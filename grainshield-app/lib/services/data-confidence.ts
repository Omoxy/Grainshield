/**
 * GrainShield Live Data Confidence Engine
 *
 * Scores trustworthiness of external data sources.
 * Tracks freshness, reliability, sync failures, anomaly frequency, missing intervals.
 * Enables graceful degradation and uncertainty surfacing.
 */

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

export type DataSourceType = "weather" | "warehouse_sensor" | "market_price" | "satellite" | "iot";

export interface DataSourceHealth {
  sourceId: string;
  sourceName: string;
  sourceType: DataSourceType;
  confidenceScore: number; // 0-1
  confidenceLabel: "high" | "medium" | "low" | "degraded" | "offline";
  freshnessMs: number;
  freshnessLabel: string;
  lastSuccessfulSync: Date | null;
  lastAttemptedSync: Date | null;
  consecutiveFailures: number;
  totalSyncsLast24h: number;
  failedSyncsLast24h: number;
  successRate24h: number;
  anomalyCount7d: number;
  missingIntervals: number;
  avgLatencyMs: number;
  status: "operational" | "degraded" | "stale" | "offline" | "unknown";
  degradationReason?: string;
}

export interface ConfidenceAssessment {
  overallConfidence: number;
  overallLabel: string;
  sources: DataSourceHealth[];
  degradedSources: DataSourceHealth[];
  offlineSources: DataSourceHealth[];
  recommendations: string[];
  assessedAt: Date;
}

// ─────────────────────────────────────────────
// SOURCE REGISTRY
// ─────────────────────────────────────────────

interface SourceConfig {
  id: string;
  name: string;
  type: DataSourceType;
  expectedIntervalMs: number; // How often we expect data
  staleThresholdMs: number; // When data becomes stale
  criticalThresholdMs: number; // When data is unreliable
  maxConsecutiveFailures: number;
}

const SOURCE_CONFIGS: SourceConfig[] = [
  {
    id: "chirps",
    name: "CHIRPS Rainfall",
    type: "weather",
    expectedIntervalMs: 6 * 60 * 60 * 1000, // 6h
    staleThresholdMs: 12 * 60 * 60 * 1000, // 12h
    criticalThresholdMs: 48 * 60 * 60 * 1000, // 48h
    maxConsecutiveFailures: 5,
  },
  {
    id: "nasa_power",
    name: "NASA POWER",
    type: "weather",
    expectedIntervalMs: 24 * 60 * 60 * 1000, // 24h
    staleThresholdMs: 48 * 60 * 60 * 1000,
    criticalThresholdMs: 96 * 60 * 60 * 1000,
    maxConsecutiveFailures: 3,
  },
  {
    id: "ecmwf",
    name: "ECMWF Forecast",
    type: "weather",
    expectedIntervalMs: 12 * 60 * 60 * 1000,
    staleThresholdMs: 24 * 60 * 60 * 1000,
    criticalThresholdMs: 72 * 60 * 60 * 1000,
    maxConsecutiveFailures: 4,
  },
  {
    id: "warehouse_iot",
    name: "Warehouse IoT Sensors",
    type: "warehouse_sensor",
    expectedIntervalMs: 15 * 60 * 1000, // 15min
    staleThresholdMs: 60 * 60 * 1000, // 1h
    criticalThresholdMs: 4 * 60 * 60 * 1000, // 4h
    maxConsecutiveFailures: 10,
  },
  {
    id: "ncpb",
    name: "NCPB Official Prices",
    type: "market_price",
    expectedIntervalMs: 24 * 60 * 60 * 1000,
    staleThresholdMs: 48 * 60 * 60 * 1000,
    criticalThresholdMs: 7 * 24 * 60 * 60 * 1000,
    maxConsecutiveFailures: 5,
  },
  {
    id: "regional_markets",
    name: "Regional Market Feeds",
    type: "market_price",
    expectedIntervalMs: 12 * 60 * 60 * 1000,
    staleThresholdMs: 24 * 60 * 60 * 1000,
    criticalThresholdMs: 72 * 60 * 60 * 1000,
    maxConsecutiveFailures: 5,
  },
  {
    id: "sentinel2",
    name: "Sentinel-2 NDVI",
    type: "satellite",
    expectedIntervalMs: 5 * 24 * 60 * 60 * 1000, // 5 days
    staleThresholdMs: 10 * 24 * 60 * 60 * 1000,
    criticalThresholdMs: 20 * 24 * 60 * 60 * 1000,
    maxConsecutiveFailures: 3,
  },
];

