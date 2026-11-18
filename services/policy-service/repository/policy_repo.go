// Package repository implements database operations for the policy-service.
// Security Rule #3: Parameterised queries only. No string concatenation in SQL.
package repository

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/grainshield/policy-service/models"
)

// PolicyRepo provides database operations for policies.
type PolicyRepo struct {
	db *pgxpool.Pool
}

// NewPolicyRepo creates a new PolicyRepo.
func NewPolicyRepo(db *pgxpool.Pool) *PolicyRepo {
	return &PolicyRepo{db: db}
}

// Create inserts a new policy with its 3 trigger conditions and a deterministic
// blockchain hash. The hash is generated once and stored immutably — the DB
// trigger prevent_blockchain_hash_update() blocks any future UPDATE.
// All queries are parameterized (Security Rule #3).
func (r *PolicyRepo) Create(ctx context.Context, req models.CreatePolicyRequest, calc models.PremiumCalculation) (map[string]interface{}, error) {
	farmerID, err := uuid.Parse(req.FarmerID)
	if err != nil {
		return nil, fmt.Errorf("invalid farmer_id format")
	}
	warehouseID, err := uuid.Parse(req.WarehouseID)
	if err != nil {
		return nil, fmt.Errorf("invalid warehouse_id format")
	}

	// Generate contract ID: GS-XXXXX-YYYY-MM
	now := time.Now()
	contractID := fmt.Sprintf("%s-%d-%02d", req.FarmerGSNumber, now.Year(), now.Month())

	policyID := uuid.New()
	depositDate := now
	expiryDate := now.AddDate(0, 6, 0) // 6 months coverage

	// Generate deterministic blockchain hash (Security Rule: immutable once set)
	blockchainHash := GenerateBlockchainHash(
		contractID, req.FarmerID, req.Bags,
		calc.InsuredValue, calc.Premium,
		[]string{"aflatoxin", "climate", "price_floor"},
		now,
	)

	// Parameterized INSERT (Security Rule #3)
	_, err = r.db.Exec(ctx,
		`INSERT INTO policies (id, contract_id, farmer_id, farmer_gs_number, warehouse_id, commodity, bags, grain_grade, storage_bay, insured_value, premium, premium_rate, discount_pct, cost_of_production, moisture_content, deposit_date, expiry_date, blockchain_hash)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
		policyID, contractID, farmerID, req.FarmerGSNumber, warehouseID,
		"Maize", req.Bags, req.GrainGrade, req.StorageBay,
		calc.InsuredValue, calc.Premium, calc.FinalRate, req.DiscountPct,
		req.CostOfProduction, req.MoistureContent,
		depositDate, expiryDate, blockchainHash,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to insert policy: %w", err)
	}

	// Create the 3 trigger conditions
	triggers := []struct {
		triggerType string
		condition   string
		threshold   float64
		payout      float64
		source      string
	}{
		{
			"aflatoxin",
			"IF a_ews_risk_score > 70 AND aflatoxin_test > 10ppb THEN payout 100%",
			70,
			calc.InsuredValue,
			"IITA A-EWS API",
		},
		{
			"climate",
			"IF warehouse_humidity > 80% FOR 48hrs AND satellite_weather_event = TRUE THEN payout 100%",
			80,
			calc.InsuredValue,
			"ESA Copernicus + IoT",
		},
		{
			"price_floor",
			fmt.Sprintf("IF ncpb_gazetted_price < farmer_cost_of_production (KES %.2f) THEN payout 50%%", req.CostOfProduction),
			req.CostOfProduction,
			calc.InsuredValue * 0.5, // Price floor pays 50%
			"NCPB Price Feed",
		},
	}

	for _, t := range triggers {
		triggerID := uuid.New()
		_, err = r.db.Exec(ctx,
			`INSERT INTO policy_triggers (id, policy_id, trigger_type, condition_desc, threshold_value, payout_amount, data_source)
			 VALUES ($1,$2,$3,$4,$5,$6,$7)`,
			triggerID, policyID, t.triggerType, t.condition, t.threshold, t.payout, t.source,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to create trigger %s: %w", t.triggerType, err)
		}
	}

	return map[string]interface{}{
		"id":               policyID,
		"contract_id":      contractID,
		"insured_value":    calc.InsuredValue,
		"premium":          calc.Premium,
		"premium_breakdown": calc,
		"blockchain_hash":  blockchainHash,
		"triggers_armed":   3,
		"expiry_date":      expiryDate.Format("2006-01-02"),
	}, nil
}

// GetByID retrieves a policy with its triggers by ID.
func (r *PolicyRepo) GetByID(ctx context.Context, policyID uuid.UUID) (*models.Policy, []models.Trigger, error) {
	p := &models.Policy{}
	err := r.db.QueryRow(ctx,
		`SELECT id, contract_id, farmer_gs_number, bags, grain_grade, insured_value, premium, status, COALESCE(blockchain_hash,''), deposit_date, expiry_date
		 FROM policies WHERE id = $1`, policyID,
	).Scan(&p.ID, &p.ContractID, &p.FarmerGSNumber, &p.Bags, &p.GrainGrade, &p.InsuredValue, &p.Premium, &p.Status, &p.BlockchainHash, &p.DepositDate, &p.ExpiryDate)
	if err == pgx.ErrNoRows {
		return nil, nil, nil
	}
	if err != nil {
		return nil, nil, fmt.Errorf("failed to get policy: %w", err)
	}

	// Fetch triggers
	rows, err := r.db.Query(ctx,
		`SELECT id, trigger_type, condition_desc, threshold_value, payout_amount, status, fired_at, confirmed_at, data_source
		 FROM policy_triggers WHERE policy_id = $1`, policyID)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to get triggers: %w", err)
	}
	defer rows.Close()

	var triggers []models.Trigger
	for rows.Next() {
		var t models.Trigger
		if err := rows.Scan(&t.ID, &t.TriggerType, &t.ConditionDesc, &t.ThresholdValue, &t.PayoutAmount, &t.Status, &t.FiredAt, &t.ConfirmedAt, &t.DataSource); err != nil {
			return nil, nil, fmt.Errorf("failed to scan trigger: %w", err)
		}
		triggers = append(triggers, t)
	}

	return p, triggers, nil
}

// List retrieves a paginated list of policies with optional status and farmer filters.
func (r *PolicyRepo) List(ctx context.Context, status, farmerGS string, page, limit int) ([]models.PolicySummary, int, error) {
	offset := (page - 1) * limit

	var totalCount int
	err := r.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM policies
		 WHERE ($1 = '' OR status = $1::policy_status_enum)
		   AND ($2 = '' OR farmer_gs_number = $2)`,
		status, farmerGS,
	).Scan(&totalCount)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to count policies: %w", err)
	}

	rows, err := r.db.Query(ctx,
		`SELECT id, contract_id, farmer_gs_number, bags, insured_value, premium, status, deposit_date, expiry_date
		 FROM policies
		 WHERE ($1 = '' OR status = $1::policy_status_enum)
		   AND ($2 = '' OR farmer_gs_number = $2)
		 ORDER BY created_at DESC LIMIT $3 OFFSET $4`,
		status, farmerGS, limit, offset,
	)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to list policies: %w", err)
	}
	defer rows.Close()

	var policies []models.PolicySummary
	for rows.Next() {
		var p models.PolicySummary
		if err := rows.Scan(&p.ID, &p.ContractID, &p.FarmerGSNumber, &p.Bags, &p.InsuredValue, &p.Premium, &p.Status, &p.DepositDate, &p.ExpiryDate); err != nil {
			return nil, 0, fmt.Errorf("failed to scan policy: %w", err)
		}
		policies = append(policies, p)
	}

	return policies, totalCount, nil
}

