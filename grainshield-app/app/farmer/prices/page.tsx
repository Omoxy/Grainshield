"use client";

import {
  MapPin,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  AlertCircle,
  Clock,
} from "lucide-react";
import useSWR from "swr";

const fetcher = (url: string) =>
  fetch(url, { credentials: "include" }).then((r) => {
    if (!r.ok) throw new Error("Failed to fetch");
    return r.json();
  });

function getDirectionText(direction: string, percent: number): string {
  const abs = Math.abs(percent);
  if (direction === "up") {
    if (abs > 5) return "Prices have increased significantly compared to last week.";
    return "Prices are trending upward.";
  }
  if (direction === "down") {
    if (abs > 5) return "Prices have dropped compared to last week.";
    return "Prices are trending slightly lower.";
  }
  return "Prices remain stable compared to last week.";
}

function getGuidanceText(recommendation: string): string {
  switch (recommendation) {
    case "hold":
      return "Current market conditions suggest holding. Prices may improve in the coming weeks.";
    case "sell":
      return "Market conditions are favourable for selling. Prices are near recent highs.";
    default:
      return "No strong market signal at this time. Continue monitoring.";
  }
}

export default function PriceIntelligencePage() {
  const { data, isLoading } = useSWR("/api/prices?type=current", fetcher, { revalidateOnFocus: false });

  const current = data?.current ?? null;
  const guidance = data?.recommendation ?? null;
  const regional: { market: string; pricePerKg: number; confidence: number; isStale: boolean }[] =
    data?.regional ?? [];

  return (
    <div className="max-w-4xl">
      <div className="mb-5">
        <h1 className="page-title">Market Prices</h1>
        <p className="page-subtitle">
          Regional maize pricing and market conditions
        </p>
      </div>

      {/* Current price — simple, prominent */}
      <div className="card p-5 mb-4">
        {current ? (
          <>
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="label-caps mb-2">Current Maize Price</p>
                <div className="flex items-end gap-2">
                  <p className="text-2xl font-semibold text-ink tracking-[-0.01em] tabular-nums">
                    KSh {current.pricePerKg?.toFixed(2) ?? "—"}
                  </p>
                  <span className="text-sm text-ink-muted font-normal mb-0.5">per kg</span>
                </div>
              </div>
              {current.changePercent != null && (
                <div className={`flex items-center gap-1 px-2 py-1 ${
                  current.changeDirection === "up" ? "bg-status-success-surface text-status-success"
                    : current.changeDirection === "down" ? "bg-status-danger-surface text-status-danger"
                    : "bg-surface-raised text-ink-muted"
                }`}>
                  {current.changeDirection === "up" ? (
                    <ArrowUpRight style={{ width: 14, height: 14 }} />
                  ) : current.changeDirection === "down" ? (
                    <ArrowDownRight style={{ width: 14, height: 14 }} />
                  ) : (
                    <Minus style={{ width: 14, height: 14 }} />
                  )}
                  <span className="text-sm font-medium tabular-nums">
                    {Math.abs(current.changePercent)}%
                  </span>
                </div>
              )}
            </div>

            {/* Plain-language market interpretation */}
            <p className="text-sm text-ink-secondary">
              {current.changePercent != null
                ? getDirectionText(current.changeDirection, current.changePercent)
                : "Market direction data unavailable."}
            </p>

            <div className="flex items-center gap-3 mt-3 pt-3 border-t border-border-subtle text-2xs text-ink-muted">
              {current.market && (
                <span className="flex items-center gap-1">
                  <MapPin style={{ width: 12, height: 12 }} />
                  {current.market}
                </span>
              )}
              {current.isStale && (
                <span className="flex items-center gap-1 text-status-warning">
                  <Clock style={{ width: 12, height: 12 }} />
                  Price data may be delayed
                </span>
              )}
            </div>
          </>
        ) : (
          <div className="py-3">
            <p className="text-sm text-ink-muted">
              {isLoading ? "Loading current market conditions..." : "Regional pricing is temporarily unavailable. Check back shortly."}
            </p>
          </div>
        )}
      </div>

      {/* Market guidance — plain language, no confidence percentages */}
      {guidance && guidance.recommendation !== "neutral" && (
        <div className={`card p-4 mb-4 border-l-[3px] ${
          guidance.recommendation === "hold"
            ? "border-l-status-warning"
            : guidance.recommendation === "sell"
              ? "border-l-status-success"
              : "border-l-border"
        }`}>
          <p className="label-caps mb-2">Market Guidance</p>
          <p className={`text-sm font-semibold mb-1 ${
            guidance.recommendation === "hold" ? "text-yellow-800"
              : guidance.recommendation === "sell" ? "text-green-800"
              : "text-ink"
          }`}>
            {guidance.recommendation === "hold" ? "Hold"
              : guidance.recommendation === "sell" ? "Consider Selling"
              : "Monitor"}
          </p>
          <p className="text-sm text-ink-tertiary">
            {guidance.reason ?? getGuidanceText(guidance.recommendation)}
          </p>
        </div>
      )}

      {/* Regional prices — location-based, practical */}
      {regional.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-border-subtle">
            <p className="label-caps">Regional Prices</p>
          </div>
          <div className="divide-y divide-border-subtle">
            {regional.map((r) => (
              <div key={r.market} className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-2">
                  <MapPin style={{ width: 14, height: 14 }} className="text-ink-muted" />
                  <span className="text-sm font-medium text-ink">{r.market}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-ink tabular-nums">
                    KSh {r.pricePerKg.toFixed(1)}/kg
                  </span>
                  {r.isStale && (
                    <span className="text-2xs text-status-warning">delayed</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!current && !isLoading && regional.length === 0 && (
        <div className="card p-5">
          <p className="text-sm text-ink-secondary mb-1">Regional pricing data is temporarily unavailable.</p>
          <p className="text-2xs text-ink-tertiary">
            Market prices are sourced from county-level collection points and updated throughout the trading day.
            Check back shortly or contact your cooperative for current rates.
          </p>
        </div>
      )}
    </div>
  );
}
