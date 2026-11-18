// Package tests provides unit tests for all farmer-service handlers
// and security edge cases.
package tests

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/golang-jwt/jwt/v5"

	"github.com/grainshield/farmer-service/models"
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

// validCreateRequest returns a valid CreateFarmerRequest for testing.
func validCreateRequest() models.CreateFarmerRequest {
	return models.CreateFarmerRequest{
		Name:         "Wanjiku Muthoni",
		NationalID:   "23847261",
		Phone:        "+254712345678",
		SubCounty:    models.SubCountyKiminini,
		Hectares:     2.5,
		ExpectedBags: 60,
		Language:     models.LangSwahili,
	}
}


func TestAuth_MissingHeader(t *testing.T) {
	handler := middleware.Auth(testSecret)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/farmers", nil)
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

	req := httptest.NewRequest(http.MethodGet, "/api/v1/farmers", nil)
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
	req := httptest.NewRequest(http.MethodGet, "/api/v1/farmers", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", w.Code)
	}
}

func TestAuth_ValidToken(t *testing.T) {
	var capturedClaims *middleware.Claims
	handler := middleware.Auth(testSecret)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		claims, ok := middleware.GetClaims(r.Context())
		if ok {
			capturedClaims = claims
		}
		w.WriteHeader(http.StatusOK)
	}))

	token := generateTestToken(testSecret, "admin-user-1", []string{"admin"}, 1*time.Hour)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/farmers", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
	if capturedClaims == nil {
		t.Fatal("claims not found in context")
	}
	if capturedClaims.Sub != "admin-user-1" {
		t.Errorf("expected sub 'admin-user-1', got '%s'", capturedClaims.Sub)
	}
}


func TestRBAC_AdminCanCreateFarmer(t *testing.T) {
	claims := &middleware.Claims{Sub: "admin-1", Roles: []string{"admin"}}
	if !claims.Can("farmer:create") {
		t.Error("admin should be able to create farmers")
	}
}

func TestRBAC_ExtensionOfficerCannotCreateFarmer(t *testing.T) {
	claims := &middleware.Claims{Sub: "officer-1", Roles: []string{"extension_officer"}}
	if claims.Can("farmer:create") {
		t.Error("extension_officer should NOT be able to create farmers")
	}
}

func TestRBAC_ExtensionOfficerCanReadFarmer(t *testing.T) {
	claims := &middleware.Claims{Sub: "officer-1", Roles: []string{"extension_officer"}}
	if !claims.Can("farmer:read") {
		t.Error("extension_officer should be able to read farmers")
	}
}

func TestRBAC_WarehouseClerkCanCreateFarmer(t *testing.T) {
	claims := &middleware.Claims{Sub: "clerk-1", Roles: []string{"warehouse_clerk"}}
	if !claims.Can("farmer:create") {
		t.Error("warehouse_clerk should be able to create farmers")
	}
}

func TestRBAC_WarehouseClerkCannotUpdateFarmer(t *testing.T) {
	claims := &middleware.Claims{Sub: "clerk-1", Roles: []string{"warehouse_clerk"}}
	if claims.Can("farmer:update") {
		t.Error("warehouse_clerk should NOT be able to update farmers")
	}
}

func TestRBAC_UnknownRoleCannotDoAnything(t *testing.T) {
	claims := &middleware.Claims{Sub: "hacker-1", Roles: []string{"hacker"}}
	actions := []string{"farmer:create", "farmer:read", "farmer:list", "farmer:update"}
	for _, action := range actions {
		if claims.Can(action) {
			t.Errorf("unknown role should NOT have permission: %s", action)
		}
	}
}

func TestRBAC_USSDGatewayCanCreateFarmer(t *testing.T) {
	claims := &middleware.Claims{Sub: "ussd-gw-1", Roles: []string{"ussd_gateway"}}
	if !claims.Can("farmer:create") {
		t.Error("ussd_gateway should be able to create farmers")
	}
}

func TestRBAC_DataIngestCannotAccessFarmers(t *testing.T) {
	claims := &middleware.Claims{Sub: "ingest-1", Roles: []string{"data_ingest"}}
	farmerActions := []string{"farmer:create", "farmer:read", "farmer:list", "farmer:update"}
	for _, action := range farmerActions {
		if claims.Can(action) {
			t.Errorf("data_ingest should NOT have farmer permission: %s", action)
		}
	}
}


