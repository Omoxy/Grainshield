-- GrainShield price-service schema
-- Cross-border price intelligence: NCPB, Uganda, Tanzania, South Sudan

BEGIN;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TYPE price_source_enum AS ENUM ('NCPB', 'Uganda', 'Tanzania', 'South Sudan');
CREATE TYPE commodity_enum AS ENUM ('Maize', 'Wheat', 'Beans', 'Sorghum');

-- ─── MARKET PRICES ──────────────────────────────────────────────────────────

CREATE TABLE market_prices (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source      price_source_enum NOT NULL,
    market_name VARCHAR(100) NOT NULL,
    commodity   commodity_enum NOT NULL DEFAULT 'Maize',
    price_per_bag NUMERIC(10,2) NOT NULL CHECK (price_per_bag > 0),
    currency    VARCHAR(3) NOT NULL DEFAULT 'KES',
    unit        VARCHAR(20) NOT NULL DEFAULT '90kg bag',
    trend       VARCHAR(10),              -- 'up', 'down', 'stable'
    recorded_at DATE NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_prices_source ON market_prices (source);
CREATE INDEX idx_prices_recorded ON market_prices (recorded_at DESC);
CREATE INDEX idx_prices_commodity ON market_prices (commodity);

-- ─── PRICE ALERTS ───────────────────────────────────────────────────────────

CREATE TABLE price_alerts (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    farmer_id    UUID NOT NULL,
    alert_type   VARCHAR(50) NOT NULL,     -- 'price_above', 'weekly_report'
    threshold    NUMERIC(10,2),
    commodity    commodity_enum NOT NULL DEFAULT 'Maize',
    active       BOOLEAN NOT NULL DEFAULT TRUE,
    last_sent_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_alerts_farmer ON price_alerts (farmer_id);

-- ─── SELL ORDERS ────────────────────────────────────────────────────────────

CREATE TABLE sell_orders (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    farmer_id    UUID NOT NULL,
    gs_number    VARCHAR(10) NOT NULL,
    bags         INTEGER NOT NULL CHECK (bags >= 1),
    target_price NUMERIC(10,2),
    market       VARCHAR(100),
    status       VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending, matched, sold, cancelled
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_orders_farmer ON sell_orders (farmer_id);
CREATE INDEX idx_orders_status ON sell_orders (status);

COMMIT;
