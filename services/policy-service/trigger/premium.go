// Package trigger provides the dynamic premium calculator for the policy-service.
// Premium is adjusted based on real-time risk scores from the risk-service.
package trigger

import (
	"context"

	"go.uber.org/zap"

	"github.com/grainshield/policy-service/models"
)

// PremiumCalculator computes policy premiums with dynamic risk-based adjustments.
type PremiumCalculator struct {
	client *ServiceClient
	logger *zap.Logger
}

// NewPremiumCalculator creates a new PremiumCalculator.
func NewPremiumCalculator(client *ServiceClient, logger *zap.Logger) *PremiumCalculator {
	return &PremiumCalculator{client: client, logger: logger}
}

// Calculate computes the premium for a policy creation request.
//
// Risk adjustment logic (from documentation):
//   - Score 0–40:  base premium rate (adjustment factor 1.00)
//   - Score 41–70: base rate × 1.15 (+15%)
//   - Score 71–100: base rate × 1.35 (+35%)
//
// If the risk-service is unavailable, we use the base rate (fail-open for
// availability — the farmer should not be blocked from getting insurance).
func (pc *PremiumCalculator) Calculate(ctx context.Context, req models.CreatePolicyRequest) models.PremiumCalculation {
	insuredValue := float64(req.Bags) * req.PricePerBag

	// Fetch current risk score for the farmer's sub-county
	riskScore := float64(0)
	if req.SubCounty != "" {
		afResp, err := pc.client.GetAflatoxinRisk(ctx, req.SubCounty)
		if err != nil {
			pc.logger.Warn("risk service unavailable, using base premium rate",
				zap.String("sub_county", req.SubCounty),
				zap.Error(err),
			)
		} else if len(afResp.Scores) > 0 {
			// Use the score for the farmer's sub-county
			for _, s := range afResp.Scores {
				if s.SubCounty == req.SubCounty {
					riskScore = s.RiskScore
					break
				}
			}
			// If no exact match, use the first (latest) score
			if riskScore == 0 && len(afResp.Scores) > 0 {
				riskScore = afResp.Scores[0].RiskScore
			}
		}
	}

	// Determine adjustment factor based on risk score
	adjustmentFactor := RiskAdjustmentFactor(riskScore)

	// Apply adjustment to base rate
	adjustedRate := req.PremiumRate * adjustmentFactor

	// Apply input verification discount
	finalRate := adjustedRate * (1 - req.DiscountPct/100)

	// Calculate premium
	premium := insuredValue * finalRate

	return models.PremiumCalculation{
		BaseRate:         req.PremiumRate,
		RiskScore:        riskScore,
		AdjustmentFactor: adjustmentFactor,
		AdjustedRate:     adjustedRate,
		DiscountPct:      req.DiscountPct,
		FinalRate:        finalRate,
		InsuredValue:     insuredValue,
		Premium:          premium,
	}
}

// RiskAdjustmentFactor returns the premium adjustment multiplier for a risk score.
//
//	Score 0–40:  1.00 (no adjustment)
//	Score 41–70: 1.15 (+15%)
//	Score 71–100: 1.35 (+35%)
func RiskAdjustmentFactor(riskScore float64) float64 {
	switch {
	case riskScore <= 40:
		return 1.00
	case riskScore <= 70:
		return 1.15
	default:
		return 1.35
	}
}