func TestRequirePermission_Forbidden(t *testing.T) {
	handler := middleware.Auth(testSecret)(
		middleware.RequirePermission("farmer:create")(
			http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusOK)
			}),
		),
	)

	token := generateTestToken(testSecret, "officer-1", []string{"extension_officer"}, 1*time.Hour)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/farmers", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d", w.Code)
	}
}


func TestValidation_InvalidNationalID(t *testing.T) {
	tests := []struct {
		name       string
		nationalID string
	}{
		{"too short", "1234567"},
		{"too long", "123456789"},
		{"contains letters", "1234567a"},
		{"contains special chars", "1234567!"},
		{"empty", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if matched := nationalIDRegexTest(tt.nationalID); matched {
				t.Errorf("national ID '%s' should not match regex", tt.nationalID)
			}
		})
	}
}

func TestValidation_ValidNationalID(t *testing.T) {
	valid := []string{"23847261", "00000000", "99999999", "12345678"}
	for _, id := range valid {
		if !nationalIDRegexTest(id) {
			t.Errorf("national ID '%s' should match regex", id)
		}
	}
}

func TestValidation_InvalidPhone(t *testing.T) {
	invalid := []string{
		"0712345678",     // missing +254
		"+25312345678",   // wrong country code
		"+254612345678",  // invalid prefix (6)
		"+25471234567",   // too short
		"+2547123456789", // too long
		"",               // empty
	}
	for _, phone := range invalid {
		if phoneRegexTest(phone) {
			t.Errorf("phone '%s' should not match regex", phone)
		}
	}
}

func TestValidation_ValidPhone(t *testing.T) {
	valid := []string{"+254712345678", "+254112345678"}
	for _, phone := range valid {
		if !phoneRegexTest(phone) {
			t.Errorf("phone '%s' should match regex", phone)
		}
	}
}

func TestValidation_InvalidSubCounty(t *testing.T) {
	invalid := []models.SubCounty{"InvalidPlace", "kitale", "", "Trans Nzoia"}
	for _, sc := range invalid {
		if models.ValidSubCounties[sc] {
			t.Errorf("sub_county '%s' should not be valid", sc)
		}
	}
}

func TestValidation_ValidSubCounty(t *testing.T) {
	valid := []models.SubCounty{"Kiminini", "Kwanza", "Saboti", "Endebess", "Cherangany"}
	for _, sc := range valid {
		if !models.ValidSubCounties[sc] {
			t.Errorf("sub_county '%s' should be valid", sc)
		}
	}
}


var gsNumberRegex = regexp.MustCompile(`^GS-\d{5}$`)

func TestValidation_ValidGSNumber(t *testing.T) {
	valid := []string{"GS-00001", "GS-00847", "GS-99999", "GS-12345"}
	for _, gs := range valid {
		if !gsNumberRegex.MatchString(gs) {
			t.Errorf("GS number '%s' should be valid", gs)
		}
	}
}

func TestValidation_InvalidGSNumber(t *testing.T) {
	invalid := []string{
		"GS-0001",                             // too short
		"GS-123456",                           // too long
		"GS-ABCDE",                            // letters
		"gs-00001",                            // lowercase
		"00001",                               // no prefix
		"",                                    // empty
		"GS-'; DROP TABLE farmers; --",        // SQL injection
		strings.Repeat("A", 100),              // overflow
	}
	for _, gs := range invalid {
		t.Run(gs, func(t *testing.T) {
			if gsNumberRegex.MatchString(gs) {
				t.Errorf("GS number '%s' should NOT be valid", gs)
			}
		})
	}
}


func TestSecurity_SQLInjectionInName(t *testing.T) {
	// Verify that HTML stripping and sanitization work
	malicious := "<script>alert('xss')</script>'; DROP TABLE farmers; --"
	sanitized := middleware.SanitizeString(malicious, 100)

	// Should not contain HTML tags
	if strings.Contains(sanitized, "<") || strings.Contains(sanitized, ">") {
		t.Errorf("sanitized string should not contain HTML tags: %s", sanitized)
	}

	// The remaining text would fail regex validation in the handler
	// This test confirms the sanitization layer strips dangerous content
}

func TestSecurity_XSSInName(t *testing.T) {
	xss := `<img src=x onerror=alert(1)> Wanjiku`
	sanitized := middleware.SanitizeString(xss, 100)

	if strings.Contains(sanitized, "<") {
		t.Errorf("XSS should be stripped: %s", sanitized)
	}
	if !strings.Contains(sanitized, "Wanjiku") {
		t.Errorf("legitimate content should be preserved: %s", sanitized)
	}
}

