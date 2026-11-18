-- GrainShield policy-service schema
-- Migration 001: policies, policy_triggers, claims tables

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── ENUM TYPES ──────────────────────────────────────────────────────────────

CREATE TYPE policy_status_enum AS ENUM ('active', 'expired', 'claimed', 'cancelled');
CREATE TYPE trigger_type_enum AS ENUM ('aflatoxin', 'climate', 'price_floor');
CREATE TYPE trigger_status_enum AS ENUM ('armed', 'fired', 'expired', 'disabled');
CREATE TYPE claim_status_enum AS ENUM ('pending', 'confirmed', 'paid', 'rejected');
CREATE TYPE grain_grade_enum AS ENUM ('Grade 1', 'Grade 2', 'Grade 3');

-- ─── POLICIES TABLE ─────────────────────────────────────────────────────────

CREATE TABLE policies (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    contract_id     VARCHAR(20) NOT NULL UNIQUE,  -- e.g. GS-00847-2026-03
    farmer_id       UUID NOT NULL,
    farmer_gs_number VARCHAR(10) NOT NULL,
    warehouse_id    UUID NOT NULL,
    commodity       VARCHAR(50) NOT NULL DEFAULT 'Maize',
    bags            INTEGER NOT NULL CHECK (bags >= 1 AND bags <= 10000),
    grain_grade     grain_grade_enum NOT NULL,
    storage_bay     VARCHAR(50),
    insured_value   NUMERIC(12,2) NOT NULL CHECK (insured_value > 0),
    premium         NUMERIC(10,2) NOT NULL CHECK (premium > 0),
    premium_rate    NUMERIC(5,4) NOT NULL,           -- e.g. 0.0300 = 3%
    discount_pct    NUMERIC(5,2) NOT NULL DEFAULT 0, -- input verification discount
    deposit_date    DATE NOT NULL,
    expiry_date     DATE NOT NULL,
    status          policy_status_enum NOT NULL DEFAULT 'active',
    blockchain_hash VARCHAR(66),                     -- 0x + 64 hex chars
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_policies_farmer ON policies (farmer_id);
CREATE INDEX idx_policies_status ON policies (status);
CREATE INDEX idx_policies_contract ON policies (contract_id);
CREATE INDEX idx_policies_expiry ON policies (expiry_date);

-- ─── POLICY TRIGGERS ────────────────────────────────────────────────────────

CREATE TABLE policy_triggers (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    policy_id       UUID NOT NULL REFERENCES policies(id),
    trigger_type    trigger_type_enum NOT NULL,
    condition_desc  TEXT NOT NULL,
    threshold_value NUMERIC(10,2),
    payout_amount   NUMERIC(12,2) NOT NULL CHECK (payout_amount > 0),
    status          trigger_status_enum NOT NULL DEFAULT 'armed',
    fired_at        TIMESTAMPTZ,
    confirmed_at    TIMESTAMPTZ,
    data_source     VARCHAR(100),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_triggers_policy ON policy_triggers (policy_id);
CREATE INDEX idx_triggers_status ON policy_triggers (status);
CREATE INDEX idx_triggers_type ON policy_triggers (trigger_type);

-- ─── CLAIMS TABLE ───────────────────────────────────────────────────────────

CREATE TABLE claims (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    policy_id       UUID NOT NULL REFERENCES policies(id),
    trigger_id      UUID NOT NULL REFERENCES policy_triggers(id),
    farmer_id       UUID NOT NULL,
    trigger_type    trigger_type_enum NOT NULL,
    amount          NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    status          claim_status_enum NOT NULL DEFAULT 'pending',
    triggered_at    TIMESTAMPTZ NOT NULL,
    confirmed_at    TIMESTAMPTZ,
    paid_at         TIMESTAMPTZ,
    payment_ref     VARCHAR(100),                    -- M-Pesa transaction ID
    rejection_reason TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_claims_policy ON claims (policy_id);
CREATE INDEX idx_claims_farmer ON claims (farmer_id);
CREATE INDEX idx_claims_status ON claims (status);

-- ─── AUDIT LOG (same pattern as farmer-service) ─────────────────────────────

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

-- ─── UPDATED_AT TRIGGERS ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_policies_updated_at BEFORE UPDATE ON policies
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_claims_updated_at BEFORE UPDATE ON claims
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMIT;
