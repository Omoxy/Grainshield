// Package handlers implements HTTP handlers for the warehouse-service.
package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/go-playground/validator/v10"
	"github.com/google/uuid"
	"go.uber.org/zap"

	"github.com/grainshield/pkg/httputil"
	"github.com/grainshield/pkg/middleware"
	"github.com/grainshield/warehouse-service/models"
	"github.com/grainshield/warehouse-service/repository"
)

var validate = validator.New()

// WarehouseHandlers holds dependencies for all HTTP handlers.
type WarehouseHandlers struct {
	repo   *repository.WarehouseRepo
	audit  *middleware.AuditLogger
	logger *zap.Logger
}

// NewWarehouseHandlers creates a new WarehouseHandlers instance.
func NewWarehouseHandlers(repo *repository.WarehouseRepo, audit *middleware.AuditLogger, logger *zap.Logger) *WarehouseHandlers {
	return &WarehouseHandlers{repo: repo, audit: audit, logger: logger}
}

func respondJSON(w http.ResponseWriter, status int, data interface{}) {
	httputil.RespondJSON(w, status, data)
}

func respondError(w http.ResponseWriter, status int, message string) {
	httputil.RespondError(w, status, message)
}


func (h *WarehouseHandlers) ListWarehouses(w http.ResponseWriter, r *http.Request) {
	warehouses, err := h.repo.ListWarehouses(r.Context())
	if err != nil {
		h.logger.Error("failed to list warehouses", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	respondJSON(w, http.StatusOK, map[string]interface{}{"warehouses": warehouses})
}


func (h *WarehouseHandlers) CreateDeposit(w http.ResponseWriter, r *http.Request) {
	var req models.DepositRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Sanitize (Security Rule #2)
	req.GSNumber = middleware.SanitizeString(req.GSNumber, 10)
	req.Commodity = middleware.SanitizeString(req.Commodity, 50)
	req.StorageBay = middleware.SanitizeString(req.StorageBay, 50)
	req.ReceivedBy = middleware.SanitizeString(req.ReceivedBy, 100)
	req.GrainGrade = middleware.SanitizeString(req.GrainGrade, 20)

	if err := validate.Struct(req); err != nil {
		respondError(w, http.StatusBadRequest, "validation failed")
		return
	}

	result, err := h.repo.CreateDeposit(r.Context(), req)
	if err != nil {
		errMsg := err.Error()
		if errMsg == "warehouse not found or inactive" {
			respondError(w, http.StatusNotFound, errMsg)
			return
		}
		if len(errMsg) > 20 && errMsg[:20] == "insufficient capacit" {
			respondError(w, http.StatusConflict, errMsg)
			return
		}
		h.logger.Error("deposit failed", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	actor := "system"
	if claims, ok := middleware.GetClaims(r.Context()); ok {
		actor = claims.Sub
	}
	h.audit.Log(r.Context(), actor, "deposit:create", "deposit",
		result["deposit_id"].(uuid.UUID).String(), map[string]interface{}{
			"gs_number": req.GSNumber, "bags": req.Bags, "commodity": req.Commodity,
		})

	respondJSON(w, http.StatusCreated, result)
}


func (h *WarehouseHandlers) CreateInspection(w http.ResponseWriter, r *http.Request) {
	var req models.InspectionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Sanitize (Security Rule #2)
	req.InspectorName = middleware.SanitizeString(req.InspectorName, 100)
	req.Notes = middleware.SanitizeString(req.Notes, 500)

	if err := validate.Struct(req); err != nil {
		respondError(w, http.StatusBadRequest, "validation failed")
		return
	}

	result, err := h.repo.CreateInspection(r.Context(), req)
	if err != nil {
		h.logger.Error("inspection failed", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	actor := "system"
	if claims, ok := middleware.GetClaims(r.Context()); ok {
		actor = claims.Sub
	}
	h.audit.Log(r.Context(), actor, "inspection:create", "inspection",
		result["inspection_id"].(uuid.UUID).String(), map[string]interface{}{
			"result": result["result"], "deposit_status": result["deposit_status"],
		})

	respondJSON(w, http.StatusCreated, result)
}


func (h *WarehouseHandlers) ListDeposits(w http.ResponseWriter, r *http.Request) {
	whID := chi.URLParam(r, "id")
	warehouseID, err := uuid.Parse(whID)
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid warehouse ID")
		return
	}

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

	deposits, err := h.repo.ListDeposits(r.Context(), warehouseID, page, limit)
	if err != nil {
		h.logger.Error("failed to list deposits", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{"deposits": deposits, "page": page, "limit": limit})
}


func (h *WarehouseHandlers) GetStats(w http.ResponseWriter, r *http.Request) {
	stats, err := h.repo.GetStats(r.Context())
	if err != nil {
		h.logger.Error("failed to get stats", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	respondJSON(w, http.StatusOK, stats)
}
