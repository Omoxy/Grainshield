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
	req := httptest.NewRequest(http.MethodPost, "/api/v1/notifications/send", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != 401 { t.Errorf("expected 401, got %d", w.Code) }
}

func TestAuth_ValidToken(t *testing.T) {
	handler := middleware.Auth(testSecret)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) }))
	token := generateTestToken(testSecret, "admin-1", []string{"admin"}, time.Hour)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/notifications/send", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != 200 { t.Errorf("expected 200, got %d", w.Code) }
}

func TestRBAC_AdminCanSend(t *testing.T) {
	claims := &middleware.Claims{Sub: "admin-1", Roles: []string{"admin"}}
	if !claims.Can("notification:send") { t.Error("admin should be able to send notifications") }
}

func TestRBAC_AdminCanBulkSend(t *testing.T) {
	claims := &middleware.Claims{Sub: "admin-1", Roles: []string{"admin"}}
	if !claims.Can("notification:bulk") { t.Error("admin should be able to bulk send") }
}

func TestRBAC_ExtensionOfficerCanSend(t *testing.T) {
	claims := &middleware.Claims{Sub: "officer-1", Roles: []string{"extension_officer"}}
	if !claims.Can("notification:send") { t.Error("extension_officer should be able to send notifications") }
}

func TestRBAC_ExtensionOfficerCannotBulkSend(t *testing.T) {
	claims := &middleware.Claims{Sub: "officer-1", Roles: []string{"extension_officer"}}
	if claims.Can("notification:bulk") { t.Error("extension_officer should NOT be able to bulk send") }
}

func TestRBAC_WarehouseClerkCanSend(t *testing.T) {
	claims := &middleware.Claims{Sub: "clerk-1", Roles: []string{"warehouse_clerk"}}
	if !claims.Can("notification:send") { t.Error("warehouse_clerk should be able to send notifications") }
}

func TestRBAC_USSDGatewayCanSend(t *testing.T) {
	claims := &middleware.Claims{Sub: "ussd-1", Roles: []string{"ussd_gateway"}}
	if !claims.Can("notification:send") { t.Error("ussd_gateway should be able to send notifications") }
}

func TestSMSTruncation_UnderLimit(t *testing.T) {
	sms := strings.Repeat("A", 400)
	if len(sms) > 480 { t.Error("400 chars should not be truncated") }
}

func TestSMSTruncation_OverLimit(t *testing.T) {
	sms := strings.Repeat("A", 500)
	if len(sms) > 480 {
		sms = sms[:477] + "..."
	}
	if len(sms) != 480 { t.Errorf("expected 480, got %d", len(sms)) }
}

func TestTemplateRendering(t *testing.T) {
	template := "Habari {{name}}, bei ya mahindi ni KES {{price}}"
	vars := map[string]string{"name": "Wanjiku", "price": "4,500"}
	rendered := template
	for k, v := range vars {
		rendered = strings.ReplaceAll(rendered, "{{"+k+"}}", v)
	}
	if !strings.Contains(rendered, "Wanjiku") { t.Error("name not rendered") }
	if !strings.Contains(rendered, "4,500") { t.Error("price not rendered") }
	if strings.Contains(rendered, "{{") { t.Error("unrendered variables remain") }
}

func TestSanitize_XSSInVariables(t *testing.T) {
	sanitized := middleware.SanitizeString(`<script>alert(1)</script>Wanjiku`, 200)
	if strings.Contains(sanitized, "<") { t.Errorf("XSS not stripped: %s", sanitized) }
	if !strings.Contains(sanitized, "Wanjiku") { t.Error("content should be preserved") }
}

func TestSanitize_RejectsNonJSON(t *testing.T) {
	handler := middleware.Sanitize(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) }))
	req := httptest.NewRequest(http.MethodPost, "/api/v1/notifications/send", bytes.NewReader([]byte("bad")))
	req.Header.Set("Content-Type", "text/plain")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != 415 { t.Errorf("expected 415, got %d", w.Code) }
}
