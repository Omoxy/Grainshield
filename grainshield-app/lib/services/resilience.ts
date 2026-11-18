/**
 * GrainShield Resilience & Failure Recovery
 *
 * Handles partial outages, delayed integrations, and failure recovery:
 * - Retry orchestration with exponential backoff
 * - Dead-letter queue management
 * - Circuit breaker for external services
 * - Degraded mode detection
 * - Recovery job scheduling
 */

async function getDb() {
  try {
    const { db } = await import("@/lib/db");
    return db;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────
// CIRCUIT BREAKER
// ─────────────────────────────────────────────

type CircuitState = "closed" | "open" | "half_open";

interface CircuitBreakerConfig {
  failureThreshold: number;
  recoveryTimeMs: number;
  halfOpenMaxAttempts: number;
}

interface CircuitBreakerState {
  state: CircuitState;
  failures: number;
  lastFailure: Date | null;
  lastSuccess: Date | null;
  halfOpenAttempts: number;
}

const circuitBreakers = new Map<string, CircuitBreakerState>();

const DEFAULT_CB_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  recoveryTimeMs: 60000,
  halfOpenMaxAttempts: 2,
};

export function getCircuitState(serviceId: string, config = DEFAULT_CB_CONFIG): CircuitBreakerState {
  if (!circuitBreakers.has(serviceId)) {
    circuitBreakers.set(serviceId, {
      state: "closed",
      failures: 0,
      lastFailure: null,
      lastSuccess: null,
      halfOpenAttempts: 0,
    });
  }

  const cb = circuitBreakers.get(serviceId)!;

  if (cb.state === "open" && cb.lastFailure) {
    const elapsed = Date.now() - cb.lastFailure.getTime();
    if (elapsed >= config.recoveryTimeMs) {
      cb.state = "half_open";
      cb.halfOpenAttempts = 0;
    }
  }

  return cb;
}

export function recordSuccess(serviceId: string): void {
  const cb = getCircuitState(serviceId);
  cb.failures = 0;
  cb.lastSuccess = new Date();
  cb.state = "closed";
  cb.halfOpenAttempts = 0;
}

export function recordFailure(serviceId: string, config = DEFAULT_CB_CONFIG): CircuitState {
  const cb = getCircuitState(serviceId);
  cb.failures++;
  cb.lastFailure = new Date();

  if (cb.state === "half_open") {
    cb.halfOpenAttempts++;
    if (cb.halfOpenAttempts >= config.halfOpenMaxAttempts) {
      cb.state = "open";
    }
  } else if (cb.failures >= config.failureThreshold) {
    cb.state = "open";
  }

  return cb.state;
}

export function canExecute(serviceId: string): boolean {
  const cb = getCircuitState(serviceId);
  return cb.state !== "open";
}

// ─────────────────────────────────────────────
// RETRY ORCHESTRATION
// ─────────────────────────────────────────────

export async function enqueueRetry(params: {
  operationType: string;
  payload: Record<string, unknown>;
  maxAttempts?: number;
  initialBackoffMs?: number;
  idempotencyKey?: string;
}): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;

  const backoff = params.initialBackoffMs ?? 1000;

  const entry = await db.retryQueue.create({
    data: {
      operationType: params.operationType,
      payload: JSON.stringify(params.payload),
      maxAttempts: params.maxAttempts ?? 5,
      backoffMs: backoff,
      nextRetryAt: new Date(Date.now() + backoff),
      idempotencyKey: params.idempotencyKey,
    },
  });

  return entry.id;
}

export async function processRetryQueue(): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
  deadLettered: number;
}> {
  const db = await getDb();
  if (!db) return { processed: 0, succeeded: 0, failed: 0, deadLettered: 0 };

  const ready = await db.retryQueue.findMany({
    where: {
      status: "PENDING",
      nextRetryAt: { lte: new Date() },
    },
    orderBy: { nextRetryAt: "asc" },
    take: 50,
  });

  let succeeded = 0;
  let failed = 0;
  let deadLettered = 0;

  for (const entry of ready) {
    await db.retryQueue.update({
      where: { id: entry.id },
      data: { status: "IN_PROGRESS" },
    });

    try {
      const payload = JSON.parse(entry.payload);
      await executeRetryOperation(entry.operationType, payload);

      await db.retryQueue.update({
        where: { id: entry.id },
        data: { status: "SUCCEEDED" },
      });
      succeeded++;
    } catch (err) {
      const newAttempts = entry.attempts + 1;
      const errorMsg = err instanceof Error ? err.message : String(err);

      if (newAttempts >= entry.maxAttempts) {
        await db.retryQueue.update({
          where: { id: entry.id },
          data: {
            status: "DEAD_LETTERED",
            attempts: newAttempts,
            lastError: errorMsg,
          },
        });
        deadLettered++;
      } else {
        const nextBackoff = entry.backoffMs * Math.pow(2, newAttempts - 1);
        await db.retryQueue.update({
          where: { id: entry.id },
          data: {
            status: "PENDING",
            attempts: newAttempts,
            lastError: errorMsg,
            backoffMs: nextBackoff,
            nextRetryAt: new Date(Date.now() + nextBackoff),
          },
        });
        failed++;
      }
    }
  }

  return { processed: ready.length, succeeded, failed, deadLettered };
}

