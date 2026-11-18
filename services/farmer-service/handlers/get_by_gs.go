package handlers

import (
	"net/http"
	"regexp"

	"github.com/go-chi/chi/v5"
	"go.uber.org/zap"
)

// gsNumberRegex matches GS-XXXXX format (GS- followed by 5 digits).
var gsNumberRegex = regexp.MustCompile(`^GS-\d{5}$`)

// GetByGSNumber handles GET /api/v1/farmers/gs/{gsNumber}
// Flow: auth → authz → rate limit → validate GS number → fetch → respond
func (h *Handlers) GetByGSNumber(w http.ResponseWriter, r *http.Request) {
	// 1. Extract and validate GS number from URL path
	gsNumber := chi.URLParam(r, "gsNumber")

	// Security Rule #2: validate format — max 8 chars, exact pattern
	if len(gsNumber) > 8 {
		respondError(w, http.StatusBadRequest, "invalid GS number format")
		return
	}
	if !gsNumberRegex.MatchString(gsNumber) {
		respondError(w, http.StatusBadRequest, "invalid GS number format — must be GS-XXXXX (e.g. GS-00847)")
		return
	}

	// 2. Fetch from database (parameterized query — Security Rule #3)
	farmer, err := h.repo.GetByGSNumber(r.Context(), gsNumber)
	if err != nil {
		h.logger.Error("failed to get farmer by GS number", zap.Error(err))
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
