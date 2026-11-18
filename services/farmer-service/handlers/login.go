package handlers

import (
	"encoding/json"
	"net/http"

	"go.uber.org/zap"
)

type loginRequest struct {
	Identifier string `json:"identifier"`
	Password   string `json:"password"`
}

type loginResponse struct {
	User *loginUser `json:"user"`
}

type loginUser struct {
	ID    string   `json:"id"`
	Roles []string `json:"roles"`
}

// Login handles POST /api/v1/auth/login
// Verifies credentials against the users table and returns user info.
// The Next.js frontend issues the JWT — this endpoint only validates credentials.
func (h *Handlers) Login(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Identifier == "" || req.Password == "" {
		respondError(w, http.StatusBadRequest, "identifier and password are required")
		return
	}

	if len(req.Identifier) > 200 || len(req.Password) > 200 {
		respondError(w, http.StatusBadRequest, "input too long")
		return
	}

	user, err := h.repo.AuthenticateUser(r.Context(), req.Identifier, req.Password)
	if err != nil {
		h.logger.Error("authentication error", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	if user == nil {
		h.audit.Log(r.Context(), req.Identifier, "auth:login_failed", "user", "", map[string]interface{}{
			"ip": r.RemoteAddr,
		})
		respondError(w, http.StatusUnauthorized, "invalid credentials")
		return
	}

	h.audit.Log(r.Context(), user.ID, "auth:login_success", "user", user.ID, map[string]interface{}{
		"ip":    r.RemoteAddr,
		"roles": user.Roles,
	})

	respondJSON(w, http.StatusOK, loginResponse{
		User: &loginUser{
			ID:    user.ID,
			Roles: user.Roles,
		},
	})
}
