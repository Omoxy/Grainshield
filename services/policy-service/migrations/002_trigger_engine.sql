-- GrainShield policy-service schema
-- Migration 002: Trigger evaluation engine support
-- Adds trigger evaluation audit trail, payout deadline, blockchain hash immutability,
-- and cost_of_production for price_floor trigger.

BEGIN;

-- ─── TRIGGER EVALUATION LOG ─────────────────────────────────────────────────
-- Immutable audit trail: every trigger evaluation writes a record, pass or fail.
-- Security Rule #4: Full audit trail for every state-changing operation.

CREATE TABLE trigger_evaluations (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    trigger_id       UUID NOT NULL REFERENCES policy_triggers(id),
    policy_id        UUID NOT NULL REFERENCES policies(id),
    trigger_type     trigger_type_enum NOT NULL,
    evaluation_time  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    data_evaluated   JSONB NOT NULL DEFAULT '{}',    -- raw data points checked
    threshold_checked TEXT NOT NULL,                  -- human-readable threshold description
    threshold_value  NUMERIC(10,2),                   -- numeric threshold used
    actual_value     NUMERIC(10,2),                   -- actual value observed
    result           BOOLEAN NOT NULL,                -- TRUE = condition met, FALSE = not met
    data_sources     TEXT[] NOT NULL DEFAULT '{}',    -- list of data source URIs/names
    notes            TEXT,                            -- additional context
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Append-only: no UPDATE or DELETE permitted
REVOKE DELETE ON trigger_evaluations FROM PUBLIC;
REVOKE UPDATE ON trigger_evaluations FROM PUBLIC;

CREATE INDEX idx_eval_trigger ON trigger_evaluations (trigger_id);
CREATE INDEX idx_eval_policy ON trigger_evaluations (policy_id);
CREATE INDEX idx_eval_time ON trigger_evaluations (evaluation_time DESC);
CREATE INDEX idx_eval_result ON trigger_evaluations (result) WHERE result = TRUE;

-- ─── PAYOUT DEADLINE ON CLAIMS ──────────────────────────────────────────────
-- Payout must complete within 4 hours of trigger confirmation.

ALTER TABLE claims ADD COLUMN payout_deadline TIMESTAMPTZ;

-- Set default for new claims: 4 hours from creation
-- (applied at INSERT time in repository code, not as column default,
--  because the deadline is relative to the trigger confirmation time)

CREATE INDEX idx_claims_payout_deadline ON claims (payout_deadline)
    WHERE status != 'paid' AND status != 'rejected';

-- ─── COST OF PRODUCTION ON POLICIES ─────────────────────────────────────────
-- Farmer-declared production cost per bag, used for price_floor trigger.

ALTER TABLE policies ADD COLUMN cost_of_production NUMERIC(10,2);
ALTER TABLE policies ADD COLUMN moisture_content NUMERIC(5,2);

-- ─── BLOCKCHAIN HASH IMMUTABILITY ───────────────────────────────────────────
-- Once set, blockchain_hash can NEVER be updated. This is the trust guarantee.
-- Security Rule #10 equivalent: immutable smart contract hash.

CREATE OR REPLACE FUNCTION prevent_blockchain_hash_update()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.blockchain_hash IS NOT NULL AND NEW.blockchain_hash IS DISTINCT FROM OLD.blockchain_hash THEN
        RAISE EXCEPTION 'blockchain_hash is immutable and cannot be updated once set';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_blockchain_hash_immutability
    BEFORE UPDATE ON policies
    FOR EACH ROW
    EXECUTE FUNCTION prevent_blockchain_hash_update();

COMMIT;