// ─────────────────────────────────────────────
// SYNC STATE TRACKING (in-memory for now, would be DB-backed in production)
// ─────────────────────────────────────────────

interface SyncRecord {
  sourceId: string;
  status: "success" | "partial" | "failed";
  timestamp: Date;
  latencyMs: number;
  recordCount: number;
  confidence: number;
  errorDetail?: string;
}

const syncHistory: SyncRecord[] = [];

export function recordSync(record: SyncRecord): void {
  syncHistory.push(record);
  // Keep last 500 per source
  const sourceRecords = syncHistory.filter((r) => r.sourceId === record.sourceId);
  if (sourceRecords.length > 500) {
    const oldest = sourceRecords[0];
    const idx = syncHistory.indexOf(oldest);
    if (idx >= 0) syncHistory.splice(idx, 1);
  }
}

// ─────────────────────────────────────────────
// CONFIDENCE SCORING
// ─────────────────────────────────────────────

function computeSourceHealth(config: SourceConfig): DataSourceHealth {
  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

  const sourceRecords = syncHistory.filter((r) => r.sourceId === config.id);
  const last24h = sourceRecords.filter((r) => r.timestamp.getTime() > dayAgo);
  const last7d = sourceRecords.filter((r) => r.timestamp.getTime() > weekAgo);

  const lastSuccess = sourceRecords
    .filter((r) => r.status === "success")
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())[0];

  const lastAttempt = sourceRecords
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())[0];

  // Consecutive failures
  let consecutiveFailures = 0;
  for (let i = sourceRecords.length - 1; i >= 0; i--) {
    if (sourceRecords[i].status !== "success") consecutiveFailures++;
    else break;
  }

  // Freshness
  const freshnessMs = lastSuccess ? now - lastSuccess.timestamp.getTime() : Infinity;

  // Success rate
  const totalSyncs24h = last24h.length;
  const failedSyncs24h = last24h.filter((r) => r.status === "failed").length;
  const successRate24h = totalSyncs24h > 0 ? (totalSyncs24h - failedSyncs24h) / totalSyncs24h : 0;

  // Anomaly count (records with confidence < 0.5)
  const anomalyCount7d = last7d.filter((r) => r.confidence < 0.5).length;

  // Missing intervals
  const expectedSyncs = Math.floor((24 * 60 * 60 * 1000) / config.expectedIntervalMs);
  const missingIntervals = Math.max(0, expectedSyncs - totalSyncs24h);

  // Average latency
  const successfulRecords = last24h.filter((r) => r.status === "success");
  const avgLatencyMs = successfulRecords.length > 0
    ? successfulRecords.reduce((sum, r) => sum + r.latencyMs, 0) / successfulRecords.length
    : 0;

  // Compute confidence score (0-1)
  let confidence = 1.0;

  // Freshness penalty
  if (freshnessMs > config.criticalThresholdMs) {
    confidence *= 0.1;
  } else if (freshnessMs > config.staleThresholdMs) {
    confidence *= 0.5;
  } else if (freshnessMs > config.expectedIntervalMs * 2) {
    confidence *= 0.8;
  }

  // Failure penalty
  if (consecutiveFailures >= config.maxConsecutiveFailures) {
    confidence *= 0.1;
  } else if (consecutiveFailures > 0) {
    confidence *= 1 - (consecutiveFailures / config.maxConsecutiveFailures) * 0.5;
  }

  // Success rate penalty
  if (successRate24h < 0.5) {
    confidence *= 0.3;
  } else if (successRate24h < 0.8) {
    confidence *= 0.7;
  }

  // Anomaly penalty
  if (anomalyCount7d > 5) {
    confidence *= 0.7;
  }

  // Missing interval penalty
  if (missingIntervals > expectedSyncs * 0.5) {
    confidence *= 0.5;
  }

  confidence = Math.max(0, Math.min(1, confidence));

  // Determine status and label
  let status: DataSourceHealth["status"];
  let confidenceLabel: DataSourceHealth["confidenceLabel"];
  let degradationReason: string | undefined;

  if (confidence >= 0.8) {
    status = "operational";
    confidenceLabel = "high";
  } else if (confidence >= 0.5) {
    status = "degraded";
    confidenceLabel = "medium";
    degradationReason = buildDegradationReason(freshnessMs, consecutiveFailures, successRate24h, config);
  } else if (confidence >= 0.2) {
    status = "stale";
    confidenceLabel = "low";
    degradationReason = buildDegradationReason(freshnessMs, consecutiveFailures, successRate24h, config);
  } else if (sourceRecords.length === 0) {
    status = "unknown";
    confidenceLabel = "offline";
    degradationReason = "No sync data available";
  } else {
    status = "offline";
    confidenceLabel = "offline";
    degradationReason = buildDegradationReason(freshnessMs, consecutiveFailures, successRate24h, config);
  }

  // Freshness label
  let freshnessLabel: string;
  if (freshnessMs === Infinity) {
    freshnessLabel = "No data";
  } else if (freshnessMs < 60 * 1000) {
    freshnessLabel = "Just now";
  } else if (freshnessMs < 60 * 60 * 1000) {
    freshnessLabel = `${Math.round(freshnessMs / (60 * 1000))}m ago`;
  } else if (freshnessMs < 24 * 60 * 60 * 1000) {
    freshnessLabel = `${Math.round(freshnessMs / (60 * 60 * 1000))}h ago`;
  } else {
    freshnessLabel = `${Math.round(freshnessMs / (24 * 60 * 60 * 1000))}d ago`;
  }

  return {
    sourceId: config.id,
    sourceName: config.name,
    sourceType: config.type,
    confidenceScore: Math.round(confidence * 100) / 100,
    confidenceLabel,
    freshnessMs,
    freshnessLabel,
    lastSuccessfulSync: lastSuccess?.timestamp ?? null,
    lastAttemptedSync: lastAttempt?.timestamp ?? null,
    consecutiveFailures,
    totalSyncsLast24h: totalSyncs24h,
    failedSyncsLast24h: failedSyncs24h,
    successRate24h: Math.round(successRate24h * 100) / 100,
    anomalyCount7d,
    missingIntervals,
    avgLatencyMs: Math.round(avgLatencyMs),
    status,
    degradationReason,
  };
}