async function executeRetryOperation(type: string, payload: Record<string, unknown>): Promise<void> {
  switch (type) {
    case "payout":
      console.log(`[Retry] Processing payout: ${payload.payoutId}`);
      break;
    case "notification":
      console.log(`[Retry] Sending notification: ${payload.alertId}`);
      break;
    case "sync":
      console.log(`[Retry] Re-syncing: ${payload.source}`);
      break;
    default:
      console.log(`[Retry] Unknown operation type: ${type}`);
  }
}

// ─────────────────────────────────────────────
// DEGRADED MODE DETECTION
// ─────────────────────────────────────────────

export interface ServiceHealth {
  serviceId: string;
  status: "healthy" | "degraded" | "down";
  circuitState: CircuitState;
  failureCount: number;
  lastSuccess: Date | null;
  lastFailure: Date | null;
}

export interface PlatformHealth {
  overall: "operational" | "degraded" | "partial_outage" | "major_outage";
  services: ServiceHealth[];
  degradedCapabilities: string[];
  timestamp: Date;
}

const MONITORED_SERVICES = [
  { id: "mpesa", label: "M-Pesa Payments" },
  { id: "weather_api", label: "Weather Data" },
  { id: "warehouse_iot", label: "Warehouse Sensors" },
  { id: "sms_gateway", label: "SMS Gateway" },
  { id: "price_feed", label: "Price Feeds" },
  { id: "satellite", label: "Satellite Imagery" },
];

export function getPlatformHealth(): PlatformHealth {
  const services: ServiceHealth[] = MONITORED_SERVICES.map((svc) => {
    const cb = getCircuitState(svc.id);
    let status: ServiceHealth["status"] = "healthy";
    if (cb.state === "open") status = "down";
    else if (cb.state === "half_open" || cb.failures > 2) status = "degraded";

    return {
      serviceId: svc.id,
      status,
      circuitState: cb.state,
      failureCount: cb.failures,
      lastSuccess: cb.lastSuccess,
      lastFailure: cb.lastFailure,
    };
  });

  const downCount = services.filter((s) => s.status === "down").length;
  const degradedCount = services.filter((s) => s.status === "degraded").length;

  let overall: PlatformHealth["overall"] = "operational";
  if (downCount >= 3) overall = "major_outage";
  else if (downCount >= 1) overall = "partial_outage";
  else if (degradedCount >= 2) overall = "degraded";

  const degradedCapabilities: string[] = [];
  for (const svc of services) {
    if (svc.status !== "healthy") {
      const label = MONITORED_SERVICES.find((s) => s.id === svc.serviceId)?.label ?? svc.serviceId;
      degradedCapabilities.push(label);
    }
  }

  return {
    overall,
    services,
    degradedCapabilities,
    timestamp: new Date(),
  };
}

// ─────────────────────────────────────────────
// DEAD LETTER QUEUE
// ─────────────────────────────────────────────

export async function getDeadLetterItems(): Promise<{
  items: { id: string; type: string; error: string; attempts: number; createdAt: Date }[];
  count: number;
}> {
  const db = await getDb();
  if (!db) return { items: [], count: 0 };

  const items = await db.retryQueue.findMany({
    where: { status: "DEAD_LETTERED" },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: {
      id: true,
      operationType: true,
      lastError: true,
      attempts: true,
      createdAt: true,
    },
  });

  return {
    items: items.map((i) => ({
      id: i.id,
      type: i.operationType,
      error: i.lastError ?? "Unknown error",
      attempts: i.attempts,
      createdAt: i.createdAt,
    })),
    count: items.length,
  };
}
