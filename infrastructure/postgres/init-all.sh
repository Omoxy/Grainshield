#!/bin/bash
set -e

# GrainShield — Combined database initialisation script
# 1. Creates service roles (needed before migrations that reference them in RLS)
# 2. Runs all service migrations in order
# 3. Applies per-role grants and revokes
#
# Executed automatically by the PostgreSQL docker-entrypoint on first boot.

echo "=== GrainShield DB Init: Phase 1 — Create service roles ==="

# Create the bare roles and set passwords from environment variables.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v farmer_pwd="${GS_FARMER_DB_PASSWORD:?set GS_FARMER_DB_PASSWORD}" \
  -v policy_pwd="${GS_POLICY_DB_PASSWORD:?set GS_POLICY_DB_PASSWORD}" \
  -v payment_pwd="${GS_PAYMENT_DB_PASSWORD:?set GS_PAYMENT_DB_PASSWORD}" \
  -v price_pwd="${GS_PRICE_DB_PASSWORD:?set GS_PRICE_DB_PASSWORD}" \
  -v risk_pwd="${GS_RISK_DB_PASSWORD:?set GS_RISK_DB_PASSWORD}" \
  -v warehouse_pwd="${GS_WAREHOUSE_DB_PASSWORD:?set GS_WAREHOUSE_DB_PASSWORD}" \
  -v notification_pwd="${GS_NOTIFICATION_DB_PASSWORD:?set GS_NOTIFICATION_DB_PASSWORD}" <<'EOSQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'gs_farmer') THEN
    CREATE ROLE gs_farmer WITH LOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'gs_policy') THEN
    CREATE ROLE gs_policy WITH LOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'gs_payment') THEN
    CREATE ROLE gs_payment WITH LOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'gs_price') THEN
    CREATE ROLE gs_price WITH LOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'gs_risk') THEN
    CREATE ROLE gs_risk WITH LOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'gs_warehouse') THEN
    CREATE ROLE gs_warehouse WITH LOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'gs_notification') THEN
    CREATE ROLE gs_notification WITH LOGIN;
  END IF;
END
$$;
ALTER ROLE gs_farmer WITH PASSWORD :'farmer_pwd';
ALTER ROLE gs_policy WITH PASSWORD :'policy_pwd';
ALTER ROLE gs_payment WITH PASSWORD :'payment_pwd';
ALTER ROLE gs_price WITH PASSWORD :'price_pwd';
ALTER ROLE gs_risk WITH PASSWORD :'risk_pwd';
ALTER ROLE gs_warehouse WITH PASSWORD :'warehouse_pwd';
ALTER ROLE gs_notification WITH PASSWORD :'notification_pwd';
EOSQL

echo "=== GrainShield DB Init: Phase 2 — Run service migrations ==="

SERVICES=(
  "farmer-service"
  "policy-service"
  "payment-service"
  "price-service"
  "risk-service"
  "warehouse-service"
  "notification-service"
)

for svc in "${SERVICES[@]}"; do
  MIGRATION_DIR="/migrations/${svc}"
  if [ -d "$MIGRATION_DIR" ]; then
    echo "--- Running migrations for ${svc} ---"
    for f in "$MIGRATION_DIR"/*.sql; do
      if [ -f "$f" ]; then
        echo "  Applying $(basename "$f") ..."
        psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -f "$f"
      fi
    done
  else
    echo "  WARN: No migration directory for ${svc} at ${MIGRATION_DIR}"
  fi
done

echo "=== GrainShield DB Init: Phase 3 — Apply role grants ==="

# Now apply the full grants (schema usage, table-level, sequence permissions)
# and revocations from the service-roles SQL.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -f /migrations/init-service-roles.sql

echo "=== GrainShield DB Init: all 3 phases complete ==="
