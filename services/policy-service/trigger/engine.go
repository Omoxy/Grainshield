// Package trigger implements the trigger evaluation engine for the policy-service.
// The engine runs every 6 hours (configurable), evaluating all armed triggers
// across all active policies. Every evaluation writes an immutable audit record.
package trigger

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.uber.org/zap"

	"github.com/grainshield/pkg/middleware"
	"github.com/grainshield/policy-service/models"
)

// PayoutDeadlineHours is the number of hours after trigger confirmation
// within which payout must be completed.
const PayoutDeadlineHours = 4

// Engine is the trigger evaluation engine.
type Engine struct {
	db                 *pgxpool.Pool
	audit              *middleware.AuditLogger
	aflatoxinEval      *AflatoxinEvaluator
	climateEval        *ClimateEvaluator
	priceFloorEval     *PriceFloorEvaluator
	logger             *zap.Logger
	interval           time.Duration
}

// NewEngine creates a new trigger evaluation engine.
func NewEngine(
	db *pgxpool.Pool,
	audit *middleware.AuditLogger,
	client *ServiceClient,
	logger *zap.Logger,
	interval time.Duration,
) *Engine {
	return &Engine{
		db:             db,
		audit:          audit,
		aflatoxinEval:  NewAflatoxinEvaluator(client, logger),
		climateEval:    NewClimateEvaluator(client, logger),
		priceFloorEval: NewPriceFloorEvaluator(client, logger),
		logger:         logger,
		interval:       interval,
	}
}

// Start begins the periodic trigger evaluation loop.
// It runs in its own goroutine and can be stopped via context cancellation.
func (e *Engine) Start(ctx context.Context) {
	e.logger.Info("starting trigger evaluation engine",
		zap.Duration("interval", e.interval),
	)

	// Run an initial evaluation immediately
	e.RunEvaluationCycle(ctx)

	ticker := time.NewTicker(e.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			e.logger.Info("trigger evaluation engine stopped")
			return
		case <-ticker.C:
			e.RunEvaluationCycle(ctx)
		}
	}
}

// RunEvaluationCycle evaluates all armed triggers. This can be called
// manually via the /evaluate endpoint or automatically by the ticker.
func (e *Engine) RunEvaluationCycle(ctx context.Context) {
	cycleID := uuid.New()
	startTime := time.Now()

	e.logger.Info("starting trigger evaluation cycle",
		zap.String("cycle_id", cycleID.String()),
	)

	// Evaluate each trigger type
	aflatoxinCount := e.evaluateByType(ctx, models.TriggerAflatoxin, cycleID)
	climateCount := e.evaluateByType(ctx, models.TriggerClimate, cycleID)
	priceCount := e.evaluateByType(ctx, models.TriggerPriceFloor, cycleID)

	duration := time.Since(startTime)
	e.logger.Info("trigger evaluation cycle complete",
		zap.String("cycle_id", cycleID.String()),
		zap.Int("aflatoxin_evaluated", aflatoxinCount),
		zap.Int("climate_evaluated", climateCount),
		zap.Int("price_floor_evaluated", priceCount),
		zap.Duration("duration", duration),
	)
}

// RunSingleType evaluates only triggers of a specific type.
func (e *Engine) RunSingleType(ctx context.Context, triggerType models.TriggerType) int {
	cycleID := uuid.New()
	return e.evaluateByType(ctx, triggerType, cycleID)
}

// evaluateByType fetches all armed triggers of a given type and evaluates each.
func (e *Engine) evaluateByType(ctx context.Context, triggerType models.TriggerType, cycleID uuid.UUID) int {
	triggers, err := e.getArmedTriggers(ctx, triggerType)
	if err != nil {
		e.logger.Error("failed to fetch armed triggers",
			zap.String("type", string(triggerType)),
			zap.Error(err),
		)
		return 0
	}

	if len(triggers) == 0 {
		return 0
	}

	e.logger.Info("evaluating armed triggers",
		zap.String("type", string(triggerType)),
		zap.Int("count", len(triggers)),
	)

	evaluated := 0
	for _, t := range triggers {
		var eval models.TriggerEvaluation

		switch triggerType {
		case models.TriggerAflatoxin:
			eval = e.aflatoxinEval.Evaluate(ctx, t, "" /* sub-county fetched from warehouse */)
		case models.TriggerClimate:
			eval = e.climateEval.Evaluate(ctx, t)
		case models.TriggerPriceFloor:
			eval = e.priceFloorEval.Evaluate(ctx, t)
		}

		eval.EvaluationTime = time.Now()
		eval.ID = uuid.New()

		// Write evaluation audit record (ALWAYS, regardless of result)
		if err := e.saveEvaluation(ctx, eval); err != nil {
			e.logger.Error("failed to save trigger evaluation",
				zap.String("trigger_id", t.TriggerID.String()),
				zap.Error(err),
			)
		}

		// If trigger fired, create claim with payout deadline
		if eval.Result {
			if err := e.fireTrigger(ctx, t, eval); err != nil {
				e.logger.Error("failed to fire trigger",
					zap.String("trigger_id", t.TriggerID.String()),
					zap.Error(err),
				)
			}
		}

		evaluated++
	}

	return evaluated
}

