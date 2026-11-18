import { executePricingSync } from "./pricing-sync";
import { executeWeatherSync } from "./weather-sync";
import { executeWarehouseSync } from "./warehouse-sync";
import { seedOperationalData } from "./seed-operational-data";
import { processRetryQueue } from "@/lib/services/resilience";

interface SyncStatus {
  initialized: boolean;
  lastPriceSync: Date | null;
  lastWeatherSync: Date | null;
  lastWarehouseSync: Date | null;
  lastRetryProcess: Date | null;
  lastStaleCleanup: Date | null;
  errors: string[];
  workerIntervals: NodeJS.Timeout[];
}

const state: SyncStatus = {
  initialized: false,
  lastPriceSync: null,
  lastWeatherSync: null,
  lastWarehouseSync: null,
  lastRetryProcess: null,
  lastStaleCleanup: null,
  errors: [],
  workerIntervals: [],
};

const PRICE_SYNC_INTERVAL_MS = 15 * 60 * 1000;
const WEATHER_SYNC_INTERVAL_MS = 30 * 60 * 1000;
const WAREHOUSE_SYNC_INTERVAL_MS = 10 * 60 * 1000;
const RETRY_PROCESS_INTERVAL_MS = 2 * 60 * 1000;
const STALE_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

async function cleanStaleData(): Promise<void> {
  try {
    const { db } = await import("@/lib/db");

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await db.dataSyncLog.deleteMany({
      where: { syncedAt: { lt: thirtyDaysAgo } },
    });

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    await db.operationalEvent.deleteMany({
      where: { resolvedAt: { not: null, lt: sevenDaysAgo } },
    });

    await db.idempotencyKey.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });

    state.lastStaleCleanup = new Date();
    console.log("[Orchestrator] Stale data cleanup completed");
  } catch (err) {
    console.error("[Orchestrator] Stale cleanup failed:", err);
  }
}

export async function executeInitialHydration(): Promise<{
  seed: Awaited<ReturnType<typeof seedOperationalData>>;
  warehouse: Awaited<ReturnType<typeof executeWarehouseSync>>;
  pricing: Awaited<ReturnType<typeof executePricingSync>>;
  weather: Awaited<ReturnType<typeof executeWeatherSync>>;
}> {
  console.log("[Orchestrator] Beginning initial hydration...");

  const warehouse = await executeWarehouseSync();
  console.log(`[Orchestrator] Warehouses: ${warehouse.warehousesUpdated} updated, ${warehouse.sensorReadings} readings`);

  const seed = await seedOperationalData();
  console.log(`[Orchestrator] Seed: ${seed.users} users, ${seed.farmers} farmers, ${seed.receipts} receipts`);

  const [pricing, weather] = await Promise.all([
    executePricingSync(),
    executeWeatherSync(),
  ]);
  console.log(`[Orchestrator] Prices: ${pricing.marketsUpdated} markets`);
  console.log(`[Orchestrator] Weather: ${weather.regionsUpdated} regions, ${weather.alertsCreated} alerts`);

  state.lastPriceSync = new Date();
  state.lastWeatherSync = new Date();
  state.lastWarehouseSync = new Date();

  return { seed, warehouse, pricing, weather };
}

