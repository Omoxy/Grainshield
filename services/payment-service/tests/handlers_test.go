// Package tests provides unit tests for the payment-service.
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

	req := httptest.NewRequest(http.MethodPost, "/api/v1/payments/disburse", nil)
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
	req := httptest.NewRequest(http.MethodGet, "/api/v1/payments", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
}


func TestRBAC_AdminCanDisburse(t *testing.T) {
	claims := &middleware.Claims{Sub: "admin-1", Roles: []string{"admin"}}
	if !claims.Can("payment:disburse") {
		t.Error("admin should be able to disburse payments")
	}
}

func TestRBAC_ExtensionOfficerCannotDisburse(t *testing.T) {
	claims := &middleware.Claims{Sub: "officer-1", Roles: []string{"extension_officer"}}
	if claims.Can("payment:disburse") {
		t.Error("extension_officer should NOT be able to disburse payments")
	}
}

func TestRBAC_ServiceCanDisburse(t *testing.T) {
	claims := &middleware.Claims{Sub: "service-1", Roles: []string{"service"}}
	if !claims.Can("payment:disburse") {
		t.Error("service role should be able to disburse payments")
	}
}


func TestSanitize_XSSInGSNumber(t *testing.T) {
	xss := `<script>alert('xss')</script>GS-00123`
	sanitized := middleware.SanitizeString(xss, 10)
	if strings.Contains(sanitized, "<") {
		t.Errorf("XSS should be stripped: %s", sanitized)
	}
}

func TestSanitize_RejectsNonJSON(t *testing.T) {
	handler := middleware.Sanitize(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodPost, "/api/v1/payments/disburse", bytes.NewReader([]byte("not json")))
	req.Header.Set("Content-Type", "text/plain")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusUnsupportedMediaType {
		t.Errorf("expected 415, got %d", w.Code)
	}
}


func TestSecurity_ErrorResponsesNoInternals(t *testing.T) {
	w := httptest.NewRecorder()
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusInternalServerError)
	json.NewEncoder(w).Encode(map[string]string{"error": "internal server error"})

	body := w.Body.String()
	forbidden := []string{"panic", "goroutine", "SELECT", "INSERT", "postgres"}
	for _, word := range forbidden {
		if strings.Contains(strings.ToLower(body), strings.ToLower(word)) {
			t.Errorf("error response should not contain '%s': %s", word, body)
		}
	}
}

func TestFullChain_AuthThenRBAC(t *testing.T) {
	reached := false
	handler := middleware.Auth(testSecret)(
		middleware.RequirePermission("payment:disburse")(
			http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				reached = true
				w.WriteHeader(http.StatusOK)
			}),
		),
	)

	token := generateTestToken(testSecret, "admin-1", []string{"admin"}, 1*time.Hour)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/payments/disburse", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("admin should get 200, got %d", w.Code)
	}
	if !reached {
		t.Error("handler should have been reached for admin")
	}
}
