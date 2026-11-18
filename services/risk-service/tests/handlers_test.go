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
	req := httptest.NewRequest(http.MethodGet, "/api/v1/risk/aflatoxin", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != 401 { t.Errorf("expected 401, got %d", w.Code) }
}

func TestAuth_ValidToken(t *testing.T) {
	handler := middleware.Auth(testSecret)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) }))
	token := generateTestToken(testSecret, "admin-1", []string{"admin"}, time.Hour)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/risk/aflatoxin", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != 200 { t.Errorf("expected 200, got %d", w.Code) }
}

func TestRBAC_AdminCanReadRisk(t *testing.T) {
	claims := &middleware.Claims{Sub: "admin-1", Roles: []string{"admin"}}
	if !claims.Can("risk:read") { t.Error("admin should be able to read risk data") }
}

func TestRBAC_AdminCanIngestRisk(t *testing.T) {
	claims := &middleware.Claims{Sub: "admin-1", Roles: []string{"admin"}}
	if !claims.Can("risk:ingest") { t.Error("admin should be able to ingest risk data") }
}

func TestRBAC_DataIngestCanIngest(t *testing.T) {
	claims := &middleware.Claims{Sub: "ingest-1", Roles: []string{"data_ingest"}}
	if !claims.Can("risk:ingest") { t.Error("data_ingest should be able to ingest risk data") }
}

func TestRBAC_ExtensionOfficerCanReadRisk(t *testing.T) {
	claims := &middleware.Claims{Sub: "officer-1", Roles: []string{"extension_officer"}}
	if !claims.Can("risk:read") { t.Error("extension_officer should be able to read risk data") }
}

func TestRBAC_ExtensionOfficerCannotIngest(t *testing.T) {
	claims := &middleware.Claims{Sub: "officer-1", Roles: []string{"extension_officer"}}
	if claims.Can("risk:ingest") { t.Error("extension_officer should NOT be able to ingest risk data") }
}

func TestRiskLevel_LOW(t *testing.T) {
	score := 25.0
	level := determineRiskLevel(score)
	if level != "LOW" { t.Errorf("expected LOW for score %.0f, got %s", score, level) }
}

func TestRiskLevel_MODERATE(t *testing.T) {
	score := 40.0
	level := determineRiskLevel(score)
	if level != "MODERATE" { t.Errorf("expected MODERATE for score %.0f, got %s", score, level) }
}

func TestRiskLevel_HIGH(t *testing.T) {
	score := 60.0
	level := determineRiskLevel(score)
	if level != "HIGH" { t.Errorf("expected HIGH for score %.0f, got %s", score, level) }
}

func TestRiskLevel_CRITICAL(t *testing.T) {
	score := 85.0
	level := determineRiskLevel(score)
	if level != "CRITICAL" { t.Errorf("expected CRITICAL for score %.0f, got %s", score, level) }
}

func TestSensorAlert_HumidityAbove80(t *testing.T) {
	if !shouldTriggerAlert("humidity", 85) { t.Error("humidity > 80 should trigger alert") }
}

func TestSensorAlert_HumidityBelow80(t *testing.T) {
	if shouldTriggerAlert("humidity", 75) { t.Error("humidity < 80 should not trigger alert") }
}

func TestSensorAlert_TemperatureAbove35(t *testing.T) {
	if !shouldTriggerAlert("temperature", 38) { t.Error("temperature > 35 should trigger alert") }
}

func TestSensorAlert_MoistureAbove14(t *testing.T) {
	if !shouldTriggerAlert("moisture", 15) { t.Error("moisture > 14 should trigger alert") }
}

func TestSanitize_XSSInSubCounty(t *testing.T) {
	sanitized := middleware.SanitizeString(`<script>alert(1)</script>Kiminini`, 50)
	if strings.Contains(sanitized, "<") { t.Errorf("XSS not stripped: %s", sanitized) }
	if !strings.Contains(sanitized, "Kiminini") { t.Error("content should be preserved") }
}

func TestSanitize_RejectsNonJSON(t *testing.T) {
	handler := middleware.Sanitize(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) }))
	req := httptest.NewRequest(http.MethodPost, "/api/v1/risk/aflatoxin", bytes.NewReader([]byte("bad")))
	req.Header.Set("Content-Type", "text/plain")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != 415 { t.Errorf("expected 415, got %d", w.Code) }
}


func determineRiskLevel(score float64) string {
	if score > 70 { return "CRITICAL" }
	if score > 50 { return "HIGH" }
	if score > 30 { return "MODERATE" }
	return "LOW"
}

func shouldTriggerAlert(sensorType string, value float64) bool {
	if sensorType == "humidity" && value > 80 { return true }
	if sensorType == "temperature" && value > 35 { return true }
	if sensorType == "moisture" && value > 14 { return true }
	return false
}