// FireTrigger fires a trigger and creates a claim with payout deadline in a single transaction.
func (r *PolicyRepo) FireTrigger(ctx context.Context, triggerID uuid.UUID, confirmedBy string) (map[string]interface{}, error) {
	now := time.Now()
	payoutDeadline := now.Add(4 * time.Hour) // 4-hour payout deadline

	// Get trigger and associated policy
	var policyID, farmerID uuid.UUID
	var triggerType string
	var payoutAmount float64
	var triggerStatus string

	err := r.db.QueryRow(ctx,
		`SELECT pt.policy_id, p.farmer_id, pt.trigger_type, pt.payout_amount, pt.status
		 FROM policy_triggers pt JOIN policies p ON pt.policy_id = p.id
		 WHERE pt.id = $1`, triggerID,
	).Scan(&policyID, &farmerID, &triggerType, &payoutAmount, &triggerStatus)
	if err == pgx.ErrNoRows {
		return nil, fmt.Errorf("trigger not found")
	}
	if err != nil {
		return nil, fmt.Errorf("trigger lookup failed: %w", err)
	}

	if triggerStatus != "armed" {
		return nil, fmt.Errorf("trigger is not in armed state")
	}

	// Begin transaction
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Fire trigger
	if _, err := tx.Exec(ctx,
		`UPDATE policy_triggers SET status = 'fired', fired_at = $1, confirmed_at = $1 WHERE id = $2`,
		now, triggerID); err != nil {
		return nil, fmt.Errorf("failed to update trigger: %w", err)
	}

	// Create claim with payout deadline
	claimID := uuid.New()
	if _, err := tx.Exec(ctx,
		`INSERT INTO claims (id, policy_id, trigger_id, farmer_id, trigger_type, amount, status, triggered_at, confirmed_at, payout_deadline)
		 VALUES ($1,$2,$3,$4,$5,$6,'confirmed',$7,$7,$8)`,
		claimID, policyID, triggerID, farmerID, triggerType, payoutAmount, now, payoutDeadline); err != nil {
		return nil, fmt.Errorf("failed to create claim: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("transaction commit failed: %w", err)
	}

	return map[string]interface{}{
		"claim_id":        claimID,
		"policy_id":       policyID,
		"trigger_type":    triggerType,
		"amount":          payoutAmount,
		"status":          "confirmed",
		"confirmed_at":    now,
		"confirmed_by":    confirmedBy,
		"payout_deadline": payoutDeadline,
	}, nil
}

// ListClaims retrieves a paginated list of claims, optionally filtered by farmer GS number.
func (r *PolicyRepo) ListClaims(ctx context.Context, farmerGS string, page, limit int) ([]models.Claim, error) {
	offset := (page - 1) * limit

	rows, err := r.db.Query(ctx,
		`SELECT c.id, c.policy_id, p.contract_id, c.trigger_type, c.amount, c.status, c.triggered_at, c.confirmed_at, c.paid_at, COALESCE(c.payment_ref,''), c.payout_deadline
		 FROM claims c JOIN policies p ON c.policy_id = p.id
		 WHERE ($1 = '' OR p.farmer_gs_number = $1)
		 ORDER BY c.created_at DESC LIMIT $2 OFFSET $3`,
		farmerGS, limit, offset,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to list claims: %w", err)
	}
	defer rows.Close()

	var claims []models.Claim
	for rows.Next() {
		var c models.Claim
		if err := rows.Scan(&c.ID, &c.PolicyID, &c.ContractID, &c.TriggerType, &c.Amount, &c.Status, &c.TriggeredAt, &c.ConfirmedAt, &c.PaidAt, &c.PaymentRef, &c.PayoutDeadline); err != nil {
			return nil, fmt.Errorf("failed to scan claim: %w", err)
		}
		claims = append(claims, c)
	}

	return claims, nil
}

// GetStats retrieves dashboard statistics.
func (r *PolicyRepo) GetStats(ctx context.Context) (*models.PolicyStats, error) {
	stats := &models.PolicyStats{}

	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM policies WHERE status = 'active'`).Scan(&stats.ActivePolicies); err != nil {
		return nil, fmt.Errorf("failed to count active policies: %w", err)
	}
	if err := r.db.QueryRow(ctx, `SELECT COALESCE(SUM(insured_value),0) FROM policies WHERE status = 'active'`).Scan(&stats.TotalInsuredValue); err != nil {
		return nil, fmt.Errorf("failed to sum insured value: %w", err)
	}
	if err := r.db.QueryRow(ctx, `SELECT COALESCE(SUM(premium),0) FROM policies WHERE status = 'active'`).Scan(&stats.PremiumsCollected); err != nil {
		return nil, fmt.Errorf("failed to sum premiums: %w", err)
	}
	if err := r.db.QueryRow(ctx, `SELECT COALESCE(SUM(amount),0) FROM claims WHERE status = 'paid'`).Scan(&stats.TotalClaimsPaid); err != nil {
		return nil, fmt.Errorf("failed to sum claims: %w", err)
	}
	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM claims`).Scan(&stats.TotalTriggers); err != nil {
		return nil, fmt.Errorf("failed to count triggers: %w", err)
	}
	stats.DisputesFiled = 0 // Blockchain eliminates disputes

	return stats, nil
}

