import { canExecute, recordSuccess, recordFailure } from "@/lib/services/resilience";

export interface ChirpsRainfallRecord {
  region: string;
  latitude: number;
  longitude: number;
  periodStart: Date;
  periodEnd: Date;
  rainfallMm: number;
  longTermAvgMm: number;
  anomalyPct: number;
  source: "chirps";
  confidence: number;
}

const SERVICE_ID = "chirps_rainfall";
const STALE_HOURS = 48;

async function getDb() {
  try {
    const { db } = await import("@/lib/db");
    return db;
  } catch {
    return null;
  }
}

export async function fetchChirpsRainfall(county?: string): Promise<ChirpsRainfallRecord[]> {
  if (!canExecute(SERVICE_ID)) return [];

  try {
    const db = await getDb();
    if (!db) return [];

    const staleThreshold = new Date(Date.now() - STALE_HOURS * 60 * 60 * 1000);

    const syncLog = await db.dataSyncLog.findFirst({
      where: {
        sourceType: "chirps",
        status: { in: ["success", "partial"] },
        syncedAt: { gte: staleThreshold },
      },
      orderBy: { syncedAt: "desc" },
    });

    if (!syncLog) {
      return getFallbackFromEvents(db, county);
    }

    const events = await db.operationalEvent.findMany({
      where: {
        category: "rainfall",
        createdAt: { gte: staleThreshold },
        ...(county ? { title: { contains: county } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    recordSuccess(SERVICE_ID);

    return events.map((e) => {
      let payload: Record<string, unknown> = {};
      try {
        payload = e.payload ? JSON.parse(e.payload) : {};
      } catch { /* ignore */ }

      const rainfallMm = (payload.rainfallMm as number) ?? 0;
      const longTermAvg = (payload.longTermAvgMm as number) ?? rainfallMm;
      const anomaly = longTermAvg > 0
        ? ((rainfallMm - longTermAvg) / longTermAvg) * 100
        : 0;

      return {
        region: (payload.region as string) ?? "Unknown",
        latitude: (payload.lat as number) ?? 0,
        longitude: (payload.lon as number) ?? 0,
        periodStart: new Date((payload.periodStart as string) ?? e.createdAt),
        periodEnd: new Date((payload.periodEnd as string) ?? e.createdAt),
        rainfallMm,
        longTermAvgMm: longTermAvg,
        anomalyPct: Math.round(anomaly * 10) / 10,
        source: "chirps" as const,
        confidence: syncLog.confidence ?? 0.75,
      };
    });
  } catch {
    recordFailure(SERVICE_ID);
    return [];
  }
}

async function getFallbackFromEvents(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  county?: string
): Promise<ChirpsRainfallRecord[]> {
  try {
    const events = await db.operationalEvent.findMany({
      where: {
        category: "rainfall",
        ...(county ? { title: { contains: county } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    return events.map((e) => {
      let payload: Record<string, unknown> = {};
      try {
        payload = e.payload ? JSON.parse(e.payload) : {};
      } catch { /* ignore */ }

      return {
        region: (payload.region as string) ?? "Unknown",
        latitude: (payload.lat as number) ?? 0,
        longitude: (payload.lon as number) ?? 0,
        periodStart: e.createdAt,
        periodEnd: e.createdAt,
        rainfallMm: (payload.rainfallMm as number) ?? 0,
        longTermAvgMm: (payload.longTermAvgMm as number) ?? 0,
        anomalyPct: 0,
        source: "chirps" as const,
        confidence: 0.4,
      };
    });
  } catch {
    return [];
  }
}
