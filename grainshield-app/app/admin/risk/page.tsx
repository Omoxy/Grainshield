"use client";

import { useState } from "react";
import {
  MapPin,
  AlertTriangle,
  Activity,
  Database,
  Zap,
  ChevronDown,
  ChevronUp,
  Radio,
  AlertCircle,
} from "lucide-react";
import useSWR from "swr";

const fetcher = (url: string) =>
  fetch(url, { credentials: "include" }).then((r) => {
    if (!r.ok) throw new Error("Failed to fetch");
    return r.json();
  });

interface RiskAlert {
  region: string;
  riskLevel: string;
  indicator: string;
  confidence: number;
  recordedAt: string;
}

interface RegionalRisk {
  region: string;
  farmers: number;
  riskScore: number;
  level: "high" | "medium" | "low";
}

interface DataSourceHealth {
  sourceId: string;
  sourceName: string;
  confidenceScore: number;
  freshnessLabel: string;
  failedSyncsLast24h: number;
  successRate24h: number;
  status: "operational" | "degraded" | "stale" | "offline" | "unknown";
}

const SEVERITY_STYLES: Record<string, { bg: string; border: string; text: string; dot: string; badge: string }> = {
  critical: { bg: "bg-red-50", border: "border-l-risk-critical", text: "text-risk-critical", dot: "bg-risk-critical animate-pulse-subtle", badge: "bg-red-50 text-risk-critical" },
  high: { bg: "bg-orange-50", border: "border-l-risk-high", text: "text-risk-high", dot: "bg-risk-high", badge: "bg-orange-50 text-risk-high" },
  medium: { bg: "bg-yellow-50", border: "border-l-risk-medium", text: "text-risk-medium", dot: "bg-risk-medium", badge: "bg-yellow-50 text-risk-medium" },
  low: { bg: "bg-blue-50", border: "border-l-risk-low", text: "text-risk-low", dot: "bg-risk-low", badge: "bg-blue-50 text-risk-low" },
  info: { bg: "bg-surface-secondary", border: "border-l-border-strong", text: "text-ink-tertiary", dot: "bg-ink-faint", badge: "bg-surface-secondary text-ink-tertiary" },
};

const SOURCE_STATUS_STYLES: Record<string, string> = {
  operational: "bg-status-success-surface text-status-success",
  degraded: "bg-status-warning-surface text-status-warning",
  stale: "bg-orange-50 text-risk-high",
  offline: "bg-status-danger-surface text-status-danger",
  unknown: "bg-surface-sunken text-ink-tertiary",
};

const RISK_LEVEL_STYLES: Record<string, { badge: string; bar: string }> = {
  high: { badge: "bg-red-50 text-risk-critical", bar: "bg-risk-critical" },
  medium: { badge: "bg-yellow-50 text-risk-medium", bar: "bg-risk-medium" },
  low: { badge: "bg-status-success-surface text-status-success", bar: "bg-status-success" },
};

