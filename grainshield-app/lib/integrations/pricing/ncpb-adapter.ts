import type { PriceAdapter, PriceRecord } from "./pricing-adapter";

const NCPB_REFERENCE_PRICE_KSH_PER_KG = 40.0;
const NCPB_SOURCE_ID = "ncpb";

export class NcpbAdapter implements PriceAdapter {
  readonly sourceId = NCPB_SOURCE_ID;
  readonly sourceName = "NCPB Official Reference";

  async fetchCurrentPrices(grainType = "Maize"): Promise<PriceRecord[]> {
    // NCPB publishes official gazette prices — in production this hits
    // the NCPB API or a scraper endpoint. For now we pull from the
    // database's most recent NCPB-sourced record and fall back to
    // the gazetted reference.
    try {
      const { db } = await import("@/lib/db");
      const latest = await db.marketPrice.findFirst({
        where: { source: { startsWith: "NCPB" }, grainType },
        orderBy: { recordedAt: "desc" },
      });

      if (latest) {
        return [{
          source: this.sourceId,
          market: latest.market,
          grainType: latest.grainType,
          pricePerKg: latest.pricePerKg,
          currency: latest.currency,
          recordedAt: latest.recordedAt,
          confidence: 0.95,
        }];
      }

      return [{
        source: this.sourceId,
        market: "NCPB National",
        grainType,
        pricePerKg: NCPB_REFERENCE_PRICE_KSH_PER_KG,
        currency: "KSh",
        recordedAt: new Date(),
        confidence: 0.7,
      }];
    } catch {
      return [];
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const { db } = await import("@/lib/db");
      const count = await db.marketPrice.count({
        where: { source: { startsWith: "NCPB" } },
      });
      return count > 0;
    } catch {
      return false;
    }
  }
}
