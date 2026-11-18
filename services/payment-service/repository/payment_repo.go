// Package repository implements database operations for the payment-service.
// Security Rule #3: Parameterised queries only.
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

	"github.com/grainshield/payment-service/models"
)

// PaymentRepo provides database operations for payments.
type PaymentRepo struct {
	db *pgxpool.Pool
}

// NewPaymentRepo creates a new PaymentRepo.
func NewPaymentRepo(db *pgxpool.Pool) *PaymentRepo {
	return &PaymentRepo{db: db}
}


// GenerateIdempotencyKey creates a deterministic SHA-256 hash for dedup.
func GenerateIdempotencyKey(farmerID, referenceType, referenceID string, amount float64) string {
	input := fmt.Sprintf("GrainShield:pay:%s:%s:%s:%.2f", farmerID, referenceType, referenceID, amount)
	hash := sha256.Sum256([]byte(input))
	return hex.EncodeToString(hash[:])
}

// CheckIdempotency returns an existing payment if a duplicate request is found
// within the 24-hour idempotency window.
func (r *PaymentRepo) CheckIdempotency(ctx context.Context, keyHash string) (*models.Payment, error) {
	var paymentID uuid.UUID
	err := r.db.QueryRow(ctx,
		`SELECT payment_id FROM idempotency_keys WHERE key_hash = $1 AND expires_at > NOW()`,
		keyHash,
	).Scan(&paymentID)

	if err == pgx.ErrNoRows {
		return nil, nil // No duplicate found
	}
	if err != nil {
		return nil, fmt.Errorf("idempotency check failed: %w", err)
	}

	// Return the existing payment
	p := &models.Payment{}
	err = r.db.QueryRow(ctx,
		`SELECT id, payment_type, direction, farmer_id, farmer_gs_number, phone, amount, currency,
		        reference_type, reference_id, COALESCE(mpesa_request_id,''), COALESCE(mpesa_receipt,''),
		        status, COALESCE(status_reason,''), retry_count, initiated_at, completed_at
		 FROM payments WHERE id = $1`, paymentID,
	).Scan(&p.ID, &p.PaymentType, &p.Direction, &p.FarmerID, &p.FarmerGSNumber,
		&p.Phone, &p.Amount, &p.Currency, &p.ReferenceType, &p.ReferenceID,
		&p.MpesaRequestID, &p.MpesaReceipt, &p.Status, &p.StatusReason,
		&p.RetryCount, &p.InitiatedAt, &p.CompletedAt)
	if err != nil {
		return nil, fmt.Errorf("failed to get existing payment: %w", err)
	}

	return p, nil
}

// StoreIdempotencyKey records a dedup key with 24-hour expiry.
func (r *PaymentRepo) StoreIdempotencyKey(ctx context.Context, keyHash string, paymentID uuid.UUID) error {
	expiresAt := time.Now().Add(models.IdempotencyWindow)
	_, err := r.db.Exec(ctx,
		`INSERT INTO idempotency_keys (key_hash, payment_id, expires_at) VALUES ($1, $2, $3)
		 ON CONFLICT (key_hash) DO NOTHING`,
		keyHash, paymentID, expiresAt,
	)
	if err != nil {
		return fmt.Errorf("failed to store idempotency key: %w", err)
	}
	return nil
}


