import { canExecute, recordSuccess, recordFailure } from "@/lib/services/resilience";

export interface WeatherRiskIndicator {
  region: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  indicator: string;
  rainfallMm: number | null;
  temperatureC: number | null;
  source: string;
  confidence: number;
  recordedAt: Date;
  isStale: boolean;
}

export interface FarmerWeatherAlert {
  type: "rainfall" | "drying" | "moisture" | "harvest_delay" | "advisory";
  severity: "info" | "warning" | "critical";
  message: string;
  region: string;
  validUntil: Date | null;
}

const STALE_HOURS = 12;

async function getDb() {
  try {
    const { db } = await import("@/lib/db");
    return db;
  } catch {
    return null;
  }
}

export async function getRegionalWeatherRisks(): Promise<WeatherRiskIndicator[]> {
  const serviceId = "weather_api";
  if (!canExecute(serviceId)) {
    return [];
  }

  try {
    const db = await getDb();
    if (!db) return [];

    const recentSync = await db.dataSyncLog.findFirst({
      where: { sourceType: "weather", status: { in: ["success", "partial"] } },
      orderBy: { syncedAt: "desc" },
    });

    if (!recentSync) return [];

    const staleThreshold = new Date(Date.now() - STALE_HOURS * 60 * 60 * 1000);
    const isStale = recentSync.syncedAt < staleThreshold;

    const events = await db.operationalEvent.findMany({
      where: {
        category: "weather",
        resolvedAt: null,
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    recordSuccess(serviceId);

    return events.map((e) => {
      let payload: Record<string, unknown> = {};
      try {
        payload = e.payload ? JSON.parse(e.payload) : {};
      } catch { /* ignore */ }

      return {
        region: (payload.region as string) ?? "Unknown",
        riskLevel: mapSeverity(e.severity),
        indicator: e.title,
        rainfallMm: (payload.rainfallMm as number) ?? null,
        temperatureC: (payload.temperatureC as number) ?? null,
        source: (payload.source as string) ?? "weather_api",
        confidence: recentSync.confidence ?? 0.7,
        recordedAt: e.createdAt,
        isStale,
      };
    });
  } catch {
    recordFailure(serviceId);
    return [];
  }
}

export async function getFarmerWeatherAlerts(county?: string): Promise<FarmerWeatherAlert[]> {
  try {
    const db = await getDb();
    if (!db) return [];

    const where: Record<string, unknown> = {
      category: "WEATHER",
      read: false,
    };

    const alerts = await db.alert.findMany({
      where: where as never,
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    return alerts
      .filter((a) => {
        if (!county) return true;
        return a.message.toLowerCase().includes(county.toLowerCase());
      })
      .map((a) => ({
        type: classifyWeatherAlert(a.title),
        severity: mapAlertSeverity(a.severity),
        message: a.message,
        region: extractRegion(a.title),
        validUntil: null,
      }));
  } catch {
    return [];
  }
}

export async function getStorageWeatherRisks(): Promise<{
  warehouseId: string;
  warehouseName: string;
  moistureRisk: boolean;
  humidityPct: number;
  temperatureC: number;
  lastReading: Date | null;
}[]> {
  try {
    const db = await getDb();
    if (!db) return [];

    const warehouses = await db.warehouse.findMany({
      where: { status: { not: "OFFLINE" } },
      include: {
        sensorReadings: {
          orderBy: { recordedAt: "desc" },
          take: 1,
        },
      },
    });

    return warehouses.map((w) => {
      const reading = w.sensorReadings[0];
      return {
        warehouseId: w.code,
        warehouseName: w.name,
        moistureRisk: reading ? reading.humidityPct > 65 : false,
        humidityPct: reading?.humidityPct ?? 0,
        temperatureC: reading?.temperatureC ?? 0,
        lastReading: reading?.recordedAt ?? null,
      };
    });
  } catch {
    return [];
  }
}

function mapSeverity(s: string): WeatherRiskIndicator["riskLevel"] {
  switch (s) {
    case "critical": return "critical";
    case "high": return "high";
    case "medium": case "warning": return "medium";
    default: return "low";
  }
}

function mapAlertSeverity(s: string): FarmerWeatherAlert["severity"] {
  switch (s) {
    case "CRITICAL": case "HIGH": return "critical";
    case "MEDIUM": return "warning";
    default: return "info";
  }
}

function classifyWeatherAlert(title: string): FarmerWeatherAlert["type"] {
  const lower = title.toLowerCase();
  if (lower.includes("rain")) return "rainfall";
  if (lower.includes("dry") || lower.includes("drought")) return "drying";
  if (lower.includes("moisture") || lower.includes("humid")) return "moisture";
  if (lower.includes("harvest") || lower.includes("delay")) return "harvest_delay";
  return "advisory";
}

function extractRegion(title: string): string {
  const regions = ["Trans Nzoia", "Uasin Gishu", "Kitale", "Eldoret", "Moiben", "Turbo", "Endebess"];
  for (const r of regions) {
    if (title.includes(r)) return r;
  }
  return "Regional";
}
