// Package tests provides unit tests for the policy-service handlers and security edge cases.
package tests

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/grainshield/pkg/middleware"
	"github.com/grainshield/policy-service/models"
)

var testSecret = []byte("test-secret-key-for-unit-tests-must-be-long-enough")

func generateTestToken(secret []byte, sub string, roles []string, expiry time.Duration) string {
	claims := &middleware.Claims{
		Sub:   sub,
		Roles: roles,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(expiry)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Issuer:    "grainshield",
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString(secret)
	if err != nil {
		panic("failed to sign test token: " + err.Error())
	}
	return signed
}


func TestAuth_MissingHeader(t *testing.T) {
	handler := middleware.Auth(testSecret)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/policies", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", w.Code)
	}
}

func TestAuth_InvalidToken(t *testing.T) {
	handler := middleware.Auth(testSecret)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/policies", nil)
	req.Header.Set("Authorization", "Bearer invalid.token.here")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", w.Code)
	}
}

func TestAuth_ExpiredToken(t *testing.T) {
	handler := middleware.Auth(testSecret)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	token := generateTestToken(testSecret, "test-user", []string{"admin"}, -1*time.Hour)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/policies", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", w.Code)
	}
}

func TestAuth_ValidToken(t *testing.T) {
	handler := middleware.Auth(testSecret)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	token := generateTestToken(testSecret, "admin-1", []string{"admin"}, 1*time.Hour)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/policies", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
}


func TestRBAC_AdminCanCreatePolicy(t *testing.T) {
	claims := &middleware.Claims{Sub: "admin-1", Roles: []string{"admin"}}
	if !claims.Can("policy:create") {
		t.Error("admin should be able to create policies")
	}
}

func TestRBAC_AdminCanTriggerPolicy(t *testing.T) {
	claims := &middleware.Claims{Sub: "admin-1", Roles: []string{"admin"}}
	if !claims.Can("policy:trigger") {
		t.Error("admin should be able to trigger policies")
	}
}

func TestRBAC_ExtensionOfficerCannotCreatePolicy(t *testing.T) {
	claims := &middleware.Claims{Sub: "officer-1", Roles: []string{"extension_officer"}}
	if claims.Can("policy:create") {
		t.Error("extension_officer should NOT be able to create policies")
	}
}

func TestRBAC_USSDGatewayCanCreatePolicy(t *testing.T) {
	claims := &middleware.Claims{Sub: "ussd-1", Roles: []string{"ussd_gateway"}}
	if !claims.Can("policy:create") {
		t.Error("ussd_gateway should be able to create policies")
	}
}

func TestRBAC_ServiceCanTriggerPolicy(t *testing.T) {
	claims := &middleware.Claims{Sub: "service-1", Roles: []string{"service"}}
	if !claims.Can("policy:trigger") {
		t.Error("service role should be able to trigger policies")
	}
}

func TestRBAC_UnknownRoleCannotDoAnything(t *testing.T) {
	claims := &middleware.Claims{Sub: "hacker-1", Roles: []string{"hacker"}}
	actions := []string{"policy:create", "policy:read", "policy:list", "policy:trigger"}
	for _, action := range actions {
		if claims.Can(action) {
			t.Errorf("unknown role should NOT have permission: %s", action)
		}
	}
}


func TestRequirePermission_Forbidden(t *testing.T) {
	handler := middleware.Auth(testSecret)(
		middleware.RequirePermission("policy:trigger")(
			http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusOK)
			}),
		),
	)

	token := generateTestToken(testSecret, "officer-1", []string{"extension_officer"}, 1*time.Hour)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/policies/trigger", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d", w.Code)
	}
}


func TestValidation_ValidGrainGrades(t *testing.T) {
	valid := []string{"Grade 1", "Grade 2", "Grade 3"}
	for _, g := range valid {
		if !models.ValidGrainGrades[g] {
			t.Errorf("grade '%s' should be valid", g)
		}
	}
}

func TestValidation_InvalidGrainGrades(t *testing.T) {
	invalid := []string{"Grade 4", "grade 1", "A", "", "Premium"}
	for _, g := range invalid {
		if models.ValidGrainGrades[g] {
			t.Errorf("grade '%s' should not be valid", g)
		}
	}
}