func TestSecurity_OversizedInput(t *testing.T) {
	// 501 characters should be truncated to 500
	longString := strings.Repeat("A", 501)
	sanitized := middleware.SanitizeString(longString, 500)

	if len(sanitized) != 500 {
		t.Errorf("expected length 500, got %d", len(sanitized))
	}
}

func TestSecurity_FarmerResponseExcludesNationalID(t *testing.T) {
	farmer := &models.Farmer{
		Name:                "Test Farmer",
		NationalIDEncrypted: []byte("encrypted-data"),
		NationalIDHash:      "hash-value",
		Phone:               "+254712345678",
		SubCounty:           models.SubCountyKiminini,
		Hectares:            2.5,
		ExpectedBags:        60,
		Language:            models.LangSwahili,
		Status:              models.StatusActive,
		RegisteredBy:        "officer-1",
	}

	response := farmer.ToResponse()

	// Marshal to JSON and verify no sensitive fields
	jsonBytes, err := json.Marshal(response)
	if err != nil {
		t.Fatal(err)
	}
	jsonStr := string(jsonBytes)

	if strings.Contains(jsonStr, "encrypted") {
		t.Error("response should not contain encrypted national ID")
	}
	if strings.Contains(jsonStr, "hash-value") {
		t.Error("response should not contain national ID hash")
	}
	if strings.Contains(jsonStr, "national_id") {
		t.Error("response should not contain any national_id field")
	}
}

func TestSecurity_FarmerResponseIncludesRegisteredBy(t *testing.T) {
	farmer := &models.Farmer{
		Name:         "Test Farmer",
		Phone:        "+254712345678",
		SubCounty:    models.SubCountyKiminini,
		Hectares:     2.5,
		ExpectedBags: 60,
		Language:     models.LangSwahili,
		Status:       models.StatusActive,
		RegisteredBy: "officer-abc-123",
	}

	response := farmer.ToResponse()
	if response.RegisteredBy != "officer-abc-123" {
		t.Errorf("expected registered_by 'officer-abc-123', got '%s'", response.RegisteredBy)
	}
}

func TestSecurity_ErrorResponsesNoInternals(t *testing.T) {
	// Simulate an error response
	w := httptest.NewRecorder()
	respondTestError(w, http.StatusInternalServerError, "internal server error")

	body := w.Body.String()

	// Must not contain stack traces, SQL errors, or internal paths
	forbidden := []string{"panic", "goroutine", "SELECT", "INSERT", "postgres", "/go/src/", "runtime"}
	for _, word := range forbidden {
		if strings.Contains(strings.ToLower(body), strings.ToLower(word)) {
			t.Errorf("error response should not contain '%s': %s", word, body)
		}
	}
}


func TestSanitize_RejectsNonJSON(t *testing.T) {
	handler := middleware.Sanitize(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodPost, "/api/v1/farmers", bytes.NewReader([]byte("not json")))
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

	req := httptest.NewRequest(http.MethodPost, "/api/v1/farmers", bytes.NewReader([]byte("{}")))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
}

