package handlers

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

// Get handles GET /api/v1/farmers/{id}
// Flow: auth → authz → rate limit → validate UUID → fetch → respond
func (h *Handlers) Get(w http.ResponseWriter, r *http.Request) {
	// 1. Extract and validate farmer ID from URL path
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

	// 2. Fetch from database
	farmer, err := h.repo.GetByID(r.Context(), farmerID)
	if err != nil {
		h.logger.Error("failed to get farmer", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	// 3. Handle not found
	if farmer == nil {
		respondError(w, http.StatusNotFound, "farmer not found")
		return
	}

	// 4. Return safe response (no encrypted fields)
	respondJSON(w, http.StatusOK, farmer.ToResponse())
}