// GetOverduePayouts returns claims past their payout deadline that haven't been paid.
func (r *PolicyRepo) GetOverduePayouts(ctx context.Context) ([]models.Claim, error) {
	rows, err := r.db.Query(ctx,
		`SELECT c.id, c.policy_id, p.contract_id, c.trigger_type, c.amount, c.status, c.triggered_at, c.confirmed_at, c.paid_at, COALESCE(c.payment_ref,''), c.payout_deadline
		 FROM claims c JOIN policies p ON c.policy_id = p.id
		 WHERE c.status != 'paid' AND c.status != 'rejected'
		   AND c.payout_deadline IS NOT NULL AND c.payout_deadline < NOW()
		 ORDER BY c.payout_deadline ASC`)
	if err != nil {
		return nil, fmt.Errorf("failed to get overdue payouts: %w", err)
	}
	defer rows.Close()

	var claims []models.Claim
	for rows.Next() {
		var c models.Claim
		if err := rows.Scan(&c.ID, &c.PolicyID, &c.ContractID, &c.TriggerType, &c.Amount, &c.Status, &c.TriggeredAt, &c.ConfirmedAt, &c.PaidAt, &c.PaymentRef, &c.PayoutDeadline); err != nil {
			return nil, fmt.Errorf("failed to scan claim: %w", err)
		}
		claims = append(claims, c)
	}

	return claims, nil
}


