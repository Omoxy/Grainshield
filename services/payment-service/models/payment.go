// Package models defines data structures matching the PostgreSQL schema for the payment-service.
package models

import (
	"math"
	"time"

	"github.com/google/uuid"
)


// PaymentType represents the type of payment.
type PaymentType string

const (
	PaymentClaimPayout    PaymentType = "claim_payout"
	PaymentPremium        PaymentType = "premium"
	PaymentCreditDisburse PaymentType = "credit_disbursement"
)

// PaymentDirection represents the direction of a payment.
type PaymentDirection string

const (
	DirectionB2C PaymentDirection = "b2c"
	DirectionC2B PaymentDirection = "c2b"
)

// PaymentStatus represents the status of a payment.
type PaymentStatus string

const (
	PaymentQueued    PaymentStatus = "queued"
	PaymentPending   PaymentStatus = "pending"
	PaymentCompleted PaymentStatus = "completed"
	PaymentFailed    PaymentStatus = "failed"
)


// Payment represents the full database row.
type Payment struct {
	ID             uuid.UUID  `json:"id"`
	PaymentType    string     `json:"payment_type"`
	Direction      string     `json:"direction"`
	FarmerID       uuid.UUID  `json:"farmer_id"`
	FarmerGSNumber string     `json:"farmer_gs_number"`
	Phone          string     `json:"phone"`
	Amount         float64    `json:"amount"`
	Currency       string     `json:"currency"`
	ReferenceType  string     `json:"reference_type"`
	ReferenceID    uuid.UUID  `json:"reference_id"`
	MpesaRequestID string     `json:"mpesa_request_id,omitempty"`
	MpesaReceipt   string     `json:"mpesa_receipt,omitempty"`
	Status         string     `json:"status"`
	StatusReason   string     `json:"status_reason,omitempty"`
	RetryCount     int        `json:"retry_count"`
	InitiatedAt    time.Time  `json:"initiated_at"`
	CompletedAt    *time.Time `json:"completed_at,omitempty"`
}

// PaymentSummary is a lightweight view for list endpoints.
type PaymentSummary struct {
	ID             uuid.UUID  `json:"id"`
	PaymentType    string     `json:"payment_type"`
	Direction      string     `json:"direction"`
	FarmerGSNumber string     `json:"farmer_gs_number"`
	Phone          string     `json:"phone"`
	Amount         float64    `json:"amount"`
	Currency       string     `json:"currency"`
	ReferenceType  string     `json:"reference_type"`
	Status         string     `json:"status"`
	MpesaReceipt   string     `json:"mpesa_receipt,omitempty"`
	InitiatedAt    time.Time  `json:"initiated_at"`
	CompletedAt    *time.Time `json:"completed_at,omitempty"`
}

// PaymentDetail includes retry count for single-payment view.
type PaymentDetail struct {
	ID             uuid.UUID  `json:"id"`
	PaymentType    string     `json:"payment_type"`
	Direction      string     `json:"direction"`
	FarmerGSNumber string     `json:"farmer_gs_number"`
	Amount         float64    `json:"amount"`
	Status         string     `json:"status"`
	MpesaReceipt   string     `json:"mpesa_receipt,omitempty"`
	InitiatedAt    time.Time  `json:"initiated_at"`
	CompletedAt    *time.Time `json:"completed_at,omitempty"`
	RetryCount     int        `json:"retry_count"`
}

// PaymentStats holds dashboard statistics.
type PaymentStats struct {
	TotalCompleted int     `json:"total_completed"`
	TotalPending   int     `json:"total_pending"`
	TotalDisbursed float64 `json:"total_disbursed"`
	TotalCollected float64 `json:"total_collected"`
	TotalFailed    int     `json:"total_failed"`
}


// DisburseRequest is the validated input for M-Pesa B2C disbursement.
type DisburseRequest struct {
	FarmerID       string  `json:"farmer_id" validate:"required"`
	FarmerGSNumber string  `json:"farmer_gs_number" validate:"required,min=6,max=10"`
	Phone          string  `json:"phone" validate:"required,min=12,max=13"`
	Amount         float64 `json:"amount" validate:"required,gt=0,lte=10000000"`
	ReferenceType  string  `json:"reference_type" validate:"required,oneof=claim policy credit"`
	ReferenceID    string  `json:"reference_id" validate:"required"`
}


