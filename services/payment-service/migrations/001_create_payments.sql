-- GrainShield payment-service schema
-- M-Pesa integration: disbursements, callbacks, reconciliation

BEGIN;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TYPE payment_type_enum AS ENUM ('claim_payout', 'credit_disbursement', 'premium_collection');
CREATE TYPE payment_status_enum AS ENUM ('pending', 'queued', 'sent', 'completed', 'failed', 'reversed');
CREATE TYPE mpesa_direction_enum AS ENUM ('b2c', 'c2b');

-- ─── PAYMENTS TABLE ─────────────────────────────────────────────────────────

CREATE TABLE payments (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    payment_type      payment_type_enum NOT NULL,
    direction         mpesa_direction_enum NOT NULL,
    farmer_id         UUID NOT NULL,
    farmer_gs_number  VARCHAR(10) NOT NULL,
    phone             VARCHAR(13) NOT NULL,
    amount            NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    currency          VARCHAR(3) NOT NULL DEFAULT 'KES',
    reference_type    VARCHAR(50) NOT NULL,     -- 'claim', 'policy', 'credit'
    reference_id      UUID NOT NULL,
    mpesa_receipt     VARCHAR(50),               -- M-Pesa transaction ID
    mpesa_request_id  VARCHAR(100),              -- Conversation ID from M-Pesa
    status            payment_status_enum NOT NULL DEFAULT 'pending',
    status_reason     VARCHAR(500),
    initiated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at      TIMESTAMPTZ,
    callback_received BOOLEAN NOT NULL DEFAULT FALSE,
    retry_count       INTEGER NOT NULL DEFAULT 0,
    max_retries       INTEGER NOT NULL DEFAULT 3,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payments_farmer ON payments (farmer_id);
CREATE INDEX idx_payments_status ON payments (status);
CREATE INDEX idx_payments_reference ON payments (reference_type, reference_id);
CREATE INDEX idx_payments_mpesa ON payments (mpesa_receipt);

-- ─── M-PESA CALLBACK LOG (immutable) ────────────────────────────────────────

CREATE TABLE mpesa_callbacks (
    id                BIGSERIAL PRIMARY KEY,
    conversation_id   VARCHAR(100) NOT NULL,
    originator_id     VARCHAR(100),
    result_type       INTEGER NOT NULL,
    result_code       INTEGER NOT NULL,
    result_desc       VARCHAR(500),
    transaction_id    VARCHAR(50),
    transaction_amount NUMERIC(12,2),
    transaction_receipt VARCHAR(50),
    phone             VARCHAR(13),
    raw_payload       JSONB NOT NULL,              -- Full callback for audit
    processed         BOOLEAN NOT NULL DEFAULT FALSE,
    received_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_mpesa_cb_conversation ON mpesa_callbacks (conversation_id);
CREATE INDEX idx_mpesa_cb_processed ON mpesa_callbacks (processed);

REVOKE DELETE ON mpesa_callbacks FROM PUBLIC;
REVOKE UPDATE ON mpesa_callbacks FROM PUBLIC;

-- ─── AUDIT LOG ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_log (
    id            BIGSERIAL PRIMARY KEY,
    actor         VARCHAR(100) NOT NULL,
    action        VARCHAR(50) NOT NULL,
    resource_type VARCHAR(50) NOT NULL,
    resource_id   VARCHAR(100) NOT NULL,
    metadata      JSONB DEFAULT '{}',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

REVOKE DELETE ON audit_log FROM PUBLIC;
REVOKE UPDATE ON audit_log FROM PUBLIC;

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;

CREATE TRIGGER set_payments_updated_at BEFORE UPDATE ON payments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMIT;
