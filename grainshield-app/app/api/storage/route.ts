import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/api/auth-guard";
import { getFarmerStorageSummary } from "@/lib/integrations/warehouse/warehouse-sync-service";

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request, ["farmer", "admin"]);
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const receiptId = searchParams.get("receiptId");

    const userId = auth.ctx.sub;
    const storage = await getFarmerStorageSummary(userId);

    if (receiptId) {
      if (receiptId.length > 50) {
        return NextResponse.json({ error: "Invalid receipt ID" }, { status: 400 });
      }
      const receipt = storage.receipts.find((r) => r.receiptCode === receiptId);
      if (!receipt) {
        return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
      }
      return NextResponse.json({ receipt });
    }

    const healthOverview = {
      safe: storage.receipts.filter((r) => r.healthStatus === "safe").length,
      caution: storage.receipts.filter((r) => r.healthStatus === "caution").length,
      risk: storage.receipts.filter((r) => r.healthStatus === "risk").length,
    };

    return NextResponse.json({
      summary: {
        totalStoredKg: storage.totalStoredKg,
        receiptsCount: storage.receipts.length,
        healthOverview,
      },
      receipts: storage.receipts.map((r) => ({
        id: r.receiptCode,
        warehouseName: r.warehouseName,
        location: r.warehouseLocation,
        grainType: "Maize",
        quantityKg: r.quantityKg,
        grade: r.grade,
        depositDate: r.depositDate.toISOString().split("T")[0],
        daysInStorage: Math.floor((Date.now() - r.depositDate.getTime()) / (86400000)),
        temperatureC: r.temperatureC,
        humidityPct: r.humidityPct,
        moisturePct: r.moisturePct,
        healthStatus: r.healthStatus,
      })),
      dataAvailable: storage.receipts.length > 0,
    });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
