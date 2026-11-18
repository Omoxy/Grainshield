// Package models defines data structures matching the PostgreSQL schema for the policy-service.
package models

import (
	"time"

	"github.com/google/uuid"
)


// PolicyStatus represents the status of an insurance policy.
type PolicyStatus string

const (
	PolicyActive  PolicyStatus = "active"
	PolicyExpired PolicyStatus = "expired"
	PolicyClaimed PolicyStatus = "claimed"
)

// TriggerType represents the type of policy trigger.
type TriggerType string

const (
	TriggerAflatoxin  TriggerType = "aflatoxin"
	TriggerClimate    TriggerType = "climate"
	TriggerPriceFloor TriggerType = "price_floor"
)

// TriggerStatus represents the status of a trigger.
type TriggerStatus string

const (
	TriggerArmed     TriggerStatus = "armed"
	TriggerFired     TriggerStatus = "fired"
	TriggerConfirmed TriggerStatus = "confirmed"
	TriggerExpired   TriggerStatus = "expired"
)

// ClaimStatus represents the status of a claim.
type ClaimStatus string

const (
	ClaimPending   ClaimStatus = "pending"
	ClaimConfirmed ClaimStatus = "confirmed"
	ClaimPaid      ClaimStatus = "paid"
	ClaimRejected  ClaimStatus = "rejected"
)

// GrainGrade represents valid grain grades.
type GrainGrade string

const (
	Grade1 GrainGrade = "Grade 1"
	Grade2 GrainGrade = "Grade 2"
	Grade3 GrainGrade = "Grade 3"
)

// ValidGrainGrades is the set of valid grain grade values.
var ValidGrainGrades = map[string]bool{
	"Grade 1": true,
	"Grade 2": true,
	"Grade 3": true,
}


// Policy represents the full database row for a policy.
type Policy struct {
	ID               uuid.UUID    `json:"id"`
	ContractID       string       `json:"contract_id"`
	FarmerID         uuid.UUID    `json:"farmer_id"`
	FarmerGSNumber   string       `json:"farmer_gs_number"`
	WarehouseID      uuid.UUID    `json:"warehouse_id"`
	Commodity        string       `json:"commodity"`
	Bags             int          `json:"bags"`
	GrainGrade       string       `json:"grain_grade"`
	StorageBay       string       `json:"storage_bay,omitempty"`
	InsuredValue     float64      `json:"insured_value"`
	Premium          float64      `json:"premium"`
	PremiumRate      float64      `json:"premium_rate"`
	DiscountPct      float64      `json:"discount_pct"`
	CostOfProduction float64      `json:"cost_of_production"`
	MoistureContent  float64      `json:"moisture_content"`
	Status           PolicyStatus `json:"status"`
	BlockchainHash   string       `json:"blockchain_hash"`
	DepositDate      time.Time    `json:"deposit_date"`
	ExpiryDate       time.Time    `json:"expiry_date"`
	CreatedAt        time.Time    `json:"created_at"`
}

// PolicySummary is a lightweight view for list endpoints.
type PolicySummary struct {
	ID             uuid.UUID `json:"id"`
	ContractID     string    `json:"contract_id"`
	FarmerGSNumber string    `json:"farmer_gs_number"`
	Bags           int       `json:"bags"`
	InsuredValue   float64   `json:"insured_value"`
	Premium        float64   `json:"premium"`
	Status         string    `json:"status"`
	DepositDate    time.Time `json:"deposit_date"`
	ExpiryDate     time.Time `json:"expiry_date"`
}

// Trigger represents a policy trigger condition.
type Trigger struct {
	ID             uuid.UUID  `json:"id"`
	PolicyID       uuid.UUID  `json:"policy_id,omitempty"`
	TriggerType    string     `json:"trigger_type"`
	ConditionDesc  string     `json:"condition_desc"`
	ThresholdValue float64    `json:"threshold_value"`
	PayoutAmount   float64    `json:"payout_amount"`
	Status         string     `json:"status"`
	FiredAt        *time.Time `json:"fired_at,omitempty"`
	ConfirmedAt    *time.Time `json:"confirmed_at,omitempty"`
	DataSource     string     `json:"data_source"`
}

// Claim represents an insurance claim.
type Claim struct {
	ID             uuid.UUID  `json:"id"`
	PolicyID       uuid.UUID  `json:"policy_id"`
	ContractID     string     `json:"contract_id"`
	TriggerType    string     `json:"trigger_type"`
	Amount         float64    `json:"amount"`
	Status         string     `json:"status"`
	TriggeredAt    time.Time  `json:"triggered_at"`
	ConfirmedAt    *time.Time `json:"confirmed_at,omitempty"`
	PaidAt         *time.Time `json:"paid_at,omitempty"`
	PaymentRef     string     `json:"payment_ref,omitempty"`
	PayoutDeadline *time.Time `json:"payout_deadline,omitempty"`
}

