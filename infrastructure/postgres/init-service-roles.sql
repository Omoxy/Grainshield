-- GrainShield — Per-Service Database Roles
-- Creates least-privilege Postgres users for each microservice.
-- Run ONCE during initial setup (docker-compose handles this via initdb).
--
-- SECURITY PRINCIPLE: Each service gets only the permissions it needs.
-- Compromise of one service cannot escalate to reading/writing other
-- services' tables. The 'grainshield' superuser is for migrations only.
--
-- In production Kubernetes, each service has its own connection string
-- from a sealed secret pointing to a dedicated user.

-- ─── Create service users ────────────────────────────────────────────────
-- Passwords are set via env vars in production. These are dev defaults.
-- The docker-compose entrypoint replaces these with actual secrets.

DO $$
BEGIN
  -- Service roles (passwords are assigned via init-all.sh from environment variables)
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

-- ─── Grant schema usage ──────────────────────────────────────────────────
-- All services need access to the public schema.
GRANT USAGE ON SCHEMA public TO gs_farmer, gs_policy, gs_payment,
  gs_price, gs_risk, gs_warehouse, gs_notification;

-- ─── farmer-service grants ───────────────────────────────────────────────
-- Owns: farmers, solidarity_groups, users, audit_log
GRANT SELECT, INSERT, UPDATE ON TABLE farmers TO gs_farmer;
GRANT SELECT, INSERT, UPDATE ON TABLE solidarity_groups TO gs_farmer;
GRANT SELECT, INSERT, UPDATE ON TABLE users TO gs_farmer;
GRANT SELECT, INSERT ON TABLE audit_log TO gs_farmer;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO gs_farmer;

-- ─── policy-service grants ───────────────────────────────────────────────
-- Owns: policies, policy_triggers, claims, trigger_evaluations
GRANT SELECT, INSERT, UPDATE ON TABLE policies TO gs_policy;
GRANT SELECT, INSERT, UPDATE ON TABLE policy_triggers TO gs_policy;
GRANT SELECT, INSERT, UPDATE ON TABLE claims TO gs_policy;
GRANT SELECT, INSERT ON TABLE trigger_evaluations TO gs_policy;
GRANT SELECT, INSERT ON TABLE audit_log TO gs_policy;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO gs_policy;
-- Read-only access to farmers (for policy lookups)
GRANT SELECT ON TABLE farmers TO gs_policy;

-- ─── payment-service grants ──────────────────────────────────────────────
-- Owns: payments, mpesa_callbacks, idempotency_keys, dead_letter_queue, bank_origination_fees
GRANT SELECT, INSERT, UPDATE ON TABLE payments TO gs_payment;
GRANT SELECT, INSERT, UPDATE ON TABLE mpesa_callbacks TO gs_payment;
GRANT SELECT, INSERT ON TABLE idempotency_keys TO gs_payment;
GRANT SELECT, INSERT, UPDATE ON TABLE dead_letter_queue TO gs_payment;
GRANT SELECT, INSERT ON TABLE bank_origination_fees TO gs_payment;
GRANT SELECT, INSERT ON TABLE audit_log TO gs_payment;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO gs_payment;

-- ─── price-service grants ────────────────────────────────────────────────
-- Owns: market_prices, price_alerts, sell_orders
GRANT SELECT, INSERT, UPDATE ON TABLE market_prices TO gs_price;
GRANT SELECT, INSERT ON TABLE price_alerts TO gs_price;
GRANT SELECT, INSERT, UPDATE ON TABLE sell_orders TO gs_price;
GRANT SELECT, INSERT ON TABLE audit_log TO gs_price;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO gs_price;

-- ─── risk-service grants ─────────────────────────────────────────────────
-- Owns: aflatoxin_scores, sensor_readings, weather_data
GRANT SELECT, INSERT, UPDATE ON TABLE aflatoxin_scores TO gs_risk;
GRANT SELECT, INSERT ON TABLE sensor_readings TO gs_risk;
GRANT SELECT, INSERT ON TABLE weather_data TO gs_risk;
GRANT SELECT, INSERT ON TABLE audit_log TO gs_risk;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO gs_risk;

-- ─── warehouse-service grants ────────────────────────────────────────────
-- Owns: warehouses, deposits, inspections
GRANT SELECT, INSERT, UPDATE ON TABLE warehouses TO gs_warehouse;
GRANT SELECT, INSERT, UPDATE ON TABLE deposits TO gs_warehouse;
GRANT SELECT, INSERT ON TABLE inspections TO gs_warehouse;
GRANT SELECT, INSERT ON TABLE audit_log TO gs_warehouse;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO gs_warehouse;

-- ─── notification-service grants ─────────────────────────────────────────
-- Owns: notification_templates, notifications
GRANT SELECT, INSERT, UPDATE ON TABLE notification_templates TO gs_notification;
GRANT SELECT, INSERT, UPDATE ON TABLE notifications TO gs_notification;
GRANT SELECT, INSERT ON TABLE audit_log TO gs_notification;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO gs_notification;
-- Read-only access to farmers (for notification target lookups)
GRANT SELECT ON TABLE farmers TO gs_notification;

-- ─── Fix RLS on audit_log ────────────────────────────────────────────────
-- The farmer-service migration creates RLS policies for gs_farmer only.
-- Extend them so all services can write audit entries.
DO $$
BEGIN
  -- Drop narrow policies set by farmer migration
  DROP POLICY IF EXISTS audit_insert_only ON audit_log;
  DROP POLICY IF EXISTS audit_read ON audit_log;

  -- All service roles may insert and read audit entries
  CREATE POLICY audit_service_insert ON audit_log
    FOR INSERT
    TO gs_farmer, gs_policy, gs_payment, gs_price, gs_risk, gs_warehouse, gs_notification
    WITH CHECK (true);

  CREATE POLICY audit_service_read ON audit_log
    FOR SELECT
    TO gs_farmer, gs_policy, gs_payment, gs_price, gs_risk, gs_warehouse, gs_notification
    USING (true);

  -- Superuser (used for migrations) retains full access
  CREATE POLICY audit_owner_all ON audit_log
    FOR ALL
    TO grainshield
    USING (true)
    WITH CHECK (true);
END
$$;

-- ─── Revoke public defaults ─────────────────────────────────────────────
-- Ensure no service can access tables it shouldn't.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;

-- The grainshield superuser retains full access for migrations.
GRANT ALL ON ALL TABLES IN SCHEMA public TO grainshield;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO grainshield;
