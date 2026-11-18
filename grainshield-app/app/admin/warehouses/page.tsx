"use client";

import {
  Warehouse,
  MapPin,
  Thermometer,
  Droplets,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Calendar,
  Users,
} from "lucide-react";
import useSWR from "swr";

const fetcher = (url: string) =>
  fetch(url, { credentials: "include" }).then((r) => {
    if (!r.ok) throw new Error("Failed to fetch");
    return r.json();
  });

const STATUS_CONFIG: Record<string, { label: string; color: string; headerBg: string; icon: typeof CheckCircle2 }> = {
  operational: { label: "Operational", color: "bg-status-success-surface text-status-success", headerBg: "bg-green-50 border-b-green-200", icon: CheckCircle2 },
  warning: { label: "Warning", color: "bg-status-warning-surface text-status-warning", headerBg: "bg-yellow-50 border-b-yellow-200", icon: AlertTriangle },
  offline: { label: "Offline", color: "bg-surface-sunken text-ink-tertiary", headerBg: "bg-stone-50 border-b-stone-200", icon: XCircle },
  maintenance: { label: "Maintenance", color: "bg-status-info-surface text-status-info", headerBg: "bg-blue-50 border-b-blue-200", icon: AlertTriangle },
};

interface WarehouseData {
  code: string;
  name: string;
  location: string;
  county: string;
  capacityKg: number;
  usedKg: number;
  temperatureC: number | null;
  humidityPct: number | null;
  status: string;
  lastInspection: string | null;
  riskFlags: string[];
  farmersCount: number;
}

export default function WarehouseOversightPage() {
  const { data, isLoading } = useSWR("/api/warehouses", fetcher, { revalidateOnFocus: false });

  const warehouses: WarehouseData[] = data?.warehouses ?? [];
  const summary = data?.summary;

  const utilizationPct = summary?.utilizationPct ?? 0;
  const flaggedWarehouses = warehouses.filter((w) => w.riskFlags.length > 0 || w.status !== "operational");
  const healthyWarehouses = warehouses.filter((w) => w.riskFlags.length === 0 && w.status === "operational");

  return (
    <div className="max-w-7xl">
      <div className="mb-4">
        <h1 className="page-title">Warehouse Oversight</h1>
        <p className="page-subtitle">Facility status, capacity, and condition readings</p>
      </div>

      {/* Capacity utilization — visual bar, not metric cards */}
      {summary && (
        <div className="border border-border bg-white mb-5 px-5 py-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <span className="text-2xs text-ink-muted uppercase tracking-wide">System Capacity</span>
              <span className="text-sm font-bold text-ink tabular-nums">
                {(summary.totalUsedKg / 1000).toFixed(0)}t / {(summary.totalCapacityKg / 1000).toFixed(0)}t
              </span>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-ink-secondary tabular-nums">
                <span className="font-bold text-ink">{summary.totalWarehouses}</span> facilities
              </span>
              {(summary.riskFlagCount ?? 0) > 0 && (
                <span className="flex items-center gap-1 text-sm text-status-warning">
                  <AlertTriangle style={{ width: 12, height: 12 }} />
                  <span className="font-bold tabular-nums">{summary.riskFlagCount}</span> flagged
                </span>
              )}
            </div>
          </div>
          <div className="w-full h-3 bg-surface-sunken overflow-hidden">
            <div
              className={`h-full transition-all ${utilizationPct > 85 ? "bg-risk-critical" : utilizationPct > 70 ? "bg-risk-medium" : "bg-brand-500"}`}
              style={{ width: `${utilizationPct}%` }}
            />
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className="text-2xs text-ink-muted tabular-nums">{utilizationPct}% utilized</span>
            <span className="text-2xs text-ink-muted tabular-nums">{(100 - utilizationPct)}% available</span>
          </div>
        </div>
      )}

      {/* Facilities requiring attention — shown first */}
      {flaggedWarehouses.length > 0 && (
        <div className="mb-5">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle style={{ width: 13, height: 13 }} className="text-status-warning" />
            <span className="text-2xs font-semibold text-ink-tertiary uppercase tracking-wide">
              Requires Attention ({flaggedWarehouses.length})
            </span>
          </div>
          <div className="space-y-3">
            {flaggedWarehouses.map((wh) => (
              <WarehouseCard key={wh.code} wh={wh} highlighted />
            ))}
          </div>
        </div>
      )}

      {/* Healthy facilities */}
      {healthyWarehouses.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle2 style={{ width: 13, height: 13 }} className="text-status-success" />
            <span className="text-2xs font-semibold text-ink-tertiary uppercase tracking-wide">
              Operational ({healthyWarehouses.length})
            </span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {healthyWarehouses.map((wh) => (
              <WarehouseCard key={wh.code} wh={wh} />
            ))}
          </div>
        </div>
      )}

      {warehouses.length === 0 && !isLoading && (
        <div className="border border-border bg-white p-5">
          <p className="text-sm text-ink-secondary mb-1">No warehouse facilities are currently registered in the system.</p>
          <p className="text-2xs text-ink-tertiary">
            Warehouse data populates as partner facilities are onboarded and sensor integrations are configured.
          </p>
        </div>
      )}
    </div>
  );
}

