"use client";

import { useState } from "react";
import {
  Cloud,
  Warehouse,
  TrendingUp,
  FileText,
  Bell,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import useSWR from "swr";

const fetcher = (url: string) =>
  fetch(url, { credentials: "include" }).then((r) => {
    if (!r.ok) throw new Error("Failed to fetch");
    return r.json();
  });

type AlertCategory = "all" | "weather" | "storage" | "price" | "claims";

interface Alert {
  id: string;
  category: string;
  title: string;
  message: string;
  severity: "high" | "medium" | "low" | "info";
  createdAt: string;
  read: boolean;
}

const CATEGORY_ICON_MAP: Record<string, typeof Cloud> = {
  weather: Cloud,
  storage: Warehouse,
  price: TrendingUp,
  claims: FileText,
};

const SEVERITY_STYLES: Record<string, { border: string; accent: string }> = {
  high: { border: "border-l-risk-critical", accent: "text-risk-critical" },
  medium: { border: "border-l-risk-medium", accent: "text-risk-medium" },
  low: { border: "border-l-risk-low", accent: "text-risk-low" },
  info: { border: "border-l-status-success", accent: "text-status-success" },
};

const CATEGORY_FILTERS: { key: AlertCategory; label: string; icon: typeof Bell }[] = [
  { key: "all", label: "All", icon: Bell },
  { key: "weather", label: "Weather", icon: Cloud },
  { key: "storage", label: "Storage", icon: Warehouse },
  { key: "price", label: "Price", icon: TrendingUp },
  { key: "claims", label: "Claims", icon: FileText },
];

export default function AlertsPage() {
  const [activeCategory, setActiveCategory] = useState<AlertCategory>("all");

  const params = new URLSearchParams();
  params.set("limit", "50");
  if (activeCategory !== "all") params.set("category", activeCategory);

  const { data, isLoading, mutate } = useSWR(`/api/alerts?${params}`, fetcher, { revalidateOnFocus: false });

  const alerts: Alert[] = data?.alerts ?? [];
  const unreadCount: number = data?.unreadCount ?? 0;

  const highAlerts = alerts.filter((a) => a.severity === "high" && !a.read);
  const otherAlerts = alerts.filter((a) => !(a.severity === "high" && !a.read));

  function timeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  async function markAllRead() {
    try {
      await fetch("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ markAll: true }),
      });
      mutate();
    } catch { /* silent */ }
  }

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="page-title">Alerts</h1>
          <p className="page-subtitle">
            {unreadCount > 0 ? `${unreadCount} unread` : "All caught up"}
          </p>
        </div>
        {unreadCount > 0 && (
          <button onClick={markAllRead} className="link-action flex items-center gap-1">
            <CheckCircle2 style={{ width: 14, height: 14 }} />
            Mark all read
          </button>
        )}
      </div>

      {/* Category filter — horizontal strip with icons */}
      <div className="flex items-center gap-1 mb-4">
        {CATEGORY_FILTERS.map((cat) => {
          const Icon = cat.icon;
          const isActive = activeCategory === cat.key;
          return (
            <button
              key={cat.key}
              onClick={() => setActiveCategory(cat.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors border ${
                isActive
                  ? "border-brand-500 bg-brand-50 text-ink"
                  : "border-transparent text-ink-tertiary hover:text-ink-secondary"
              }`}
            >
              <Icon style={{ width: 13, height: 13 }} />
              {cat.label}
            </button>
          );
        })}
      </div>

      {/* High-priority alerts — surfaced prominently */}
      {highAlerts.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle style={{ width: 12, height: 12 }} className="text-risk-critical" />
            <span className="text-2xs font-semibold text-status-danger uppercase tracking-wide">Urgent</span>
          </div>
          <div className="space-y-1.5">
            {highAlerts.map((alert) => (
              <AlertRow key={alert.id} alert={alert} timeAgo={timeAgo} />
            ))}
          </div>
        </div>
      )}

      {/* Remaining alerts — standard feed */}
      <div className="space-y-1.5">
        {otherAlerts.length === 0 && highAlerts.length === 0 && !isLoading ? (
          <div className="border border-border bg-white p-5">
            <p className="text-sm text-ink-secondary mb-1">No alerts in this category.</p>
            <p className="text-2xs text-ink-tertiary">
              Alerts are generated for weather events, storage condition changes, price movements, and claim status updates.
            </p>
          </div>
        ) : (
          otherAlerts.map((alert) => (
            <AlertRow key={alert.id} alert={alert} timeAgo={timeAgo} />
          ))
        )}
      </div>
    </div>
  );
}

function AlertRow({ alert, timeAgo }: { alert: Alert; timeAgo: (d: string) => string }) {
  const severity = SEVERITY_STYLES[alert.severity] ?? SEVERITY_STYLES.info;
  const CategoryIcon = CATEGORY_ICON_MAP[alert.category] ?? Bell;

  return (
    <div className={`border border-border bg-white border-l-[3px] ${severity.border} px-4 py-3 ${alert.read ? "opacity-60" : ""}`}>
      <div className="flex items-start gap-3">
        <CategoryIcon style={{ width: 14, height: 14 }} className={`${severity.accent} flex-shrink-0 mt-0.5`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            {!alert.read && <span className="w-1.5 h-1.5 rounded-full bg-brand-500 flex-shrink-0" />}
            <h3 className="text-sm font-semibold text-ink">{alert.title}</h3>
          </div>
          <p className="text-sm text-ink-tertiary">{alert.message}</p>
        </div>
        <span className="text-2xs text-ink-muted flex-shrink-0 tabular-nums">{timeAgo(alert.createdAt)}</span>
      </div>
    </div>
  );
}
