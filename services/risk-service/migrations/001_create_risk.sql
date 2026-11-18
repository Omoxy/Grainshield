-- GrainShield risk-service schema
-- IITA A-EWS aflatoxin risk scores + IoT sensor data

BEGIN;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TYPE risk_level_enum AS ENUM ('LOW', 'MODERATE', 'HIGH', 'CRITICAL');

-- ─── AFLATOXIN RISK SCORES ──────────────────────────────────────────────────

CREATE TABLE aflatoxin_scores (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sub_county      VARCHAR(50) NOT NULL,
    risk_score      NUMERIC(5,2) NOT NULL CHECK (risk_score >= 0 AND risk_score <= 100),
    risk_level      risk_level_enum NOT NULL,
    contamination_ppb NUMERIC(8,2),            -- parts per billion
    confidence      NUMERIC(5,2),              -- model confidence 0-100
    model_version   VARCHAR(20) NOT NULL,       -- e.g. "A-EWS v2.1"
    data_source     VARCHAR(100) NOT NULL DEFAULT 'IITA A-EWS API',
    season          VARCHAR(20),
    recorded_at     DATE NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_aflatoxin_sub ON aflatoxin_scores (sub_county);
CREATE INDEX idx_aflatoxin_date ON aflatoxin_scores (recorded_at DESC);
CREATE INDEX idx_aflatoxin_level ON aflatoxin_scores (risk_level);

-- ─── IOT SENSOR DATA ────────────────────────────────────────────────────────

CREATE TABLE sensor_readings (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    warehouse_id    UUID NOT NULL,
    sensor_id       VARCHAR(50) NOT NULL,
    sensor_type     VARCHAR(30) NOT NULL,       -- 'humidity', 'temperature', 'moisture'
    value           NUMERIC(8,2) NOT NULL,
    unit            VARCHAR(10) NOT NULL,        -- '%', '°C', '%MC'
    alert_triggered BOOLEAN NOT NULL DEFAULT FALSE,
    recorded_at     TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sensors_warehouse ON sensor_readings (warehouse_id);
CREATE INDEX idx_sensors_type ON sensor_readings (sensor_type);
CREATE INDEX idx_sensors_alert ON sensor_readings (alert_triggered);
CREATE INDEX idx_sensors_time ON sensor_readings (recorded_at DESC);

-- ─── WEATHER DATA (ESA Copernicus) ──────────────────────────────────────────

CREATE TABLE weather_data (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sub_county      VARCHAR(50) NOT NULL,
    temperature     NUMERIC(5,2),
    humidity        NUMERIC(5,2),
    rainfall_mm     NUMERIC(8,2),
    wind_speed_kph  NUMERIC(5,2),
    weather_event   BOOLEAN NOT NULL DEFAULT FALSE,
    event_type      VARCHAR(50),                -- 'flood', 'drought', 'storm'
    satellite_ref   VARCHAR(100),
    recorded_at     DATE NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_weather_sub ON weather_data (sub_county);
CREATE INDEX idx_weather_date ON weather_data (recorded_at DESC);
CREATE INDEX idx_weather_event ON weather_data (weather_event);

COMMIT;
