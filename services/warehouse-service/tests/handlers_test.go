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
	req := httptest.NewRequest(http.MethodGet, "/api/v1/warehouses", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != 401 { t.Errorf("expected 401, got %d", w.Code) }
}

func TestAuth_ValidToken(t *testing.T) {
	handler := middleware.Auth(testSecret)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) }))
	token := generateTestToken(testSecret, "admin-1", []string{"admin"}, time.Hour)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/warehouses", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != 200 { t.Errorf("expected 200, got %d", w.Code) }
}

func TestRBAC_AdminCanCreateDeposit(t *testing.T) {
	claims := &middleware.Claims{Sub: "admin-1", Roles: []string{"admin"}}
	if !claims.Can("deposit:create") { t.Error("admin should be able to create deposits") }
}

func TestRBAC_WarehouseClerkCanCreateDeposit(t *testing.T) {
	claims := &middleware.Claims{Sub: "clerk-1", Roles: []string{"warehouse_clerk"}}
	if !claims.Can("deposit:create") { t.Error("warehouse_clerk should be able to create deposits") }
}

func TestRBAC_WarehouseClerkCanInspect(t *testing.T) {
	claims := &middleware.Claims{Sub: "clerk-1", Roles: []string{"warehouse_clerk"}}
	if !claims.Can("inspection:create") { t.Error("warehouse_clerk should be able to create inspections") }
}

func TestRBAC_ExtensionOfficerCannotDeposit(t *testing.T) {
	claims := &middleware.Claims{Sub: "officer-1", Roles: []string{"extension_officer"}}
	if claims.Can("deposit:create") { t.Error("extension_officer should NOT be able to create deposits") }
}

func TestRBAC_ExtensionOfficerCanReadWarehouse(t *testing.T) {
	claims := &middleware.Claims{Sub: "officer-1", Roles: []string{"extension_officer"}}
	if !claims.Can("warehouse:read") { t.Error("extension_officer should be able to read warehouses") }
}

func TestInspectionResult_Passed(t *testing.T) {
	result := determineInspectionResult(12.0, false, false, false, 3.0)
	if result != "passed" { t.Errorf("expected passed, got %s", result) }
}

func TestInspectionResult_Conditional_HighMoisture(t *testing.T) {
	result := determineInspectionResult(14.0, false, false, false, 0)
	if result != "conditional" { t.Errorf("expected conditional, got %s", result) }
}

func TestInspectionResult_Conditional_ModerateAflatoxin(t *testing.T) {
	result := determineInspectionResult(12.0, false, false, true, 7.0)
	if result != "conditional" { t.Errorf("expected conditional, got %s", result) }
}

func TestInspectionResult_Failed_WeevilDamage(t *testing.T) {
	result := determineInspectionResult(12.0, true, false, false, 0)
	if result != "failed" { t.Errorf("expected failed, got %s", result) }
}

func TestInspectionResult_Failed_HighAflatoxin(t *testing.T) {
	result := determineInspectionResult(12.0, false, false, true, 15.0)
	if result != "failed" { t.Errorf("expected failed, got %s", result) }
}

func TestSanitize_XSSInReceivedBy(t *testing.T) {
	sanitized := middleware.SanitizeString(`<script>alert(1)</script>John Wafula`, 100)
	if strings.Contains(sanitized, "<") { t.Errorf("XSS not stripped: %s", sanitized) }
	if !strings.Contains(sanitized, "John Wafula") { t.Error("content should be preserved") }
}

func TestSanitize_RejectsNonJSON(t *testing.T) {
	handler := middleware.Sanitize(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) }))
	req := httptest.NewRequest(http.MethodPost, "/api/v1/warehouses/deposit", bytes.NewReader([]byte("bad")))
	req.Header.Set("Content-Type", "text/plain")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != 415 { t.Errorf("expected 415, got %d", w.Code) }
}

func determineInspectionResult(moisture float64, weevil, foreign, aflatoxinTest bool, aflatoxinPPB float64) string {
	if weevil || foreign || (aflatoxinTest && aflatoxinPPB > 10) {
		return "failed"
	}
	if moisture > 13.5 || (aflatoxinTest && aflatoxinPPB > 5) {
		return "conditional"
	}
	return "passed"
}
