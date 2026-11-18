// Package handlers implements HTTP handlers for the farmer-service.
// Every handler follows the pattern: auth → authz → rate limit → validate → audit → business logic.
package handlers

import (
	"net/http"
	"regexp"

	"github.com/go-playground/validator/v10"
	"go.uber.org/zap"

	"github.com/grainshield/farmer-service/models"
	"github.com/grainshield/farmer-service/repository"
	"github.com/grainshield/pkg/httputil"
	"github.com/grainshield/pkg/middleware"
)

// validate is the shared validator instance.
var validate = validator.New()

// Phone regex: +254 followed by 7 or 1 and 8 digits
var phoneRegex = regexp.MustCompile(`^\+254[17]\d{8}$`)

// Name regex: letters, spaces, hyphens, apostrophes
var nameRegex = regexp.MustCompile(`^[a-zA-Z\s\-']{2,100}$`)

// National ID regex: exactly 8 digits
var nationalIDRegex = regexp.MustCompile(`^\d{8}$`)

// Handlers holds dependencies for all HTTP handlers.
type Handlers struct {
	repo   *repository.FarmerRepo
	audit  *middleware.AuditLogger
	logger *zap.Logger
}

// NewHandlers creates a new Handlers instance with all dependencies.
func NewHandlers(repo *repository.FarmerRepo, audit *middleware.AuditLogger, logger *zap.Logger) *Handlers {
	return &Handlers{repo: repo, audit: audit, logger: logger}
}

// respondJSON delegates to the shared httputil package.
func respondJSON(w http.ResponseWriter, status int, data interface{}) {
	httputil.RespondJSON(w, status, data)
}

// respondError delegates to the shared httputil package.
func respondError(w http.ResponseWriter, status int, message string) {
	httputil.RespondError(w, status, message)
}

// sanitizeCreateRequest validates and sanitizes a CreateFarmerRequest.
func sanitizeCreateRequest(req *models.CreateFarmerRequest) error {
	// Sanitize string fields
	req.Name = middleware.SanitizeString(req.Name, 100)
	req.NationalID = middleware.SanitizeString(req.NationalID, 8)
	req.Phone = middleware.SanitizeString(req.Phone, 13)

	// Validate with struct tags
	if err := validate.Struct(req); err != nil {
		return err
	}

	// Regex validation
	if !nameRegex.MatchString(req.Name) {
		return &validationError{Field: "name", Message: "must contain only letters, spaces, hyphens, and apostrophes"}
	}
	if !nationalIDRegex.MatchString(req.NationalID) {
		return &validationError{Field: "national_id", Message: "must be exactly 8 digits"}
	}
	if !phoneRegex.MatchString(req.Phone) {
		return &validationError{Field: "phone", Message: "must be in +254 format (e.g. +254712345678)"}
	}

	// Enum validation
	if !models.ValidSubCounties[req.SubCounty] {
		return &validationError{Field: "sub_county", Message: "must be one of: Kiminini, Kwanza, Saboti, Endebess, Cherangany"}
	}
	if !models.ValidLanguages[req.Language] {
		return &validationError{Field: "language", Message: "must be 'sw' or 'en'"}
	}

	return nil
}

// validationError represents a field-level validation error.
type validationError struct {
	Field   string
	Message string
}

func (e *validationError) Error() string {
	return e.Field + ": " + e.Message
}

// RevOpsSummary returns aggregated farmer metrics for the RevOps dashboard.
func (h *Handlers) RevOpsSummary(w http.ResponseWriter, r *http.Request) {
	summary, err := h.repo.GetRevOpsSummary(r.Context())
	if err != nil {
		h.logger.Error("failed to get revops summary", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	respondJSON(w, http.StatusOK, summary)
}
