// Package handlers implements HTTP handlers for the payment-service.
// Security Rule #9: Error responses never expose internal details.
// Payment Rule: M-Pesa callbacks acknowledged within 5 seconds.
// Payment Rule: Every payment attempt writes an audit record.
package handlers

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/go-playground/validator/v10"
	"github.com/google/uuid"
	"go.uber.org/zap"

	"github.com/grainshield/payment-service/mpesa"
	"github.com/grainshield/payment-service/models"
	"github.com/grainshield/payment-service/repository"
	"github.com/grainshield/pkg/httputil"
	"github.com/grainshield/pkg/middleware"
)

var validate = validator.New()

// PaymentHandlers holds dependencies for all HTTP handlers.
type PaymentHandlers struct {
	repo        *repository.PaymentRepo
	audit       *middleware.AuditLogger
	logger      *zap.Logger
	mpesaClient *mpesa.Client
}

// NewPaymentHandlers creates a new PaymentHandlers instance with all dependencies.
func NewPaymentHandlers(
	repo *repository.PaymentRepo,
	audit *middleware.AuditLogger,
	logger *zap.Logger,
	mpesaClient *mpesa.Client,
) *PaymentHandlers {
	return &PaymentHandlers{
		repo:        repo,
		audit:       audit,
		logger:      logger,
		mpesaClient: mpesaClient,
	}
}

func respondJSON(w http.ResponseWriter, status int, data interface{}) {
	httputil.RespondJSON(w, status, data)
}

func respondError(w http.ResponseWriter, status int, message string) {
	httputil.RespondError(w, status, message)
}


