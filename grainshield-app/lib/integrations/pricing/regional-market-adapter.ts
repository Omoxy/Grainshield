import type { PriceAdapter, PriceRecord } from "./pricing-adapter";

const SOURCE_ID = "regional_field";
const STALE_THRESHOLD_MS = 48 * 60 * 60 * 1000;

const REGIONAL_MARKETS = [
  "Eldoret Main",
  "Kitale Town",
  "Moiben",
  "Turbo",
  "Endebess",
  "Ziwa",
  "Soy",
  "Kabiyet",
  "Moi's Bridge",
  "Cherangany",
];

export class RegionalMarketAdapter implements PriceAdapter {
  readonly sourceId = SOURCE_ID;
  readonly sourceName = "Regional Field Markets";

  async fetchCurrentPrices(grainType = "Maize"): Promise<PriceRecord[]> {
    try {
      const { db } = await import("@/lib/db");

      const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);
      const records = await db.marketPrice.findMany({
        where: {
          grainType,
          recordedAt: { gte: cutoff },
          source: { not: { in: ["NCPB", "KACE"] } },
          market: { in: REGIONAL_MARKETS },
        },
        orderBy: { recordedAt: "desc" },
        distinct: ["market"],
        take: 15,
      });

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
          confidence: Math.round(freshness * 75) / 100,
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
        where: {
          market: { in: REGIONAL_MARKETS },
          recordedAt: { gte: cutoff },
        },
      });
      return count > 0;
    } catch {
      return false;
    }
  }
}
