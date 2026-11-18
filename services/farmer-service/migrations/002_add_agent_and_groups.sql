-- GrainShield farmer-service schema
-- Migration 002: Add extension officer tracking and solidarity groups
-- Extension officer agent relationship: which officer registered each farmer
-- Solidarity groups: 20-farmer clusters for collective risk pooling

BEGIN;

-- ─── EXTENSION OFFICER TRACKING ─────────────────────────────────────────────

-- Track which officer/clerk registered the farmer (JWT sub claim)
ALTER TABLE farmers ADD COLUMN registered_by VARCHAR(100);

-- Index for officer-level queries and commission tracking
CREATE INDEX idx_farmers_registered_by ON farmers (registered_by);

-- ─── SOLIDARITY GROUPS ──────────────────────────────────────────────────────

CREATE TABLE solidarity_groups (
    id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name                   VARCHAR(100) NOT NULL,
    sub_county             sub_county_enum NOT NULL,
    max_members            INTEGER NOT NULL DEFAULT 20,
    pool_balance_kes       NUMERIC(12,2) NOT NULL DEFAULT 0,
    contribution_per_bag_kes NUMERIC(8,2) NOT NULL DEFAULT 50,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_groups_sub_county ON solidarity_groups (sub_county);

-- ─── FARMER → GROUP RELATIONSHIP ────────────────────────────────────────────

ALTER TABLE farmers ADD COLUMN solidarity_group_id UUID;

ALTER TABLE farmers ADD CONSTRAINT fk_farmer_group
    FOREIGN KEY (solidarity_group_id) REFERENCES solidarity_groups(id);

CREATE INDEX idx_farmers_group ON farmers (solidarity_group_id);

-- ─── RLS FOR SOLIDARITY GROUPS ──────────────────────────────────────────────

ALTER TABLE solidarity_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY groups_service_policy ON solidarity_groups
    FOR ALL
    TO gs_farmer
    USING (true)
    WITH CHECK (true);

COMMIT;
