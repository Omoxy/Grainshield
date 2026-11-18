// Package trigger implements the price floor trigger evaluator.
// Condition 3: NCPB gazetted price falls below farmer declared production cost
package trigger

import (
	"context"
	"fmt"

	"go.uber.org/zap"

	"github.com/grainshield/policy-service/models"
)

// PriceFloorEvaluator evaluates the price floor trigger condition.
type PriceFloorEvaluator struct {
	client *ServiceClient
	logger *zap.Logger
}

// NewPriceFloorEvaluator creates a new PriceFloorEvaluator.
func NewPriceFloorEvaluator(client *ServiceClient, logger *zap.Logger) *PriceFloorEvaluator {
	return &PriceFloorEvaluator{client: client, logger: logger}
}

// NCPBSource is the data source identifier for NCPB gazetted prices.
const NCPBSource = "NCPB"

// Evaluate checks the price floor trigger condition for a single armed trigger.
//
// Condition: NCPB gazetted price < farmer declared production cost
// Payout: 50% of insured value (per GrainShield documentation)
//
// The farmer's cost_of_production was declared at policy creation and stored on the policy.
// The NCPB gazetted price is fetched from the price-service in real-time.
func (e *PriceFloorEvaluator) Evaluate(ctx context.Context, trigger models.ArmedTrigger) models.TriggerEvaluation {
	eval := models.TriggerEvaluation{
		TriggerID:        trigger.TriggerID,
		PolicyID:         trigger.PolicyID,
		TriggerType:      models.TriggerPriceFloor,
		ThresholdChecked: fmt.Sprintf("NCPB gazetted price < farmer cost_of_production (KES %.2f/bag)", trigger.CostOfProduction),
		ThresholdValue:   trigger.CostOfProduction,
		DataSources:      []string{"NCPB Price Feed"},
		Result:           false,
		DataEvaluated:    map[string]interface{}{},
	}

	// Validate that cost of production was set
	if trigger.CostOfProduction <= 0 {
		eval.Notes = "cost_of_production not set on policy — evaluation skipped"
		eval.DataEvaluated["cost_of_production"] = trigger.CostOfProduction
		return eval
	}

	// Fetch current market prices
	priceResp, err := e.client.GetCurrentPrices(ctx)
	if err != nil {
		e.logger.Error("price floor evaluation failed: price service unavailable",
			zap.String("trigger_id", trigger.TriggerID.String()),
			zap.Error(err),
		)
		eval.Notes = "price service unavailable — evaluation skipped"
		eval.DataEvaluated["error"] = "price_service_unavailable"
		return eval
	}

	if len(priceResp.Prices) == 0 {
		eval.Notes = "no market prices available"
		eval.DataEvaluated["prices_available"] = 0
		return eval
	}

	// Find NCPB source prices
	var ncpbPrice *MarketPrice
	for i, p := range priceResp.Prices {
		if p.Source == NCPBSource {
			ncpbPrice = &priceResp.Prices[i]
			break
		}
	}

	if ncpbPrice == nil {
		eval.Notes = "no NCPB gazetted price available in current data"
		eval.DataEvaluated["sources_available"] = len(priceResp.Prices)
		eval.DataEvaluated["ncpb_found"] = false
		return eval
	}

	// Record all data evaluated (for audit trail)
	eval.DataEvaluated["ncpb_price_per_bag"] = ncpbPrice.PricePerBag
	eval.DataEvaluated["ncpb_market"] = ncpbPrice.MarketName
	eval.DataEvaluated["ncpb_currency"] = ncpbPrice.Currency
	eval.DataEvaluated["ncpb_trend"] = ncpbPrice.Trend
	eval.DataEvaluated["ncpb_recorded_at"] = ncpbPrice.RecordedAt
	eval.DataEvaluated["farmer_cost_of_production"] = trigger.CostOfProduction
	eval.DataEvaluated["farmer_gs_number"] = trigger.FarmerGSNumber
	eval.ActualValue = ncpbPrice.PricePerBag

	// Evaluate: is NCPB price below farmer's cost of production?
	priceBelowCost := ncpbPrice.PricePerBag < trigger.CostOfProduction

	eval.DataEvaluated["price_below_cost"] = priceBelowCost
	eval.DataEvaluated["price_deficit"] = trigger.CostOfProduction - ncpbPrice.PricePerBag

	if priceBelowCost {
		eval.Result = true
		eval.Notes = fmt.Sprintf(
			"TRIGGER FIRED: NCPB price KES %.2f < farmer cost KES %.2f (deficit KES %.2f/bag). Payout = 50%% insured value",
			ncpbPrice.PricePerBag,
			trigger.CostOfProduction,
			trigger.CostOfProduction-ncpbPrice.PricePerBag,
		)
	} else {
		eval.Notes = fmt.Sprintf(
			"NCPB price KES %.2f ≥ farmer cost KES %.2f — no trigger",
			ncpbPrice.PricePerBag,
			trigger.CostOfProduction,
		)
	}

	return eval
}
