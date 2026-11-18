-- GrainShield farmer-service migration 003
-- Authentication: users table with bcrypt password hashes.
-- Supports login by phone, email, or gs_number.

BEGIN;

CREATE TABLE IF NOT EXISTS users (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    identifier  VARCHAR(200) NOT NULL UNIQUE,
    password_hash VARCHAR(100) NOT NULL,
    roles       TEXT[] NOT NULL DEFAULT '{farmer}',
    farmer_id   UUID REFERENCES farmers(id),
    active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_identifier ON users (identifier);
CREATE INDEX idx_users_farmer_id ON users (farmer_id);

CREATE TRIGGER set_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

COMMIT;