// Disburse creates a new payment record for M-Pesa B2C disbursement with idempotency.
func (r *PaymentRepo) Disburse(ctx context.Context, req models.DisburseRequest) (map[string]interface{}, error) {
	farmerID, err := uuid.Parse(req.FarmerID)
	if err != nil {
		return nil, fmt.Errorf("invalid farmer_id format")
	}
	refID, err := uuid.Parse(req.ReferenceID)
	if err != nil {
		return nil, fmt.Errorf("invalid reference_id format")
	}

	// Idempotency check
	idemKey := GenerateIdempotencyKey(req.FarmerID, req.ReferenceType, req.ReferenceID, req.Amount)
	existing, err := r.CheckIdempotency(ctx, idemKey)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return map[string]interface{}{
			"payment_id":       existing.ID,
			"status":           existing.Status,
			"idempotent":       true,
			"message":          "Duplicate request: returning original payment",
		}, nil
	}

	paymentID := uuid.New()
	mpesaReqID := fmt.Sprintf("AG_%s_%d", paymentID.String()[:8], time.Now().Unix())

	_, err = r.db.Exec(ctx,
		`INSERT INTO payments (id, payment_type, direction, farmer_id, farmer_gs_number, phone, amount,
		                       reference_type, reference_id, mpesa_request_id, idempotency_key, status)
		 VALUES ($1,'claim_payout','b2c',$2,$3,$4,$5,$6,$7,$8,$9,'queued')`,
		paymentID, farmerID, req.FarmerGSNumber, req.Phone, req.Amount,
		req.ReferenceType, refID, mpesaReqID, idemKey,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create payment: %w", err)
	}

	// Store idempotency key
	if err := r.StoreIdempotencyKey(ctx, idemKey, paymentID); err != nil {
		// Non-fatal: payment was created, idempotency is best-effort
	}

	return map[string]interface{}{
		"payment_id":          paymentID,
		"mpesa_request_id":    mpesaReqID,
		"status":              "queued",
		"idempotent":          false,
		"estimated_completion": "within 4 hours",
		"message":             "Payment queued for M-Pesa B2C disbursement",
	}, nil
}

// DisburseWithDeadline creates a payment with a payout SLA deadline (from Kafka trigger).
func (r *PaymentRepo) DisburseWithDeadline(ctx context.Context, req models.DisburseRequest, deadline time.Time, idemKey string) (map[string]interface{}, error) {
	farmerID, err := uuid.Parse(req.FarmerID)
	if err != nil {
		return nil, fmt.Errorf("invalid farmer_id format")
	}
	refID, err := uuid.Parse(req.ReferenceID)
	if err != nil {
		return nil, fmt.Errorf("invalid reference_id format")
	}

	paymentID := uuid.New()
	mpesaReqID := fmt.Sprintf("AG_%s_%d", paymentID.String()[:8], time.Now().Unix())

	_, err = r.db.Exec(ctx,
		`INSERT INTO payments (id, payment_type, direction, farmer_id, farmer_gs_number, phone, amount,
		                       reference_type, reference_id, mpesa_request_id, idempotency_key,
		                       payout_deadline, status)
		 VALUES ($1,'claim_payout','b2c',$2,$3,$4,$5,$6,$7,$8,$9,$10,'queued')`,
		paymentID, farmerID, req.FarmerGSNumber, req.Phone, req.Amount,
		req.ReferenceType, refID, mpesaReqID, idemKey, deadline,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create payment with deadline: %w", err)
	}

	if err := r.StoreIdempotencyKey(ctx, idemKey, paymentID); err != nil {
		// Non-fatal
	}

	return map[string]interface{}{
		"payment_id":       paymentID,
		"mpesa_request_id": mpesaReqID,
		"status":           "queued",
		"payout_deadline":  deadline.Format(time.RFC3339),
	}, nil
}


// UpdateMpesaRequestID sets the Daraja conversation ID after B2C initiation.
func (r *PaymentRepo) UpdateMpesaRequestID(ctx context.Context, paymentID uuid.UUID, conversationID string) error {
	_, err := r.db.Exec(ctx,
		`UPDATE payments SET mpesa_request_id = $1, status = 'pending' WHERE id = $2`,
		conversationID, paymentID,
	)
	if err != nil {
		return fmt.Errorf("failed to update mpesa_request_id: %w", err)
	}
	return nil
}

// IncrementRetryCount bumps the retry counter for a payment.
func (r *PaymentRepo) IncrementRetryCount(ctx context.Context, paymentID uuid.UUID) error {
	_, err := r.db.Exec(ctx,
		`UPDATE payments SET retry_count = retry_count + 1 WHERE id = $1`,
		paymentID,
	)
	if err != nil {
		return fmt.Errorf("failed to increment retry count: %w", err)
	}
	return nil
}

