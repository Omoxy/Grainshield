-- GrainShield payment-service migration 002
-- Adds: idempotency_keys, dead_letter_queue, bank_origination_fees

BEGIN;

-- ─── IDEMPOTENCY KEYS ──────────────────────────────────────────────────────
-- Security Rule: 24-hour dedup window prevents duplicate M-Pesa disbursements.
-- key_hash = SHA-256(farmer_id + reference_type + reference_id + amount)

CREATE TABLE idempotency_keys (
    id          BIGSERIAL PRIMARY KEY,
    key_hash    VARCHAR(64) NOT NULL UNIQUE,
    payment_id  UUID NOT NULL REFERENCES payments(id),
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_idempotency_expires ON idempotency_keys (expires_at);
CREATE INDEX idx_idempotency_hash ON idempotency_keys (key_hash);

-- ─── DEAD LETTER QUEUE ─────────────────────────────────────────────────────
-- Payments that fail after 3 retries. Immutable: no DELETE or UPDATE.

CREATE TABLE dead_letter_queue (
    id          BIGSERIAL PRIMARY KEY,
    payment_id  UUID NOT NULL REFERENCES payments(id),
    reason      TEXT NOT NULL,
    retry_count INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_dlq_payment ON dead_letter_queue (payment_id);
CREATE INDEX idx_dlq_created ON dead_letter_queue (created_at);

REVOKE DELETE ON dead_letter_queue FROM PUBLIC;
REVOKE UPDATE ON dead_letter_queue FROM PUBLIC;

-- ─── BANK ORIGINATION FEES ─────────────────────────────────────────────────
-- Fee schedule for the 4 partner banks.

CREATE TABLE bank_origination_fees (
    id        SERIAL PRIMARY KEY,
    bank_code VARCHAR(20) NOT NULL UNIQUE,
    bank_name VARCHAR(100) NOT NULL,
    fee_pct   NUMERIC(5,4) NOT NULL CHECK (fee_pct > 0 AND fee_pct < 1),
    min_fee   NUMERIC(10,2) NOT NULL DEFAULT 0,
    max_fee   NUMERIC(10,2) NOT NULL DEFAULT 1000000,
    active    BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Pre-seed the 4 partner banks
INSERT INTO bank_origination_fees (bank_code, bank_name, fee_pct, min_fee, max_fee) VALUES
    ('COOP',   'Cooperative Bank of Kenya', 0.0150, 50.00, 50000.00),
    ('EQUITY', 'Equity Bank Kenya',         0.0120, 50.00, 40000.00),
    ('FAMILY', 'Family Bank Kenya',         0.0180, 75.00, 60000.00),
    ('AFC',    'Africa Finance Corporation', 0.0200, 100.00, 100000.00);

-- ─── ADD payout_deadline TO payments ────────────────────────────────────────

ALTER TABLE payments ADD COLUMN IF NOT EXISTS payout_deadline TIMESTAMPTZ;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(64);

CREATE INDEX idx_payments_deadline ON payments (payout_deadline)
    WHERE status IN ('queued', 'pending', 'sent');

-- ─── ROLLBACK SCRIPT (for reversibility) ───────────────────────────────────
-- To reverse this migration, run:
-- DROP INDEX IF EXISTS idx_payments_deadline;
-- ALTER TABLE payments DROP COLUMN IF EXISTS payout_deadline;
-- ALTER TABLE payments DROP COLUMN IF EXISTS idempotency_key;
-- DROP TABLE IF EXISTS bank_origination_fees;
-- DROP TABLE IF EXISTS dead_letter_queue;
-- DROP TABLE IF EXISTS idempotency_keys;

COMMIT;
