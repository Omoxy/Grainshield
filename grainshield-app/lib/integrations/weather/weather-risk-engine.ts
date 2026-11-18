import { detectRainfallAnomalies } from "./rainfall-anomaly";
import { assessStorageMoistureRisks } from "./moisture-risk";
import { fetchCropStressIndicators } from "./gee-adapter";
import { getRegionalWeatherRisks, getFarmerWeatherAlerts } from "./weather-risk-service";
import { buildRegionalRiskSummary, generateFarmerAlerts, type RegionalRiskSummary } from "./risk-normalizer";
import type { FarmerWeatherAlert } from "./weather-risk-service";

export interface ComprehensiveRiskAssessment {
  regions: RegionalRiskSummary[];
  farmerAlerts: FarmerWeatherAlert[];
  overallStatus: "normal" | "elevated" | "warning" | "critical";
  summaryText: string;
  lastUpdated: Date;
  sourceCount: number;
}

export async function getComprehensiveRiskAssessment(
  county?: string
): Promise<ComprehensiveRiskAssessment> {
  const [rainfallAnomalies, moistureRisks, cropStress, weatherIndicators, existingAlerts] =
    await Promise.allSettled([
      detectRainfallAnomalies(county),
      assessStorageMoistureRisks(),
      fetchCropStressIndicators(county),
      getRegionalWeatherRisks(),
      getFarmerWeatherAlerts(county),
    ]);

  const rainfall = rainfallAnomalies.status === "fulfilled" ? rainfallAnomalies.value : [];
  const moisture = moistureRisks.status === "fulfilled" ? moistureRisks.value : [];
  const stress = cropStress.status === "fulfilled" ? cropStress.value : [];
  const weather = weatherIndicators.status === "fulfilled" ? weatherIndicators.value : [];
  const alerts = existingAlerts.status === "fulfilled" ? existingAlerts.value : [];

  const regions = buildRegionalRiskSummary(rainfall, moisture, weather);
  const generatedAlerts = generateFarmerAlerts(rainfall, moisture, county);

  const allAlerts = deduplicateAlerts([...alerts, ...generatedAlerts]);

  let sourceCount = 0;
  if (rainfall.length > 0) sourceCount++;
  if (moisture.length > 0) sourceCount++;
  if (stress.length > 0) sourceCount++;
  if (weather.length > 0) sourceCount++;

  const overallStatus = deriveOverallStatus(regions);

  return {
    regions,
    farmerAlerts: allAlerts,
    overallStatus,
    summaryText: buildSummaryText(overallStatus, regions, rainfall.length, moisture.length),
    lastUpdated: new Date(),
    sourceCount,
  };
}

export async function getFarmerRiskSummary(county?: string): Promise<{
  alerts: FarmerWeatherAlert[];
  status: string;
  riskLevel: "low" | "medium" | "high" | "critical";
}> {
  const assessment = await getComprehensiveRiskAssessment(county);

  const riskLevel: "low" | "medium" | "high" | "critical" =
    assessment.overallStatus === "critical" ? "critical" :
    assessment.overallStatus === "warning" ? "high" :
    assessment.overallStatus === "elevated" ? "medium" : "low";

  return {
    alerts: assessment.farmerAlerts.slice(0, 5),
    status: assessment.summaryText,
    riskLevel,
  };
}

function deriveOverallStatus(
  regions: RegionalRiskSummary[]
): ComprehensiveRiskAssessment["overallStatus"] {
  if (regions.some((r) => r.overallRisk === "critical")) return "critical";
  if (regions.some((r) => r.overallRisk === "high")) return "warning";
  if (regions.some((r) => r.overallRisk === "medium")) return "elevated";
  return "normal";
}

function buildSummaryText(
  status: ComprehensiveRiskAssessment["overallStatus"],
  regions: RegionalRiskSummary[],
  rainfallCount: number,
  storageCount: number
): string {
  if (regions.length === 0) {
    return "Risk assessment data is currently unavailable. Monitoring feeds are being refreshed.";
  }

  switch (status) {
    case "critical":
      return "Critical conditions detected in one or more regions. Review alerts and take action on flagged warehouses.";
    case "warning":
      return "Elevated risk conditions across monitored regions. Storage and weather factors require attention.";
    case "elevated":
      return "Some conditions are outside normal parameters. Continue monitoring — no immediate action required.";
    case "normal":
      return "All monitored regions are within normal parameters. Storage conditions are stable.";
  }
}

function deduplicateAlerts(alerts: FarmerWeatherAlert[]): FarmerWeatherAlert[] {
  const seen = new Set<string>();
  return alerts.filter((a) => {
    const key = `${a.type}_${a.region}_${a.severity}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