export default function RiskOperationsPage() {
  const [expandedAlert, setExpandedAlert] = useState<number | null>(null);
  const [alertFilter, setAlertFilter] = useState<string>("all");

  const { data: riskData } = useSWR("/api/risk", fetcher, { revalidateOnFocus: false });
  const { data: healthData } = useSWR("/api/health", fetcher, { revalidateOnFocus: false });

  const exposure = riskData?.exposure;
  const weatherRisks: RiskAlert[] = riskData?.weatherRisks ?? [];
  const regionalRisk: RegionalRisk[] = riskData?.regionalRisk ?? [];
  const dataAvailable = riskData?.dataAvailable !== false;

  const dataSources: DataSourceHealth[] = healthData?.dataConfidence?.sources ?? [];
  const overallConfidence = healthData?.dataConfidence?.overallConfidence ?? 0;
  const platform = healthData?.platform;
  const overallHealth = platform?.overall ?? "operational";

  const filteredAlerts = alertFilter === "all"
    ? weatherRisks
    : weatherRisks.filter((a) => {
        const indicator = a.indicator.toLowerCase();
        if (alertFilter === "weather") return indicator.includes("rain") || indicator.includes("drought") || indicator.includes("weather") || indicator.includes("temperature");
        if (alertFilter === "warehouse") return indicator.includes("warehouse") || indicator.includes("sensor") || indicator.includes("humidity") || indicator.includes("offline");
        if (alertFilter === "price") return indicator.includes("price") || indicator.includes("market");
        return true;
      });

  const criticalCount = weatherRisks.filter((a) => a.riskLevel === "critical").length;
  const highCount = weatherRisks.filter((a) => a.riskLevel === "high").length;

  return (
    <div className="max-w-7xl">
      <div className="mb-5 flex items-start justify-between">
        <div>
          <h1 className="page-title">Risk Operations</h1>
          <p className="page-subtitle">Active risk alerts, regional exposure, and data source status</p>
        </div>
        <div className={`flex items-center gap-2 px-2.5 py-1.5 border ${
          overallHealth === "operational"
            ? "bg-status-success-surface border-green-200"
            : overallHealth === "degraded"
              ? "bg-status-warning-surface border-yellow-200"
              : "bg-status-danger-surface border-red-200"
        }`}>
          <Radio style={{ width: 12, height: 12 }} className={`animate-pulse-subtle ${
            overallHealth === "operational" ? "text-status-success"
              : overallHealth === "degraded" ? "text-status-warning"
              : "text-status-danger"
          }`} />
          <span className={`text-2xs font-medium capitalize ${
            overallHealth === "operational" ? "text-status-success"
              : overallHealth === "degraded" ? "text-status-warning"
              : "text-status-danger"
          }`}>
            {String(overallHealth).replace("_", " ")}
          </span>
        </div>
      </div>

      {!dataAvailable && (
        <div className="card p-4 mb-4">
          <p className="text-sm text-ink-secondary mb-1">Risk data is not yet available for this period.</p>
          <p className="text-2xs text-ink-tertiary">
            Risk alerts populate as weather stations, satellite imagery, warehouse sensors, and market feeds are ingested and scored.
          </p>
        </div>
      )}

      {/* Exposure strip */}
      {exposure && (
        <div className="card mb-4 overflow-hidden">
          <div className="card-section-header">
            <div className="flex items-center gap-2">
              <Activity style={{ width: 14, height: 14 }} className="text-ink-muted" />
              <span className="label-caps !mb-0 !mt-0 !pb-0 !border-0">Portfolio Exposure</span>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 divide-x divide-border-subtle">
            <ExposureCell label="Total Grain" value={`${(exposure.totalGrainKg / 1000).toFixed(0)}t`} />
            <ExposureCell label="Total Value" value={`KSh ${(exposure.totalValueKsh / 1e6).toFixed(1)}M`} />
            <ExposureCell label="Loan Exposure" value={`KSh ${(exposure.totalLoansKsh / 1e6).toFixed(1)}M`} />
            <ExposureCell label="Claims Pending" value={`KSh ${((exposure.pendingClaimsKsh ?? 0) / 1e6).toFixed(2)}M`} />
            <ExposureCell label="Portfolio LTV" value={`${exposure.ltvPercent ?? 0}%`} />
            <ExposureCell label="Pending Claims" value={String(exposure.pendingClaimsCount ?? 0)} alert />
            <ExposureCell label="Active Farmers" value={String(exposure.activeFarmers ?? 0)} />
          </div>
        </div>
      )}

      {/* Alerts + Regional Risk */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <div className="lg:col-span-2">
          <div className="card overflow-hidden">
            <div className="card-section-header">
              <div className="flex items-center gap-2">
                <AlertTriangle style={{ width: 14, height: 14 }} className="text-ink-muted" />
                <span className="label-caps !mb-0 !mt-0 !pb-0 !border-0">Active Risk Alerts</span>
                {criticalCount > 0 && <span className="badge bg-red-50 text-risk-critical">{criticalCount} CRITICAL</span>}
                {highCount > 0 && <span className="badge bg-orange-50 text-risk-high">{highCount} HIGH</span>}
              </div>
              <div className="flex gap-0.5">
                {["all", "weather", "warehouse", "price"].map((f) => (
                  <button
                    key={f}
                    onClick={() => setAlertFilter(f)}
                    className={`px-2 py-1 text-2xs font-medium transition-colors ${
                      alertFilter === f ? "bg-surface-sunken text-ink" : "text-ink-muted hover:text-ink-secondary"
                    }`}
                  >
                    {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            <div>
              {filteredAlerts.length > 0 ? filteredAlerts.map((alert, i) => {
                const sev = SEVERITY_STYLES[alert.riskLevel] ?? SEVERITY_STYLES.low;
                const isExpanded = expandedAlert === i;
                return (
                  <div key={i} className={`border-l-[3px] ${sev.border}`}>
                    <button
                      onClick={() => setExpandedAlert(isExpanded ? null : i)}
                      className={`w-full text-left px-4 py-3 transition-colors ${isExpanded ? sev.bg : "hover:bg-surface-raised"} border-b border-border-subtle`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`status-dot ${sev.dot}`} />
                            <span className="text-sm font-semibold text-ink">{alert.indicator}</span>
                          </div>
                          <div className="flex items-center gap-2 pl-5">
                            <span className={`badge text-2xs uppercase ${sev.badge}`}>{alert.riskLevel}</span>
                            {alert.region && <span className="text-2xs text-ink-muted">{alert.region}</span>}
                            {alert.confidence > 0 && (
                              <span className="text-2xs text-ink-muted tabular-nums">Conf {Math.round(alert.confidence * 100)}%</span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {alert.recordedAt && (
                            <span className="text-2xs text-ink-muted tabular-nums">
                              {new Date(alert.recordedAt).toISOString().split("T")[0]}
                            </span>
                          )}
                          {isExpanded ? <ChevronUp style={{ width: 14, height: 14 }} className="text-ink-muted" /> : <ChevronDown style={{ width: 14, height: 14 }} className="text-ink-muted" />}
                        </div>
                      </div>
                    </button>

                    {isExpanded && (
                      <div className={`px-4 pb-4 pt-2 ${sev.bg} border-b border-border-subtle`}>
                        <div className="flex items-center gap-4 pl-5 text-2xs">
                          {alert.region && (
                            <span className="flex items-center gap-1 text-ink-tertiary">
                              <MapPin style={{ width: 12, height: 12 }} /> {alert.region}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-3 pl-5">
                          <button className="btn-secondary text-2xs py-1.5">Acknowledge</button>
                          <button className="btn-primary text-2xs py-1.5">Investigate</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              }) : (
                <div className="px-4 py-5">
                  <p className="text-sm text-ink-secondary mb-0.5">No active risk alerts.</p>
                  <p className="text-2xs text-ink-tertiary">All monitored indicators are within acceptable thresholds.</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Regional Risk */}
        <div>
          <div className="card overflow-hidden">
            <div className="card-section-header">
              <div className="flex items-center gap-2">
                <MapPin style={{ width: 14, height: 14 }} className="text-ink-muted" />
                <span className="label-caps !mb-0 !mt-0 !pb-0 !border-0">Regional Risk</span>
              </div>
            </div>
            <div>
              {regionalRisk.length > 0 ? regionalRisk.map((r) => {
                const rs = RISK_LEVEL_STYLES[r.level] ?? RISK_LEVEL_STYLES.low;
                return (
                  <div key={r.region} className="px-4 py-3 border-b border-border-subtle last:border-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-ink">{r.region}</span>
                      <span className={`badge text-2xs capitalize ${rs.badge}`}>{r.level}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-2xs text-ink-muted">{r.farmers} farmers</span>
                      <span className="text-sm font-bold text-ink tabular-nums">{r.riskScore}</span>
                    </div>
                    <div className="w-full h-1 bg-surface-sunken mt-2">
                      <div className={`h-full transition-all ${rs.bar}`} style={{ width: `${r.riskScore}%` }} />
                    </div>
                  </div>
                );
              }) : (
                <div className="px-4 py-5">
                  <p className="text-sm text-ink-secondary mb-0.5">No regional risk data available.</p>
                  <p className="text-2xs text-ink-tertiary">Risk scoring requires active farmer registrations and weather data for each region.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Data Confidence + Platform Services */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <div className="card overflow-hidden">
          <div className="card-section-header">
            <div className="flex items-center gap-2">
              <Database style={{ width: 14, height: 14 }} className="text-ink-muted" />
              <span className="label-caps !mb-0 !mt-0 !pb-0 !border-0">Data Confidence</span>
            </div>
            <span className="text-2xs text-ink-muted">Overall: <span className="font-bold text-ink">{Math.round(overallConfidence * 100)}%</span></span>
          </div>
          <div>
            {dataSources.length > 0 ? dataSources.map((src) => (
              <div key={src.sourceId} className="px-4 py-2.5 flex items-center justify-between border-b border-border-subtle last:border-0">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-medium text-ink">{src.sourceName}</span>
                    <span className={`badge text-2xs ${SOURCE_STATUS_STYLES[src.status] ?? SOURCE_STATUS_STYLES.unknown}`}>{src.status}</span>
                  </div>
                  <div className="flex items-center gap-3 text-2xs text-ink-muted">
                    <span>Last sync: {src.freshnessLabel}</span>
                    {src.failedSyncsLast24h > 0 && <span className="text-risk-high">{src.failedSyncsLast24h} failures/24h</span>}
                    <span className="tabular-nums">Success: {Math.round(src.successRate24h * 100)}%</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <div className="w-14 h-1.5 bg-surface-sunken">
                    <div
                      className={`h-full ${src.confidenceScore >= 0.8 ? "bg-status-success" : src.confidenceScore >= 0.5 ? "bg-risk-medium" : "bg-risk-critical"}`}
                      style={{ width: `${src.confidenceScore * 100}%` }}
                    />
                  </div>
                  <span className="text-2xs font-mono font-bold text-ink tabular-nums w-8 text-right">
                    {Math.round(src.confidenceScore * 100)}%
                  </span>
                </div>
              </div>
            )) : (
              <div className="px-4 py-5">
                <p className="text-sm text-ink-secondary mb-0.5">Data source monitoring is initializing.</p>
                <p className="text-2xs text-ink-tertiary">Confidence scores update as external feeds complete their first sync cycle.</p>
              </div>
            )}
          </div>
        </div>

        {/* Platform Services */}
        <div className="card overflow-hidden">
          <div className="card-section-header">
            <div className="flex items-center gap-2">
              <Zap style={{ width: 14, height: 14 }} className="text-ink-muted" />
              <span className="label-caps !mb-0 !mt-0 !pb-0 !border-0">Platform Services</span>
            </div>
            <span className="flex items-center gap-1.5">
              <span className={`status-dot ${overallHealth === "operational" ? "bg-status-success" : "bg-status-warning"}`} />
              <span className={`text-2xs font-medium capitalize ${overallHealth === "operational" ? "text-status-success" : "text-status-warning"}`}>
                {String(overallHealth).replace("_", " ")}
              </span>
            </span>
          </div>
          {platform?.services?.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 divide-x divide-border-subtle">
              {platform.services.map((svc: { serviceId: string; status: string }) => (
                <div key={svc.serviceId} className="px-4 py-3 text-center">
                  <div className={`status-dot mx-auto mb-1.5 ${svc.status === "healthy" ? "bg-status-success" : svc.status === "degraded" ? "bg-status-warning" : "bg-status-danger"}`} />
                  <p className="text-2xs font-medium text-ink-secondary capitalize">{svc.serviceId.replace(/_/g, " ")}</p>
                  <p className={`text-2xs capitalize ${svc.status === "healthy" ? "text-status-success" : svc.status === "degraded" ? "text-status-warning" : "text-status-danger"}`}>{svc.status}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-4 py-5">
              <p className="text-sm text-ink-muted">Retrieving platform service status...</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ExposureCell({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className="px-3 py-2.5 text-center">
      <p className="label-caps !mb-0.5">{label}</p>
      <p className={`text-sm font-bold tabular-nums ${alert ? "text-risk-medium" : "text-ink"}`}>{value}</p>
    </div>
  );
}