// ProcessCallback stores the M-Pesa callback and updates payment status.
func (r *PaymentRepo) ProcessCallback(ctx context.Context, conversationID, originatorID, transactionID, resultDesc string, resultCode int) error {
	// Store in immutable callback log
	_, err := r.db.Exec(ctx,
		`INSERT INTO mpesa_callbacks (conversation_id, originator_id, result_type, result_code, result_desc, transaction_id, raw_payload)
		 VALUES ($1,$2,$3,$4,$5,$6,$7)`,
		conversationID, originatorID, 0, resultCode, truncate(resultDesc, 500), transactionID, "{}",
	)
	if err != nil {
		return fmt.Errorf("failed to store callback: %w", err)
	}

	if resultCode == 0 {
		_, err = r.db.Exec(ctx,
			`UPDATE payments SET status = 'completed', mpesa_receipt = $1, callback_received = TRUE, completed_at = NOW()
			 WHERE mpesa_request_id = $2 OR mpesa_request_id = $3`,
			transactionID, conversationID, originatorID,
		)
	} else {
		_, err = r.db.Exec(ctx,
			`UPDATE payments SET status = 'failed', status_reason = $1, callback_received = TRUE
			 WHERE mpesa_request_id = $2 OR mpesa_request_id = $3`,
			truncate(resultDesc, 500), conversationID, originatorID,
		)
	}
	if err != nil {
		return fmt.Errorf("failed to update payment status: %w", err)
	}

	return nil
}


// MoveToDLQ moves a payment to the dead letter queue after exhausting retries.
func (r *PaymentRepo) MoveToDLQ(ctx context.Context, paymentID uuid.UUID, reason string) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Get current retry count
	var retryCount int
	err = tx.QueryRow(ctx, `SELECT retry_count FROM payments WHERE id = $1`, paymentID).Scan(&retryCount)
	if err != nil {
		return fmt.Errorf("failed to get retry count: %w", err)
	}

	// Insert into DLQ
	_, err = tx.Exec(ctx,
		`INSERT INTO dead_letter_queue (payment_id, reason, retry_count) VALUES ($1, $2, $3)`,
		paymentID, truncate(reason, 1000), retryCount,
	)
	if err != nil {
		return fmt.Errorf("failed to insert into DLQ: %w", err)
	}

	// Update payment status
	_, err = tx.Exec(ctx,
		`UPDATE payments SET status = 'failed', status_reason = $1 WHERE id = $2`,
		"moved to dead letter queue after "+fmt.Sprintf("%d", retryCount)+" retries", paymentID,
	)
	if err != nil {
		return fmt.Errorf("failed to update payment status: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("DLQ transaction commit failed: %w", err)
	}

	return nil
}


// GetBankFee retrieves the fee schedule for a partner bank.
func (r *PaymentRepo) GetBankFee(ctx context.Context, bankCode string) (*models.BankOriginationFee, error) {
	fee := &models.BankOriginationFee{}
	err := r.db.QueryRow(ctx,
		`SELECT bank_code, bank_name, fee_pct, min_fee, max_fee
		 FROM bank_origination_fees WHERE bank_code = $1 AND active = TRUE`,
		bankCode,
	).Scan(&fee.BankCode, &fee.BankName, &fee.FeePct, &fee.MinFee, &fee.MaxFee)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get bank fee: %w", err)
	}
	return fee, nil
}

// ListBankFees retrieves all active bank fee schedules.
func (r *PaymentRepo) ListBankFees(ctx context.Context) ([]models.BankOriginationFee, error) {
	rows, err := r.db.Query(ctx,
		`SELECT bank_code, bank_name, fee_pct, min_fee, max_fee
		 FROM bank_origination_fees WHERE active = TRUE ORDER BY bank_code`)
	if err != nil {
		return nil, fmt.Errorf("failed to list bank fees: %w", err)
	}
	defer rows.Close()

	var fees []models.BankOriginationFee
	for rows.Next() {
		var f models.BankOriginationFee
		if err := rows.Scan(&f.BankCode, &f.BankName, &f.FeePct, &f.MinFee, &f.MaxFee); err != nil {
			return nil, fmt.Errorf("failed to scan bank fee: %w", err)
		}
		fees = append(fees, f)
	}
	return fees, nil
}


