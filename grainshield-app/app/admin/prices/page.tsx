"use client";

import {
  TrendingUp,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  MapPin,
  Radio,
  AlertTriangle,
} from "lucide-react";
import useSWR from "swr";

const fetcher = (url: string) =>
  fetch(url, { credentials: "include" }).then((r) => {
    if (!r.ok) throw new Error("Failed to fetch");
    return r.json();
  });

interface MarketFeed {
  market: string;
  pricePerKg: number;
  confidence: number;
  isStale: boolean;
}

interface TrendPoint {
  month: string;
  avg: number;
  high: number;
  low: number;
}

export default function AdminPricesPage() {
  const { data, isLoading } = useSWR("/api/prices?type=current", fetcher, { revalidateOnFocus: false });

  const current = data?.current ?? null;
  const trend: TrendPoint[] = data?.trend ?? [];
  const regional: MarketFeed[] = data?.regional ?? [];
  const guidance = data?.recommendation ?? null;

  const highestFeed = regional.length > 0 ? regional.reduce((a, b) => a.pricePerKg > b.pricePerKg ? a : b) : null;
  const lowestFeed = regional.length > 0 ? regional.reduce((a, b) => a.pricePerKg < b.pricePerKg ? a : b) : null;
  const activeFeedsCount = regional.filter((f) => !f.isStale).length;
  const spread = highestFeed && lowestFeed ? (highestFeed.pricePerKg - lowestFeed.pricePerKg).toFixed(1) : null;

  return (
    <div className="max-w-7xl">
      <div className="mb-4">
        <h1 className="page-title">Price Intelligence</h1>
        <p className="page-subtitle">Regional market feeds and price trend data</p>
      </div>

      {/* Price anchor — dominant, not a card in a grid */}
      <div className="border border-border bg-white mb-5">
        <div className="flex flex-col lg:flex-row">
          {/* Current price: large, dominant */}
          <div className="flex-shrink-0 lg:w-[320px] px-6 py-5 lg:border-r border-b lg:border-b-0 border-border-subtle">
            <div className="flex items-center gap-2 mb-3">
              <Radio style={{ width: 10, height: 10 }} className="text-status-success animate-pulse-subtle" />
              <span className="text-2xs text-ink-muted uppercase tracking-wide">Live Market Price</span>
            </div>
            <div className="flex items-end gap-3">
              <p className="text-3xl font-bold text-ink tracking-[-0.02em] tabular-nums">
                {current ? `KSh ${current.pricePerKg?.toFixed(1)}` : "—"}
              </p>
              <span className="text-sm text-ink-muted mb-1">/kg</span>
            </div>
            {current?.changePercent != null && (
              <div className={`flex items-center gap-1 mt-2 ${
                current.changeDirection === "up" ? "text-status-success" : current.changeDirection === "down" ? "text-status-danger" : "text-ink-muted"
              }`}>
                {current.changeDirection === "up" ? <ArrowUpRight style={{ width: 14, height: 14 }} /> : current.changeDirection === "down" ? <ArrowDownRight style={{ width: 14, height: 14 }} /> : <Minus style={{ width: 14, height: 14 }} />}
                <span className="text-sm font-semibold tabular-nums">{Math.abs(current.changePercent)}%</span>
                <span className="text-2xs text-ink-muted ml-1">vs yesterday</span>
              </div>
            )}
            {guidance && guidance.recommendation !== "neutral" && (
              <div className={`mt-4 pt-3 border-t border-border-subtle`}>
                <span className="text-2xs text-ink-muted uppercase tracking-wide">Signal</span>
                <p className={`text-sm font-bold mt-0.5 ${
                  guidance.recommendation === "hold" ? "text-yellow-800"
                    : guidance.recommendation === "sell" ? "text-green-800"
                    : "text-ink"
                }`}>
                  {guidance.recommendation === "hold" ? "Hold" : guidance.recommendation === "sell" ? "Consider Selling" : "Monitor"}
                </p>
                {guidance.reason && (
                  <p className="text-2xs text-ink-tertiary mt-1">{guidance.reason}</p>
                )}
              </div>
            )}
          </div>

          {/* Summary metrics — vertical stack, not horizontal cards */}
          <div className="flex-1 flex flex-col lg:flex-row divide-y lg:divide-y-0 lg:divide-x divide-border-subtle">
            <div className="flex-1 px-5 py-4">
              <span className="text-2xs text-ink-muted uppercase tracking-wide">Highest Market</span>
              <p className="text-lg font-bold text-ink tabular-nums mt-1">{highestFeed ? `KSh ${highestFeed.pricePerKg.toFixed(1)}` : "—"}</p>
              {highestFeed && <p className="text-2xs text-ink-tertiary mt-0.5">{highestFeed.market}</p>}
            </div>
            <div className="flex-1 px-5 py-4">
              <span className="text-2xs text-ink-muted uppercase tracking-wide">Lowest Market</span>
              <p className="text-lg font-bold text-ink tabular-nums mt-1">{lowestFeed ? `KSh ${lowestFeed.pricePerKg.toFixed(1)}` : "—"}</p>
              {lowestFeed && <p className="text-2xs text-ink-tertiary mt-0.5">{lowestFeed.market}</p>}
            </div>
            <div className="flex-1 px-5 py-4">
              <span className="text-2xs text-ink-muted uppercase tracking-wide">Spread</span>
              <p className="text-lg font-bold text-ink tabular-nums mt-1">{spread ? `KSh ${spread}` : "—"}</p>
              <p className="text-2xs text-ink-tertiary mt-0.5">High to low</p>
            </div>
            <div className="flex-1 px-5 py-4">
              <span className="text-2xs text-ink-muted uppercase tracking-wide">Feed Status</span>
              <p className="text-lg font-bold text-status-success tabular-nums mt-1">
                {regional.length > 0 ? `${activeFeedsCount}/${regional.length}` : "—"}
              </p>
              <p className="text-2xs text-ink-tertiary mt-0.5">active</p>
            </div>
          </div>
        </div>
      </div>

      {/* Regional feeds + Trend — asymmetric two-column */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        {/* Regional feeds: 3/5 — location-led, each feed is a row with visual bar */}
        <div className="lg:col-span-3">
          <div className="flex items-center gap-2 mb-3">
            <MapPin style={{ width: 13, height: 13 }} className="text-ink-muted" />
            <span className="text-2xs font-semibold text-ink-tertiary uppercase tracking-wide">Regional Market Feeds</span>
          </div>

          {regional.length > 0 ? (
            <div className="space-y-1">
              {regional.map((feed) => {
                const maxPrice = Math.max(...regional.map((f) => f.pricePerKg));
                const barPct = maxPrice > 0 ? (feed.pricePerKg / maxPrice) * 100 : 0;
                return (
                  <div key={feed.market} className="bg-white border border-border px-4 py-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${feed.isStale ? "bg-status-warning" : "bg-status-success"}`} />
                        <span className="text-sm font-medium text-ink">{feed.market}</span>
                        {feed.isStale && (
                          <span className="text-2xs text-status-warning flex items-center gap-0.5">
                            <AlertTriangle style={{ width: 10, height: 10 }} /> delayed
                          </span>
                        )}
                      </div>
                      <span className="text-sm font-bold text-ink tabular-nums">KSh {feed.pricePerKg.toFixed(1)}/kg</span>
                    </div>
                    <div className="w-full h-1 bg-surface-sunken">
                      <div
                        className={`h-full transition-all ${
                          feed.market === highestFeed?.market ? "bg-brand-500" : "bg-brand-200"
                        }`}
                        style={{ width: `${barPct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : !isLoading ? (
            <div className="bg-white border border-border px-4 py-5">
              <p className="text-sm text-ink-secondary mb-0.5">No market feed data available.</p>
              <p className="text-2xs text-ink-tertiary">Regional feeds populate as county-level pricing sources are connected.</p>
            </div>
          ) : null}
        </div>

        {/* Trend: 2/5 — vertical timeline, not a separate card */}
        <div className="lg:col-span-2">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp style={{ width: 13, height: 13 }} className="text-ink-muted" />
            <span className="text-2xs font-semibold text-ink-tertiary uppercase tracking-wide">Price Trend (KSh/kg)</span>
          </div>

          {trend.length > 0 ? (
            <div className="bg-white border border-border p-4">
              <div className="space-y-2.5">
                {trend.map((m, i) => {
                  const maxVal = Math.max(...trend.map((t) => t.high || t.avg));
                  const widthPct = maxVal > 0 ? (m.avg / maxVal) * 100 : 0;
                  const isLatest = i === trend.length - 1;
                  return (
                    <div key={m.month}>
                      <div className="flex items-center justify-between mb-1">
                        <span className={`text-2xs ${isLatest ? "font-semibold text-ink" : "text-ink-muted"}`}>{m.month}</span>
                        <span className="text-2xs text-ink-muted tabular-nums">{m.low.toFixed(1)} – {m.high.toFixed(1)}</span>
                      </div>
                      <div className="w-full bg-surface-sunken h-5 relative overflow-hidden">
                        <div
                          className={`h-full ${isLatest ? "bg-brand-500" : "bg-brand-200"} flex items-center justify-end pr-2`}
                          style={{ width: `${widthPct}%` }}
                        >
                          <span className={`text-[10px] font-semibold tabular-nums ${isLatest ? "text-white" : "text-brand-700"}`}>
                            {m.avg.toFixed(1)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : !isLoading ? (
            <div className="bg-white border border-border px-4 py-5">
              <p className="text-sm text-ink-secondary mb-0.5">No trend data available for this period.</p>
              <p className="text-2xs text-ink-tertiary">Price trends require at least two months of historical data from active feeds.</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
