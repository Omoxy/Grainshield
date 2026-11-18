package handlers

import (
	"encoding/json"
	"net/http"
	"strings"

	"go.uber.org/zap"

	"github.com/grainshield/farmer-service/models"
	"github.com/grainshield/pkg/middleware"
)

// Register handles POST /api/v1/farmers
// Flow: auth → authz → rate limit → validate → audit → create → respond
func (h *Handlers) Register(w http.ResponseWriter, r *http.Request) {
	// 1. Auth + Authz already handled by middleware chain

	// 2. Parse request body
	var req models.CreateFarmerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// 3. Validate and sanitize all inputs
	if err := sanitizeCreateRequest(&req); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}

	// 4. Extract actor from JWT and set registered_by (extension officer tracking)
	actor := "anonymous"
	claims, ok := middleware.GetClaims(r.Context())
	if ok {
		actor = claims.Sub
	}
	req.RegisteredBy = actor

	// 5. Check for duplicate national ID
	exists, err := h.repo.CheckNationalIDExists(r.Context(), req.NationalID)
	if err != nil {
		h.logger.Error("failed to check national ID", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	if exists {
		respondError(w, http.StatusConflict, "a farmer with this national ID is already registered")
		return
	}

	// 6. Check for duplicate phone
	phoneExists, err := h.repo.CheckPhoneExists(r.Context(), req.Phone)
	if err != nil {
		h.logger.Error("failed to check phone", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	if phoneExists {
		respondError(w, http.StatusConflict, "a farmer with this phone number is already registered")
		return
	}

	// 7. Audit log BEFORE business logic (Security Rule #4)
	h.audit.Log(r.Context(), actor, "farmer:create", "farmer", "new", map[string]interface{}{
		"name":          req.Name,
		"sub_county":    req.SubCounty,
		"phone_last4":   lastN(req.Phone, 4),
		"registered_by": actor,
	})

	// 8. Create farmer
	farmer, err := h.repo.Create(r.Context(), req)
	if err != nil {
		h.logger.Error("failed to create farmer", zap.Error(err))
		// Check for unique constraint violations
		if strings.Contains(err.Error(), "unique") || strings.Contains(err.Error(), "duplicate") {
			respondError(w, http.StatusConflict, "farmer already registered")
			return
		}
		respondError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	// 9. Return response (FarmerResponse strips encrypted fields)
	respondJSON(w, http.StatusCreated, farmer.ToResponse())
}

// lastN returns the last n characters of a string (for audit logging phone numbers).
func lastN(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[len(s)-n:]
}
