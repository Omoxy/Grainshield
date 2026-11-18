import type { PriceAdapter, PriceRecord } from "./pricing-adapter";
import { NcpbAdapter } from "./ncpb-adapter";
import { KaceAdapter } from "./kace-adapter";
import { MarketAggregationAdapter } from "./market-aggregation-adapter";
import { RegionalMarketAdapter } from "./regional-market-adapter";
import { getCached, isFresh, setCache, invalidateAll, isStaleButServable } from "./pricing-cache";
import { normalizeAndAggregate, generateMarketSummary, type NormalizedPrice } from "./pricing-normalizer";
import { canExecute, recordSuccess, recordFailure } from "@/lib/services/resilience";

interface PriceTrend {
  market: string;
  currentPrice: number;
  previousPrice: number | null;
  changePercent: number | null;
  direction: "up" | "down" | "stable";
}

const CACHE_KEY = "maize_all";

const adapters: PriceAdapter[] = [
  new NcpbAdapter(),
  new KaceAdapter(),
  new MarketAggregationAdapter(),
  new RegionalMarketAdapter(),
];

async function fetchAllPrices(grainType = "Maize"): Promise<PriceRecord[]> {
  const cacheKey = `${CACHE_KEY}_${grainType}`;

  if (isFresh(cacheKey)) {
    return getCached(cacheKey)!;
  }

  const allRecords: PriceRecord[] = [];
  const fetchPromises = adapters.map(async (adapter) => {
    const serviceId = `price_${adapter.sourceId}`;
    if (!canExecute(serviceId)) return [];

    try {
      const records = await adapter.fetchCurrentPrices(grainType);
      if (records.length > 0) recordSuccess(serviceId);
      return records;
    } catch {
      recordFailure(serviceId);
      return [];
    }
  });

  const results = await Promise.allSettled(fetchPromises);
  for (const result of results) {
    if (result.status === "fulfilled") {
      allRecords.push(...result.value);
    }
  }

  if (allRecords.length > 0) {
    setCache(cacheKey, allRecords);
  } else {
    const stale = getCached(cacheKey);
    if (stale) return stale;
  }

  return allRecords;
}

export async function getCurrentPrices(grainType = "Maize"): Promise<NormalizedPrice[]> {
  const records = await fetchAllPrices(grainType);
  return normalizeAndAggregate(records);
}

export async function getMarketSummaryText(grainType = "Maize"): Promise<string> {
  const prices = await getCurrentPrices(grainType);
  return generateMarketSummary(prices);
}

export async function getPriceTrends(grainType = "Maize"): Promise<PriceTrend[]> {
  try {
    const { db } = await import("@/lib/db");
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);

    const recentPrices = await db.marketPrice.findMany({
      where: { grainType, recordedAt: { gte: twoDaysAgo } },
      orderBy: { recordedAt: "desc" },
    });

    const markets = [...new Set(recentPrices.map((p) => p.market))];
    const trends: PriceTrend[] = [];

    for (const market of markets) {
      const marketPrices = recentPrices.filter((p) => p.market === market);
      const current = marketPrices.find((p) => p.recordedAt >= oneDayAgo);
      const previous = marketPrices.find((p) => p.recordedAt < oneDayAgo);

      if (current) {
        const changePercent = previous
          ? Math.round(((current.pricePerKg - previous.pricePerKg) / previous.pricePerKg) * 10000) / 100
          : null;

        trends.push({
          market,
          currentPrice: current.pricePerKg,
          previousPrice: previous?.pricePerKg ?? null,
          changePercent,
          direction: changePercent === null || Math.abs(changePercent) < 0.5
            ? "stable"
            : changePercent > 0 ? "up" : "down",
        });
      }
    }

    return trends;
  } catch {
    return [];
  }
}

export async function getMonthlyTrend(grainType = "Maize", months = 6): Promise<{
  month: string;
  avg: number;
  high: number;
  low: number;
}[]> {
  try {
    const { db } = await import("@/lib/db");
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);

    const prices = await db.marketPrice.findMany({
      where: { grainType, recordedAt: { gte: cutoff } },
      orderBy: { recordedAt: "asc" },
    });

    if (prices.length === 0) return [];

    const byMonth = new Map<string, number[]>();
    for (const p of prices) {
      const key = p.recordedAt.toLocaleString("en", { month: "short" });
      const existing = byMonth.get(key) ?? [];
      existing.push(p.pricePerKg);
      byMonth.set(key, existing);
    }

    return Array.from(byMonth.entries()).map(([month, vals]) => ({
      month,
      avg: Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 100) / 100,
      high: Math.round(Math.max(...vals) * 100) / 100,
      low: Math.round(Math.min(...vals) * 100) / 100,
    }));
  } catch {
    return [];
  }
}

export async function getMarketGuidance(grainType = "Maize"): Promise<{
  recommendation: "hold" | "sell" | "neutral";
  reason: string;
  confidence: number;
}> {
  const trends = await getPriceTrends(grainType);
  if (trends.length === 0) {
    return {
      recommendation: "neutral",
      reason: "Insufficient price data to provide guidance. Check back when market feeds are active.",
      confidence: 0,
    };
  }

  const upCount = trends.filter((t) => t.direction === "up").length;
  const downCount = trends.filter((t) => t.direction === "down").length;
  const avgChange = trends
    .filter((t) => t.changePercent !== null)
    .reduce((s, t) => s + (t.changePercent ?? 0), 0) / Math.max(trends.length, 1);

  if (upCount > downCount && avgChange > 1) {
    return {
      recommendation: "hold",
      reason: "Prices are trending upward across most markets. Consider holding for potentially better returns.",
      confidence: Math.min(0.85, upCount / trends.length),
    };
  }

  if (downCount > upCount && avgChange < -1) {
    return {
      recommendation: "sell",
      reason: "Prices are declining across multiple markets. Consider selling to secure current value.",
      confidence: Math.min(0.85, downCount / trends.length),
    };
  }

  return {
    recommendation: "neutral",
    reason: "Market conditions are mixed. Monitor price movements before making a decision.",
    confidence: 0.5,
  };
}

export function invalidatePriceCache(): void {
  invalidateAll();
}