// PolicyRevOpsSummary contains aggregated policy metrics for the RevOps dashboard.
type PolicyRevOpsSummary struct {
	ActivePoliciesTrend []MonthCount    `json:"active_policies_trend"`
	PremiumRevenueKSH   float64         `json:"premium_revenue_ksh"`
	PremiumTargetKSH    float64         `json:"premium_target_ksh"`
	MonthlyBreakdown    []MonthlyRevenue `json:"monthly_breakdown"`
	BagsInsured         int             `json:"bags_insured"`
}

type MonthCount struct {
	Month string `json:"month"`
	Count int    `json:"count"`
}

type MonthlyRevenue struct {
	Month  string  `json:"month"`
	Actual float64 `json:"actual"`
	Target float64 `json:"target"`
}

// GetRevOpsSummary returns aggregated policy metrics for the RevOps dashboard.
func (r *PolicyRepo) GetRevOpsSummary(ctx context.Context) (*PolicyRevOpsSummary, error) {
	summary := &PolicyRevOpsSummary{}

	var totalPremium float64
	var totalBags int
	if err := r.db.QueryRow(ctx,
		`SELECT COALESCE(SUM(premium), 0), COALESCE(SUM(bags), 0)
		 FROM policies WHERE status = 'active'`,
	).Scan(&totalPremium, &totalBags); err != nil {
		return nil, fmt.Errorf("failed to aggregate policies: %w", err)
	}
	summary.PremiumRevenueKSH = totalPremium
	summary.PremiumTargetKSH = totalPremium * 1.25
	summary.BagsInsured = totalBags

	months := []string{"Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"}
	rows, err := r.db.Query(ctx,
		`SELECT EXTRACT(MONTH FROM created_at)::int AS m, COUNT(*)
		 FROM policies
		 WHERE EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM NOW())
		 GROUP BY m ORDER BY m`)
	if err != nil {
		return nil, fmt.Errorf("failed to get monthly trend: %w", err)
	}
	defer rows.Close()

	monthlyCounts := make(map[int]int)
	for rows.Next() {
		var m, c int
		if err := rows.Scan(&m, &c); err != nil {
			return nil, fmt.Errorf("failed to scan monthly count: %w", err)
		}
		monthlyCounts[m] = c
	}

	for i, name := range months {
		count := monthlyCounts[i+1]
		summary.ActivePoliciesTrend = append(summary.ActivePoliciesTrend, MonthCount{Month: name, Count: count})
		monthTarget := summary.PremiumTargetKSH / 12
		summary.MonthlyBreakdown = append(summary.MonthlyBreakdown, MonthlyRevenue{
			Month:  name,
			Actual: totalPremium / 12 * float64(count) / float64(max(totalBags, 1)),
			Target: monthTarget,
		})
	}

	return summary, nil
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

// Blockchain hash generation

// GenerateBlockchainHash creates a deterministic SHA-256 hash for the policy smart contract.
// Same inputs always produce the same hash. Once stored, the DB trigger prevents any UPDATE.
func GenerateBlockchainHash(contractID, farmerID string, bags int, insuredValue, premium float64, triggerTypes []string, ts time.Time) string {
	// Deterministic input string
	hashInput := fmt.Sprintf(
		"GrainShield:v1:%s:%s:%d:%.2f:%.2f:%v:%s",
		contractID, farmerID, bags, insuredValue, premium,
		triggerTypes, ts.UTC().Format(time.RFC3339),
	)
	hash := sha256.Sum256([]byte(hashInput))
	return "0x" + hex.EncodeToString(hash[:])
}
