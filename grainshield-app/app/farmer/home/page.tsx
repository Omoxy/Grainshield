"use client";

import {
  Warehouse,
  Landmark,
  Bell,
  ChevronRight,
  Wheat,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import Link from "next/link";
import useSWR from "swr";

const fetcher = (url: string) =>
  fetch(url, { credentials: "include" }).then((r) => {
    if (!r.ok) throw new Error("Failed to fetch");
    return r.json();
  });

const ALERT_STYLES: Record<string, string> = {
  weather: "border-l-risk-low bg-status-info-surface text-status-info",
  price: "border-l-status-success bg-status-success-surface text-status-success",
  storage: "border-l-risk-medium bg-status-warning-surface text-status-warning",
  claim: "border-l-risk-critical bg-status-danger-surface text-status-danger",
  default: "border-l-border bg-surface-raised text-ink-secondary",
};

function getHealthSummary(status: string): { label: string; detail: string; color: string; Icon: typeof CheckCircle2 } {
  switch (status) {
    case "safe":
      return { label: "Conditions acceptable", detail: "Stored grain remains within safe storage parameters.", color: "text-status-success", Icon: CheckCircle2 };
    case "caution":
      return { label: "Requires attention", detail: "Storage conditions flagged — review recommended.", color: "text-status-warning", Icon: AlertTriangle };
    case "risk":
      return { label: "Action needed", detail: "Storage conditions outside acceptable range. Contact your warehouse.", color: "text-status-danger", Icon: AlertTriangle };
    default:
      return { label: "Conditions acceptable", detail: "No issues reported.", color: "text-status-success", Icon: CheckCircle2 };
  }
}

export default function FarmerOverviewPage() {
  const { data: storageData } = useSWR("/api/storage", fetcher, { revalidateOnFocus: false });
  const { data: priceData } = useSWR("/api/prices?type=current", fetcher, { revalidateOnFocus: false });
  const { data: loanData } = useSWR("/api/loans", fetcher, { revalidateOnFocus: false });
  const { data: alertData } = useSWR("/api/alerts?limit=5", fetcher, { revalidateOnFocus: false });

  const storage = storageData ?? null;
  const price = priceData?.current ?? null;
  const loan = loanData ?? null;
  const alerts = alertData?.alerts ?? [];
  const hasData = storage?.dataAvailable || price;

  const totalStored = storage?.summary?.totalStoredKg ?? 0;
  const primaryReceipt = storage?.receipts?.[0];

  const greeting = getGreeting();

  return (
    <div className="max-w-5xl">
      <div className="mb-5">
        <h1 className="page-title">{greeting}</h1>
        <p className="page-subtitle">
          {hasData
            ? "Your grain, market conditions, and account activity."
            : "No active records yet. Information appears here once grain is deposited at a warehouse."}
        </p>
      </div>

      {/* What grain is protected? */}
      <div className="card p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <span className="label-caps">Grain in Storage</span>
          <Link href="/farmer/storage" className="link-action flex items-center gap-0.5">
            View details <ChevronRight style={{ width: 12, height: 12 }} />
          </Link>
        </div>

        {totalStored > 0 && primaryReceipt ? (
          <>
            <div className="flex items-start gap-3 mb-3">
              <Wheat style={{ width: 15, height: 15 }} className="text-brand-700 mt-0.5" />
              <div>
                <p className="metric-value">
                  {totalStored.toLocaleString()}
                  <span className="text-sm text-ink-muted font-normal ml-1">kg stored</span>
                </p>
                <p className="text-sm text-ink-tertiary mt-0.5">
                  {primaryReceipt.warehouseName}
                  {primaryReceipt.grade && <span className="ml-1.5 text-ink-muted">&middot; Grade {primaryReceipt.grade}</span>}
                </p>
              </div>
            </div>

            {/* Protection confidence — not sensor readings */}
            {primaryReceipt.healthStatus && (() => {
              const health = getHealthSummary(primaryReceipt.healthStatus);
              const HealthIcon = health.Icon;
              return (
                <div className="mt-3 pt-3 border-t border-border-subtle flex items-start gap-2.5">
                  <HealthIcon style={{ width: 14, height: 14 }} className={`${health.color} mt-0.5 flex-shrink-0`} />
                  <div>
                    <p className={`text-sm font-medium ${health.color}`}>{health.label}</p>
                    <p className="text-2xs text-ink-tertiary mt-0.5">{health.detail}</p>
                  </div>
                </div>
              );
            })()}
          </>
        ) : (
          <div className="py-3">
            <p className="text-sm text-ink-secondary mb-0.5">No grain currently in storage.</p>
            <p className="text-2xs text-ink-tertiary">
              Deposit grain at a verified warehouse to activate storage monitoring, financing, and protection coverage.
            </p>
          </div>
        )}
      </div>

      {/* Market conditions + Loan eligibility */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        {/* What are current market conditions? */}
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="label-caps">Maize Price</span>
            <Link href="/farmer/prices" className="link-action flex items-center gap-0.5">
              Market prices <ChevronRight style={{ width: 12, height: 12 }} />
            </Link>
          </div>
          {price ? (
            <>
              <div className="flex items-end gap-2 mb-1">
                <p className="metric-value">
                  KSh {price.pricePerKg?.toFixed(2) ?? "—"}
                  <span className="text-sm text-ink-muted font-normal">/kg</span>
                </p>
                {price.changePercent != null && (
                  <span
                    className={`flex items-center gap-0.5 text-sm font-semibold mb-0.5 ${
                      price.changeDirection === "up" ? "text-status-success"
                        : price.changeDirection === "down" ? "text-status-danger"
                        : "text-ink-muted"
                    }`}
                  >
                    {price.changeDirection === "up" ? (
                      <ArrowUpRight style={{ width: 13, height: 13 }} />
                    ) : price.changeDirection === "down" ? (
                      <ArrowDownRight style={{ width: 13, height: 13 }} />
                    ) : (
                      <Minus style={{ width: 13, height: 13 }} />
                    )}
                    {Math.abs(price.changePercent)}%
                  </span>
                )}
              </div>
              {price.market && (
                <p className="text-2xs text-ink-muted">{price.market}</p>
              )}
              {price.isStale && (
                <p className="text-2xs text-status-warning mt-1">Price data may be delayed.</p>
              )}
            </>
          ) : (
            <p className="text-sm text-ink-muted py-3">Regional pricing is temporarily unavailable. Check back shortly.</p>
          )}
        </div>

        {/* Can financing be accessed? */}
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="label-caps">Borrowing</span>
            <Link href="/farmer/loans" className="link-action flex items-center gap-0.5">
              Loans <ChevronRight style={{ width: 12, height: 12 }} />
            </Link>
          </div>
          {loan?.eligibility ? (
            <>
              <p className="metric-value tabular-nums">
                KSh {(loan.eligibility.maxAmountKsh ?? 0).toLocaleString()}
              </p>
              <p className="text-sm text-ink-tertiary mt-0.5">Available against stored grain</p>
              {loan.totalOutstanding > 0 && (
                <div className="mt-3 pt-3 border-t border-border-subtle">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-2xs text-ink-muted">Outstanding balance</p>
                      <p className="text-sm font-semibold text-ink tabular-nums">
                        KSh {loan.totalOutstanding.toLocaleString()}
                      </p>
                    </div>
                    <Link href="/farmer/loans" className="btn-primary">
                      <Landmark style={{ width: 13, height: 13 }} />
                      Apply
                    </Link>
                  </div>
                </div>
              )}
              {loan.totalOutstanding === 0 && (
                <div className="mt-3 pt-3 border-t border-border-subtle">
                  <Link href="/farmer/loans" className="btn-primary">
                    <Landmark style={{ width: 13, height: 13 }} />
                    Apply for a Loan
                  </Link>
                </div>
              )}
            </>
          ) : (
            <div className="py-3">
              <p className="text-sm text-ink-secondary mb-0.5">Not yet eligible for borrowing.</p>
              <p className="text-2xs text-ink-tertiary">
                Deposit grain at a warehouse to access receipt-backed financing.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* What requires attention? */}
      {alerts.length > 0 && (
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="label-caps">Recent Alerts</span>
            <Link href="/farmer/alerts" className="link-action flex items-center gap-0.5">
              All alerts <ChevronRight style={{ width: 12, height: 12 }} />
            </Link>
          </div>
          <div className="space-y-1.5">
            {alerts.map((alert: { id: string; category?: string; message: string; createdAt?: string }) => (
              <div
                key={alert.id}
                className={`flex items-start gap-2.5 px-3 py-2 border-l-[3px] ${
                  ALERT_STYLES[alert.category?.toLowerCase() ?? "default"] ?? ALERT_STYLES.default
                }`}
              >
                <Bell style={{ width: 13, height: 13 }} className="mt-0.5 flex-shrink-0 opacity-70" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{alert.message}</p>
                </div>
                {alert.createdAt && (
                  <span className="text-2xs opacity-50 whitespace-nowrap tabular-nums">
                    {formatRelativeTime(alert.createdAt)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {alerts.length === 0 && (
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="label-caps">Alerts</span>
            <Link href="/farmer/alerts" className="link-action flex items-center gap-0.5">
              All alerts <ChevronRight style={{ width: 12, height: 12 }} />
            </Link>
          </div>
          <div className="flex items-center gap-2 py-2">
            <CheckCircle2 style={{ width: 14, height: 14 }} className="text-status-success flex-shrink-0" />
            <p className="text-sm text-ink-secondary">No alerts requiring attention. All conditions normal.</p>
          </div>
        </div>
      )}
    </div>
  );
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function formatRelativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
