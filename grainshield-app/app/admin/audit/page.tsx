"use client";

import { useState } from "react";
import {
  ScrollText,
  Search,
  Shield,
  Settings,
  AlertTriangle,
  FileText,
  Lock,
  UserCheck,
  Banknote,
  Warehouse,
  AlertCircle,
  Clock,
} from "lucide-react";
import useSWR from "swr";

const fetcher = (url: string) =>
  fetch(url, { credentials: "include" }).then((r) => {
    if (!r.ok) throw new Error("Failed to fetch");
    return r.json();
  });

interface AuditLogEntry {
  id: string;
  timestamp: string;
  actor: string;
  actorRole: string;
  action: string;
  category: string;
  severity: string;
  target: string;
  ipAddress: string;
  details: string;
}

const CATEGORY_CONFIG: Record<string, { label: string; icon: typeof Shield; color: string }> = {
  auth: { label: "Authentication", icon: Lock, color: "text-status-info bg-status-info-surface" },
  kyc: { label: "KYC", icon: UserCheck, color: "text-brand-700 bg-brand-50" },
  claims: { label: "Claims", icon: FileText, color: "text-status-warning bg-status-warning-surface" },
  loans: { label: "Loans", icon: Banknote, color: "text-status-success bg-status-success-surface" },
  storage: { label: "Storage", icon: Warehouse, color: "text-status-warning bg-status-warning-surface" },
  warehouse: { label: "Warehouse", icon: Warehouse, color: "text-status-warning bg-status-warning-surface" },
  system: { label: "System", icon: Settings, color: "text-ink-tertiary bg-surface-sunken" },
  admin: { label: "Admin", icon: Shield, color: "text-brand-600 bg-brand-50" },
  payout: { label: "Payout", icon: Banknote, color: "text-status-success bg-status-success-surface" },
  risk: { label: "Risk", icon: AlertTriangle, color: "text-status-danger bg-status-danger-surface" },
};

const SEVERITY_BORDER: Record<string, string> = {
  critical: "border-l-risk-critical",
  warning: "border-l-risk-medium",
  info: "border-l-transparent",
};

const ACTOR_COLORS: Record<string, string> = {
  farmer: "text-status-success bg-status-success-surface",
  admin: "text-brand-700 bg-brand-50",
  system: "text-ink-tertiary bg-surface-sunken",
  super_admin: "text-brand-700 bg-brand-50",
};