func (h *PaymentHandlers) Disburse(w http.ResponseWriter, r *http.Request) {
	var req models.DisburseRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Sanitize string fields (Security Rule #2)
	req.FarmerGSNumber = middleware.SanitizeString(req.FarmerGSNumber, 10)
	req.Phone = middleware.SanitizeString(req.Phone, 13)
	req.ReferenceType = middleware.SanitizeString(req.ReferenceType, 20)

	if err := validate.Struct(req); err != nil {
		respondError(w, http.StatusBadRequest, "validation failed")
		return
	}

	// Audit: payment attempt started (Security Rule #4: every attempt, success or failure)
	actor := "payment-service"
	if claims, ok := middleware.GetClaims(r.Context()); ok {
		actor = claims.Sub
	}

	// Create payment record with idempotency check
	result, err := h.repo.Disburse(r.Context(), req)
	if err != nil {
		h.logger.Error("failed to create payment", zap.Error(err))
		// Audit failure
		h.audit.Log(r.Context(), actor, "payment:initiate_failed", "payment", "new",
			map[string]interface{}{
				"farmer": req.FarmerGSNumber,
				"amount": req.Amount,
				"error":  "payment creation failed",
			})
		respondError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	// Check if this was an idempotent return
	if idempotent, ok := result["idempotent"].(bool); ok && idempotent {
		h.audit.Log(r.Context(), actor, "payment:idempotent_return", "payment",
			result["payment_id"].(uuid.UUID).String(), map[string]interface{}{
				"farmer": req.FarmerGSNumber,
				"amount": req.Amount,
			})
		respondJSON(w, http.StatusOK, result)
		return
	}

	paymentID := result["payment_id"].(uuid.UUID)

	// Audit success
	h.audit.Log(r.Context(), actor, "payment:initiate", "payment",
		paymentID.String(), map[string]interface{}{
			"farmer":    req.FarmerGSNumber,
			"amount":    req.Amount,
			"direction": "b2c",
		})

	// Initiate M-Pesa B2C if client is configured
	if h.mpesaClient != nil && h.mpesaClient.IsConfigured() {
		occasion := paymentID.String()[:8]
		b2cResp, b2cErr := h.mpesaClient.InitiateB2C(r.Context(), req.Phone, req.Amount, occasion)

		// Audit B2C attempt regardless of outcome (Payment Rule #4)
		h.audit.Log(r.Context(), actor, "payment:b2c_attempt", "payment",
			paymentID.String(), map[string]interface{}{
				"success": b2cErr == nil,
			})

		if b2cErr == nil && b2cResp != nil {
			if updateErr := h.repo.UpdateMpesaRequestID(r.Context(), paymentID, b2cResp.ConversationID); updateErr != nil {
				h.logger.Error("failed to update conversation ID", zap.Error(updateErr))
			}
			result["conversation_id"] = b2cResp.ConversationID
			result["status"] = "pending"
		}
	}

	respondJSON(w, http.StatusCreated, result)
}

// Payment Rule: Acknowledge within 5 seconds. Queue first, process after.

func (h *PaymentHandlers) MPesaCallback(w http.ResponseWriter, r *http.Request) {
	// Read body immediately — must acknowledge within 5 seconds
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		w.WriteHeader(http.StatusOK)
		return
	}

	// Acknowledge IMMEDIATELY (Payment Rule: 5-second acknowledgement)
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"ResultCode":0,"ResultDesc":"Success"}`))

	// Parse and process asynchronously
	go func() {
		callback, parseErr := mpesa.ParseCallback(body)
		if parseErr != nil {
			h.logger.Error("failed to parse callback", zap.Error(parseErr))
			return
		}

		result := callback.Result
		if processErr := h.repo.ProcessCallback(
			r.Context(),
			result.ConversationID,
			result.OriginatorConversationID,
			result.TransactionID,
			result.ResultDesc,
			result.ResultCode,
		); processErr != nil {
			h.logger.Error("callback processing failed", zap.Error(processErr))
		}

		// Audit callback receipt (Security Rule #4)
		h.audit.Log(r.Context(), "mpesa-callback", "payment:callback_received", "payment",
			result.ConversationID, map[string]interface{}{
				"result_code":    result.ResultCode,
				"transaction_id": result.TransactionID,
			})
	}()
}


func (h *PaymentHandlers) ListPayments(w http.ResponseWriter, r *http.Request) {
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit < 1 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}

	payments, err := h.repo.List(r.Context(), page, limit)
	if err != nil {
		h.logger.Error("failed to list payments", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{"payments": payments, "page": page, "limit": limit})
}


func (h *PaymentHandlers) GetPayment(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	paymentID, err := uuid.Parse(idStr)
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid payment ID")
		return
	}

	payment, err := h.repo.GetByID(r.Context(), paymentID)
	if err != nil {
		h.logger.Error("failed to get payment", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	if payment == nil {
		respondError(w, http.StatusNotFound, "payment not found")
		return
	}

	respondJSON(w, http.StatusOK, payment)
}


func (h *PaymentHandlers) RevOpsSummary(w http.ResponseWriter, r *http.Request) {
	summary, err := h.repo.GetRevOpsSummary(r.Context())
	if err != nil {
		h.logger.Error("failed to get revops summary", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	respondJSON(w, http.StatusOK, summary)
}


func (h *PaymentHandlers) GetStats(w http.ResponseWriter, r *http.Request) {
	stats, err := h.repo.GetStats(r.Context())
	if err != nil {
		h.logger.Error("failed to get stats", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	respondJSON(w, http.StatusOK, stats)
}


func (h *PaymentHandlers) ListBankFees(w http.ResponseWriter, r *http.Request) {
	fees, err := h.repo.ListBankFees(r.Context())
	if err != nil {
		h.logger.Error("failed to list bank fees", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	respondJSON(w, http.StatusOK, map[string]interface{}{"bank_fees": fees})
}


func (h *PaymentHandlers) CalculateBankFee(w http.ResponseWriter, r *http.Request) {
	bankCode := chi.URLParam(r, "code")
	amountStr := r.URL.Query().Get("amount")
	amount, err := strconv.ParseFloat(amountStr, 64)
	if err != nil || amount <= 0 {
		respondError(w, http.StatusBadRequest, "amount must be a positive number")
		return
	}

	fee, err := h.repo.GetBankFee(r.Context(), bankCode)
	if err != nil {
		h.logger.Error("failed to get bank fee", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	if fee == nil {
		respondError(w, http.StatusNotFound, "bank not found")
		return
	}

	calculatedFee := fee.CalculateFee(amount)
	respondJSON(w, http.StatusOK, map[string]interface{}{
		"bank_code":    fee.BankCode,
		"bank_name":    fee.BankName,
		"amount":       amount,
		"fee_pct":      fee.FeePct,
		"fee_amount":   calculatedFee,
		"net_amount":   amount - calculatedFee,
	})
}
