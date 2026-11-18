package tests

import (
	"bytes"
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
	claims := &middleware.Claims{Sub: sub, Roles: roles, RegisteredClaims: jwt.RegisteredClaims{
		ExpiresAt: jwt.NewNumericDate(time.Now().Add(expiry)), IssuedAt: jwt.NewNumericDate(time.Now()), Issuer: "grainshield",
	}}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, _ := token.SignedString(secret)
	return signed
}

func TestAuth_MissingHeader(t *testing.T) {
	handler := middleware.Auth(testSecret)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) }))
	req := httptest.NewRequest(http.MethodGet, "/api/v1/prices/current", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != 401 { t.Errorf("expected 401, got %d", w.Code) }
}

func TestAuth_ValidToken(t *testing.T) {
	handler := middleware.Auth(testSecret)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) }))
	token := generateTestToken(testSecret, "admin-1", []string{"admin"}, time.Hour)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/prices/current", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != 200 { t.Errorf("expected 200, got %d", w.Code) }
}

func TestRBAC_AdminCanRecordPrice(t *testing.T) {
	claims := &middleware.Claims{Sub: "admin-1", Roles: []string{"admin"}}
	if !claims.Can("price:create") { t.Error("admin should be able to create prices") }
}

func TestRBAC_DataIngestCanRecordPrice(t *testing.T) {
	claims := &middleware.Claims{Sub: "ingest-1", Roles: []string{"data_ingest"}}
	if !claims.Can("price:create") { t.Error("data_ingest should be able to create prices") }
}

func TestRBAC_ExtensionOfficerCannotRecordPrice(t *testing.T) {
	claims := &middleware.Claims{Sub: "officer-1", Roles: []string{"extension_officer"}}
	if claims.Can("price:create") { t.Error("extension_officer should NOT be able to create prices") }
}

func TestRBAC_USSDGatewayCanSell(t *testing.T) {
	claims := &middleware.Claims{Sub: "ussd-1", Roles: []string{"ussd_gateway"}}
	if !claims.Can("price:sell") { t.Error("ussd_gateway should be able to sell") }
}

func TestSanitize_XSSInMarketName(t *testing.T) {
	sanitized := middleware.SanitizeString(`<script>alert(1)</script>Kitale Market`, 100)
	if strings.Contains(sanitized, "<") { t.Errorf("XSS not stripped: %s", sanitized) }
	if !strings.Contains(sanitized, "Kitale") { t.Error("legitimate content should be preserved") }
}

func TestSanitize_RejectsNonJSON(t *testing.T) {
	handler := middleware.Sanitize(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) }))
	req := httptest.NewRequest(http.MethodPost, "/api/v1/prices", bytes.NewReader([]byte("bad")))
	req.Header.Set("Content-Type", "text/plain")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != 415 { t.Errorf("expected 415, got %d", w.Code) }
}

func TestFullChain_AuthThenRBAC(t *testing.T) {
	reached := false
	handler := middleware.Auth(testSecret)(middleware.RequirePermission("price:create")(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { reached = true; w.WriteHeader(200) })))
	token := generateTestToken(testSecret, "admin-1", []string{"admin"}, time.Hour)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/prices", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != 200 { t.Errorf("expected 200, got %d", w.Code) }
	if !reached { t.Error("handler not reached") }
}
