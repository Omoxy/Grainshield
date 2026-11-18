import { NextResponse } from "next/server";
import {
  initializeOperationalSystem,
  getOrchestratorStatus,
  executeInitialHydration,
} from "@/lib/jobs/sync-orchestrator";

let bootPromise: Promise<void> | null = null;

export async function GET() {
  try {
    const status = getOrchestratorStatus();

    if (!status.initialized) {
      if (!bootPromise) {
        bootPromise = initializeOperationalSystem().finally(() => {
          bootPromise = null;
        });
      }
      await bootPromise;
    }

    const updatedStatus = getOrchestratorStatus();

    const { db } = await import("@/lib/db");
    const [
      userCount,
      farmerCount,
      warehouseCount,
      receiptCount,
      priceCount,
      grainLotCount,
      syncLogCount,
      alertCount,
      eventCount,
    ] = await Promise.all([
      db.user.count(),
      db.farmerProfile.count(),
      db.warehouse.count(),
      db.warehouseReceipt.count(),
      db.marketPrice.count(),
      db.grainLot.count(),
      db.dataSyncLog.count(),
      db.alert.count(),
      db.operationalEvent.count(),
    ]);

    const latestSync = await db.dataSyncLog.findFirst({
      orderBy: { syncedAt: "desc" },
    });

    return NextResponse.json({
      status: "operational",
      orchestrator: updatedStatus,
      database: {
        users: userCount,
        farmers: farmerCount,
        warehouses: warehouseCount,
        receipts: receiptCount,
        marketPrices: priceCount,
        grainLots: grainLotCount,
        syncLogs: syncLogCount,
        alerts: alertCount,
        operationalEvents: eventCount,
      },
      latestSync: latestSync
        ? { source: latestSync.source, status: latestSync.status, at: latestSync.syncedAt }
        : null,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[Hydrate] Error:", err);
    return NextResponse.json(
      {
        status: "error",
        error: err instanceof Error ? err.message : String(err),
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
}

export async function POST() {
  try {
    const result = await executeInitialHydration();

    return NextResponse.json({
      status: "hydrated",
      result,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { status: "error", error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
