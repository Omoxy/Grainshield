import type { PriceAdapter, PriceRecord } from "./pricing-adapter";

const SOURCE_ID = "regional_markets";
const STALE_THRESHOLD_MS = 48 * 60 * 60 * 1000; // 48 hours

export class MarketAggregationAdapter implements PriceAdapter {
  readonly sourceId = SOURCE_ID;
  readonly sourceName = "Regional Market Aggregation";

  async fetchCurrentPrices(grainType = "Maize"): Promise<PriceRecord[]> {
    try {
      const { db } = await import("@/lib/db");
      const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);

      const markets = await db.marketPrice.findMany({
        where: {
          grainType,
          recordedAt: { gte: cutoff },
          source: { not: { startsWith: "NCPB" } },
        },
        orderBy: { recordedAt: "desc" },
        distinct: ["market"],
        take: 20,
      });

      return markets.map((m) => {
        const ageMs = Date.now() - m.recordedAt.getTime();
        const freshness = Math.max(0, 1 - ageMs / STALE_THRESHOLD_MS);
        return {
          source: this.sourceId,
          market: m.market,
          grainType: m.grainType,
          pricePerKg: m.pricePerKg,
          currency: m.currency,
          recordedAt: m.recordedAt,
          confidence: Math.round(freshness * 90) / 100,
        };
      });
    } catch {
      return [];
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const { db } = await import("@/lib/db");
      const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);
      const count = await db.marketPrice.count({
        where: { recordedAt: { gte: cutoff } },
      });
      return count > 0;
    } catch {
      return false;
    }
  }
}
