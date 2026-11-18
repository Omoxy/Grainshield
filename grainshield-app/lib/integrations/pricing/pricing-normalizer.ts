import type { PriceRecord } from "./pricing-adapter";

const KG_PER_BAG_90KG = 90;
const KG_PER_BAG_50KG = 50;

export interface NormalizedPrice {
  market: string;
  pricePerKg: number;
  pricePerBag90: number;
  currency: string;
  confidence: number;
  sources: string[];
  lastUpdated: Date;
  isStale: boolean;
  staleSince: Date | null;
}

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export function normalizeAndAggregate(records: PriceRecord[]): NormalizedPrice[] {
  if (records.length === 0) return [];

  const byMarket = new Map<string, PriceRecord[]>();
  for (const r of records) {
    const key = normalizeMarketName(r.market);
    const existing = byMarket.get(key) ?? [];
    existing.push(r);
    byMarket.set(key, existing);
  }

  const results: NormalizedPrice[] = [];

  for (const [market, marketRecords] of byMarket) {
    const validated = marketRecords.filter((r) => r.pricePerKg > 0 && r.pricePerKg < 200);
    if (validated.length === 0) continue;

    const totalWeight = validated.reduce((s, r) => s + r.confidence, 0);
    const weightedPrice =
      totalWeight > 0
        ? validated.reduce((s, r) => s + r.pricePerKg * r.confidence, 0) / totalWeight
        : validated.reduce((s, r) => s + r.pricePerKg, 0) / validated.length;

    const avgConfidence = totalWeight / validated.length;
    const latestDate = new Date(
      Math.max(...validated.map((r) => r.recordedAt.getTime()))
    );
    const ageMs = Date.now() - latestDate.getTime();
    const isStale = ageMs > STALE_THRESHOLD_MS;

    results.push({
      market,
      pricePerKg: roundPrice(weightedPrice),
      pricePerBag90: roundPrice(weightedPrice * KG_PER_BAG_90KG),
      currency: "KSh",
      confidence: roundConfidence(avgConfidence),
      sources: [...new Set(validated.map((r) => r.source))],
      lastUpdated: latestDate,
      isStale,
      staleSince: isStale ? latestDate : null,
    });
  }

  return results.sort((a, b) => b.confidence - a.confidence);
}

export function convertUnits(
  pricePerKg: number,
  targetUnit: "kg" | "bag_90" | "bag_50" | "ton"
): number {
  switch (targetUnit) {
    case "kg":
      return pricePerKg;
    case "bag_90":
      return roundPrice(pricePerKg * KG_PER_BAG_90KG);
    case "bag_50":
      return roundPrice(pricePerKg * KG_PER_BAG_50KG);
    case "ton":
      return roundPrice(pricePerKg * 1000);
  }
}

export function generateMarketSummary(prices: NormalizedPrice[]): string {
  if (prices.length === 0) {
    return "Market data is currently unavailable. Check back when feeds are active.";
  }

  const nonStale = prices.filter((p) => !p.isStale);
  if (nonStale.length === 0) {
    return "Market data is delayed. Last available prices may not reflect current conditions.";
  }

  const avgPrice = nonStale.reduce((s, p) => s + p.pricePerKg, 0) / nonStale.length;
  const highest = nonStale.reduce((a, b) => (a.pricePerKg > b.pricePerKg ? a : b));
  const lowest = nonStale.reduce((a, b) => (a.pricePerKg < b.pricePerKg ? a : b));

  const spread = highest.pricePerKg - lowest.pricePerKg;
  const spreadPct = (spread / avgPrice) * 100;

  if (spreadPct < 3) {
    return `Regional maize prices are steady around KSh ${avgPrice.toFixed(1)}/kg across ${nonStale.length} markets.`;
  }

  if (spreadPct < 8) {
    return `Maize prices range from KSh ${lowest.pricePerKg.toFixed(1)} to ${highest.pricePerKg.toFixed(1)}/kg. ${highest.market} is currently the strongest market.`;
  }

  return `Significant price variation across markets. ${highest.market} at KSh ${highest.pricePerKg.toFixed(1)}/kg, ${lowest.market} at KSh ${lowest.pricePerKg.toFixed(1)}/kg. Check local conditions before selling.`;
}

function normalizeMarketName(name: string): string {
  return name
    .replace(/\s+/g, " ")
    .trim()
    .replace(/market$/i, "")
    .replace(/\s+$/, "")
    .replace(/^ncpb\s*/i, "NCPB ")
    .trim();
}

function roundPrice(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundConfidence(value: number): number {
  return Math.round(value * 100) / 100;
}