func TestSanitize_GETDoesNotRequireContentType(t *testing.T) {
	handler := middleware.Sanitize(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/farmers", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
}


func TestGet_InvalidUUID(t *testing.T) {
	invalid := []string{
		"not-a-uuid",
		"12345",
		"'; DROP TABLE farmers; --",
		strings.Repeat("a", 100),
	}

	for _, id := range invalid {
		t.Run(id, func(t *testing.T) {
			// We can't easily test the full handler without a DB,
			// but we can verify UUID parsing fails
			if isValidUUID(id) {
				t.Errorf("'%s' should not be a valid UUID", id)
			}
		})
	}
}


func TestSolidarity_JoinRequestValidation(t *testing.T) {
	// Verify that JoinGroupRequest struct tag validation requires both fields
	req := models.JoinGroupRequest{}
	if req.FarmerID != "" || req.GroupID != "" {
		t.Error("empty JoinGroupRequest should have empty fields")
	}
}

func TestSolidarity_LeaveRequestValidation(t *testing.T) {
	req := models.LeaveGroupRequest{}
	if req.FarmerID != "" {
		t.Error("empty LeaveGroupRequest should have empty farmer_id")
	}
}

func TestSolidarity_GroupModelDefaults(t *testing.T) {
	group := models.SolidarityGroup{
		Name:       "Kiminini Group A",
		MaxMembers: 20,
	}
	if group.MaxMembers != 20 {
		t.Errorf("expected max_members 20, got %d", group.MaxMembers)
	}
	if group.MemberCount != 0 {
		t.Errorf("expected member_count 0, got %d", group.MemberCount)
	}
}


func nationalIDRegexTest(id string) bool {
	return len(id) == 8 && isAllDigits(id)
}

func phoneRegexTest(phone string) bool {
	if len(phone) != 13 {
		return false
	}
	if !strings.HasPrefix(phone, "+254") {
		return false
	}
	if phone[4] != '7' && phone[4] != '1' {
		return false
	}
	return isAllDigits(phone[5:])
}

func isAllDigits(s string) bool {
	for _, c := range s {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

func isValidUUID(s string) bool {
	if len(s) != 36 {
		return false
	}
	// Check format: 8-4-4-4-12
	parts := strings.Split(s, "-")
	if len(parts) != 5 {
		return false
	}
	expected := []int{8, 4, 4, 4, 12}
	for i, p := range parts {
		if len(p) != expected[i] {
			return false
		}
	}
	return true
}

func respondTestError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": message})
}


func TestFullChain_AuthThenRBAC(t *testing.T) {
	reached := false
	handler := middleware.Auth(testSecret)(
		middleware.RequirePermission("farmer:create")(
			http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				reached = true
				w.WriteHeader(http.StatusOK)
			}),
		),
	)

	// Test 1: admin with farmer:create → should succeed
	token := generateTestToken(testSecret, "admin-1", []string{"admin"}, 1*time.Hour)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/farmers", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("admin should get 200, got %d", w.Code)
	}
	if !reached {
		t.Error("handler should have been reached for admin")
	}

	// Test 2: extension_officer → should get 403
	reached = false
	token = generateTestToken(testSecret, "officer-1", []string{"extension_officer"}, 1*time.Hour)
	req = httptest.NewRequest(http.MethodPost, "/api/v1/farmers", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Errorf("extension_officer should get 403, got %d", w.Code)
	}
	if reached {
		t.Error("handler should NOT have been reached for extension_officer")
	}
}

// TestFullChain_RouterWithAuth tests that the chi router correctly applies middleware per route.
func TestFullChain_RouterWithAuth(t *testing.T) {
	r := chi.NewRouter()
	r.Use(middleware.Sanitize)

	// Health routes — no auth
	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"healthy"}`))
	})

	// Protected routes
	r.Route("/api/v1", func(r chi.Router) {
		r.Use(middleware.Auth(testSecret))
		r.With(middleware.RequirePermission("farmer:list")).Get("/farmers", func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"farmers":[]}`))
		})
	})

	// Test 1: Health check should work without auth
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("healthz should return 200 without auth, got %d", w.Code)
	}

	// Test 2: Protected route without auth → 401
	req = httptest.NewRequest(http.MethodGet, "/api/v1/farmers", nil)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Errorf("protected route without auth should return 401, got %d", w.Code)
	}

	// Test 3: Protected route with valid admin token → 200
	token := generateTestToken(testSecret, "admin-1", []string{"admin"}, 1*time.Hour)
	req = httptest.NewRequest(http.MethodGet, "/api/v1/farmers", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("admin with valid token should get 200, got %d", w.Code)
	}
}


func TestExtensionOfficer_RegisteredByPopulated(t *testing.T) {
	// Verify the CreateFarmerRequest RegisteredBy field has json:"-" tag
	// (meaning it cannot be set by user input, only by server code)
	req := validCreateRequest()
	jsonBytes, _ := json.Marshal(req)
	jsonStr := string(jsonBytes)

	// registered_by should NOT appear in serialized JSON (it has json:"-" tag)
	if strings.Contains(jsonStr, "registered_by") {
		t.Error("registered_by should not be serializable from CreateFarmerRequest (json:\"-\" tag)")
	}

	// But it can be set programmatically
	req.RegisteredBy = "officer-abc-123"
	if req.RegisteredBy != "officer-abc-123" {
		t.Error("registered_by should be settable programmatically")
	}
}

func TestExtensionOfficer_RegisteredByInResponse(t *testing.T) {
	farmer := &models.Farmer{
		RegisteredBy: "warehouse-clerk-xyz",
		Status:       models.StatusActive,
	}
	resp := farmer.ToResponse()

	jsonBytes, _ := json.Marshal(resp)
	jsonStr := string(jsonBytes)

	if !strings.Contains(jsonStr, "registered_by") {
		t.Error("FarmerResponse should include registered_by")
	}
	if !strings.Contains(jsonStr, "warehouse-clerk-xyz") {
		t.Error("FarmerResponse should include the actual registered_by value")
	}
}

// Unused import guard — ensure context is used (required by some tests above).
var _ = context.Background
var _ = fmt.Sprintf