export async function startBackgroundWorkers(): Promise<void> {
  if (state.workerIntervals.length > 0) {
    console.log("[Orchestrator] Workers already running");
    return;
  }

  console.log("[Orchestrator] Starting background workers...");

  state.workerIntervals.push(
    setInterval(async () => {
      try {
        const result = await executePricingSync();
        state.lastPriceSync = new Date();
        if (result.errors.length > 0) state.errors.push(...result.errors);
        console.log(`[Worker:Pricing] ${result.marketsUpdated} markets synced`);
      } catch (err) {
        console.error("[Worker:Pricing] Failed:", err);
      }
    }, PRICE_SYNC_INTERVAL_MS),
  );

  state.workerIntervals.push(
    setInterval(async () => {
      try {
        const result = await executeWeatherSync();
        state.lastWeatherSync = new Date();
        if (result.errors.length > 0) state.errors.push(...result.errors);
        console.log(`[Worker:Weather] ${result.regionsUpdated} regions, ${result.alertsCreated} alerts`);
      } catch (err) {
        console.error("[Worker:Weather] Failed:", err);
      }
    }, WEATHER_SYNC_INTERVAL_MS),
  );

  state.workerIntervals.push(
    setInterval(async () => {
      try {
        const result = await executeWarehouseSync();
        state.lastWarehouseSync = new Date();
        if (result.errors.length > 0) state.errors.push(...result.errors);
        console.log(`[Worker:Warehouse] ${result.warehousesUpdated} warehouses, ${result.sensorReadings} readings`);
      } catch (err) {
        console.error("[Worker:Warehouse] Failed:", err);
      }
    }, WAREHOUSE_SYNC_INTERVAL_MS),
  );

  state.workerIntervals.push(
    setInterval(async () => {
      try {
        const result = await processRetryQueue();
        state.lastRetryProcess = new Date();
        if (result.processed > 0) {
          console.log(`[Worker:Retry] ${result.processed} processed, ${result.succeeded} ok, ${result.deadLettered} DLQ`);
        }
      } catch (err) {
        console.error("[Worker:Retry] Failed:", err);
      }
    }, RETRY_PROCESS_INTERVAL_MS),
  );

  state.workerIntervals.push(
    setInterval(async () => {
      await cleanStaleData();
    }, STALE_CLEANUP_INTERVAL_MS),
  );

  console.log("[Orchestrator] All background workers started");
  console.log(`  Pricing:   every ${PRICE_SYNC_INTERVAL_MS / 60000}min`);
  console.log(`  Weather:   every ${WEATHER_SYNC_INTERVAL_MS / 60000}min`);
  console.log(`  Warehouse: every ${WAREHOUSE_SYNC_INTERVAL_MS / 60000}min`);
  console.log(`  Retry:     every ${RETRY_PROCESS_INTERVAL_MS / 60000}min`);
  console.log(`  Cleanup:   every ${STALE_CLEANUP_INTERVAL_MS / 60000}min`);
}

export function getOrchestratorStatus(): {
  initialized: boolean;
  workersRunning: number;
  lastPriceSync: string | null;
  lastWeatherSync: string | null;
  lastWarehouseSync: string | null;
  lastRetryProcess: string | null;
  lastStaleCleanup: string | null;
  recentErrors: string[];
} {
  return {
    initialized: state.initialized,
    workersRunning: state.workerIntervals.length,
    lastPriceSync: state.lastPriceSync?.toISOString() ?? null,
    lastWeatherSync: state.lastWeatherSync?.toISOString() ?? null,
    lastWarehouseSync: state.lastWarehouseSync?.toISOString() ?? null,
    lastRetryProcess: state.lastRetryProcess?.toISOString() ?? null,
    lastStaleCleanup: state.lastStaleCleanup?.toISOString() ?? null,
    recentErrors: state.errors.slice(-10),
  };
}

export async function initializeOperationalSystem(): Promise<void> {
  if (state.initialized) return;

  console.log("[Orchestrator] ========================================");
  console.log("[Orchestrator] GrainShield Operational System Starting");
  console.log("[Orchestrator] ========================================");

  try {
    const { db } = await import("@/lib/db");
    await db.$queryRaw`SELECT 1`;
    console.log("[Orchestrator] Database connection verified");
  } catch (err) {
    console.error("[Orchestrator] DATABASE CONNECTION FAILED:", err);
    console.error("[Orchestrator] System cannot start without database");
    return;
  }

  try {
    await executeInitialHydration();
    await startBackgroundWorkers();
    state.initialized = true;
    console.log("[Orchestrator] ========================================");
    console.log("[Orchestrator] System fully operational");
    console.log("[Orchestrator] ========================================");
  } catch (err) {
    console.error("[Orchestrator] Initialization failed:", err);
    state.errors.push(err instanceof Error ? err.message : String(err));
  }
}
