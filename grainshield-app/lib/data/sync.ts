async function getDb() {
  try {
    const { db } = await import("@/lib/db");
    return db;
  } catch {
    return null;
  }
}

interface SyncResult<T> {
  data: T | null;
  source: string;
  confidence: number;
  stale: boolean;
  lastSyncAt: Date | null;
  error?: string;
}

interface DataAdapter<T> {
  source: string;
  sourceType: string;
  fetch: () => Promise<T>;
  stalenessThresholdMs: number;
  retries: number;
}

export async function syncFromAdapter<T>(
  adapter: DataAdapter<T>,
): Promise<SyncResult<T>> {
  const db = await getDb();

  const lastSync = db
    ? await db.dataSyncLog.findFirst({
        where: { source: adapter.source, status: "success" },
        orderBy: { syncedAt: "desc" },
      })
    : null;

  const isStale =
    !lastSync ||
    Date.now() - lastSync.syncedAt.getTime() > adapter.stalenessThresholdMs;

  if (!isStale && lastSync) {
    return {
      data: null,
      source: adapter.source,
      confidence: lastSync.confidence ?? 1.0,
      stale: false,
      lastSyncAt: lastSync.syncedAt,
    };
  }

  let lastError: string | undefined;
  const startTime = Date.now();

  for (let attempt = 0; attempt <= adapter.retries; attempt++) {
    try {
      const data = await adapter.fetch();
      const durationMs = Date.now() - startTime;

      if (db) {
        await db.dataSyncLog.create({
          data: {
            source: adapter.source,
            sourceType: adapter.sourceType,
            status: "success",
            confidence: 1.0,
            durationMs,
          },
        });
      }

      return {
        data,
        source: adapter.source,
        confidence: 1.0,
        stale: false,
        lastSyncAt: new Date(),
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);

      if (attempt < adapter.retries) {
        await new Promise((r) =>
          setTimeout(r, Math.min(1000 * 2 ** attempt, 10000)),
        );
      }
    }
  }

  const durationMs = Date.now() - startTime;

  if (db) {
    await db.dataSyncLog.create({
      data: {
        source: adapter.source,
        sourceType: adapter.sourceType,
        status: "failed",
        errorDetail: lastError,
        durationMs,
      },
    });
  }

  return {
    data: null,
    source: adapter.source,
    confidence: 0,
    stale: true,
    lastSyncAt: lastSync?.syncedAt ?? null,
    error: lastError,
  };
}

export const weatherAdapter: DataAdapter<unknown> = {
  source: "chirps",
  sourceType: "weather",
  stalenessThresholdMs: 6 * 60 * 60 * 1000,
  retries: 2,
  async fetch() {
    const { executeWeatherSync } = await import("@/lib/jobs/weather-sync");
    return executeWeatherSync();
  },
};

export const priceAdapter: DataAdapter<unknown> = {
  source: "ncpb",
  sourceType: "price",
  stalenessThresholdMs: 60 * 60 * 1000,
  retries: 2,
  async fetch() {
    const { executePricingSync } = await import("@/lib/jobs/pricing-sync");
    return executePricingSync();
  },
};

export const warehouseIotAdapter: DataAdapter<unknown> = {
  source: "warehouse_iot",
  sourceType: "warehouse",
  stalenessThresholdMs: 15 * 60 * 1000,
  retries: 3,
  async fetch() {
    const { executeWarehouseSync } = await import("@/lib/jobs/warehouse-sync");
    return executeWarehouseSync();
  },
};
