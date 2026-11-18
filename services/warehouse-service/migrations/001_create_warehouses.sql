-- GrainShield warehouse-service schema
-- NCPB depot management: warehouses, deposits, bays, inspections

BEGIN;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TYPE depot_status_enum AS ENUM ('active', 'maintenance', 'closed');
CREATE TYPE deposit_status_enum AS ENUM ('received', 'inspected', 'stored', 'released', 'condemned');
CREATE TYPE inspection_result_enum AS ENUM ('passed', 'failed', 'conditional');

-- ─── WAREHOUSES ─────────────────────────────────────────────────────────────

CREATE TABLE warehouses (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ncpb_code       VARCHAR(20) NOT NULL UNIQUE,
    name            VARCHAR(100) NOT NULL,
    sub_county      VARCHAR(50) NOT NULL,
    location        VARCHAR(200),
    capacity_bags   INTEGER NOT NULL CHECK (capacity_bags > 0),
    current_stock   INTEGER NOT NULL DEFAULT 0,
    status          depot_status_enum NOT NULL DEFAULT 'active',
    has_iot_sensors  BOOLEAN NOT NULL DEFAULT FALSE,
    manager_name    VARCHAR(100),
    manager_phone   VARCHAR(13),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wh_sub_county ON warehouses (sub_county);
CREATE INDEX idx_wh_status ON warehouses (status);

-- ─── GRAIN DEPOSITS ─────────────────────────────────────────────────────────

CREATE TABLE deposits (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    warehouse_id    UUID NOT NULL REFERENCES warehouses(id),
    farmer_id       UUID NOT NULL,
    gs_number       VARCHAR(10) NOT NULL,
    bags            INTEGER NOT NULL CHECK (bags >= 1),
    commodity       VARCHAR(50) NOT NULL DEFAULT 'Maize',
    grain_grade     VARCHAR(20),
    moisture_content NUMERIC(5,2),
    storage_bay     VARCHAR(50),
    receipt_number  VARCHAR(30) NOT NULL UNIQUE,    -- Warehouse receipt
    status          deposit_status_enum NOT NULL DEFAULT 'received',
    received_by     VARCHAR(100),                   -- Clerk name
    deposited_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    released_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_deposits_warehouse ON deposits (warehouse_id);
CREATE INDEX idx_deposits_farmer ON deposits (farmer_id);
CREATE INDEX idx_deposits_receipt ON deposits (receipt_number);
CREATE INDEX idx_deposits_status ON deposits (status);

-- ─── INSPECTIONS ────────────────────────────────────────────────────────────

CREATE TABLE inspections (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    deposit_id      UUID NOT NULL REFERENCES deposits(id),
    inspector_name  VARCHAR(100) NOT NULL,
    moisture_level  NUMERIC(5,2),
    weevil_damage   BOOLEAN NOT NULL DEFAULT FALSE,
    foreign_matter  BOOLEAN NOT NULL DEFAULT FALSE,
    aflatoxin_test  BOOLEAN NOT NULL DEFAULT FALSE,
    aflatoxin_ppb   NUMERIC(8,2),
    result          inspection_result_enum NOT NULL,
    notes           TEXT,
    inspected_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_inspections_deposit ON inspections (deposit_id);

-- ─── SEED DATA: Trans Nzoia NCPB Depots ────────────────────────────────────

INSERT INTO warehouses (ncpb_code, name, sub_county, location, capacity_bags, has_iot_sensors) VALUES
    ('NCPB-KMN-001', 'Kiminini NCPB Depot', 'Kiminini', 'Kiminini Town, Trans Nzoia', 200000, TRUE),
    ('NCPB-KWZ-001', 'Kwanza NCPB Depot', 'Kwanza', 'Kwanza Town, Trans Nzoia', 150000, TRUE),
    ('NCPB-SBT-001', 'Saboti NCPB Depot', 'Saboti', 'Saboti Town, Trans Nzoia', 120000, TRUE),
    ('NCPB-END-001', 'Endebess NCPB Depot', 'Endebess', 'Endebess Town, Trans Nzoia', 100000, FALSE),
    ('NCPB-CHR-001', 'Cherangany NCPB Depot', 'Cherangany', 'Cherangany Town, Trans Nzoia', 180000, TRUE);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;

CREATE TRIGGER set_warehouses_updated_at BEFORE UPDATE ON warehouses FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_deposits_updated_at BEFORE UPDATE ON deposits FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMIT;
