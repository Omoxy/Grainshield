// Package trigger implements the aflatoxin trigger evaluator.
// Condition 1: IITA A-EWS risk_score > 70 AND lab aflatoxin_test > 10ppb
package trigger

import (
	"context"
	"fmt"

	"go.uber.org/zap"

	"github.com/grainshield/policy-service/models"
)

// AflatoxinEvaluator evaluates the aflatoxin trigger condition.
type AflatoxinEvaluator struct {
	client *ServiceClient
	logger *zap.Logger
}

// NewAflatoxinEvaluator creates a new AflatoxinEvaluator.
func NewAflatoxinEvaluator(client *ServiceClient, logger *zap.Logger) *AflatoxinEvaluator {
	return &AflatoxinEvaluator{client: client, logger: logger}
}

// AflatoxinThresholdScore is the IITA A-EWS risk score threshold.
const AflatoxinThresholdScore = 70.0

// AflatoxinThresholdPPB is the lab contamination threshold in parts per billion.
const AflatoxinThresholdPPB = 10.0

// Evaluate checks the aflatoxin trigger condition for a single armed trigger.
//
// Condition: IITA A-EWS risk_score > 70 AND lab aflatoxin_test > 10ppb
//
// Both conditions must be TRUE simultaneously for the trigger to fire.
// The evaluation result is returned regardless of pass/fail for the audit trail.
func (e *AflatoxinEvaluator) Evaluate(ctx context.Context, trigger models.ArmedTrigger, subCounty string) models.TriggerEvaluation {
	eval := models.TriggerEvaluation{
		TriggerID:        trigger.TriggerID,
		PolicyID:         trigger.PolicyID,
		TriggerType:      models.TriggerAflatoxin,
		ThresholdChecked: fmt.Sprintf("risk_score > %.0f AND contamination_ppb > %.0f", AflatoxinThresholdScore, AflatoxinThresholdPPB),
		ThresholdValue:   AflatoxinThresholdScore,
		DataSources:      []string{"IITA A-EWS API"},
		Result:           false,
		DataEvaluated:    map[string]interface{}{},
	}

	// Call risk-service for aflatoxin data
	afResp, err := e.client.GetAflatoxinRisk(ctx, subCounty)
	if err != nil {
		e.logger.Error("aflatoxin evaluation failed: risk service unavailable",
			zap.String("trigger_id", trigger.TriggerID.String()),
			zap.Error(err),
		)
		eval.Notes = "risk service unavailable — evaluation skipped"
		eval.DataEvaluated["error"] = "risk_service_unavailable"
		return eval
	}

	if len(afResp.Scores) == 0 {
		eval.Notes = "no aflatoxin scores available for sub-county"
		eval.DataEvaluated["sub_county"] = subCounty
		eval.DataEvaluated["scores_available"] = 0
		return eval
	}

	// Find the score for the matching sub-county
	var matchedScore *AflatoxinScore
	for i, s := range afResp.Scores {
		if s.SubCounty == subCounty {
			matchedScore = &afResp.Scores[i]
			break
		}
	}
	if matchedScore == nil {
		// Use the first score if no exact sub-county match
		matchedScore = &afResp.Scores[0]
	}

	// Record all data evaluated (for audit trail)
	eval.DataEvaluated["sub_county"] = matchedScore.SubCounty
	eval.DataEvaluated["risk_score"] = matchedScore.RiskScore
	eval.DataEvaluated["contamination_ppb"] = matchedScore.ContaminationPPB
	eval.DataEvaluated["confidence"] = matchedScore.Confidence
	eval.DataEvaluated["model_version"] = matchedScore.ModelVersion
	eval.DataEvaluated["recorded_at"] = matchedScore.RecordedAt
	eval.ActualValue = matchedScore.RiskScore

	// Evaluate both conditions: score > 70 AND contamination > 10ppb
	scoreExceeded := matchedScore.RiskScore > AflatoxinThresholdScore
	ppbExceeded := matchedScore.ContaminationPPB > AflatoxinThresholdPPB

	eval.DataEvaluated["score_exceeded"] = scoreExceeded
	eval.DataEvaluated["ppb_exceeded"] = ppbExceeded

	if scoreExceeded && ppbExceeded {
		eval.Result = true
		eval.Notes = fmt.Sprintf(
			"TRIGGER FIRED: risk_score=%.1f (>%.0f) AND contamination=%.1fppb (>%.0fppb)",
			matchedScore.RiskScore, AflatoxinThresholdScore,
			matchedScore.ContaminationPPB, AflatoxinThresholdPPB,
		)
	} else if scoreExceeded {
		eval.Notes = fmt.Sprintf(
			"score exceeded (%.1f>%.0f) but contamination below threshold (%.1f≤%.0fppb)",
			matchedScore.RiskScore, AflatoxinThresholdScore,
			matchedScore.ContaminationPPB, AflatoxinThresholdPPB,
		)
	} else if ppbExceeded {
		eval.Notes = fmt.Sprintf(
			"contamination exceeded (%.1fppb>%.0fppb) but score below threshold (%.1f≤%.0f)",
			matchedScore.ContaminationPPB, AflatoxinThresholdPPB,
			matchedScore.RiskScore, AflatoxinThresholdScore,
		)
	} else {
		eval.Notes = fmt.Sprintf(
			"both below threshold: score=%.1f (≤%.0f), contamination=%.1fppb (≤%.0fppb)",
			matchedScore.RiskScore, AflatoxinThresholdScore,
			matchedScore.ContaminationPPB, AflatoxinThresholdPPB,
		)
	}

	return eval
}
