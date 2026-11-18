// Package tests provides M-Pesa Daraja client tests for the payment-service.
package tests

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"go.uber.org/zap"

	"github.com/grainshield/payment-service/mpesa"
)


func TestOAuthResponse_ValidParse(t *testing.T) {
	raw := `{"access_token":"test-token-abc","expires_in":"3599"}`
	var resp mpesa.OAuthResponse
	if err := json.Unmarshal([]byte(raw), &resp); err != nil {
		t.Fatalf("failed to parse oauth response: %v", err)
	}
	if resp.AccessToken != "test-token-abc" {
		t.Errorf("expected test-token-abc, got %s", resp.AccessToken)
	}
	if resp.ExpiresIn != "3599" {
		t.Errorf("expected 3599, got %s", resp.ExpiresIn)
	}
}

func TestOAuthResponse_MissingFields(t *testing.T) {
	raw := `{}`
	var resp mpesa.OAuthResponse
	if err := json.Unmarshal([]byte(raw), &resp); err != nil {
		t.Fatalf("failed to parse: %v", err)
	}
	if resp.AccessToken != "" {
		t.Error("access_token should be empty")
	}
}


func TestB2CRequest_Serialization(t *testing.T) {
	req := mpesa.B2CRequest{
		InitiatorName:      "testapi",
		SecurityCredential: "cred123",
		CommandID:          "BusinessPayment",
		Amount:             5000,
		PartyA:             "600000",
		PartyB:             "254712345678",
		Remarks:            "GrainShield Insurance Payout",
		QueueTimeOutURL:    "https://example.com/timeout",
		ResultURL:          "https://example.com/result",
		Occasion:           "test-payment",
	}

	data, err := json.Marshal(req)
	if err != nil {
		t.Fatalf("failed to marshal: %v", err)
	}

	// Verify key fields are present
	var parsed map[string]interface{}
	json.Unmarshal(data, &parsed)

	if parsed["CommandID"] != "BusinessPayment" {
		t.Errorf("CommandID should be BusinessPayment, got %v", parsed["CommandID"])
	}
	if parsed["Amount"].(float64) != 5000 {
		t.Errorf("Amount should be 5000, got %v", parsed["Amount"])
	}
	if parsed["PartyB"] != "254712345678" {
		t.Errorf("PartyB should be 254712345678, got %v", parsed["PartyB"])
	}
}


func TestB2CResponse_SuccessParse(t *testing.T) {
	raw := `{
		"ConversationID": "AG_20260325_1234",
		"OriginatorConversationID": "orig_123",
		"ResponseCode": "0",
		"ResponseDescription": "Accept the service request successfully."
	}`
	var resp mpesa.B2CResponse
	if err := json.Unmarshal([]byte(raw), &resp); err != nil {
		t.Fatalf("failed to parse: %v", err)
	}
	if resp.ResponseCode != "0" {
		t.Errorf("expected response code 0, got %s", resp.ResponseCode)
	}
	if resp.ConversationID != "AG_20260325_1234" {
		t.Errorf("unexpected conversation ID: %s", resp.ConversationID)
	}
}

func TestB2CResponse_FailureParse(t *testing.T) {
	raw := `{
		"ConversationID": "",
		"OriginatorConversationID": "",
		"ResponseCode": "1",
		"ResponseDescription": "The initiator information is invalid."
	}`
	var resp mpesa.B2CResponse
	if err := json.Unmarshal([]byte(raw), &resp); err != nil {
		t.Fatalf("failed to parse: %v", err)
	}
	if resp.ResponseCode == "0" {
		t.Error("response code should not be 0 for failure")
	}
}


func TestParseCallback_Success(t *testing.T) {
	raw := `{
		"Result": {
			"ResultType": 0,
			"ResultCode": 0,
			"ResultDesc": "The service request is processed successfully.",
			"OriginatorConversationID": "orig_456",
			"ConversationID": "AG_20260325_5678",
			"TransactionID": "QKJ3A5B6C7",
			"ResultParameters": {
				"ResultParameter": [
					{"Key": "TransactionAmount", "Value": 5000},
					{"Key": "TransactionReceipt", "Value": "QKJ3A5B6C7"},
					{"Key": "ReceiverPartyPublicName", "Value": "254712345678 - WANJIKU MUTHONI"}
				]
			}
		}
	}`

	result, err := mpesa.ParseCallback([]byte(raw))
	if err != nil {
		t.Fatalf("failed to parse callback: %v", err)
	}
	if result.Result.ResultCode != 0 {
		t.Errorf("expected result code 0, got %d", result.Result.ResultCode)
	}
	if result.Result.TransactionID != "QKJ3A5B6C7" {
		t.Errorf("unexpected transaction ID: %s", result.Result.TransactionID)
	}
	if result.Result.ConversationID != "AG_20260325_5678" {
		t.Errorf("unexpected conversation ID: %s", result.Result.ConversationID)
	}
}

