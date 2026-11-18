package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/google/uuid"
	"go.uber.org/zap"

	"github.com/grainshield/farmer-service/models"
	"github.com/grainshield/pkg/middleware"
)

// ListGroups handles GET /api/v1/solidarity-groups?sub_county=Kiminini
// Flow: auth → authz → rate limit → validate → list → respond
func (h *Handlers) ListGroups(w http.ResponseWriter, r *http.Request) {
	// 1. Parse and validate sub_county filter
	subCounty := middleware.SanitizeString(r.URL.Query().Get("sub_county"), 20)

	if subCounty != "" {
		if !models.ValidSubCounties[models.SubCounty(subCounty)] {
			respondError(w, http.StatusBadRequest, "invalid sub_county — must be one of: Kiminini, Kwanza, Saboti, Endebess, Cherangany")
			return
		}
	}

	// 2. Fetch from database (parameterized query — Security Rule #3)
	groups, err := h.repo.ListSolidarityGroups(r.Context(), subCounty)
	if err != nil {
		h.logger.Error("failed to list solidarity groups", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{"groups": groups})
}

// JoinGroup handles POST /api/v1/solidarity-groups/join
// Flow: auth → authz → rate limit → validate → audit → join → respond
func (h *Handlers) JoinGroup(w http.ResponseWriter, r *http.Request) {
	var req models.JoinGroupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Sanitize inputs (Security Rule #2)
	req.FarmerID = middleware.SanitizeString(req.FarmerID, 36)
	req.GroupID = middleware.SanitizeString(req.GroupID, 36)

	if err := validate.Struct(req); err != nil {
		respondError(w, http.StatusBadRequest, "validation failed")
		return
	}

	farmerID, err := uuid.Parse(req.FarmerID)
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid farmer_id format")
		return
	}
	groupID, err := uuid.Parse(req.GroupID)
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid group_id format")
		return
	}

	// Audit BEFORE business logic (Security Rule #4)
	actor := "anonymous"
	claims, ok := middleware.GetClaims(r.Context())
	if ok {
		actor = claims.Sub
	}
	h.audit.Log(r.Context(), actor, "solidarity:join", "solidarity_group",
		groupID.String(), map[string]interface{}{
			"farmer_id": farmerID.String(),
		})

	// Business logic — repo enforces max 20 members
	if err := h.repo.JoinSolidarityGroup(r.Context(), farmerID, groupID); err != nil {
		errMsg := err.Error()
		if errMsg == "farmer not found" {
			respondError(w, http.StatusNotFound, errMsg)
			return
		}
		if errMsg == "group not found" {
			respondError(w, http.StatusNotFound, errMsg)
			return
		}
		if errMsg == "group is full (maximum 20 members)" {
			respondError(w, http.StatusConflict, errMsg)
			return
		}
		if errMsg == "farmer is already in a solidarity group" {
			respondError(w, http.StatusConflict, errMsg)
			return
		}
		h.logger.Error("failed to join solidarity group", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{"message": "successfully joined solidarity group"})
}

// LeaveGroup handles POST /api/v1/solidarity-groups/leave
// Flow: auth → authz → rate limit → validate → audit → leave → respond
func (h *Handlers) LeaveGroup(w http.ResponseWriter, r *http.Request) {
	var req models.LeaveGroupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Sanitize inputs (Security Rule #2)
	req.FarmerID = middleware.SanitizeString(req.FarmerID, 36)

	if err := validate.Struct(req); err != nil {
		respondError(w, http.StatusBadRequest, "validation failed")
		return
	}

	farmerID, err := uuid.Parse(req.FarmerID)
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid farmer_id format")
		return
	}

	// Audit BEFORE business logic (Security Rule #4)
	actor := "anonymous"
	claims, ok := middleware.GetClaims(r.Context())
	if ok {
		actor = claims.Sub
	}
	h.audit.Log(r.Context(), actor, "solidarity:leave", "farmer",
		farmerID.String(), nil)

	if err := h.repo.LeaveSolidarityGroup(r.Context(), farmerID); err != nil {
		if err.Error() == "farmer not found" {
			respondError(w, http.StatusNotFound, err.Error())
			return
		}
		if err.Error() == "farmer is not in any solidarity group" {
			respondError(w, http.StatusConflict, err.Error())
			return
		}
		h.logger.Error("failed to leave solidarity group", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{"message": "successfully left solidarity group"})
}
