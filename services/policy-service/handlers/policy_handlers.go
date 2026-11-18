// Package handlers implements HTTP handlers for the policy-service.
// Every handler follows the pattern: auth → authz → rate limit → validate → sanitize → audit → business logic.
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
	"github.com/grainshield/policy-service/models"
	"github.com/grainshield/policy-service/repository"
	"github.com/grainshield/policy-service/trigger"
)

// validate is the shared validator instance.
var validate = validator.New()

// PolicyHandlers holds dependencies for all HTTP handlers.
type PolicyHandlers struct {
	repo       *repository.PolicyRepo
	audit      *middleware.AuditLogger
	logger     *zap.Logger
	premCalc   *trigger.PremiumCalculator
	engine     *trigger.Engine
}

// NewPolicyHandlers creates a new PolicyHandlers instance with all dependencies.
func NewPolicyHandlers(
	repo *repository.PolicyRepo,
	audit *middleware.AuditLogger,
	logger *zap.Logger,
	premCalc *trigger.PremiumCalculator,
	engine *trigger.Engine,
) *PolicyHandlers {
	return &PolicyHandlers{
		repo:     repo,
		audit:    audit,
		logger:   logger,
		premCalc: premCalc,
		engine:   engine,
	}
}

// respondJSON delegates to the shared httputil package.
func respondJSON(w http.ResponseWriter, status int, data interface{}) {
	httputil.RespondJSON(w, status, data)
}

// respondError delegates to the shared httputil package.
func respondError(w http.ResponseWriter, status int, message string) {
	httputil.RespondError(w, status, message)
}


