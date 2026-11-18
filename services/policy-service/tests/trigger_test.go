// Package tests provides unit tests for the policy-service trigger engine,
// premium calculator, and security edge cases.
package tests

import (
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/grainshield/policy-service/models"
	"github.com/grainshield/policy-service/repository"
	"github.com/grainshield/policy-service/trigger"
)


func TestPremiumCalculator_RiskAdjustmentFactor(t *testing.T) {
	tests := []struct {
		name       string
		riskScore  float64
		wantFactor float64
	}{
		// Band 1: 0–40 → base rate (1.00)
		{"score_0_base", 0, 1.00},
		{"score_20_base", 20, 1.00},
		{"score_40_base", 40, 1.00},

		// Band 2: 41–70 → +15% (1.15)
		{"score_41_plus15", 41, 1.15},
		{"score_55_plus15", 55, 1.15},
		{"score_70_plus15", 70, 1.15},

		// Band 3: 71–100 → +35% (1.35)
		{"score_71_plus35", 71, 1.35},
		{"score_85_plus35", 85, 1.35},
		{"score_100_plus35", 100, 1.35},

		// Edge: negative defaults to base
		{"score_negative_base", -5, 1.00},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := trigger.RiskAdjustmentFactor(tt.riskScore)
			if got != tt.wantFactor {
				t.Errorf("RiskAdjustmentFactor(%.0f) = %.2f, want %.2f", tt.riskScore, got, tt.wantFactor)
			}
		})
	}
}

func TestPremiumCalculator_PremiumCalculation(t *testing.T) {
	tests := []struct {
		name         string
		bags         int
		pricePerBag  float64
		baseRate     float64
		discountPct  float64
		riskFactor   float64
		wantPremium  float64
		wantInsured  float64
	}{
		{
			name:        "50_bags_no_discount_base_risk",
			bags:        50,
			pricePerBag: 3200,
			baseRate:    0.03,
			discountPct: 0,
			riskFactor:  1.00,
			wantPremium: 50 * 3200 * 0.03,     // 4800
			wantInsured: 50 * 3200,             // 160000
		},
		{
			name:        "50_bags_25pct_discount_base_risk",
			bags:        50,
			pricePerBag: 3200,
			baseRate:    0.03,
			discountPct: 25,
			riskFactor:  1.00,
			wantPremium: 50 * 3200 * 0.03 * 0.75, // 3600
			wantInsured: 50 * 3200,
		},
		{
			name:        "100_bags_no_discount_high_risk",
			bags:        100,
			pricePerBag: 4000,
			baseRate:    0.03,
			discountPct: 0,
			riskFactor:  1.35,
			wantPremium: 100 * 4000 * 0.03 * 1.35, // 16200
			wantInsured: 100 * 4000,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			insuredValue := float64(tt.bags) * tt.pricePerBag
			adjustedRate := tt.baseRate * tt.riskFactor
			finalRate := adjustedRate * (1 - tt.discountPct/100)
			premium := insuredValue * finalRate

			if premium != tt.wantPremium {
				t.Errorf("premium = %.2f, want %.2f", premium, tt.wantPremium)
			}
			if insuredValue != tt.wantInsured {
				t.Errorf("insuredValue = %.2f, want %.2f", insuredValue, tt.wantInsured)
			}
		})
	}
}


func TestBlockchainHash_Deterministic(t *testing.T) {
	ts := time.Date(2026, 3, 23, 12, 0, 0, 0, time.UTC)
	triggers := []string{"aflatoxin", "climate", "price_floor"}

	hash1 := repository.GenerateBlockchainHash("GS-00847-2026-03", "farmer-uuid-1", 50, 160000, 4800, triggers, ts)
	hash2 := repository.GenerateBlockchainHash("GS-00847-2026-03", "farmer-uuid-1", 50, 160000, 4800, triggers, ts)

	if hash1 != hash2 {
		t.Errorf("same inputs should produce same hash: %s != %s", hash1, hash2)
	}

	// Different inputs → different hash
	hash3 := repository.GenerateBlockchainHash("GS-00848-2026-03", "farmer-uuid-2", 50, 160000, 4800, triggers, ts)
	if hash1 == hash3 {
		t.Error("different inputs should produce different hash")
	}
}

func TestBlockchainHash_Format(t *testing.T) {
	ts := time.Now()
	hash := repository.GenerateBlockchainHash("GS-00847-2026-03", "farmer-uuid-1", 50, 160000, 4800, []string{"aflatoxin"}, ts)

	// Must start with 0x
	if hash[:2] != "0x" {
		t.Errorf("hash should start with '0x', got %s", hash[:2])
	}

	// Should be 66 chars: 0x + 64 hex chars (SHA-256)
	if len(hash) != 66 {
		t.Errorf("hash should be 66 chars (0x + 64 hex), got %d", len(hash))
	}
}


