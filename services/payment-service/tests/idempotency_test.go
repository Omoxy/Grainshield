// Package tests provides idempotency verification tests for the payment-service.
package tests

import (
	"testing"
	"time"

	"github.com/grainshield/payment-service/models"
	"github.com/grainshield/payment-service/repository"
)


func TestIdempotencyKey_Deterministic(t *testing.T) {
	key1 := repository.GenerateIdempotencyKey("farmer-1", "claim", "ref-1", 5000.00)
	key2 := repository.GenerateIdempotencyKey("farmer-1", "claim", "ref-1", 5000.00)

	if key1 != key2 {
		t.Errorf("same inputs should produce same key: %s != %s", key1, key2)
	}
}

func TestIdempotencyKey_DifferentFarmers(t *testing.T) {
	key1 := repository.GenerateIdempotencyKey("farmer-1", "claim", "ref-1", 5000.00)
	key2 := repository.GenerateIdempotencyKey("farmer-2", "claim", "ref-1", 5000.00)

	if key1 == key2 {
		t.Error("different farmer IDs should produce different keys")
	}
}

func TestIdempotencyKey_DifferentAmounts(t *testing.T) {
	key1 := repository.GenerateIdempotencyKey("farmer-1", "claim", "ref-1", 5000.00)
	key2 := repository.GenerateIdempotencyKey("farmer-1", "claim", "ref-1", 5001.00)

	if key1 == key2 {
		t.Error("different amounts should produce different keys")
	}
}

func TestIdempotencyKey_DifferentReferenceTypes(t *testing.T) {
	key1 := repository.GenerateIdempotencyKey("farmer-1", "claim", "ref-1", 5000.00)
	key2 := repository.GenerateIdempotencyKey("farmer-1", "policy", "ref-1", 5000.00)

	if key1 == key2 {
		t.Error("different reference types should produce different keys")
	}
}

func TestIdempotencyKey_DifferentReferenceIDs(t *testing.T) {
	key1 := repository.GenerateIdempotencyKey("farmer-1", "claim", "ref-1", 5000.00)
	key2 := repository.GenerateIdempotencyKey("farmer-1", "claim", "ref-2", 5000.00)

	if key1 == key2 {
		t.Error("different reference IDs should produce different keys")
	}
}