// GetAtRiskPayouts returns payments with payout_deadline within the given window
// that are still pending/queued.
func (r *PaymentRepo) GetAtRiskPayouts(ctx context.Context, window time.Duration) ([]models.PayoutDeadlineAlert, error) {
	cutoff := time.Now().Add(window)
	rows, err := r.db.Query(ctx,
		`SELECT p.id, p.reference_id, p.farmer_gs_number, p.amount, p.payout_deadline
		 FROM payments p
		 WHERE p.payout_deadline IS NOT NULL
		   AND p.payout_deadline <= $1
		   AND p.status IN ('queued', 'pending', 'sent')
		 ORDER BY p.payout_deadline ASC`, cutoff,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to query at-risk payouts: %w", err)
	}
	defer rows.Close()

	var alerts []models.PayoutDeadlineAlert
	now := time.Now()
	for rows.Next() {
		var a models.PayoutDeadlineAlert
		if err := rows.Scan(&a.PaymentID, &a.ClaimID, &a.FarmerGSNumber, &a.Amount, &a.PayoutDeadline); err != nil {
			return nil, fmt.Errorf("failed to scan at-risk payout: %w", err)
		}
		a.MinutesLeft = int(time.Until(a.PayoutDeadline).Minutes())
		_ = now // clarity: MinutesLeft is relative to current time
		alerts = append(alerts, a)
	}

	return alerts, nil
}


// GetByID retrieves a payment by its UUID.
func (r *PaymentRepo) GetByID(ctx context.Context, paymentID uuid.UUID) (*models.PaymentDetail, error) {
	p := &models.PaymentDetail{}
	err := r.db.QueryRow(ctx,
		`SELECT id, payment_type, direction, farmer_gs_number, amount, status, COALESCE(mpesa_receipt,''), initiated_at, completed_at, retry_count
		 FROM payments WHERE id = $1`, paymentID,
	).Scan(&p.ID, &p.PaymentType, &p.Direction, &p.FarmerGSNumber, &p.Amount, &p.Status, &p.MpesaReceipt, &p.InitiatedAt, &p.CompletedAt, &p.RetryCount)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get payment: %w", err)
	}
	return p, nil
}

// List retrieves a paginated list of payments.
func (r *PaymentRepo) List(ctx context.Context, page, limit int) ([]models.PaymentSummary, error) {
	offset := (page - 1) * limit

	rows, err := r.db.Query(ctx,
		`SELECT id, payment_type, direction, farmer_gs_number, phone, amount, currency, reference_type, status, COALESCE(mpesa_receipt,''), initiated_at, completed_at
		 FROM payments ORDER BY created_at DESC LIMIT $1 OFFSET $2`, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("failed to list payments: %w", err)
	}
	defer rows.Close()

	var payments []models.PaymentSummary
	for rows.Next() {
		var p models.PaymentSummary
		if err := rows.Scan(&p.ID, &p.PaymentType, &p.Direction, &p.FarmerGSNumber, &p.Phone, &p.Amount, &p.Currency, &p.ReferenceType, &p.Status, &p.MpesaReceipt, &p.InitiatedAt, &p.CompletedAt); err != nil {
			return nil, fmt.Errorf("failed to scan payment: %w", err)
		}
		payments = append(payments, p)
	}

	return payments, nil
}

