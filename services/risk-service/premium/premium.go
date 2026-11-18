// Package premium implements dynamic premium calculation based on aflatoxin risk scores.
// Score bands: 0-40 base rate, 41-70 +15%, 71-100 +35%.
package premium


const (
	// Score band thresholds
	bandLowMax  = 40.0
	bandMidMax  = 70.0
	bandHighMax = 100.0

	// Multipliers per band
	multiplierBase = 1.0
	multiplierMid  = 1.15
	multiplierHigh = 1.35
)

// CalculatePremiumMultiplier returns the premium multiplier for a given risk score.
// Score 0-40: 1.0 (base rate)
// Score 41-70: 1.15 (+15%)
// Score 71-100: 1.35 (+35%)
// Scores outside 0-100 are clamped.
func CalculatePremiumMultiplier(riskScore float64) float64 {
	if riskScore < 0 {
		riskScore = 0
	}
	if riskScore > bandHighMax {
		riskScore = bandHighMax
	}

	if riskScore <= bandLowMax {
		return multiplierBase
	}
	if riskScore <= bandMidMax {
		return multiplierMid
	}
	return multiplierHigh
}

// CalculatePremium returns the adjusted premium in KES.
func CalculatePremium(basePremiumKES float64, riskScore float64) float64 {
	return basePremiumKES * CalculatePremiumMultiplier(riskScore)
}
