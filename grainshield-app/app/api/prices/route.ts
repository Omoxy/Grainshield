import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/api/auth-guard";
import {
  getCurrentPrices,
  getPriceTrends,
  getMonthlyTrend,
  getMarketGuidance,
} from "@/lib/integrations/pricing/pricing-service";

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request, ["farmer", "admin"]);
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") ?? "current";

    switch (type) {
      case "trend": {
        const trend = await getMonthlyTrend();
        return NextResponse.json({ trend });
      }
      case "regional": {
        const prices = await getCurrentPrices();
        return NextResponse.json({
          regional: prices.map((p) => ({
            market: p.market,
            pricePerKg: p.pricePerKg,
            confidence: p.confidence,
            lastUpdated: p.lastUpdated,
            isStale: p.isStale,
          })),
        });
      }
      case "current":
      default: {
        const [prices, trends, monthlyTrend, guidance] = await Promise.all([
          getCurrentPrices(),
          getPriceTrends(),
          getMonthlyTrend(),
          getMarketGuidance(),
        ]);

        const primary = prices[0];

        const matchedTrend = primary
          ? trends.find((t) => t.market === primary.market)
          : null;

        return NextResponse.json({
          current: primary
            ? {
                pricePerKg: primary.pricePerKg,
                currency: primary.currency,
                market: primary.market,
                changePercent: matchedTrend?.changePercent ?? null,
                changeDirection: matchedTrend?.direction ?? "stable",
                confidence: primary.confidence,
                lastUpdated: primary.lastUpdated,
                isStale: primary.isStale,
                sources: primary.sources,
              }
            : null,
          recommendation: guidance,
          trend: monthlyTrend,
          regional: prices.map((p) => ({
            market: p.market,
            pricePerKg: p.pricePerKg,
            confidence: p.confidence,
            lastUpdated: p.lastUpdated,
            isStale: p.isStale,
          })),
          dataAvailable: prices.length > 0,
        });
      }
    }
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