// PolicyStats holds dashboard statistics.
type PolicyStats struct {
	ActivePolicies    int     `json:"active_policies"`
	TotalInsuredValue float64 `json:"total_insured_value"`
	PremiumsCollected float64 `json:"premiums_collected"`
	TotalClaimsPaid   float64 `json:"total_claims_paid"`
	TotalTriggers     int     `json:"total_triggers"`
	DisputesFiled     int     `json:"disputes_filed"`
}


// TriggerEvaluation records a single evaluation attempt of a trigger condition.
// Every evaluation writes one of these — pass or fail — for a full audit trail.
// Security Rule #4: Audit log entry for every state-changing operation.
type TriggerEvaluation struct {
	ID               uuid.UUID              `json:"id"`
	TriggerID        uuid.UUID              `json:"trigger_id"`
	PolicyID         uuid.UUID              `json:"policy_id"`
	TriggerType      TriggerType            `json:"trigger_type"`
	EvaluationTime   time.Time              `json:"evaluation_time"`
	DataEvaluated    map[string]interface{} `json:"data_evaluated"`
	ThresholdChecked string                 `json:"threshold_checked"`
	ThresholdValue   float64                `json:"threshold_value"`
	ActualValue      float64                `json:"actual_value"`
	Result           bool                   `json:"result"`
	DataSources      []string               `json:"data_sources"`
	Notes            string                 `json:"notes,omitempty"`
}

// ArmedTrigger is a trigger with its associated policy data for evaluation.
type ArmedTrigger struct {
	TriggerID        uuid.UUID   `json:"trigger_id"`
	PolicyID         uuid.UUID   `json:"policy_id"`
	TriggerType      TriggerType `json:"trigger_type"`
	ThresholdValue   float64     `json:"threshold_value"`
	PayoutAmount     float64     `json:"payout_amount"`
	FarmerID         uuid.UUID   `json:"farmer_id"`
	FarmerGSNumber   string      `json:"farmer_gs_number"`
	WarehouseID      uuid.UUID   `json:"warehouse_id"`
	CostOfProduction float64     `json:"cost_of_production"`
}


// PremiumCalculation holds the full breakdown of a premium calculation.
type PremiumCalculation struct {
	BaseRate         float64 `json:"base_rate"`
	RiskScore        float64 `json:"risk_score"`
	AdjustmentFactor float64 `json:"adjustment_factor"` // 1.0, 1.15, or 1.35
	AdjustedRate     float64 `json:"adjusted_rate"`
	DiscountPct      float64 `json:"discount_pct"`
	FinalRate        float64 `json:"final_rate"`
	InsuredValue     float64 `json:"insured_value"`
	Premium          float64 `json:"premium"`
}


// PolicyTriggeredEvent is published to Kafka topic "policy.triggered" when a
// trigger fires. Payment-service consumes this to initiate M-Pesa B2C payout.
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

// PolicyCreatedEvent is published to Kafka topic "policy.created" when a new
// policy is created on grain deposit.
type PolicyCreatedEvent struct {
	EventID        uuid.UUID `json:"event_id"`
	PolicyID       uuid.UUID `json:"policy_id"`
	ContractID     string    `json:"contract_id"`
	FarmerID       uuid.UUID `json:"farmer_id"`
	FarmerGSNumber string    `json:"farmer_gs_number"`
	InsuredValue   float64   `json:"insured_value"`
	Premium        float64   `json:"premium"`
	BlockchainHash string    `json:"blockchain_hash"`
	CreatedAt      time.Time `json:"created_at"`
}


// CreatePolicyRequest is the validated input for policy creation.
type CreatePolicyRequest struct {
	FarmerID         string  `json:"farmer_id" validate:"required"`
	FarmerGSNumber   string  `json:"farmer_gs_number" validate:"required,min=6,max=10"`
	WarehouseID      string  `json:"warehouse_id" validate:"required"`
	Bags             int     `json:"bags" validate:"required,gte=1,lte=10000"`
	GrainGrade       string  `json:"grain_grade" validate:"required"`
	StorageBay       string  `json:"storage_bay" validate:"max=50"`
	MoistureContent  float64 `json:"moisture_content" validate:"gte=0,lte=100"`
	PricePerBag      float64 `json:"price_per_bag" validate:"required,gt=0"`
	CostOfProduction float64 `json:"cost_of_production" validate:"required,gt=0"`
	PremiumRate      float64 `json:"premium_rate" validate:"required,gt=0,lte=0.10"`
	DiscountPct      float64 `json:"discount_pct" validate:"gte=0,lte=50"`
	SubCounty        string  `json:"sub_county" validate:"max=50"`
}

// FireTriggerRequest is the validated input for firing a trigger.
type FireTriggerRequest struct {
	TriggerID   string  `json:"trigger_id" validate:"required"`
	DataSource  string  `json:"data_source" validate:"required,max=100"`
	DataValue   float64 `json:"data_value"`
	ConfirmedBy string  `json:"confirmed_by" validate:"required,max=100"`
}

// EvaluateTriggersRequest is the input for manually running a trigger evaluation cycle.
type EvaluateTriggersRequest struct {
	TriggerType string `json:"trigger_type" validate:"omitempty,oneof=aflatoxin climate price_floor"`
	DryRun      bool   `json:"dry_run"` // If true, evaluate but don't fire
}