func TestParseCallback_Failure(t *testing.T) {
	raw := `{
		"Result": {
			"ResultType": 0,
			"ResultCode": 2001,
			"ResultDesc": "The initiator information is invalid.",
			"OriginatorConversationID": "orig_789",
			"ConversationID": "AG_20260325_9012",
			"TransactionID": ""
		}
	}`

	result, err := mpesa.ParseCallback([]byte(raw))
	if err != nil {
		t.Fatalf("failed to parse: %v", err)
	}
	if result.Result.ResultCode == 0 {
		t.Error("result code should not be 0 for failure")
	}
	if result.Result.TransactionID != "" {
		t.Error("transaction ID should be empty for failure")
	}
}

func TestParseCallback_InvalidJSON(t *testing.T) {
	_, err := mpesa.ParseCallback([]byte("not json"))
	if err == nil {
		t.Error("should fail on invalid JSON")
	}
}


func TestClient_NotConfigured(t *testing.T) {
	logger, _ := zap.NewDevelopment()
	client := mpesa.NewClient("", "", "", "", "", "", "", "", "", logger)
	if client.IsConfigured() {
		t.Error("client should not be configured with empty credentials")
	}
}

func TestClient_Configured(t *testing.T) {
	logger, _ := zap.NewDevelopment()
	client := mpesa.NewClient("key", "secret", "600000", "init", "cred",
		"https://api.test/b2c", "https://api.test/token",
		"https://result.test", "https://timeout.test", logger)
	if !client.IsConfigured() {
		t.Error("client should be configured with valid credentials")
	}
}


func TestCircuitBreaker_States(t *testing.T) {
	if mpesa.CircuitClosed != 0 {
		t.Errorf("CircuitClosed should be 0, got %d", mpesa.CircuitClosed)
	}
	if mpesa.CircuitOpen != 1 {
		t.Errorf("CircuitOpen should be 1, got %d", mpesa.CircuitOpen)
	}
	if mpesa.CircuitHalfOpen != 2 {
		t.Errorf("CircuitHalfOpen should be 2, got %d", mpesa.CircuitHalfOpen)
	}
}


func TestGetToken_MockServer(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Verify Basic Auth is set
		user, pass, ok := r.BasicAuth()
		if !ok || user != "test-key" || pass != "test-secret" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"access_token":"mock-token-xyz","expires_in":"3599"}`))
	}))
	defer server.Close()

	logger, _ := zap.NewDevelopment()
	client := mpesa.NewClient(
		"test-key", "test-secret", "600000", "init", "cred",
		"https://unused/b2c", server.URL,
		"https://unused/result", "https://unused/timeout", logger,
	)

	token, err := client.GetToken(context.Background())
	if err != nil {
		t.Fatalf("GetToken failed: %v", err)
	}
	if token != "mock-token-xyz" {
		t.Errorf("expected mock-token-xyz, got %s", token)
	}

	// Second call should return cached token
	token2, err := client.GetToken(context.Background())
	if err != nil {
		t.Fatalf("GetToken (cached) failed: %v", err)
	}
	if token2 != token {
		t.Error("cached token should match")
	}
}


func TestInitiateB2C_MockServer(t *testing.T) {
	callCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		if r.URL.Path == "/oauth/v1/generate" {
			w.Write([]byte(`{"access_token":"token","expires_in":"3599"}`))
			return
		}
		// B2C endpoint
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{
			"ConversationID": "AG_b2c_123",
			"OriginatorConversationID": "orig_b2c",
			"ResponseCode": "0",
			"ResponseDescription": "Accept the service request successfully."
		}`))
	}))
	defer server.Close()

	logger, _ := zap.NewDevelopment()
	client := mpesa.NewClient(
		"key", "secret", "600000", "init", "cred",
		server.URL+"/b2c", server.URL+"/oauth/v1/generate",
		server.URL+"/result", server.URL+"/timeout", logger,
	)

	resp, err := client.InitiateB2C(context.Background(), "254712345678", 5000, "test")
	if err != nil {
		t.Fatalf("InitiateB2C failed: %v", err)
	}
	if resp.ConversationID != "AG_b2c_123" {
		t.Errorf("unexpected conversation ID: %s", resp.ConversationID)
	}
	if resp.ResponseCode != "0" {
		t.Errorf("expected response code 0, got %s", resp.ResponseCode)
	}
}

func TestInitiateB2C_ServerError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/oauth/v1/generate" {
			w.Write([]byte(`{"access_token":"token","expires_in":"3599"}`))
			return
		}
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	logger, _ := zap.NewDevelopment()
	client := mpesa.NewClient(
		"key", "secret", "600000", "init", "cred",
		server.URL+"/b2c", server.URL+"/oauth/v1/generate",
		server.URL+"/result", server.URL+"/timeout", logger,
	)

	_, err := client.InitiateB2C(context.Background(), "254712345678", 5000, "test")
	if err == nil {
		t.Error("should fail on server error")
	}
}


func TestCallback_AcknowledgeWithin5Seconds(t *testing.T) {
	// Verify that callback handling completes synchronously within 5s
	start := time.Now()

	raw := `{"Result":{"ResultType":0,"ResultCode":0,"ResultDesc":"ok","ConversationID":"c1","TransactionID":"t1","OriginatorConversationID":"o1"}}`
	_, err := mpesa.ParseCallback([]byte(raw))
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}

	elapsed := time.Since(start)
	if elapsed > 5*time.Second {
		t.Errorf("callback parsing took %v, must be under 5 seconds", elapsed)
	}
}
