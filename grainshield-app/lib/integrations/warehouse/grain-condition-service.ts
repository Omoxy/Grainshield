async function getDb() {
  try {
    const { db } = await import("@/lib/db");
    return db;
  } catch {
    return null;
  }
}

export interface GrainConditionLog {
  receiptCode: string;
  warehouseName: string;
  temperatureC: number | null;
  humidityPct: number | null;
  moisturePct: number | null;
  healthStatus: "safe" | "caution" | "risk";
  conditionNotes: string | null;
  recordedAt: Date;
}

export async function logGrainCondition(params: {
  receiptCode: string;
  temperatureC?: number;
  humidityPct?: number;
  moisturePct?: number;
  healthStatus?: "SAFE" | "CAUTION" | "AT_RISK";
  notes?: string;
  operatorId: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const db = await getDb();
    if (!db) return { success: false, error: "Database unavailable" };

    const receipt = await db.warehouseReceipt.findFirst({
      where: { receiptCode: params.receiptCode, deletedAt: null },
    });

    if (!receipt) {
      return { success: false, error: `Receipt ${params.receiptCode} not found` };
    }

    const updateData: Record<string, unknown> = {};
    if (params.temperatureC !== undefined) updateData.temperatureC = params.temperatureC;
    if (params.humidityPct !== undefined) updateData.humidityPct = params.humidityPct;
    if (params.moisturePct !== undefined) updateData.moisturePct = params.moisturePct;
    if (params.healthStatus) updateData.healthStatus = params.healthStatus;

    await db.warehouseReceipt.update({
      where: { id: receipt.id },
      data: updateData as never,
    });

    await db.auditLog.create({
      data: {
        actorId: params.operatorId,
        actorRole: "operator",
        action: "CONDITION_UPDATED",
        actionType: "update",
        category: "WAREHOUSE",
        targetId: receipt.id,
        targetType: "warehouse_receipt",
        targetLabel: params.receiptCode,
        details: JSON.stringify({
          ...updateData,
          notes: params.notes,
        }),
        ipAddress: "system",
      },
    });

    if (params.healthStatus === "AT_RISK") {
      await db.alert.create({
        data: {
          userId: receipt.userId,
          title: `Storage condition alert: ${params.receiptCode}`,
          message: `Your stored grain (${params.receiptCode}) has been flagged for attention. ${params.notes ?? "Check with your warehouse operator."}`,
          severity: "HIGH",
          category: "STORAGE",
        },
      });
    }

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Condition update failed",
    };
  }
}

export async function getConditionHistory(
  receiptCode: string
): Promise<GrainConditionLog[]> {
  try {
    const db = await getDb();
    if (!db) return [];

    const logs = await db.auditLog.findMany({
      where: {
        action: "CONDITION_UPDATED",
        targetLabel: receiptCode,
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    return logs.map((log) => {
      let details: Record<string, unknown> = {};
      try {
        details = JSON.parse(log.details ?? "{}");
      } catch { /* ignore */ }

      return {
        receiptCode,
        warehouseName: "",
        temperatureC: (details.temperatureC as number) ?? null,
        humidityPct: (details.humidityPct as number) ?? null,
        moisturePct: (details.moisturePct as number) ?? null,
        healthStatus: mapHealthStatus((details.healthStatus as string) ?? "SAFE"),
        conditionNotes: (details.notes as string) ?? null,
        recordedAt: log.createdAt,
      };
    });
  } catch {
    return [];
  }
}

function mapHealthStatus(s: string): GrainConditionLog["healthStatus"] {
  switch (s) {
    case "AT_RISK": return "risk";
    case "CAUTION": return "caution";
    default: return "safe";
  }
}