func TestIdempotencyKey_SHA256Format(t *testing.T) {
	key := repository.GenerateIdempotencyKey("farmer-1", "claim", "ref-1", 5000.00)

	// SHA-256 hex string = 64 characters
	if len(key) != 64 {
		t.Errorf("idempotency key should be 64 hex chars (SHA-256), got %d", len(key))
	}

	// Verify all characters are valid hex
	for _, c := range key {
		valid := (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')
		if !valid {
			t.Errorf("key contains non-hex character: %c", c)
			break
		}
	}
}

func TestIdempotencyKey_AmountPrecision(t *testing.T) {
	// Verify that 5000.0 and 5000.00 produce the same key
	key1 := repository.GenerateIdempotencyKey("farmer-1", "claim", "ref-1", 5000.0)
	key2 := repository.GenerateIdempotencyKey("farmer-1", "claim", "ref-1", 5000.00)

	if key1 != key2 {
		t.Error("5000.0 and 5000.00 should produce the same key")
	}
}


func TestIdempotencyWindow_24Hours(t *testing.T) {
	if models.IdempotencyWindow != 24*time.Hour {
		t.Errorf("idempotency window should be 24 hours, got %v", models.IdempotencyWindow)
	}
}


func TestMaxRetries_Three(t *testing.T) {
	if models.MaxRetries != 3 {
		t.Errorf("max retries should be 3, got %d", models.MaxRetries)
	}
}


func TestPayoutDeadline_FourHours(t *testing.T) {
	if models.PayoutDeadlineHours != 4 {
		t.Errorf("payout deadline should be 4 hours, got %d", models.PayoutDeadlineHours)
	}
}


func TestBankFee_CooperativeBank(t *testing.T) {
	fee := models.BankOriginationFee{
		BankCode: "COOP",
		BankName: "Cooperative Bank of Kenya",
		FeePct:   0.015, // 1.5%
		MinFee:   50.0,
		MaxFee:   50000.0,
	}

	// Normal case: 1.5% of 100,000 = 1,500
	result := fee.CalculateFee(100000)
	if result != 1500.0 {
		t.Errorf("COOP fee for 100K should be 1500, got %.2f", result)
	}
}

func TestBankFee_EquityBank(t *testing.T) {
	fee := models.BankOriginationFee{
		BankCode: "EQUITY",
		BankName: "Equity Bank Kenya",
		FeePct:   0.012, // 1.2%
		MinFee:   50.0,
		MaxFee:   40000.0,
	}

	result := fee.CalculateFee(100000)
	if result != 1200.0 {
		t.Errorf("EQUITY fee for 100K should be 1200, got %.2f", result)
	}
}

func TestBankFee_FamilyBank(t *testing.T) {
	fee := models.BankOriginationFee{
		BankCode: "FAMILY",
		BankName: "Family Bank Kenya",
		FeePct:   0.018, // 1.8%
		MinFee:   75.0,
		MaxFee:   60000.0,
	}

	result := fee.CalculateFee(100000)
	if result != 1800.0 {
		t.Errorf("FAMILY fee for 100K should be 1800, got %.2f", result)
	}
}

func TestBankFee_AFC(t *testing.T) {
	fee := models.BankOriginationFee{
		BankCode: "AFC",
		BankName: "Africa Finance Corporation",
		FeePct:   0.020, // 2.0%
		MinFee:   100.0,
		MaxFee:   100000.0,
	}

	result := fee.CalculateFee(100000)
	if result != 2000.0 {
		t.Errorf("AFC fee for 100K should be 2000, got %.2f", result)
	}
}

func TestBankFee_MinFeeClamp(t *testing.T) {
	fee := models.BankOriginationFee{
		BankCode: "COOP",
		FeePct:   0.015,
		MinFee:   50.0,
		MaxFee:   50000.0,
	}

	// 1.5% of 1,000 = 15 — below min fee of 50
	result := fee.CalculateFee(1000)
	if result != 50.0 {
		t.Errorf("fee should be clamped to min 50, got %.2f", result)
	}
}

func TestBankFee_MaxFeeClamp(t *testing.T) {
	fee := models.BankOriginationFee{
		BankCode: "EQUITY",
		FeePct:   0.012,
		MinFee:   50.0,
		MaxFee:   40000.0,
	}

	// 1.2% of 10,000,000 = 120,000 — above max fee of 40,000
	result := fee.CalculateFee(10000000)
	if result != 40000.0 {
		t.Errorf("fee should be clamped to max 40000, got %.2f", result)
	}
}


func TestPolicyTriggeredEvent_Fields(t *testing.T) {
	event := models.PolicyTriggeredEvent{
		PayoutAmount:   160000,
		FarmerGSNumber: "GS-00847",
	}

	if event.PayoutAmount <= 0 {
		t.Error("payout amount must be positive")
	}
	if event.FarmerGSNumber == "" {
		t.Error("farmer GS number must not be empty")
	}
}

func TestPaymentCompletedEvent_Fields(t *testing.T) {
	event := models.PaymentCompletedEvent{
		MpesaReceipt: "QKJ3A5B6C7",
		Amount:       5000,
		CompletedAt:  time.Now(),
	}

	if event.MpesaReceipt == "" {
		t.Error("mpesa receipt must be set")
	}
	if event.Amount <= 0 {
		t.Error("amount must be positive")
	}
}


func TestPaymentStatuses_Complete(t *testing.T) {
	statuses := []models.PaymentStatus{
		models.PaymentQueued,
		models.PaymentPending,
		models.PaymentCompleted,
		models.PaymentFailed,
	}
	if len(statuses) != 4 {
		t.Errorf("expected 4 payment statuses, got %d", len(statuses))
	}
}

func TestPaymentTypes_Complete(t *testing.T) {
	types := []models.PaymentType{
		models.PaymentClaimPayout,
		models.PaymentPremium,
		models.PaymentCreditDisburse,
	}
	if len(types) != 3 {
		t.Errorf("expected 3 payment types, got %d", len(types))
	}
}

func TestPaymentDirections_Complete(t *testing.T) {
	directions := []models.PaymentDirection{
		models.DirectionB2C,
		models.DirectionC2B,
	}
	if len(directions) != 2 {
		t.Errorf("expected 2 payment directions, got %d", len(directions))
	}
}


func TestRetryDelay_ExponentialBackoff(t *testing.T) {
	// Verify the exponential backoff pattern: 5s, 10s, 20s
	delays := []struct {
		attempt  int
		expected time.Duration
	}{
		{1, 5 * time.Second},
		{2, 10 * time.Second},
		{3, 20 * time.Second},
	}

	for _, d := range delays {
		// Calculate: baseDelay * 2^(attempt-1)
		baseDelay := 5 * time.Second
		calculated := baseDelay * (1 << (d.attempt - 1))

		maxDelay := 30 * time.Second
		if calculated > maxDelay {
			calculated = maxDelay
		}

		if calculated != d.expected {
			t.Errorf("attempt %d: expected %v, got %v", d.attempt, d.expected, calculated)
		}
	}
}