function WarehouseCard({ wh, highlighted }: { wh: WarehouseData; highlighted?: boolean }) {
  const statusCfg = STATUS_CONFIG[wh.status] ?? STATUS_CONFIG.operational;
  const StatusIcon = statusCfg.icon;
  const usePct = wh.capacityKg > 0 ? Math.round((wh.usedKg / wh.capacityKg) * 100) : 0;

  return (
    <div className={`border overflow-hidden ${highlighted ? "border-yellow-300" : "border-border"} bg-white`}>
      {/* Condition header — color-coded by status */}
      <div className={`px-4 py-2.5 border-b ${statusCfg.headerBg} flex items-center justify-between`}>
        <div className="flex items-center gap-2">
          <StatusIcon style={{ width: 13, height: 13 }} />
          <span className="text-sm font-semibold text-ink">{wh.name}</span>
        </div>
        <span className="text-2xs font-mono text-ink-muted">{wh.code}</span>
      </div>

      <div className="px-4 py-3">
        {/* Sensor readings — the operational truth */}
        <div className="flex items-center gap-6 mb-3">
          <div className="flex items-center gap-1.5">
            <Thermometer style={{ width: 13, height: 13 }} className="text-ink-muted" />
            <span className="text-sm font-semibold text-ink tabular-nums">
              {wh.temperatureC != null ? `${wh.temperatureC}°C` : "—"}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Droplets style={{ width: 13, height: 13 }} className="text-ink-muted" />
            <span className={`text-sm font-semibold tabular-nums ${(wh.humidityPct ?? 0) > 62 ? "text-risk-medium" : "text-ink"}`}>
              {wh.humidityPct != null ? `${wh.humidityPct}%` : "—"}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Users style={{ width: 13, height: 13 }} className="text-ink-muted" />
            <span className="text-sm text-ink tabular-nums">{wh.farmersCount}</span>
          </div>
        </div>

        {/* Capacity bar */}
        <div className="flex items-center gap-3 mb-2">
          <div className="flex-1">
            <div className="w-full h-1.5 bg-surface-sunken">
              <div
                className={`h-full ${usePct > 85 ? "bg-risk-critical" : usePct > 70 ? "bg-risk-medium" : "bg-brand-500"}`}
                style={{ width: `${usePct}%` }}
              />
            </div>
          </div>
          <span className="text-2xs text-ink-muted tabular-nums w-20 text-right">
            {(wh.usedKg / 1000).toFixed(1)}t / {(wh.capacityKg / 1000).toFixed(0)}t
          </span>
        </div>

        {/* Location + metadata */}
        <div className="flex items-center justify-between text-2xs text-ink-muted">
          <span className="flex items-center gap-1">
            <MapPin style={{ width: 11, height: 11 }} />
            {wh.location}, {wh.county}
          </span>
          {wh.lastInspection && (
            <span className="flex items-center gap-1">
              <Calendar style={{ width: 11, height: 11 }} />
              {new Date(wh.lastInspection).toISOString().split("T")[0]}
            </span>
          )}
        </div>

        {/* Risk flags */}
        {wh.riskFlags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3 pt-2.5 border-t border-border-subtle">
            {wh.riskFlags.map((flag) => (
              <span key={flag} className="badge bg-status-warning-surface text-status-warning border border-yellow-200">
                <AlertTriangle style={{ width: 10, height: 10 }} /> {flag}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
