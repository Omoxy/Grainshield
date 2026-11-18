-- GrainShield farmer-service schema
-- Migration 001: Create farmers and audit_log tables
-- All National IDs encrypted AES-256-GCM via pgcrypto (Security Rule #7)
-- Audit log is append-only (Security Rule #4)

BEGIN;

-- Enable pgcrypto for encryption functions
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── ENUM TYPES ──────────────────────────────────────────────────────────────

CREATE TYPE sub_county_enum AS ENUM (
    'Kiminini',
    'Kwanza',
    'Saboti',
    'Endebess',
    'Cherangany'
);

CREATE TYPE language_enum AS ENUM ('sw', 'en');

CREATE TYPE farmer_status_enum AS ENUM ('active', 'suspended', 'deregistered');

-- ─── FARMERS TABLE ───────────────────────────────────────────────────────────

CREATE TABLE farmers (
    id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    gs_number            VARCHAR(10) NOT NULL UNIQUE,
    name                 VARCHAR(100) NOT NULL,
    national_id_encrypted BYTEA NOT NULL,          -- AES-256-GCM encrypted
    national_id_hash     VARCHAR(64) NOT NULL UNIQUE, -- SHA-256 for dedup lookups
    phone                VARCHAR(13) NOT NULL UNIQUE,
    sub_county           sub_county_enum NOT NULL,
    hectares             NUMERIC(6,2) NOT NULL CHECK (hectares >= 0.1 AND hectares <= 100.0),
    expected_bags        INTEGER NOT NULL CHECK (expected_bags >= 1 AND expected_bags <= 10000),
    language             language_enum NOT NULL DEFAULT 'sw',
    status               farmer_status_enum NOT NULL DEFAULT 'active',
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- GS Number auto-generation sequence
CREATE SEQUENCE gs_number_seq START WITH 1 INCREMENT BY 1;

-- Indexes for common query patterns
CREATE INDEX idx_farmers_sub_county ON farmers (sub_county);
CREATE INDEX idx_farmers_status ON farmers (status);
CREATE INDEX idx_farmers_created_at ON farmers (created_at DESC);
CREATE INDEX idx_farmers_gs_number ON farmers (gs_number);

-- ─── AUDIT LOG TABLE ─────────────────────────────────────────────────────────
-- Append-only: no UPDATE or DELETE permitted (Security Rule #4)

CREATE TABLE audit_log (
    id            BIGSERIAL PRIMARY KEY,
    actor         VARCHAR(100) NOT NULL,       -- JWT sub claim
    action        VARCHAR(50) NOT NULL,         -- e.g. "farmer:create"
    resource_type VARCHAR(50) NOT NULL,         -- e.g. "farmer"
    resource_id   VARCHAR(100) NOT NULL,        -- e.g. farmer UUID
    metadata      JSONB DEFAULT '{}',           -- additional context
    ip_address    INET,
    user_agent    VARCHAR(500),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_log_actor ON audit_log (actor);
CREATE INDEX idx_audit_log_action ON audit_log (action);
CREATE INDEX idx_audit_log_resource ON audit_log (resource_type, resource_id);
CREATE INDEX idx_audit_log_created_at ON audit_log (created_at DESC);

-- ─── ROW LEVEL SECURITY ─────────────────────────────────────────────────────

ALTER TABLE farmers ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Service role can read and write farmers
CREATE POLICY farmers_service_policy ON farmers
    FOR ALL
    TO gs_farmer
    USING (true)
    WITH CHECK (true);

-- Audit log: INSERT only, no UPDATE or DELETE
CREATE POLICY audit_insert_only ON audit_log
    FOR INSERT
    TO gs_farmer
    WITH CHECK (true);

CREATE POLICY audit_read ON audit_log
    FOR SELECT
    TO gs_farmer
    USING (true);

-- Revoke DELETE on audit_log from all roles (belt and suspenders)
REVOKE DELETE ON audit_log FROM PUBLIC;
REVOKE UPDATE ON audit_log FROM PUBLIC;

-- ─── UPDATED_AT TRIGGER ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_farmers_updated_at
    BEFORE UPDATE ON farmers
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

COMMIT;