// getArmedTriggers fetches all armed triggers of a given type with their policy data.
// Security Rule #3: Parameterised queries only.
func (e *Engine) getArmedTriggers(ctx context.Context, triggerType models.TriggerType) ([]models.ArmedTrigger, error) {
	rows, err := e.db.Query(ctx,
		`SELECT pt.id, pt.policy_id, pt.trigger_type, pt.threshold_value, pt.payout_amount,
		        p.farmer_id, p.farmer_gs_number, p.warehouse_id, COALESCE(p.cost_of_production, 0)
		 FROM policy_triggers pt
		 JOIN policies p ON pt.policy_id = p.id
		 WHERE pt.trigger_type = $1
		   AND pt.status = 'armed'
		   AND p.status = 'active'
		   AND p.expiry_date >= CURRENT_DATE
		 ORDER BY p.created_at`, string(triggerType),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to query armed triggers: %w", err)
	}
	defer rows.Close()

	var triggers []models.ArmedTrigger
	for rows.Next() {
		var t models.ArmedTrigger
		if err := rows.Scan(&t.TriggerID, &t.PolicyID, &t.TriggerType, &t.ThresholdValue,
			&t.PayoutAmount, &t.FarmerID, &t.FarmerGSNumber, &t.WarehouseID, &t.CostOfProduction); err != nil {
			return nil, fmt.Errorf("failed to scan armed trigger: %w", err)
		}
		triggers = append(triggers, t)
	}

	return triggers, nil
}

// saveEvaluation writes an immutable trigger evaluation record.
// Security Rule #3: Parameterised queries.
// Security Rule #4: Audit trail for every evaluation.
func (e *Engine) saveEvaluation(ctx context.Context, eval models.TriggerEvaluation) error {
	dataJSON, err := json.Marshal(eval.DataEvaluated)
	if err != nil {
		dataJSON = []byte("{}")
	}

	_, err = e.db.Exec(ctx,
		`INSERT INTO trigger_evaluations (id, trigger_id, policy_id, trigger_type, evaluation_time, data_evaluated, threshold_checked, threshold_value, actual_value, result, data_sources, notes)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
		eval.ID, eval.TriggerID, eval.PolicyID, string(eval.TriggerType),
		eval.EvaluationTime, string(dataJSON), eval.ThresholdChecked,
		eval.ThresholdValue, eval.ActualValue, eval.Result,
		eval.DataSources, eval.Notes,
	)
	if err != nil {
		return fmt.Errorf("failed to save evaluation: %w", err)
	}
	return nil
}

// fireTrigger fires a trigger, creates a claim with payout deadline, and writes audit.
// Security Rule #3: Parameterised queries.
// Security Rule #4: Audit trail.
func (e *Engine) fireTrigger(ctx context.Context, trigger models.ArmedTrigger, eval models.TriggerEvaluation) error {
	now := time.Now()
	payoutDeadline := now.Add(PayoutDeadlineHours * time.Hour)

	tx, err := e.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// 1. Update trigger status to 'fired'
	_, err = tx.Exec(ctx,
		`UPDATE policy_triggers SET status = 'fired', fired_at = $1, confirmed_at = $1 WHERE id = $2 AND status = 'armed'`,
		now, trigger.TriggerID,
	)
	if err != nil {
		return fmt.Errorf("failed to fire trigger: %w", err)
	}

	// 2. Create claim with payout deadline (Security Rule: 4-hour deadline)
	claimID := uuid.New()
	_, err = tx.Exec(ctx,
		`INSERT INTO claims (id, policy_id, trigger_id, farmer_id, trigger_type, amount, status, triggered_at, confirmed_at, payout_deadline)
		 VALUES ($1, $2, $3, $4, $5, $6, 'confirmed', $7, $7, $8)`,
		claimID, trigger.PolicyID, trigger.TriggerID, trigger.FarmerID,
		string(trigger.TriggerType), trigger.PayoutAmount, now, payoutDeadline,
	)
	if err != nil {
		return fmt.Errorf("failed to create claim: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("transaction commit failed: %w", err)
	}

	// 3. Audit log (Security Rule #4)
	e.audit.Log(ctx, "trigger-engine", "trigger:auto_fire", "claim",
		claimID.String(), map[string]interface{}{
			"trigger_id":      trigger.TriggerID.String(),
			"trigger_type":    string(trigger.TriggerType),
			"policy_id":       trigger.PolicyID.String(),
			"farmer_gs":       trigger.FarmerGSNumber,
			"payout_amount":   trigger.PayoutAmount,
			"payout_deadline": payoutDeadline.Format(time.RFC3339),
			"evaluation_id":   eval.ID.String(),
		})

	e.logger.Info("trigger fired successfully",
		zap.String("trigger_id", trigger.TriggerID.String()),
		zap.String("claim_id", claimID.String()),
		zap.String("type", string(trigger.TriggerType)),
		zap.Float64("payout", trigger.PayoutAmount),
		zap.Time("deadline", payoutDeadline),
	)

	return nil
}

// ExpireOverduePolicies marks policies past their expiry_date as expired.
// Also disables armed triggers on expired policies.
// Security Rule #3: Parameterised queries.
func (e *Engine) ExpireOverduePolicies(ctx context.Context) (int, error) {
	now := time.Now()

	// Expire policies
	tag, err := e.db.Exec(ctx,
		`UPDATE policies SET status = 'expired' WHERE status = 'active' AND expiry_date < $1`,
		now,
	)
	if err != nil {
		return 0, fmt.Errorf("failed to expire policies: %w", err)
	}
	expired := int(tag.RowsAffected())

	// Disable armed triggers on expired policies
	if expired > 0 {
		_, err = e.db.Exec(ctx,
			`UPDATE policy_triggers SET status = 'expired'
			 WHERE status = 'armed' AND policy_id IN (SELECT id FROM policies WHERE status = 'expired')`,
		)
		if err != nil {
			e.logger.Error("failed to expire triggers on expired policies", zap.Error(err))
		}

		e.audit.Log(ctx, "trigger-engine", "policy:auto_expire", "policy", "batch",
			map[string]interface{}{
				"expired_count": expired,
				"expired_at":    now.Format(time.RFC3339),
			})
	}

	return expired, nil
}
