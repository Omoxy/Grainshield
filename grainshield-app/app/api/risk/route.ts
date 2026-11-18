import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/api/auth-guard";
import { getRegionalWeatherRisks, getStorageWeatherRisks } from "@/lib/integrations/weather/weather-risk-service";
import { getWarehouseSummaries } from "@/lib/integrations/warehouse/warehouse-sync-service";

async function getDb() {
  try {
    const { db } = await import("@/lib/db");
    return db;
  } catch {
    return null;
  }
}

async function getExposure() {
  const db = await getDb();
  if (!db) return null;

  const [receipts, loans, claims, farmers] = await Promise.all([
    db.warehouseReceipt.aggregate({
      where: { deletedAt: null },
      _sum: { quantityKg: true, estimatedValueKsh: true },
    }),
    db.loan.aggregate({
      where: { status: { in: ["ACTIVE", "DISBURSED"] } },
      _sum: { amountKsh: true },
    }),
    db.claim.aggregate({
      where: { status: { in: ["SUBMITTED", "IN_REVIEW"] } },
      _sum: { amountClaimedKsh: true },
      _count: true,
    }),
    db.user.count({
      where: { role: "FARMER", accountStatus: "APPROVED" },
    }),
  ]);

  const totalGrainKg = receipts._sum.quantityKg ?? 0;
  const totalValueKsh = receipts._sum.estimatedValueKsh ?? 0;
  const totalLoansKsh = loans._sum.amountKsh ?? 0;

  return {
    totalGrainKg,
    totalValueKsh,
    totalLoansKsh,
    ltvPercent: totalValueKsh > 0 ? Math.round((totalLoansKsh / totalValueKsh) * 100) : 0,
    pendingClaimsKsh: claims._sum.amountClaimedKsh ?? 0,
    pendingClaimsCount: claims._count,
    activeFarmers: farmers,
  };
}

async function getRegionalRisk() {
  const db = await getDb();
  if (!db) return [];

  const profiles = await db.farmerProfile.findMany({
    select: { county: true, ward: true },
  });

  const byWard = new Map<string, number>();
  for (const p of profiles) {
    const key = p.ward;
    byWard.set(key, (byWard.get(key) ?? 0) + 1);
  }

  const risks = await db.operationalEvent.findMany({
    where: { category: "weather", resolvedAt: null },
    select: { payload: true },
  });

  const riskByRegion = new Map<string, number>();
  for (const r of risks) {
    try {
      const payload = r.payload ? JSON.parse(r.payload) : {};
      const region = payload.region ?? payload.ward;
      if (region) {
        riskByRegion.set(region, (riskByRegion.get(region) ?? 0) + 1);
      }
    } catch { /* skip */ }
  }

  return Array.from(byWard.entries()).map(([ward, farmers]) => {
    const riskEvents = riskByRegion.get(ward) ?? 0;
    const riskScore = Math.min(100, riskEvents * 15 + (farmers > 100 ? 10 : 0));
    return {
      region: ward,
      farmers,
      riskScore,
      level: riskScore >= 50 ? "high" : riskScore >= 25 ? "medium" : "low",
    };
  });
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request, ["admin"]);
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type");

    switch (type) {
      case "exposure": {
        const exposure = await getExposure();
        return NextResponse.json({ exposure, dataAvailable: exposure !== null });
      }
      case "weather": {
        const weatherRisks = await getRegionalWeatherRisks();
        return NextResponse.json({ weatherRisks, dataAvailable: weatherRisks.length > 0 });
      }
      case "storage": {
        const [warehouseRisks, storageWeather] = await Promise.all([
          getWarehouseSummaries(),
          getStorageWeatherRisks(),
        ]);
        const storageRisks = warehouseRisks.map((w) => {
          const weather = storageWeather.find((s) => s.warehouseId === w.code);
          return {
            warehouse: w.name,
            warehouseId: w.code,
            risk: w.riskFlags.length > 0 || w.status === "offline" ? "high"
              : (weather?.moistureRisk ? "medium" : "low"),
            issue: w.riskFlags.length > 0 ? w.riskFlags.join("; ") : "All systems normal",
            humidityPct: w.humidityPct ?? 0,
            tempC: w.temperatureC ?? 0,
            lastReading: w.lastSensorReading,
          };
        });
        return NextResponse.json({ storageRisks, dataAvailable: storageRisks.length > 0 });
      }
      case "regional": {
        const regionalRisk = await getRegionalRisk();
        return NextResponse.json({ regionalRisk, dataAvailable: regionalRisk.length > 0 });
      }
      default: {
        const [exposure, weatherRisks, warehouses, regionalRisk] = await Promise.all([
          getExposure(),
          getRegionalWeatherRisks(),
          getWarehouseSummaries(),
          getRegionalRisk(),
        ]);
        return NextResponse.json({
          exposure,
          weatherRisks,
          storageRisks: warehouses.map((w) => ({
            warehouse: w.name,
            warehouseId: w.code,
            risk: w.riskFlags.length > 0 || w.status === "offline" ? "high" : "low",
            issue: w.riskFlags.length > 0 ? w.riskFlags.join("; ") : "All systems normal",
            humidityPct: w.humidityPct ?? 0,
            tempC: w.temperatureC ?? 0,
          })),
          regionalRisk,
          dataAvailable: exposure !== null,
        });
      }
    }
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
