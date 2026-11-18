package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"go.uber.org/zap"

	"github.com/grainshield/farmer-service/models"
	"github.com/grainshield/pkg/middleware"
)

// Update handles PUT /api/v1/farmers/{id}
// Flow: auth → authz → rate limit → validate → audit → update → respond
func (h *Handlers) Update(w http.ResponseWriter, r *http.Request) {
	// 1. Extract and validate farmer ID
	idStr := chi.URLParam(r, "id")
	if len(idStr) > 36 {
		respondError(w, http.StatusBadRequest, "invalid farmer ID format")
		return
	}

	farmerID, err := uuid.Parse(idStr)
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid farmer ID format — must be a valid UUID")
		return
	}

	// 2. Parse request body
	var req models.UpdateFarmerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// 3. Validate individual fields
	if req.Hectares != nil {
		if *req.Hectares < 0.1 || *req.Hectares > 100.0 {
			respondError(w, http.StatusBadRequest, "hectares must be between 0.1 and 100.0")
			return
		}
	}
	if req.ExpectedBags != nil {
		if *req.ExpectedBags < 1 || *req.ExpectedBags > 10000 {
			respondError(w, http.StatusBadRequest, "expected_bags must be between 1 and 10000")
			return
		}
	}
	if req.Language != nil {
		if !models.ValidLanguages[*req.Language] {
			respondError(w, http.StatusBadRequest, "language must be 'sw' or 'en'")
			return
		}
	}
	if req.Status != nil {
		validStatuses := map[models.FarmerStatus]bool{
			models.StatusActive:       true,
			models.StatusSuspended:    true,
			models.StatusDeregistered: true,
		}
		if !validStatuses[*req.Status] {
			respondError(w, http.StatusBadRequest, "status must be 'active', 'suspended', or 'deregistered'")
			return
		}
	}

	// 4. Check farmer exists
	existing, err := h.repo.GetByID(r.Context(), farmerID)
	if err != nil {
		h.logger.Error("failed to check farmer exists", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	if existing == nil {
		respondError(w, http.StatusNotFound, "farmer not found")
		return
	}

	// 5. Audit BEFORE update
	actor := "anonymous"
	claims, ok := middleware.GetClaims(r.Context())
	if ok {
		actor = claims.Sub
	}
	h.audit.Log(r.Context(), actor, "farmer:update", "farmer", farmerID.String(), map[string]interface{}{
		"gs_number": existing.GSNumber,
	})

	// 6. Perform update
	farmer, err := h.repo.Update(r.Context(), farmerID, req)
	if err != nil {
		h.logger.Error("failed to update farmer", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	if farmer == nil {
		respondError(w, http.StatusNotFound, "farmer not found")
		return
	}

	// 7. Return safe response
	respondJSON(w, http.StatusOK, farmer.ToResponse())
}
