package handlers

import (
	"net/http"
	"strconv"

	"github.com/grainshield/farmer-service/models"
	"github.com/grainshield/pkg/middleware"
	"go.uber.org/zap"
)

// List handles GET /api/v1/farmers?sub_county=Kiminini&page=1&limit=20
// Flow: auth → authz → rate limit → validate query params → list → respond
func (h *Handlers) List(w http.ResponseWriter, r *http.Request) {
	// 1. Parse and validate query parameters
	subCounty := middleware.SanitizeString(r.URL.Query().Get("sub_county"), 20)

	// Validate sub_county if provided
	if subCounty != "" {
		if !models.ValidSubCounties[models.SubCounty(subCounty)] {
			respondError(w, http.StatusBadRequest, "invalid sub_county — must be one of: Kiminini, Kwanza, Saboti, Endebess, Cherangany")
			return
		}
	}

	// Parse page (default 1, min 1)
	page := 1
	if p := r.URL.Query().Get("page"); p != "" {
		parsed, err := strconv.Atoi(p)
		if err != nil || parsed < 1 {
			respondError(w, http.StatusBadRequest, "page must be a positive integer")
			return
		}
		if parsed > 10000 {
			respondError(w, http.StatusBadRequest, "page must be at most 10000")
			return
		}
		page = parsed
	}

	// Parse limit (default 20, max 100)
	limit := 20
	if l := r.URL.Query().Get("limit"); l != "" {
		parsed, err := strconv.Atoi(l)
		if err != nil || parsed < 1 {
			respondError(w, http.StatusBadRequest, "limit must be a positive integer")
			return
		}
		if parsed > 100 {
			respondError(w, http.StatusBadRequest, "limit must be at most 100")
			return
		}
		limit = parsed
	}

	// 2. Fetch from database
	farmers, totalCount, err := h.repo.List(r.Context(), subCounty, page, limit)
	if err != nil {
		h.logger.Error("failed to list farmers", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	// 3. Convert to safe responses
	responses := make([]models.FarmerResponse, 0, len(farmers))
	for i := range farmers {
		responses = append(responses, farmers[i].ToResponse())
	}

	// 4. Return paginated response
	respondJSON(w, http.StatusOK, models.FarmerListResponse{
		Farmers:    responses,
		TotalCount: totalCount,
		Page:       page,
		Limit:      limit,
	})
}