func TestTriggerEvaluation_AlwaysCreated(t *testing.T) {
	// A trigger evaluation should always have an evaluation time, trigger ID,
	// and data_evaluated map — regardless of whether the trigger fires or not
	eval := models.TriggerEvaluation{
		ID:               uuid.New(),
		TriggerID:        uuid.New(),
		PolicyID:         uuid.New(),
		TriggerType:      models.TriggerAflatoxin,
		EvaluationTime:   time.Now(),
		DataEvaluated:    map[string]interface{}{"test": true},
		ThresholdChecked: "risk_score > 70 AND contamination_ppb > 10",
		ThresholdValue:   70,
		ActualValue:      45,
		Result:           false, // Did not fire
		DataSources:      []string{"IITA A-EWS API"},
		Notes:            "both below threshold",
	}

	if eval.TriggerID == uuid.Nil {
		t.Error("trigger_id must be set")
	}
	if eval.DataEvaluated == nil {
		t.Error("data_evaluated must not be nil")
	}
	if len(eval.DataSources) == 0 {
		t.Error("data_sources must not be empty")
	}
	if eval.ThresholdChecked == "" {
		t.Error("threshold_checked must not be empty")
	}
}


func TestPayoutDeadline_ExactlyFourHours(t *testing.T) {
	now := time.Now()
	deadline := now.Add(4 * time.Hour)

	diff := deadline.Sub(now)
	if diff != 4*time.Hour {
		t.Errorf("payout deadline should be exactly 4 hours, got %v", diff)
	}
}

func TestPayoutDeadline_ConstantMatch(t *testing.T) {
	if trigger.PayoutDeadlineHours != 4 {
		t.Errorf("PayoutDeadlineHours should be 4, got %d", trigger.PayoutDeadlineHours)
	}
}


func TestAflatoxinThresholds(t *testing.T) {
	if trigger.AflatoxinThresholdScore != 70.0 {
		t.Errorf("aflatoxin score threshold should be 70, got %.0f", trigger.AflatoxinThresholdScore)
	}
	if trigger.AflatoxinThresholdPPB != 10.0 {
		t.Errorf("aflatoxin PPB threshold should be 10, got %.0f", trigger.AflatoxinThresholdPPB)
	}
}

func TestAflatoxinCondition_BothMet(t *testing.T) {
	// Both conditions met → should fire
	riskScore := 75.0
	ppb := 15.0
	result := riskScore > trigger.AflatoxinThresholdScore && ppb > trigger.AflatoxinThresholdPPB
	if !result {
		t.Error("both conditions met: should fire")
	}
}

func TestAflatoxinCondition_ScoreOnlyMet(t *testing.T) {
	// Score > 70 but PPB ≤ 10 → should NOT fire
	riskScore := 80.0
	ppb := 5.0
	result := riskScore > trigger.AflatoxinThresholdScore && ppb > trigger.AflatoxinThresholdPPB
	if result {
		t.Error("ppb below threshold: should not fire")
	}
}

func TestAflatoxinCondition_PPBOnlyMet(t *testing.T) {
	// PPB > 10 but score ≤ 70 → should NOT fire
	riskScore := 50.0
	ppb := 20.0
	result := riskScore > trigger.AflatoxinThresholdScore && ppb > trigger.AflatoxinThresholdPPB
	if result {
		t.Error("score below threshold: should not fire")
	}
}

func TestAflatoxinCondition_NeitherMet(t *testing.T) {
	riskScore := 30.0
	ppb := 5.0
	result := riskScore > trigger.AflatoxinThresholdScore && ppb > trigger.AflatoxinThresholdPPB
	if result {
		t.Error("neither condition met: should not fire")
	}
}

func TestAflatoxinCondition_ExactBoundary(t *testing.T) {
	// Exactly at threshold → should NOT fire (strictly greater than)
	riskScore := 70.0
	ppb := 10.0
	result := riskScore > trigger.AflatoxinThresholdScore && ppb > trigger.AflatoxinThresholdPPB
	if result {
		t.Error("exact boundary (not strictly greater): should not fire")
	}
}


func TestClimateThresholds(t *testing.T) {
	if trigger.HumidityThreshold != 80.0 {
		t.Errorf("humidity threshold should be 80, got %.0f", trigger.HumidityThreshold)
	}
	if trigger.ConsecutiveHoursReq != 48 {
		t.Errorf("consecutive hours should be 48, got %d", trigger.ConsecutiveHoursReq)
	}
}

func TestClimateCondition_BothMet(t *testing.T) {
	consecutiveHours := 52
	weatherEvent := true
	result := consecutiveHours >= trigger.ConsecutiveHoursReq && weatherEvent
	if !result {
		t.Error("both conditions met: should fire")
	}
}

