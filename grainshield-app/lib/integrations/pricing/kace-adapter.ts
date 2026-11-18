import type { PriceAdapter, PriceRecord } from "./pricing-adapter";

const SOURCE_ID = "kace";
const STALE_THRESHOLD_MS = 72 * 60 * 60 * 1000;

export class KaceAdapter implements PriceAdapter {
  readonly sourceId = SOURCE_ID;
  readonly sourceName = "Kenya Agricultural Commodity Exchange";

  async fetchCurrentPrices(grainType = "Maize"): Promise<PriceRecord[]> {
    try {
      const { db } = await import("@/lib/db");

      const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);
      const records = await db.marketPrice.findMany({
        where: {
          source: { startsWith: "KACE" },
          grainType,
          recordedAt: { gte: cutoff },
        },
        orderBy: { recordedAt: "desc" },
        distinct: ["market"],
        take: 10,
      });

      if (records.length > 0) {
        return records.map((r) => {
          const ageMs = Date.now() - r.recordedAt.getTime();
          const freshness = Math.max(0, 1 - ageMs / STALE_THRESHOLD_MS);
          return {
            source: this.sourceId,
            market: r.market,
            grainType: r.grainType,
            pricePerKg: r.pricePerKg,
            currency: r.currency,
            recordedAt: r.recordedAt,
            confidence: Math.round(freshness * 85) / 100,
          };
        });
      }

      return [];
    } catch {
      return [];
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const { db } = await import("@/lib/db");
      const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);
      const count = await db.marketPrice.count({
        where: { source: { startsWith: "KACE" }, recordedAt: { gte: cutoff } },
      });
      return count > 0;
    } catch {
      return false;
    }
  }
}