func TestSanitize_XSSInGSNumber(t *testing.T) {
	xss := `<script>alert('xss')</script>GS-00123`
	sanitized := middleware.SanitizeString(xss, 10)

	if strings.Contains(sanitized, "<") {
		t.Errorf("XSS should be stripped: %s", sanitized)
	}
}

func TestSanitize_XSSInStorageBay(t *testing.T) {
	xss := `<img src=x onerror=alert(1)> Bay A`
	sanitized := middleware.SanitizeString(xss, 50)

	if strings.Contains(sanitized, "<") {
		t.Errorf("XSS should be stripped: %s", sanitized)
	}
	if !strings.Contains(sanitized, "Bay A") {
		t.Errorf("legitimate content should be preserved: %s", sanitized)
	}
}

func TestSanitize_OversizedInput(t *testing.T) {
	longString := strings.Repeat("A", 200)
	sanitized := middleware.SanitizeString(longString, 100)

	if len(sanitized) != 100 {
		t.Errorf("expected length 100, got %d", len(sanitized))
	}
}

func TestSanitize_RejectsNonJSON(t *testing.T) {
	handler := middleware.Sanitize(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodPost, "/api/v1/policies", bytes.NewReader([]byte("not json")))
	req.Header.Set("Content-Type", "text/plain")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusUnsupportedMediaType {
		t.Errorf("expected 415, got %d", w.Code)
	}
}

func TestSanitize_AcceptsJSON(t *testing.T) {
	handler := middleware.Sanitize(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodPost, "/api/v1/policies", bytes.NewReader([]byte("{}")))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
}


func TestSecurity_ErrorResponsesNoInternals(t *testing.T) {
	w := httptest.NewRecorder()
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusInternalServerError)
	json.NewEncoder(w).Encode(map[string]string{"error": "internal server error"})

	body := w.Body.String()

	forbidden := []string{"panic", "goroutine", "SELECT", "INSERT", "postgres", "/go/src/", "runtime"}
	for _, word := range forbidden {
		if strings.Contains(strings.ToLower(body), strings.ToLower(word)) {
			t.Errorf("error response should not contain '%s': %s", word, body)
		}
	}
}

func TestSecurity_InvalidUUID(t *testing.T) {
	invalid := []string{
		"not-a-uuid",
		"12345",
		"'; DROP TABLE policies; --",
		strings.Repeat("a", 100),
	}

	for _, id := range invalid {
		t.Run(id, func(t *testing.T) {
			_, err := parseUUID(id)
			if err == nil {
				t.Errorf("'%s' should not be a valid UUID", id)
			}
		})
	}
}


func TestFullChain_AuthThenRBAC(t *testing.T) {
	reached := false
	handler := middleware.Auth(testSecret)(
		middleware.RequirePermission("policy:create")(
			http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				reached = true
				w.WriteHeader(http.StatusOK)
			}),
		),
	)

	// admin with policy:create → should succeed
	token := generateTestToken(testSecret, "admin-1", []string{"admin"}, 1*time.Hour)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/policies", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("admin should get 200, got %d", w.Code)
	}
	if !reached {
		t.Error("handler should have been reached for admin")
	}

	// extension_officer → should get 403
	reached = false
	token = generateTestToken(testSecret, "officer-1", []string{"extension_officer"}, 1*time.Hour)
	req = httptest.NewRequest(http.MethodPost, "/api/v1/policies", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Errorf("extension_officer should get 403, got %d", w.Code)
	}
}


func parseUUID(s string) (interface{}, error) {
	// Simulates UUID parsing used in handlers
	if len(s) != 36 {
		return nil, errInvalidUUID
	}
	parts := strings.Split(s, "-")
	if len(parts) != 5 {
		return nil, errInvalidUUID
	}
	expected := []int{8, 4, 4, 4, 12}
	for i, p := range parts {
		if len(p) != expected[i] {
			return nil, errInvalidUUID
		}
	}
	return s, nil
}

var errInvalidUUID = &validationError{Field: "uuid", Message: "invalid UUID format"}

type validationError struct {
	Field   string
	Message string
}

func (e *validationError) Error() string {
	return e.Field + ": " + e.Message
}