export default function AuditGovernancePage() {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [page, setPage] = useState(1);

  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("limit", "30");
  if (categoryFilter !== "all") params.set("category", categoryFilter);
  if (severityFilter !== "all") params.set("severity", severityFilter);
  if (search) params.set("search", search);

  const { data, isLoading } = useSWR(`/api/audit?${params}`, fetcher, { revalidateOnFocus: false });
  const { data: healthData } = useSWR("/api/health", fetcher, { revalidateOnFocus: false });

  const logs: AuditLogEntry[] = data?.logs ?? [];
  const summary = data?.summary;
  const pagination = data?.pagination;
  const platform = healthData?.platform;

  const criticalLogs = logs.filter((l) => l.severity === "critical");

  return (
    <div className="max-w-7xl">
      <div className="mb-4">
        <h1 className="page-title">Audit & Governance</h1>
        <p className="page-subtitle">Event ledger and system health</p>
      </div>

      {/* Three-column header: stats + category breakdown + system health — not card grid */}
      <div className="flex items-stretch border border-border bg-white mb-5 overflow-hidden">
        {/* Left: volume stats */}
        <div className="w-[200px] flex-shrink-0 px-5 py-4 border-r border-border-subtle">
          <span className="text-2xs text-ink-muted uppercase tracking-wide">Total Events</span>
          <p className="text-2xl font-bold text-ink tabular-nums mt-1">{pagination?.total ?? "—"}</p>
          <div className="flex items-center gap-2 mt-2">
            {(summary?.criticalLast24h ?? 0) > 0 ? (
              <span className="flex items-center gap-1 text-2xs text-status-danger font-medium">
                <AlertTriangle style={{ width: 10, height: 10 }} />
                {summary?.criticalLast24h} critical (24h)
              </span>
            ) : (
              <span className="text-2xs text-ink-muted">No critical events (24h)</span>
            )}
          </div>
        </div>

        {/* Middle: category breakdown — inline chips */}
        <div className="flex-1 px-5 py-4 border-r border-border-subtle">
          <span className="text-2xs text-ink-muted uppercase tracking-wide mb-2 block">Activity by Category</span>
          <div className="flex flex-wrap gap-2 mt-1.5">
            {summary?.categoryBreakdown?.length > 0 ? summary.categoryBreakdown.map((c: { category: string; count: number }) => {
              const cfg = CATEGORY_CONFIG[c.category] ?? CATEGORY_CONFIG.system;
              const Icon = cfg.icon;
              return (
                <button
                  key={c.category}
                  onClick={() => { setCategoryFilter(c.category); setPage(1); }}
                  className={`inline-flex items-center gap-1.5 px-2 py-1 border transition-colors ${
                    categoryFilter === c.category
                      ? "border-brand-500 bg-brand-50"
                      : "border-border-subtle hover:border-border-strong"
                  }`}
                >
                  <Icon style={{ width: 11, height: 11 }} className="text-ink-muted" />
                  <span className="text-2xs text-ink-secondary capitalize">{c.category}</span>
                  <span className="text-2xs font-bold text-ink tabular-nums">{c.count}</span>
                </button>
              );
            }) : (
              <span className="text-2xs text-ink-muted">Loading category data...</span>
            )}
          </div>
        </div>

        {/* Right: platform services — compact status dots */}
        <div className="w-[200px] flex-shrink-0 px-5 py-4">
          <span className="text-2xs text-ink-muted uppercase tracking-wide mb-2 block">Platform</span>
          <div className="space-y-1.5 mt-1.5">
            {platform?.services?.length > 0 ? platform.services.map((svc: { serviceId: string; status: string }) => (
              <div key={svc.serviceId} className="flex items-center justify-between">
                <span className="text-2xs text-ink-secondary capitalize">{svc.serviceId.replace(/_/g, " ")}</span>
                <span className={`w-2 h-2 rounded-full ${
                  svc.status === "healthy" ? "bg-status-success"
                    : svc.status === "degraded" ? "bg-status-warning"
                    : "bg-status-danger"
                }`} />
              </div>
            )) : (
              <span className="text-2xs text-ink-muted">Loading...</span>
            )}
          </div>
        </div>
      </div>

      {/* Critical events feed — only if present, not a permanent section */}
      {criticalLogs.length > 0 && (
        <div className="mb-5">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle style={{ width: 12, height: 12 }} className="text-risk-critical" />
            <span className="text-2xs font-semibold text-status-danger uppercase tracking-wide">Critical Events</span>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {criticalLogs.slice(0, 5).map((log) => (
              <div key={log.id} className="flex-shrink-0 w-[280px] border-2 border-red-200 bg-status-danger-surface p-3">
                <p className="text-sm font-semibold text-ink mb-0.5">{log.action}</p>
                <p className="text-2xs text-ink-secondary">{log.target}</p>
                <div className="flex items-center gap-2 mt-2 text-2xs text-ink-muted">
                  <Clock style={{ width: 11, height: 11 }} />
                  <span className="tabular-nums">{new Date(log.timestamp).toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Search + filter controls — inline, not in a card */}
      <div className="flex items-center gap-3 mb-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" style={{ width: 15, height: 15 }} />
          <input
            type="text"
            placeholder="Search by action, actor, or ID..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="input-field pl-9"
          />
        </div>
        <select
          value={categoryFilter}
          onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }}
          className="input-field w-auto"
        >
          <option value="all">All Categories</option>
          {Object.entries(CATEGORY_CONFIG).map(([key, cfg]) => (
            <option key={key} value={key}>{cfg.label}</option>
          ))}
        </select>
        <select
          value={severityFilter}
          onChange={(e) => { setSeverityFilter(e.target.value); setPage(1); }}
          className="input-field w-auto"
        >
          <option value="all">All Severity</option>
          <option value="info">Info</option>
          <option value="warning">Warning</option>
          <option value="critical">Critical</option>
        </select>
      </div>

      {/* Audit ledger — timeline-style feed, not a table */}
      <div className="space-y-px">
        {logs.map((log) => {
          const catCfg = CATEGORY_CONFIG[log.category] ?? CATEGORY_CONFIG.system;
          const CatIcon = catCfg.icon;
          const borderClass = SEVERITY_BORDER[log.severity] ?? SEVERITY_BORDER.info;
          return (
            <div key={log.id} className={`border-l-[3px] ${borderClass} bg-white border border-border px-4 py-2.5 flex items-center gap-4`}>
              {/* Timestamp */}
              <div className="w-[160px] flex-shrink-0">
                <p className="text-sm font-mono text-ink tabular-nums">
                  {new Date(log.timestamp).toLocaleString()}
                </p>
              </div>

              {/* Actor */}
              <div className="w-[140px] flex-shrink-0">
                <div className="flex items-center gap-1.5">
                  <span className={`px-1.5 py-0.5 text-2xs font-medium capitalize ${ACTOR_COLORS[log.actorRole] ?? ACTOR_COLORS.system}`}>
                    {log.actorRole}
                  </span>
                </div>
                <p className="text-2xs text-ink-secondary mt-0.5 truncate">{log.actor}</p>
              </div>

              {/* Action */}
              <div className="flex-1 min-w-0">
                <p className="text-sm text-ink">{log.action}</p>
                {log.details && (
                  <p className="text-2xs text-ink-muted mt-0.5 truncate max-w-md">{log.details}</p>
                )}
              </div>

              {/* Category + target */}
              <div className="flex items-center gap-3 flex-shrink-0">
                <span className={`badge text-2xs ${catCfg.color}`}>
                  <CatIcon style={{ width: 10, height: 10 }} />
                  {catCfg.label}
                </span>
                <span className="text-2xs text-ink-muted max-w-[120px] truncate">{log.target}</span>
              </div>
            </div>
          );
        })}
        {logs.length === 0 && !isLoading && (
          <div className="bg-white border border-border px-5 py-8">
            <p className="text-sm text-ink-secondary mb-1">No audit entries match the current filters.</p>
            <p className="text-2xs text-ink-tertiary">
              Adjust category, severity, or search terms. All system and user actions are logged automatically.
            </p>
          </div>
        )}
      </div>

      {pagination && pagination.pages > 1 && (
        <div className="flex items-center justify-between mt-3 py-2">
          <span className="text-2xs text-ink-muted">
            Page {pagination.page} of {pagination.pages} ({pagination.total} entries)
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page <= 1}
              className="btn-secondary text-2xs py-1 px-2 disabled:opacity-40"
            >
              Previous
            </button>
            <button
              onClick={() => setPage(Math.min(pagination.pages, page + 1))}
              disabled={page >= pagination.pages}
              className="btn-secondary text-2xs py-1 px-2 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
