import { canExecute, recordSuccess, recordFailure } from "@/lib/services/resilience";

export interface CropStressIndicator {
  region: string;
  latitude: number;
  longitude: number;
  ndviCurrent: number;
  ndviBaseline: number;
  ndviDeviation: number;
  stressLevel: "healthy" | "mild" | "moderate" | "severe";
  date: Date;
  source: "gee";
  confidence: number;
}

const SERVICE_ID = "gee_ndvi";
const NDVI_MILD_THRESHOLD = -0.1;
const NDVI_MODERATE_THRESHOLD = -0.2;
const NDVI_SEVERE_THRESHOLD = -0.35;

async function getDb() {
  try {
    const { db } = await import("@/lib/db");
    return db;
  } catch {
    return null;
  }
}

export async function fetchCropStressIndicators(county?: string): Promise<CropStressIndicator[]> {
  if (!canExecute(SERVICE_ID)) return [];

  try {
    const db = await getDb();
    if (!db) return [];

    const events = await db.operationalEvent.findMany({
      where: {
        category: { in: ["ndvi", "crop_stress", "vegetation"] },
        ...(county ? { title: { contains: county } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    if (events.length === 0) return [];
    recordSuccess(SERVICE_ID);

    return events.map((e) => {
      let payload: Record<string, unknown> = {};
      try {
        payload = e.payload ? JSON.parse(e.payload) : {};
      } catch { /* ignore */ }

      const current = (payload.ndviCurrent as number) ?? (payload.ndvi as number) ?? 0;
      const baseline = (payload.ndviBaseline as number) ?? (payload.ndviAvg as number) ?? current;
      const deviation = baseline > 0 ? (current - baseline) / baseline : 0;

      return {
        region: (payload.region as string) ?? "Unknown",
        latitude: (payload.lat as number) ?? 0,
        longitude: (payload.lon as number) ?? 0,
        ndviCurrent: current,
        ndviBaseline: baseline,
        ndviDeviation: Math.round(deviation * 1000) / 1000,
        stressLevel: classifyStress(deviation),
        date: e.createdAt,
        source: "gee" as const,
        confidence: 0.7,
      };
    });
  } catch {
    recordFailure(SERVICE_ID);
    return [];
  }
}

function classifyStress(deviation: number): CropStressIndicator["stressLevel"] {
  if (deviation <= NDVI_SEVERE_THRESHOLD) return "severe";
  if (deviation <= NDVI_MODERATE_THRESHOLD) return "moderate";
  if (deviation <= NDVI_MILD_THRESHOLD) return "mild";
  return "healthy";
}
