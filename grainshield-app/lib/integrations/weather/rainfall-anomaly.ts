import { fetchChirpsRainfall, type ChirpsRainfallRecord } from "./chirps-adapter";

export interface RainfallAnomaly {
  region: string;
  anomalyPct: number;
  severity: "normal" | "watch" | "warning" | "critical";
  description: string;
  rainfallMm: number;
  expectedMm: number;
  type: "deficit" | "excess" | "normal";
  confidence: number;
}

const WATCH_THRESHOLD = 15;
const WARNING_THRESHOLD = 30;
const CRITICAL_THRESHOLD = 50;

export async function detectRainfallAnomalies(county?: string): Promise<RainfallAnomaly[]> {
  const records = await fetchChirpsRainfall(county);
  if (records.length === 0) return [];

  return records
    .filter((r) => r.longTermAvgMm > 0)
    .map(classifyAnomaly)
    .sort((a, b) => Math.abs(b.anomalyPct) - Math.abs(a.anomalyPct));
}

function classifyAnomaly(record: ChirpsRainfallRecord): RainfallAnomaly {
  const pct = record.anomalyPct;
  const absPct = Math.abs(pct);

  let severity: RainfallAnomaly["severity"] = "normal";
  if (absPct >= CRITICAL_THRESHOLD) severity = "critical";
  else if (absPct >= WARNING_THRESHOLD) severity = "warning";
  else if (absPct >= WATCH_THRESHOLD) severity = "watch";

  const type: RainfallAnomaly["type"] =
    pct < -WATCH_THRESHOLD ? "deficit" : pct > WATCH_THRESHOLD ? "excess" : "normal";

  return {
    region: record.region,
    anomalyPct: record.anomalyPct,
    severity,
    description: buildDescription(record.region, type, severity, record),
    rainfallMm: record.rainfallMm,
    expectedMm: record.longTermAvgMm,
    type,
    confidence: record.confidence,
  };
}

function buildDescription(
  region: string,
  type: RainfallAnomaly["type"],
  severity: RainfallAnomaly["severity"],
  record: ChirpsRainfallRecord
): string {
  if (type === "normal") {
    return `Rainfall in ${region} is within normal range.`;
  }

  const direction = type === "deficit" ? "below" : "above";
  const impact =
    type === "deficit"
      ? "Drought stress risk for standing crops."
      : "Waterlogging and flood risk for low-lying fields.";

  if (severity === "critical") {
    return `${region}: Rainfall ${Math.abs(record.anomalyPct).toFixed(0)}% ${direction} long-term average. ${impact} Immediate attention required.`;
  }

  if (severity === "warning") {
    return `${region}: Rainfall trending ${Math.abs(record.anomalyPct).toFixed(0)}% ${direction} average. ${impact}`;
  }

  return `${region}: Rainfall ${Math.abs(record.anomalyPct).toFixed(0)}% ${direction} average. Monitor conditions.`;
}
