"use client";

import {
  Users,
  Wheat,
  FileText,
  Landmark,
  AlertTriangle,
  Activity,
  Zap,
  ChevronRight,
  Database,
  AlertCircle,
  Radio,
} from "lucide-react";
import Link from "next/link";
import useSWR from "swr";

const fetcher = (url: string) =>
  fetch(url, { credentials: "include" }).then((r) => {
    if (!r.ok) throw new Error("Failed to fetch");
    return r.json();
  });

const SEVERITY_STYLES: Record<string, { dot: string; text: string; surface: string }> = {
  critical: { dot: "bg-risk-critical animate-pulse-subtle", text: "text-risk-critical", surface: "bg-red-50" },
  high: { dot: "bg-risk-high", text: "text-risk-high", surface: "bg-orange-50" },
  medium: { dot: "bg-risk-medium", text: "text-risk-medium", surface: "bg-yellow-50" },
  low: { dot: "bg-risk-low", text: "text-risk-low", surface: "bg-blue-50" },
};

interface RiskAlert {
  region: string;
  riskLevel: string;
  indicator: string;
  confidence: number;
  recordedAt: string;
}

export default function AdminOverviewPage() {
  const { data: riskData } = useSWR("/api/risk", fetcher, { revalidateOnFocus: false });
  const { data: farmersData } = useSWR("/api/farmers?limit=1", fetcher, { revalidateOnFocus: false });
  const { data: queueData } = useSWR("/api/queues", fetcher, { revalidateOnFocus: false });
  const { data: healthData } = useSWR("/api/health", fetcher, { revalidateOnFocus: false });

  const exposure = riskData?.exposure;
  const weatherRisks: RiskAlert[] = riskData?.weatherRisks ?? [];
  const farmerSummary = farmersData?.summary;
  const queues = queueData?.queues ?? [];
  const platform = healthData?.platform;

  const dataAvailable = riskData?.dataAvailable !== false;

  const criticalAlerts = weatherRisks.filter((a) => a.riskLevel === "critical").length;
  const highAlerts = weatherRisks.filter((a) => a.riskLevel === "high").length;

  const stats = [
    {
      label: "Active Farmers",
      value: farmerSummary ? farmerSummary.kycApproved.toLocaleString() : "—",
      sub: farmerSummary ? `${farmerSummary.pendingKyc} pending KYC` : "",
      icon: Users,
    },
    {
      label: "Grain Protected",
      value: exposure ? `${(exposure.totalGrainKg / 1000).toFixed(1)}t` : "—",
      sub: exposure ? `KSh ${(exposure.totalValueKsh / 1000000).toFixed(1)}M value` : "",
      icon: Wheat,
    },
    {
      label: "Loan Exposure",
      value: exposure ? `KSh ${(exposure.totalLoansKsh / 1000000).toFixed(1)}M` : "—",
      sub: exposure ? `LTV: ${exposure.ltvPercent}%` : "",
      icon: Landmark,
    },
    {
      label: "Pending Claims",
      value: exposure ? `${exposure.pendingClaimsCount}` : "—",
      sub: exposure ? `KSh ${((exposure.pendingClaimsKsh ?? 0) / 1000).toFixed(0)}K pending` : "",
      icon: FileText,
    },
  ];

  const overallHealth = platform?.overall ?? "operational";

  return (
    <div className="max-w-7xl">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="page-title">Operations Overview</h1>
          <p className="page-subtitle">Uasin Gishu &middot; Trans Nzoia &middot; Platform health, queues, and risk posture</p>
        </div>
        <div className={`flex items-center gap-1.5 px-2 py-1 border ${
          overallHealth === "operational"
            ? "bg-status-success-surface border-green-200"
            : overallHealth === "degraded"
              ? "bg-status-warning-surface border-yellow-200"
              : "bg-status-danger-surface border-red-200"
        }`}>
          <Radio style={{ width: 10, height: 10 }} className={`animate-pulse-subtle ${
            overallHealth === "operational" ? "text-status-success"
              : overallHealth === "degraded" ? "text-status-warning"
              : "text-status-danger"
          }`} />
          <span className={`text-2xs font-medium capitalize ${
            overallHealth === "operational" ? "text-status-success"
              : overallHealth === "degraded" ? "text-status-warning"
              : "text-status-danger"
          }`}>
            {overallHealth.replace("_", " ")}
          </span>
        </div>
      </div>

      {criticalAlerts > 0 && (
        <Link href="/admin/risk" className="block mb-4 card border-red-200 bg-status-danger-surface hover:bg-red-100 transition-colors">
          <div className="flex items-center gap-2.5 px-3 py-2.5">
            <Zap style={{ width: 14, height: 14 }} className="text-risk-critical flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-red-900">
                {criticalAlerts} critical, {highAlerts} high-priority alerts active
              </p>
              <p className="text-2xs text-red-700/70">
                Immediate review required — open Risk Operations
              </p>
            </div>
            <ChevronRight style={{ width: 14, height: 14 }} className="text-red-400 flex-shrink-0" />
          </div>
        </Link>
      )}

      {/* Stat row — flat, dense, no colored icon boxes */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-border mb-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="card p-3 border-0">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Icon style={{ width: 13, height: 13 }} className="text-ink-muted" />
                <span className="label-caps !mb-0 !mt-0 !pb-0 !border-0">{stat.label}</span>
              </div>
              <p className="metric-value-sm">{stat.value}</p>
              <p className="text-2xs text-ink-muted mt-0.5">{stat.sub}</p>
            </div>
          );
        })}
      </div>

      {!dataAvailable && (
        <div className="card p-4 mb-4">
          <p className="text-sm text-ink-secondary mb-1">Operational data is not yet available.</p>
          <p className="text-2xs text-ink-tertiary">
            Metrics, queues, and risk alerts populate as farmer registrations, storage deposits, and market feeds are processed.
          </p>
        </div>
      )}

      {queues.length > 0 && (
        <div className="card mb-4 overflow-hidden">
          <div className="card-section-header">
            <div className="flex items-center gap-1.5">
              <Activity style={{ width: 12, height: 12 }} className="text-ink-muted" />
              <span className="label-caps !mb-0 !mt-0 !pb-0 !border-0">Operational Queues</span>
            </div>
            <Link href="/admin/queues" className="link-action">Open Queues</Link>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-border-subtle">
            {queues.slice(0, 4).map((q: { name: string; total: number; critical: number; high: number; href: string }) => (
              <Link key={q.name} href={q.href ?? "/admin/queues"} className="px-3 py-3 hover:bg-surface-raised transition-colors">
                <span className="text-2xs font-medium text-ink-tertiary">{q.name}</span>
                <div className="flex items-end justify-between mt-1.5">
                  <p className="metric-value-sm">{q.total}</p>
                  <div className="flex items-center gap-1">
                    {q.critical > 0 && (
                      <span className="badge bg-red-50 text-risk-critical">{q.critical}</span>
                    )}
                    {q.high > 0 && (
                      <span className="badge bg-orange-50 text-risk-high">{q.high}</span>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Two-column: Risk + Services */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <div className="lg:col-span-2">
          <div className="card overflow-hidden">
            <div className="card-section-header">
              <div className="flex items-center gap-1.5">
                <AlertTriangle style={{ width: 12, height: 12 }} className="text-ink-muted" />
                <span className="label-caps !mb-0 !mt-0 !pb-0 !border-0">Active Risk Alerts</span>
              </div>
              <Link href="/admin/risk" className="link-action">Risk Operations</Link>
            </div>
            {weatherRisks.length > 0 ? (
              <div>
                {weatherRisks.map((alert, i) => {
                  const sev = SEVERITY_STYLES[alert.riskLevel] ?? SEVERITY_STYLES.low;
                  return (
                    <div key={i} className="table-row px-3 py-2">
                      <div className="flex items-center gap-2.5">
                        <span className={`status-dot ${sev.dot}`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-ink truncate">{alert.indicator}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className={`badge text-2xs ${sev.surface} ${sev.text}`}>{alert.riskLevel}</span>
                            <span className="text-2xs text-ink-muted">{alert.region}</span>
                            {alert.confidence > 0 && (
                              <span className="text-2xs text-ink-faint">Conf {Math.round(alert.confidence * 100)}%</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="px-3 py-4">
                <p className="text-sm text-ink-secondary mb-0.5">No active risk alerts.</p>
                <p className="text-2xs text-ink-tertiary">All monitored indicators within acceptable thresholds.</p>
              </div>
            )}
          </div>
        </div>

        <div>
          <div className="card overflow-hidden">
            <div className="card-section-header">
              <div className="flex items-center gap-1.5">
                <Database style={{ width: 12, height: 12 }} className="text-ink-muted" />
                <span className="label-caps !mb-0 !mt-0 !pb-0 !border-0">Platform Services</span>
              </div>
            </div>
            {platform?.services?.length > 0 ? (
              <div>
                {platform.services.map((svc: { serviceId: string; status: string }) => (
                  <div key={svc.serviceId} className="table-row px-3 py-2 flex items-center justify-between">
                    <span className="text-sm text-ink-secondary capitalize">
                      {svc.serviceId.replace(/_/g, " ")}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <span className={`status-dot ${
                        svc.status === "healthy" ? "bg-status-success"
                          : svc.status === "degraded" ? "bg-status-warning"
                          : "bg-status-danger"
                      }`} />
                      <span className={`text-2xs capitalize ${
                        svc.status === "healthy" ? "text-status-success"
                          : svc.status === "degraded" ? "text-status-warning"
                          : "text-status-danger"
                      }`}>
                        {svc.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-3 py-4">
                <p className="text-sm text-ink-muted">Retrieving platform service status...</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
