package premium

import (
	"math"
	"testing"
)

func TestCalculatePremiumMultiplier(t *testing.T) {
	tests := []struct {
		name     string
		score    float64
		expected float64
	}{
		// Base band: 0-40
		{"score_0_base", 0, 1.0},
		{"score_20_base", 20, 1.0},
		{"score_40_boundary_base", 40, 1.0},

		// Mid band: 41-70
		{"score_41_mid", 41, 1.15},
		{"score_55_mid", 55, 1.15},
		{"score_70_boundary_mid", 70, 1.15},

		// High band: 71-100
		{"score_71_high", 71, 1.35},
		{"score_85_high", 85, 1.35},
		{"score_100_boundary_high", 100, 1.35},

		// Edge cases: clamped
		{"score_negative_clamp", -5, 1.0},
		{"score_above_100_clamp", 150, 1.35},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := CalculatePremiumMultiplier(tc.score)
			if math.Abs(got-tc.expected) > 0.001 {
				t.Errorf("CalculatePremiumMultiplier(%.1f) = %.2f, want %.2f",
					tc.score, got, tc.expected)
			}
		})
	}
}

func TestCalculatePremium(t *testing.T) {
	tests := []struct {
		name        string
		basePremium float64
		score       float64
		expected    float64
	}{
		{"low_risk_1000", 1000, 25, 1000.0},
		{"mid_risk_1000", 1000, 55, 1150.0},
		{"high_risk_1000", 1000, 85, 1350.0},
		{"zero_base", 0, 85, 0},
		{"high_risk_5000", 5000, 75, 6750.0},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := CalculatePremium(tc.basePremium, tc.score)
			if math.Abs(got-tc.expected) > 0.01 {
				t.Errorf("CalculatePremium(%.0f, %.0f) = %.2f, want %.2f",
					tc.basePremium, tc.score, got, tc.expected)
			}
		})
	}
}