func (h *PolicyHandlers) CreatePolicy(w http.ResponseWriter, r *http.Request) {
	var req models.CreatePolicyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Sanitize string fields (Security Rule #2)
	req.FarmerGSNumber = middleware.SanitizeString(req.FarmerGSNumber, 10)
	req.StorageBay = middleware.SanitizeString(req.StorageBay, 50)
	req.GrainGrade = middleware.SanitizeString(req.GrainGrade, 20)
	req.SubCounty = middleware.SanitizeString(req.SubCounty, 50)

	if err := validate.Struct(req); err != nil {
		respondError(w, http.StatusBadRequest, "validation failed: "+err.Error())
		return
	}

	// Validate grain grade enum
	if !models.ValidGrainGrades[req.GrainGrade] {
		respondError(w, http.StatusBadRequest, "grain_grade must be Grade 1, Grade 2, or Grade 3")
		return
	}

	// Calculate premium with dynamic risk adjustment
	premCalc := h.premCalc.Calculate(r.Context(), req)

	result, err := h.repo.Create(r.Context(), req, premCalc)
	if err != nil {
		h.logger.Error("failed to create policy", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	// Audit log (Security Rule #4)
	actor := "system"
	if claims, ok := middleware.GetClaims(r.Context()); ok {
		actor = claims.Sub
	}
	h.audit.Log(r.Context(), actor, "policy:create", "policy",
		result["id"].(uuid.UUID).String(), map[string]interface{}{
			"contract_id":      result["contract_id"],
			"farmer":           req.FarmerGSNumber,
			"bags":             req.Bags,
			"insured_value":    result["insured_value"],
			"premium":          result["premium"],
			"blockchain_hash":  result["blockchain_hash"],
			"risk_score":       premCalc.RiskScore,
			"adjustment":       premCalc.AdjustmentFactor,
			"cost_of_production": req.CostOfProduction,
		})

	respondJSON(w, http.StatusCreated, result)
}


func (h *PolicyHandlers) GetPolicy(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	policyID, err := uuid.Parse(idStr)
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid policy ID")
		return
	}

	policy, triggers, err := h.repo.GetByID(r.Context(), policyID)
	if err != nil {
		h.logger.Error("failed to get policy", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	if policy == nil {
		respondError(w, http.StatusNotFound, "policy not found")
		return
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{"policy": policy, "triggers": triggers})
}


func (h *PolicyHandlers) ListPolicies(w http.ResponseWriter, r *http.Request) {
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
	status := r.URL.Query().Get("status")
	farmerGS := middleware.SanitizeString(r.URL.Query().Get("farmer_gs"), 10)

	policies, totalCount, err := h.repo.List(r.Context(), status, farmerGS, page, limit)
	if err != nil {
		h.logger.Error("failed to list policies", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"policies": policies, "total_count": totalCount, "page": page, "limit": limit,
	})
}


func (h *PolicyHandlers) FireTrigger(w http.ResponseWriter, r *http.Request) {
	var req models.FireTriggerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Sanitize string fields (Security Rule #2)
	req.DataSource = middleware.SanitizeString(req.DataSource, 100)
	req.ConfirmedBy = middleware.SanitizeString(req.ConfirmedBy, 100)

	if err := validate.Struct(req); err != nil {
		respondError(w, http.StatusBadRequest, "validation failed")
		return
	}

	triggerID, err := uuid.Parse(req.TriggerID)
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid trigger_id")
		return
	}

	result, err := h.repo.FireTrigger(r.Context(), triggerID, req.ConfirmedBy)
	if err != nil {
		errMsg := err.Error()
		if errMsg == "trigger not found" {
			respondError(w, http.StatusNotFound, errMsg)
			return
		}
		if errMsg == "trigger is not in armed state" {
			respondError(w, http.StatusConflict, errMsg)
			return
		}
		h.logger.Error("trigger fire failed", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	// Audit log (Security Rule #4)
	h.audit.Log(r.Context(), req.ConfirmedBy, "trigger:fire", "claim",
		result["claim_id"].(uuid.UUID).String(), map[string]interface{}{
			"trigger_type":    result["trigger_type"],
			"amount":          result["amount"],
			"data_source":     req.DataSource,
			"payout_deadline": result["payout_deadline"],
		})

	result["message"] = "Trigger fired. Claim created. Payment queued. Payout deadline: 4 hours."
	respondJSON(w, http.StatusCreated, result)
}


func (h *PolicyHandlers) ListClaims(w http.ResponseWriter, r *http.Request) {
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
	farmerGS := middleware.SanitizeString(r.URL.Query().Get("farmer_gs"), 10)

	claims, err := h.repo.ListClaims(r.Context(), farmerGS, page, limit)
	if err != nil {
		h.logger.Error("failed to list claims", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{"claims": claims, "page": page, "limit": limit})
}


func (h *PolicyHandlers) RevOpsSummary(w http.ResponseWriter, r *http.Request) {
	summary, err := h.repo.GetRevOpsSummary(r.Context())
	if err != nil {
		h.logger.Error("failed to get revops summary", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	respondJSON(w, http.StatusOK, summary)
}


func (h *PolicyHandlers) GetStats(w http.ResponseWriter, r *http.Request) {
	stats, err := h.repo.GetStats(r.Context())
	if err != nil {
		h.logger.Error("failed to get stats", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	respondJSON(w, http.StatusOK, stats)
}


func (h *PolicyHandlers) EvaluateTriggers(w http.ResponseWriter, r *http.Request) {
	var req models.EvaluateTriggersRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		// Allow empty body — evaluate all types
		req = models.EvaluateTriggersRequest{}
	}

	actor := "system"
	if claims, ok := middleware.GetClaims(r.Context()); ok {
		actor = claims.Sub
	}

	h.audit.Log(r.Context(), actor, "trigger:manual_evaluate", "policy", "all",
		map[string]interface{}{
			"trigger_type": req.TriggerType,
			"dry_run":      req.DryRun,
		})

	if req.TriggerType != "" {
		count := h.engine.RunSingleType(r.Context(), models.TriggerType(req.TriggerType))
		respondJSON(w, http.StatusOK, map[string]interface{}{
			"evaluated":    count,
			"trigger_type": req.TriggerType,
			"message":      "evaluation cycle complete",
		})
		return
	}

	// Evaluate all types
	h.engine.RunEvaluationCycle(r.Context())

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"message": "full evaluation cycle complete",
	})
}


func (h *PolicyHandlers) ExpirePolicies(w http.ResponseWriter, r *http.Request) {
	actor := "system"
	if claims, ok := middleware.GetClaims(r.Context()); ok {
		actor = claims.Sub
	}

	expired, err := h.engine.ExpireOverduePolicies(r.Context())
	if err != nil {
		h.logger.Error("failed to expire policies", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	h.audit.Log(r.Context(), actor, "policy:manual_expire", "policy", "batch",
		map[string]interface{}{"expired_count": expired})

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"expired_count": expired,
		"message":       "policy expiry check complete",
	})
}


func (h *PolicyHandlers) ListOverduePayouts(w http.ResponseWriter, r *http.Request) {
	claims, err := h.repo.GetOverduePayouts(r.Context())
	if err != nil {
		h.logger.Error("failed to get overdue payouts", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"overdue_payouts": claims,
		"count":           len(claims),
	})
}
