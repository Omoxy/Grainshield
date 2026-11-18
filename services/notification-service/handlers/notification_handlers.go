// Package handlers implements HTTP handlers for the notification-service.
package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/go-playground/validator/v10"
	"go.uber.org/zap"

	"github.com/grainshield/notification-service/models"
	"github.com/grainshield/notification-service/repository"
	"github.com/grainshield/pkg/httputil"
	"github.com/grainshield/pkg/middleware"
)

var validate = validator.New()

// NotificationHandlers holds dependencies for all HTTP handlers.
type NotificationHandlers struct {
	repo   *repository.NotificationRepo
	audit  *middleware.AuditLogger
	logger *zap.Logger
}

// NewNotificationHandlers creates a new NotificationHandlers instance.
func NewNotificationHandlers(repo *repository.NotificationRepo, audit *middleware.AuditLogger, logger *zap.Logger) *NotificationHandlers {
	return &NotificationHandlers{repo: repo, audit: audit, logger: logger}
}

func respondJSON(w http.ResponseWriter, status int, data interface{}) {
	httputil.RespondJSON(w, status, data)
}

func respondError(w http.ResponseWriter, status int, message string) {
	httputil.RespondError(w, status, message)
}


func (h *NotificationHandlers) Send(w http.ResponseWriter, r *http.Request) {
	var req models.SendNotificationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Sanitize (Security Rule #2)
	req.Phone = middleware.SanitizeString(req.Phone, 13)
	req.Category = middleware.SanitizeString(req.Category, 50)
	for k, v := range req.Variables {
		req.Variables[k] = middleware.SanitizeString(v, 200)
	}

	if err := validate.Struct(req); err != nil {
		respondError(w, http.StatusBadRequest, "validation failed")
		return
	}

	result, err := h.repo.Send(r.Context(), req)
	if err != nil {
		if err.Error() == "no template found for category/channel" {
			respondError(w, http.StatusNotFound, err.Error())
			return
		}
		h.logger.Error("send failed", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	actor := "system"
	if claims, ok := middleware.GetClaims(r.Context()); ok {
		actor = claims.Sub
	}
	h.audit.Log(r.Context(), actor, "notification:send", "notification",
		fmt.Sprintf("%v", result["notification_id"]), map[string]interface{}{
			"channel": req.Channel, "category": req.Category, "phone": req.Phone,
		})

	respondJSON(w, http.StatusCreated, result)
}


func (h *NotificationHandlers) BulkSend(w http.ResponseWriter, r *http.Request) {
	var req models.BulkSendRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Sanitize (Security Rule #2)
	req.Category = middleware.SanitizeString(req.Category, 50)
	req.SubCounty = middleware.SanitizeString(req.SubCounty, 50)

	if err := validate.Struct(req); err != nil {
		respondError(w, http.StatusBadRequest, "validation failed")
		return
	}

	count, err := h.repo.BulkSend(r.Context(), req)
	if err != nil {
		h.logger.Error("bulk send failed", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	actor := "system"
	if claims, ok := middleware.GetClaims(r.Context()); ok {
		actor = claims.Sub
	}
	h.audit.Log(r.Context(), actor, "notification:bulk_send", "notification", "bulk", map[string]interface{}{
		"category": req.Category, "channel": req.Channel, "recipients": count,
	})

	respondJSON(w, http.StatusAccepted, map[string]interface{}{
		"queued": true, "category": req.Category, "channel": req.Channel,
		"recipients": count,
		"message":    fmt.Sprintf("Bulk notification queued for %d farmers", count),
	})
}


func (h *NotificationHandlers) List(w http.ResponseWriter, r *http.Request) {
	category := r.URL.Query().Get("category")
	status := r.URL.Query().Get("status")

	notifs, err := h.repo.List(r.Context(), category, status)
	if err != nil {
		h.logger.Error("failed to list notifications", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{"notifications": notifs})
}


func (h *NotificationHandlers) ListTemplates(w http.ResponseWriter, r *http.Request) {
	templates, err := h.repo.ListTemplates(r.Context())
	if err != nil {
		h.logger.Error("failed to list templates", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	respondJSON(w, http.StatusOK, map[string]interface{}{"templates": templates})
}


func (h *NotificationHandlers) GetStats(w http.ResponseWriter, r *http.Request) {
	stats, err := h.repo.GetStats(r.Context())
	if err != nil {
		h.logger.Error("failed to get stats", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	respondJSON(w, http.StatusOK, stats)
}