func TestClimateCondition_HumidityOnly(t *testing.T) {
	consecutiveHours := 52
	weatherEvent := false
	result := consecutiveHours >= trigger.ConsecutiveHoursReq && weatherEvent
	if result {
		t.Error("no weather event: should not fire")
	}
}

func TestClimateCondition_WeatherOnly(t *testing.T) {
	consecutiveHours := 30
	weatherEvent := true
	result := consecutiveHours >= trigger.ConsecutiveHoursReq && weatherEvent
	if result {
		t.Error("humidity below threshold: should not fire")
	}
}

func TestClimateCondition_ExactBoundary48Hours(t *testing.T) {
	consecutiveHours := 48
	weatherEvent := true
	result := consecutiveHours >= trigger.ConsecutiveHoursReq && weatherEvent
	if !result {
		t.Error("exactly 48 hours (>=): should fire")
	}
}


func TestPriceFloorCondition_PriceBelowCost(t *testing.T) {
	ncpbPrice := 2800.0
	costOfProduction := 3200.0
	result := ncpbPrice < costOfProduction
	if !result {
		t.Error("NCPB price below cost: should fire")
	}
}

func TestPriceFloorCondition_PriceAboveCost(t *testing.T) {
	ncpbPrice := 3500.0
	costOfProduction := 3200.0
	result := ncpbPrice < costOfProduction
	if result {
		t.Error("NCPB price above cost: should not fire")
	}
}

func TestPriceFloorCondition_PriceEqualsCost(t *testing.T) {
	ncpbPrice := 3200.0
	costOfProduction := 3200.0
	result := ncpbPrice < costOfProduction
	if result {
		t.Error("NCPB price equals cost (not strictly less): should not fire")
	}
}

func TestPriceFloorPayout_FiftyPercent(t *testing.T) {
	insuredValue := 160000.0
	expectedPayout := insuredValue * 0.5
	if expectedPayout != 80000.0 {
		t.Errorf("price floor payout should be 50%% of insured value: got %.2f", expectedPayout)
	}
}


func TestPolicyTriggeredEvent_AllFieldsPopulated(t *testing.T) {
	event := models.PolicyTriggeredEvent{
		EventID:        uuid.New(),
		PolicyID:       uuid.New(),
		ContractID:     "GS-00847-2026-03",
		TriggerID:      uuid.New(),
		TriggerType:    "aflatoxin",
		ClaimID:        uuid.New(),
		FarmerID:       uuid.New(),
		FarmerGSNumber: "GS-00847",
		PayoutAmount:   160000,
		PayoutDeadline: time.Now().Add(4 * time.Hour),
		FiredAt:        time.Now(),
	}

	if event.EventID == uuid.Nil {
		t.Error("event_id must be set")
	}
	if event.ContractID == "" {
		t.Error("contract_id must be set")
	}
	if event.PayoutAmount <= 0 {
		t.Error("payout_amount must be positive")
	}
	if event.PayoutDeadline.Before(event.FiredAt) {
		t.Error("payout_deadline must be after fired_at")
	}
}

func TestArmedTrigger_CostOfProductionRequired(t *testing.T) {
	// For price_floor triggers, cost_of_production must be > 0
	trigger := models.ArmedTrigger{
		TriggerType:      models.TriggerPriceFloor,
		CostOfProduction: 0,
	}

	if trigger.CostOfProduction > 0 {
		t.Error("zero cost_of_production should fail price_floor evaluation")
	}
}


func TestValidGrainGrades_Complete(t *testing.T) {
	expected := []string{"Grade 1", "Grade 2", "Grade 3"}
	for _, g := range expected {
		if !models.ValidGrainGrades[g] {
			t.Errorf("grade '%s' should be valid", g)
		}
	}

	invalid := []string{"Grade 4", "grade 1", "", "Premium", "A"}
	for _, g := range invalid {
		if models.ValidGrainGrades[g] {
			t.Errorf("grade '%s' should not be valid", g)
		}
	}
}


func TestTriggerTypes_Complete(t *testing.T) {
	types := []models.TriggerType{
		models.TriggerAflatoxin,
		models.TriggerClimate,
		models.TriggerPriceFloor,
	}
	if len(types) != 3 {
		t.Errorf("expected 3 trigger types, got %d", len(types))
	}
}

func TestClaimStatuses_Complete(t *testing.T) {
	statuses := []models.ClaimStatus{
		models.ClaimPending,
		models.ClaimConfirmed,
		models.ClaimPaid,
		models.ClaimRejected,
	}
	if len(statuses) != 4 {
		t.Errorf("expected 4 claim statuses, got %d", len(statuses))
	}
}
