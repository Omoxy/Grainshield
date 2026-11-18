import { canExecute, recordSuccess, recordFailure } from "@/lib/services/resilience";

export interface NasaPowerRecord {
  region: string;
  latitude: number;
  longitude: number;
  date: Date;
  temperatureMaxC: number;
  temperatureMinC: number;
  solarRadiation: number;
  relativeHumidity: number;
  precipitationMm: number;
  source: "nasa_power";
  confidence: number;
}

const SERVICE_ID = "nasa_power";
const STALE_HOURS = 72;

async function getDb() {
  try {
    const { db } = await import("@/lib/db");
    return db;
  } catch {
    return null;
  }
}

export async function fetchNasaPowerData(county?: string): Promise<NasaPowerRecord[]> {
  if (!canExecute(SERVICE_ID)) return [];

  try {
    const db = await getDb();
    if (!db) return [];

    const staleThreshold = new Date(Date.now() - STALE_HOURS * 60 * 60 * 1000);

    const events = await db.operationalEvent.findMany({
      where: {
        category: "weather",
        createdAt: { gte: staleThreshold },
        ...(county ? { title: { contains: county } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 15,
    });

    if (events.length === 0) return [];
    recordSuccess(SERVICE_ID);

    return events.map((e) => {
      let payload: Record<string, unknown> = {};
      try {
        payload = e.payload ? JSON.parse(e.payload) : {};
      } catch { /* ignore */ }

      return {
        region: (payload.region as string) ?? "Unknown",
        latitude: (payload.lat as number) ?? 0,
        longitude: (payload.lon as number) ?? 0,
        date: e.createdAt,
        temperatureMaxC: (payload.tempMax as number) ?? (payload.temperatureC as number) ?? 0,
        temperatureMinC: (payload.tempMin as number) ?? 0,
        solarRadiation: (payload.solarRadiation as number) ?? 0,
        relativeHumidity: (payload.humidity as number) ?? 0,
        precipitationMm: (payload.rainfallMm as number) ?? (payload.precipitationMm as number) ?? 0,
        source: "nasa_power" as const,
        confidence: 0.7,
      };
    });
  } catch {
    recordFailure(SERVICE_ID);
    return [];
  }
}