function buildDegradationReason(
  freshnessMs: number,
  consecutiveFailures: number,
  successRate: number,
  config: SourceConfig,
): string {
  const reasons: string[] = [];
  if (freshnessMs > config.criticalThresholdMs) reasons.push("Data critically stale");
  else if (freshnessMs > config.staleThresholdMs) reasons.push("Data stale");
  if (consecutiveFailures >= config.maxConsecutiveFailures) reasons.push("Max failures reached");
  else if (consecutiveFailures > 2) reasons.push(`${consecutiveFailures} consecutive failures`);
  if (successRate < 0.5) reasons.push("Success rate below 50%");
  return reasons.join("; ") || "Multiple degradation factors";
}

// ─────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────

export function assessConfidence(): ConfidenceAssessment {
  const sources = SOURCE_CONFIGS.map(computeSourceHealth);
  const degraded = sources.filter((s) => s.status === "degraded" || s.status === "stale");
  const offline = sources.filter((s) => s.status === "offline" || s.status === "unknown");

  const operational = sources.filter((s) => s.status === "operational");
  const overallConfidence = sources.length > 0
    ? sources.reduce((sum, s) => sum + s.confidenceScore, 0) / sources.length
    : 0;

  const recommendations: string[] = [];
  if (offline.length > 0) {
    recommendations.push(`${offline.length} data source(s) offline — investigate connectivity`);
  }
  if (degraded.length > 0) {
    recommendations.push(`${degraded.length} source(s) degraded — review sync schedules`);
  }
  if (sources.some((s) => s.anomalyCount7d > 3)) {
    recommendations.push("Anomaly frequency elevated — review data quality");
  }
  if (operational.length === sources.length) {
    recommendations.push("All sources operational — confidence level normal");
  }

  let overallLabel: string;
  if (overallConfidence >= 0.8) overallLabel = "High — all systems reliable";
  else if (overallConfidence >= 0.5) overallLabel = "Medium — some degradation detected";
  else if (overallConfidence >= 0.2) overallLabel = "Low — significant data quality issues";
  else overallLabel = "Critical — major data sources unavailable";

  return {
    overallConfidence: Math.round(overallConfidence * 100) / 100,
    overallLabel,
    sources,
    degradedSources: degraded,
    offlineSources: offline,
    recommendations,
    assessedAt: new Date(),
  };
}

export function getSourceHealth(sourceId: string): DataSourceHealth | null {
  const config = SOURCE_CONFIGS.find((c) => c.id === sourceId);
  if (!config) return null;
  return computeSourceHealth(config);
}

export function getSourceConfigs(): SourceConfig[] {
  return [...SOURCE_CONFIGS];
}
