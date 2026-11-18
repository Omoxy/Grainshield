async function getDb() {
  try {
    const { db } = await import("@/lib/db");
    return db;
  } catch {
    return null;
  }
}

export interface MoistureReading {
  receiptCode: string;
  moisturePct: number;
  method: "manual" | "sensor" | "lab";
  recordedAt: Date;
  operatorId: string;
}

export interface MoistureTrend {
  receiptCode: string;
  readings: { date: Date; pct: number }[];
  currentPct: number | null;
  trending: "rising" | "falling" | "stable" | "unknown";
  requiresAction: boolean;
}

const SAFE_MOISTURE_MAX = 13.5;
const RISING_THRESHOLD = 0.5;

export async function recordMoistureReading(reading: MoistureReading): Promise<{
  success: boolean;
  warning?: string;
  error?: string;
}> {
  try {
    const db = await getDb();
    if (!db) return { success: false, error: "Database unavailable" };

    const receipt = await db.warehouseReceipt.findFirst({
      where: { receiptCode: reading.receiptCode, deletedAt: null },
    });

    if (!receipt) {
      return { success: false, error: `Receipt ${reading.receiptCode} not found` };
    }

    await db.warehouseReceipt.update({
      where: { id: receipt.id },
      data: { moisturePct: reading.moisturePct },
    });

    await db.auditLog.create({
      data: {
        actorId: reading.operatorId,
        actorRole: "operator",
        action: "MOISTURE_RECORDED",
        actionType: "update",
        category: "WAREHOUSE",
        targetId: receipt.id,
        targetType: "warehouse_receipt",
        targetLabel: reading.receiptCode,
        details: JSON.stringify({
          moisturePct: reading.moisturePct,
          method: reading.method,
        }),
        ipAddress: "system",
      },
    });

    let warning: string | undefined;
    if (reading.moisturePct > SAFE_MOISTURE_MAX) {
      warning = `Moisture ${reading.moisturePct}% exceeds safe threshold of ${SAFE_MOISTURE_MAX}%. Immediate attention required.`;

      await db.alert.create({
        data: {
          userId: receipt.userId,
          title: `High moisture alert: ${reading.receiptCode}`,
          message: warning,
          severity: "HIGH",
          category: "STORAGE",
        },
      });
    }

    return { success: true, warning };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to record moisture",
    };
  }
}

export async function getMoistureTrend(
  receiptCode: string
): Promise<MoistureTrend> {
  try {
    const db = await getDb();
    if (!db) {
      return {
        receiptCode,
        readings: [],
        currentPct: null,
        trending: "unknown",
        requiresAction: false,
      };
    }

    const logs = await db.auditLog.findMany({
      where: {
        action: "MOISTURE_RECORDED",
        targetLabel: receiptCode,
      },
      orderBy: { createdAt: "asc" },
      take: 30,
    });

    const readings = logs.map((log) => {
      let details: Record<string, unknown> = {};
      try {
        details = JSON.parse(log.details ?? "{}");
      } catch { /* ignore */ }
      return {
        date: log.createdAt,
        pct: (details.moisturePct as number) ?? 0,
      };
    });

    if (readings.length === 0) {
      const receipt = await db.warehouseReceipt.findFirst({
        where: { receiptCode, deletedAt: null },
        select: { moisturePct: true },
      });

      return {
        receiptCode,
        readings: [],
        currentPct: receipt?.moisturePct ?? null,
        trending: "unknown",
        requiresAction: (receipt?.moisturePct ?? 0) > SAFE_MOISTURE_MAX,
      };
    }

    const currentPct = readings[readings.length - 1].pct;
    let trending: MoistureTrend["trending"] = "stable";

    if (readings.length >= 2) {
      const recent = readings.slice(-3);
      const avgRecent = recent.reduce((s, r) => s + r.pct, 0) / recent.length;
      const older = readings.slice(0, Math.max(1, readings.length - 3));
      const avgOlder = older.reduce((s, r) => s + r.pct, 0) / older.length;

      const diff = avgRecent - avgOlder;
      if (diff > RISING_THRESHOLD) trending = "rising";
      else if (diff < -RISING_THRESHOLD) trending = "falling";
    }

    return {
      receiptCode,
      readings,
      currentPct,
      trending,
      requiresAction: currentPct > SAFE_MOISTURE_MAX || trending === "rising",
    };
  } catch {
    return {
      receiptCode,
      readings: [],
      currentPct: null,
      trending: "unknown",
      requiresAction: false,
    };
  }
}
