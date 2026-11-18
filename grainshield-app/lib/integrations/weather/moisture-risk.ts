export interface MoistureRiskAssessment {
  warehouseCode: string;
  warehouseName: string;
  humidityPct: number;
  temperatureC: number;
  moistureContentPct: number | null;
  riskLevel: "safe" | "elevated" | "high" | "critical";
  factors: string[];
  recommendation: string;
  lastReading: Date | null;
}

const HUMIDITY_SAFE = 55;
const HUMIDITY_ELEVATED = 65;
const HUMIDITY_HIGH = 75;
const TEMP_HIGH = 32;
const MOISTURE_CONTENT_MAX = 13.5;

async function getDb() {
  try {
    const { db } = await import("@/lib/db");
    return db;
  } catch {
    return null;
  }
}

export async function assessStorageMoistureRisks(): Promise<MoistureRiskAssessment[]> {
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
        receipts: {
          where: { deletedAt: null },
          select: { moisturePct: true },
          take: 5,
        },
      },
    });

    return warehouses.map((w) => {
      const reading = w.sensorReadings[0];
      const humidity = reading?.humidityPct ?? 0;
      const temperature = reading?.temperatureC ?? 0;
      const grainMoisture = w.receipts
        .map((r) => r.moisturePct)
        .filter((m): m is number => m != null);
      const avgMoisture = grainMoisture.length > 0
        ? grainMoisture.reduce((s, m) => s + m, 0) / grainMoisture.length
        : null;

      const factors: string[] = [];
      let riskLevel: MoistureRiskAssessment["riskLevel"] = "safe";

      if (humidity >= HUMIDITY_HIGH) {
        factors.push("Humidity above safe storage threshold");
        riskLevel = "high";
      } else if (humidity >= HUMIDITY_ELEVATED) {
        factors.push("Humidity elevated — monitor closely");
        riskLevel = riskLevel === "safe" ? "elevated" : riskLevel;
      }

      if (temperature >= TEMP_HIGH) {
        factors.push("Temperature elevated — accelerates spoilage risk");
        if (riskLevel === "safe") riskLevel = "elevated";
        if (riskLevel === "elevated" && humidity >= HUMIDITY_ELEVATED) riskLevel = "high";
      }

      if (avgMoisture !== null && avgMoisture > MOISTURE_CONTENT_MAX) {
        factors.push(`Grain moisture content ${avgMoisture.toFixed(1)}% exceeds ${MOISTURE_CONTENT_MAX}% threshold`);
        riskLevel = riskLevel === "high" ? "critical" : "high";
      }

      if (!reading) {
        factors.push("No recent sensor readings — conditions unknown");
        riskLevel = riskLevel === "safe" ? "elevated" : riskLevel;
      }

      return {
        warehouseCode: w.code,
        warehouseName: w.name,
        humidityPct: humidity,
        temperatureC: temperature,
        moistureContentPct: avgMoisture,
        riskLevel,
        factors,
        recommendation: buildRecommendation(riskLevel, factors),
        lastReading: reading?.recordedAt ?? null,
      };
    });
  } catch {
    return [];
  }
}

function buildRecommendation(
  level: MoistureRiskAssessment["riskLevel"],
  factors: string[]
): string {
  switch (level) {
    case "critical":
      return "Immediate inspection required. Grain may be at risk of spoilage or aflatoxin contamination.";
    case "high":
      return "Schedule inspection within 24 hours. Consider aeration or transfer if conditions persist.";
    case "elevated":
      return "Monitor conditions. Check ventilation and ensure no leaks or condensation.";
    case "safe":
      return "Storage conditions within normal parameters.";
  }
}