// IdempotencyWindow is the dedup window for payment requests.
const IdempotencyWindow = 24 * time.Hour

// IdempotencyKey represents a stored dedup key with 24-hour TTL.
type IdempotencyKey struct {
	KeyHash   string    `json:"key_hash"`
	PaymentID uuid.UUID `json:"payment_id"`
	ExpiresAt time.Time `json:"expires_at"`
	CreatedAt time.Time `json:"created_at"`
}


// MaxRetries is the maximum number of M-Pesa B2C attempts before DLQ.
const MaxRetries = 3

// DeadLetterEntry represents a failed payment moved to the DLQ.
type DeadLetterEntry struct {
	ID         int64     `json:"id"`
	PaymentID  uuid.UUID `json:"payment_id"`
	Reason     string    `json:"reason"`
	RetryCount int       `json:"retry_count"`
	CreatedAt  time.Time `json:"created_at"`
}


// BankOriginationFee represents a partner bank fee schedule.
type BankOriginationFee struct {
	BankCode string  `json:"bank_code"`
	BankName string  `json:"bank_name"`
	FeePct   float64 `json:"fee_pct"`
	MinFee   float64 `json:"min_fee"`
	MaxFee   float64 `json:"max_fee"`
}

// CalculateFee returns the fee amount for a given disbursement, clamped to min/max.
func (b *BankOriginationFee) CalculateFee(amount float64) float64 {
	fee := amount * b.FeePct
	if fee < b.MinFee {
		return b.MinFee
	}
	if fee > b.MaxFee {
		return b.MaxFee
	}
	return math.Round(fee*100) / 100
}


// PolicyTriggeredEvent is consumed from the policy.triggered topic.
type PolicyTriggeredEvent struct {
	EventID        uuid.UUID `json:"event_id"`
	PolicyID       uuid.UUID `json:"policy_id"`
	ContractID     string    `json:"contract_id"`
	TriggerID      uuid.UUID `json:"trigger_id"`
	TriggerType    string    `json:"trigger_type"`
	ClaimID        uuid.UUID `json:"claim_id"`
	FarmerID       uuid.UUID `json:"farmer_id"`
	FarmerGSNumber string    `json:"farmer_gs_number"`
	PayoutAmount   float64   `json:"payout_amount"`
	PayoutDeadline time.Time `json:"payout_deadline"`
	FiredAt        time.Time `json:"fired_at"`
}

// PaymentCompletedEvent is published when a payment succeeds.
type PaymentCompletedEvent struct {
	EventID      uuid.UUID `json:"event_id"`
	PaymentID    uuid.UUID `json:"payment_id"`
	ClaimID      uuid.UUID `json:"claim_id"`
	FarmerID     uuid.UUID `json:"farmer_id"`
	Amount       float64   `json:"amount"`
	MpesaReceipt string    `json:"mpesa_receipt"`
	CompletedAt  time.Time `json:"completed_at"`
}

// PaymentFailedEvent is published when a payment exhausts retries.
type PaymentFailedEvent struct {
	EventID    uuid.UUID `json:"event_id"`
	PaymentID  uuid.UUID `json:"payment_id"`
	ClaimID    uuid.UUID `json:"claim_id"`
	FarmerID   uuid.UUID `json:"farmer_id"`
	Amount     float64   `json:"amount"`
	Reason     string    `json:"reason"`
	RetryCount int       `json:"retry_count"`
	FailedAt   time.Time `json:"failed_at"`
}


// PayoutDeadlineHours is the SLA for claim payouts.
const PayoutDeadlineHours = 4

// PayoutDeadlineAlert represents an at-risk payout for PagerDuty alerting.
type PayoutDeadlineAlert struct {
	PaymentID      uuid.UUID `json:"payment_id"`
	ClaimID        uuid.UUID `json:"claim_id"`
	FarmerGSNumber string    `json:"farmer_gs_number"`
	Amount         float64   `json:"amount"`
	PayoutDeadline time.Time `json:"payout_deadline"`
	MinutesLeft    int       `json:"minutes_left"`
}