// GetStats retrieves payment dashboard statistics.
func (r *PaymentRepo) GetStats(ctx context.Context) (*models.PaymentStats, error) {
	stats := &models.PaymentStats{}

	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM payments WHERE status = 'completed'`).Scan(&stats.TotalCompleted); err != nil {
		return nil, fmt.Errorf("failed to count completed: %w", err)
	}
	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM payments WHERE status = 'pending' OR status = 'queued'`).Scan(&stats.TotalPending); err != nil {
		return nil, fmt.Errorf("failed to count pending: %w", err)
	}
	if err := r.db.QueryRow(ctx, `SELECT COALESCE(SUM(amount),0) FROM payments WHERE status = 'completed' AND direction = 'b2c'`).Scan(&stats.TotalDisbursed); err != nil {
		return nil, fmt.Errorf("failed to sum disbursed: %w", err)
	}
	if err := r.db.QueryRow(ctx, `SELECT COALESCE(SUM(amount),0) FROM payments WHERE status = 'completed' AND direction = 'c2b'`).Scan(&stats.TotalCollected); err != nil {
		return nil, fmt.Errorf("failed to sum collected: %w", err)
	}
	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM payments WHERE status = 'failed'`).Scan(&stats.TotalFailed); err != nil {
		return nil, fmt.Errorf("failed to count failed: %w", err)
	}

	return stats, nil
}

func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen]
}


// PaymentRevOpsSummary contains aggregated payment metrics for the RevOps dashboard.
type PaymentRevOpsSummary struct {
	AverageTurnaroundDays float64          `json:"average_turnaround_days"`
	TotalPayouts          int              `json:"total_payouts"`
	PaidOnTimePct         float64          `json:"paid_on_time_pct"`
	PartnerPipeline       []InstitutionalPartner `json:"partner_pipeline"`
	RevenueStreams        []RevenueStream        `json:"revenue_streams"`
}

// InstitutionalPartner represents an organisation in the partner acquisition pipeline.
type InstitutionalPartner struct {
	Name   string  `json:"name"`
	Stage  string  `json:"stage"`
	ArrKsh float64 `json:"arr_ksh"`
}

type RevenueStream struct {
	Name     string  `json:"name"`
	ValueKsh float64 `json:"value_ksh"`
	Key      string  `json:"key"`
}

// GetRevOpsSummary returns aggregated payment metrics for the RevOps dashboard.
func (r *PaymentRepo) GetRevOpsSummary(ctx context.Context) (*PaymentRevOpsSummary, error) {
	summary := &PaymentRevOpsSummary{}

	var totalPayouts int
	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM payments WHERE status = 'completed' AND direction = 'b2c'`).Scan(&totalPayouts); err != nil {
		return nil, fmt.Errorf("failed to count payouts: %w", err)
	}
	summary.TotalPayouts = totalPayouts

	var avgHours float64
	err := r.db.QueryRow(ctx,
		`SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (completed_at - created_at)) / 3600), 0)
		 FROM payments WHERE status = 'completed' AND completed_at IS NOT NULL`,
	).Scan(&avgHours)
	if err != nil {
		return nil, fmt.Errorf("failed to compute turnaround: %w", err)
	}
	summary.AverageTurnaroundDays = avgHours / 24

	var onTimeCount int
	if err := r.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM payments p
		 JOIN claims c ON c.payment_ref = p.id::text
		 WHERE p.status = 'completed'
		   AND p.completed_at IS NOT NULL
		   AND c.payout_deadline IS NOT NULL
		   AND p.completed_at <= c.payout_deadline`,
	).Scan(&onTimeCount); err != nil {
		onTimeCount = totalPayouts
	}
	if totalPayouts > 0 {
		summary.PaidOnTimePct = float64(onTimeCount) / float64(totalPayouts) * 100
	} else {
		summary.PaidOnTimePct = 100
	}

	var premiumRevenue, payoutTotal float64
	r.db.QueryRow(ctx, `SELECT COALESCE(SUM(amount), 0) FROM payments WHERE direction = 'c2b' AND status = 'completed'`).Scan(&premiumRevenue)
	r.db.QueryRow(ctx, `SELECT COALESCE(SUM(amount), 0) FROM payments WHERE direction = 'b2c' AND status = 'completed'`).Scan(&payoutTotal)

	summary.RevenueStreams = []RevenueStream{
		{Name: "Insurance Premiums", ValueKsh: premiumRevenue, Key: "premiums"},
		{Name: "Partner Data Licensing", ValueKsh: 0, Key: "partner_data"},
		{Name: "Warehouse Receipt Fees", ValueKsh: 0, Key: "warehouse_fees"},
	}

	summary.PartnerPipeline = []InstitutionalPartner{}

	return summary, nil
}
