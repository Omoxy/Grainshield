/**
 * Environment variable validation.
 *
 * Validates required environment variables at startup and provides
 * typed access to configuration values. Fails fast with clear error
 * messages if critical variables are missing.
 *
 * Usage: import { env } from "@/lib/env-validation";
 */

interface EnvConfig {
  // Required in all environments
  DATABASE_URL: string;
  JWT_SECRET: string;

  // Service URLs (defaults to localhost for dev)
  FARMER_SERVICE_URL: string;
  POLICY_SERVICE_URL: string;
  PAYMENT_SERVICE_URL: string;
  PRICE_SERVICE_URL: string;
  RISK_SERVICE_URL: string;
  WAREHOUSE_SERVICE_URL: string;
  NOTIFICATION_SERVICE_URL: string;

  // Optional: SMS gateway
  SMS_API_KEY: string;
  SMS_SENDER_ID: string;
  SMS_PROVIDER: string;

  // Optional: M-Pesa
  MPESA_CONSUMER_KEY: string;
  MPESA_CONSUMER_SECRET: string;
  MPESA_SHORTCODE: string;
  MPESA_PASSKEY: string;
  MPESA_CALLBACK_URL: string;
  MPESA_ENVIRONMENT: string;

  // Optional: Object storage
  S3_ENDPOINT: string;
  S3_BUCKET: string;
  S3_ACCESS_KEY: string;
  S3_SECRET_KEY: string;
  S3_REGION: string;

  // Runtime
  NODE_ENV: string;
  ALLOW_DEV_AUTH: boolean;
}

interface RequiredVar {
  key: string;
  prodOnly?: boolean;
  minLength?: number;
}

const REQUIRED_VARS: RequiredVar[] = [
  { key: "DATABASE_URL" },
  { key: "JWT_SECRET", minLength: 32 },
];

const REQUIRED_IN_PROD: RequiredVar[] = [
  { key: "SMS_API_KEY", prodOnly: true },
  { key: "MPESA_CONSUMER_KEY", prodOnly: true },
  { key: "MPESA_CONSUMER_SECRET", prodOnly: true },
];

const SERVICE_DEFAULTS: Record<string, string> = {
  FARMER_SERVICE_URL: "http://localhost:8080",
  POLICY_SERVICE_URL: "http://localhost:8081",
  PAYMENT_SERVICE_URL: "http://localhost:8082",
  PRICE_SERVICE_URL: "http://localhost:8083",
  RISK_SERVICE_URL: "http://localhost:8084",
  WAREHOUSE_SERVICE_URL: "http://localhost:8085",
  NOTIFICATION_SERVICE_URL: "http://localhost:8086",
};

/**
 * Validate environment variables. Returns errors array (empty = valid).
 */
export function validateEnvironment(): string[] {
  const errors: string[] = [];
  const isProd = process.env.NODE_ENV === "production";

  for (const { key, minLength } of REQUIRED_VARS) {
    const value = process.env[key];
    if (!value || value.trim() === "") {
      errors.push(`Missing required environment variable: ${key}`);
    } else if (minLength && value.length < minLength) {
      errors.push(`${key} must be at least ${minLength} characters`);
    }
  }

  if (isProd) {
    for (const { key } of REQUIRED_IN_PROD) {
      const value = process.env[key];
      if (!value || value.trim() === "") {
        errors.push(`Missing production-required environment variable: ${key}`);
      }
    }

    if (process.env.ALLOW_DEV_AUTH === "true") {
      errors.push("ALLOW_DEV_AUTH must not be 'true' in production");
    }
  }

  return errors;
}

/**
 * Get validated environment config with defaults applied.
 */
export function getEnv(): EnvConfig {
  return {
    DATABASE_URL: process.env.DATABASE_URL ?? "",
    JWT_SECRET: process.env.JWT_SECRET ?? "",

    FARMER_SERVICE_URL: process.env.FARMER_SERVICE_URL ?? SERVICE_DEFAULTS.FARMER_SERVICE_URL,
    POLICY_SERVICE_URL: process.env.POLICY_SERVICE_URL ?? SERVICE_DEFAULTS.POLICY_SERVICE_URL,
    PAYMENT_SERVICE_URL: process.env.PAYMENT_SERVICE_URL ?? SERVICE_DEFAULTS.PAYMENT_SERVICE_URL,
    PRICE_SERVICE_URL: process.env.PRICE_SERVICE_URL ?? SERVICE_DEFAULTS.PRICE_SERVICE_URL,
    RISK_SERVICE_URL: process.env.RISK_SERVICE_URL ?? SERVICE_DEFAULTS.RISK_SERVICE_URL,
    WAREHOUSE_SERVICE_URL: process.env.WAREHOUSE_SERVICE_URL ?? SERVICE_DEFAULTS.WAREHOUSE_SERVICE_URL,
    NOTIFICATION_SERVICE_URL: process.env.NOTIFICATION_SERVICE_URL ?? SERVICE_DEFAULTS.NOTIFICATION_SERVICE_URL,

    SMS_API_KEY: process.env.SMS_API_KEY ?? "",
    SMS_SENDER_ID: process.env.SMS_SENDER_ID ?? "GrainShield",
    SMS_PROVIDER: process.env.SMS_PROVIDER ?? "africastalking",

    MPESA_CONSUMER_KEY: process.env.MPESA_CONSUMER_KEY ?? "",
    MPESA_CONSUMER_SECRET: process.env.MPESA_CONSUMER_SECRET ?? "",
    MPESA_SHORTCODE: process.env.MPESA_SHORTCODE ?? "",
    MPESA_PASSKEY: process.env.MPESA_PASSKEY ?? "",
    MPESA_CALLBACK_URL: process.env.MPESA_CALLBACK_URL ?? "",
    MPESA_ENVIRONMENT: process.env.MPESA_ENVIRONMENT ?? "sandbox",

    S3_ENDPOINT: process.env.S3_ENDPOINT ?? "",
    S3_BUCKET: process.env.S3_BUCKET ?? "grainshield-kyc",
    S3_ACCESS_KEY: process.env.S3_ACCESS_KEY ?? "",
    S3_SECRET_KEY: process.env.S3_SECRET_KEY ?? "",
    S3_REGION: process.env.S3_REGION ?? "af-south-1",

    NODE_ENV: process.env.NODE_ENV ?? "development",
    ALLOW_DEV_AUTH: process.env.ALLOW_DEV_AUTH === "true",
  };
}

/** Singleton env instance */
let _env: EnvConfig | null = null;

export const env: EnvConfig = new Proxy({} as EnvConfig, {
  get(_, prop: string) {
    if (!_env) {
      _env = getEnv();
    }
    return (_env as unknown as Record<string, unknown>)[prop];
  },
});
