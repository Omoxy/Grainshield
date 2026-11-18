import type { RainfallAnomaly } from "./rainfall-anomaly";
import type { MoistureRiskAssessment } from "./moisture-risk";
import type { WeatherRiskIndicator, FarmerWeatherAlert } from "./weather-risk-service";

export interface RegionalRiskSummary {
  region: string;
  overallRisk: "low" | "medium" | "high" | "critical";
  rainfallStatus: string;
  storageStatus: string;
  activeAlerts: number;
  factors: string[];
}

export function buildRegionalRiskSummary(
  rainfallAnomalies: RainfallAnomaly[],
  moistureAssessments: MoistureRiskAssessment[],
  weatherIndicators: WeatherRiskIndicator[]
): RegionalRiskSummary[] {
  const regions = new Set<string>();

  for (const a of rainfallAnomalies) regions.add(a.region);
  for (const w of weatherIndicators) regions.add(w.region);

  const warehouseRegions = new Map<string, MoistureRiskAssessment[]>();
  for (const m of moistureAssessments) {
    const region = extractCounty(m.warehouseName);
    const existing = warehouseRegions.get(region) ?? [];
    existing.push(m);
    warehouseRegions.set(region, existing);
    regions.add(region);
  }

  const summaries: RegionalRiskSummary[] = [];

  for (const region of regions) {
    const regionAnomalies = rainfallAnomalies.filter((a) => a.region === region);
    const regionWeather = weatherIndicators.filter((w) => w.region === region);
    const regionStorage = warehouseRegions.get(region) ?? [];

    const factors: string[] = [];
    let riskScore = 0;

    for (const a of regionAnomalies) {
      if (a.severity === "critical") { riskScore += 4; factors.push(a.description); }
      else if (a.severity === "warning") { riskScore += 2; factors.push(a.description); }
      else if (a.severity === "watch") { riskScore += 1; }
    }

    for (const w of regionWeather) {
      if (w.riskLevel === "critical") { riskScore += 3; factors.push(w.indicator); }
      else if (w.riskLevel === "high") { riskScore += 2; factors.push(w.indicator); }
      else if (w.riskLevel === "medium") { riskScore += 1; }
    }

    for (const s of regionStorage) {
      if (s.riskLevel === "critical") { riskScore += 3; factors.push(...s.factors); }
      else if (s.riskLevel === "high") { riskScore += 2; factors.push(...s.factors); }
      else if (s.riskLevel === "elevated") { riskScore += 1; }
    }

    const overallRisk: RegionalRiskSummary["overallRisk"] =
      riskScore >= 6 ? "critical" :
      riskScore >= 3 ? "high" :
      riskScore >= 1 ? "medium" : "low";

    const rainfallStatus = regionAnomalies.length > 0
      ? summarizeRainfall(regionAnomalies)
      : "No anomalies detected";

    const storageStatus = regionStorage.length > 0
      ? summarizeStorage(regionStorage)
      : "No warehouse data";

    summaries.push({
      region,
      overallRisk,
      rainfallStatus,
      storageStatus,
      activeAlerts: regionWeather.length,
      factors: factors.slice(0, 5),
    });
  }

  const riskOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  return summaries.sort((a, b) => riskOrder[a.overallRisk] - riskOrder[b.overallRisk]);
}

export function generateFarmerAlerts(
  rainfallAnomalies: RainfallAnomaly[],
  moistureAssessments: MoistureRiskAssessment[],
  county?: string
): FarmerWeatherAlert[] {
  const alerts: FarmerWeatherAlert[] = [];

  const filteredRainfall = county
    ? rainfallAnomalies.filter((a) => a.region.toLowerCase().includes(county.toLowerCase()))
    : rainfallAnomalies;

  for (const anomaly of filteredRainfall) {
    if (anomaly.severity === "normal") continue;

    alerts.push({
      type: anomaly.type === "deficit" ? "drying" : "rainfall",
      severity: anomaly.severity === "critical" ? "critical" : "warning",
      message: anomaly.description,
      region: anomaly.region,
      validUntil: null,
    });
  }

  for (const assessment of moistureAssessments) {
    if (assessment.riskLevel === "safe") continue;

    alerts.push({
      type: "moisture",
      severity: assessment.riskLevel === "critical" ? "critical" : "warning",
      message: `${assessment.warehouseName}: ${assessment.recommendation}`,
      region: extractCounty(assessment.warehouseName),
      validUntil: null,
    });
  }

  return alerts;
}

function summarizeRainfall(anomalies: RainfallAnomaly[]): string {
  const worst = anomalies[0];
  if (!worst) return "Normal conditions";
  if (worst.type === "deficit") return `Rainfall deficit: ${Math.abs(worst.anomalyPct).toFixed(0)}% below average`;
  if (worst.type === "excess") return `Excess rainfall: ${worst.anomalyPct.toFixed(0)}% above average`;
  return "Within normal range";
}

function summarizeStorage(assessments: MoistureRiskAssessment[]): string {
  const atRisk = assessments.filter((a) => a.riskLevel === "high" || a.riskLevel === "critical");
  if (atRisk.length === 0) return "All warehouses within safe parameters";
  return `${atRisk.length} of ${assessments.length} warehouses with elevated conditions`;
}

function extractCounty(name: string): string {
  if (/eldoret|moiben|turbo|ziwa|soy|kabiyet|moi.?s bridge/i.test(name)) return "Uasin Gishu";
  if (/kitale|endebess|cherangany|saboti/i.test(name)) return "Trans Nzoia";
  return "Regional";
}
