import { validateGrainLot, type GrainLotInput } from "./warehouse-validation";

export interface ReceiptCreateResult {
  success: boolean;
  receiptCode: string | null;
  errors: string[];
  warnings: string[];
}

async function getDb() {
  try {
    const { db } = await import("@/lib/db");
    return db;
  } catch {
    return null;
  }
}

function generateReceiptCode(): string {
  const year = new Date().getFullYear();
  const seq = String(Math.floor(Math.random() * 9999) + 1).padStart(4, "0");
  return `WR-${year}-${seq}`;
}

export async function createWarehouseReceipt(
  input: GrainLotInput
): Promise<ReceiptCreateResult> {
  const validation = validateGrainLot(input);
  if (!validation.valid) {
    return {
      success: false,
      receiptCode: null,
      errors: validation.errors,
      warnings: validation.warnings,
    };
  }

  try {
    const db = await getDb();
    if (!db) {
      return {
        success: false,
        receiptCode: null,
        errors: ["Database connection unavailable"],
        warnings: [],
      };
    }

    const warehouse = await db.warehouse.findFirst({
      where: { code: input.warehouseCode },
    });

    if (!warehouse) {
      return {
        success: false,
        receiptCode: null,
        errors: [`Warehouse ${input.warehouseCode} not found in registry`],
        warnings: validation.warnings,
      };
    }

    const receiptCode = generateReceiptCode();

    const gradeMap: Record<string, "A" | "B" | "C"> = {
      "Grade 1": "A",
      "Grade 2": "B",
      "Grade 3": "C",
      "Grade 4": "C",
      A: "A",
      B: "B",
      C: "C",
    };

    await db.warehouseReceipt.create({
      data: {
        receiptCode,
        userId: input.depositorId,
        warehouseId: warehouse.id,
        grainType: input.grainType,
        quantityKg: input.quantityKg,
        grade: gradeMap[input.grade] ?? "B",
        moisturePct: input.moisturePct,
        depositDate: new Date(),
        healthStatus: "SAFE",
      },
    });

    await db.auditLog.create({
      data: {
        actorId: input.depositorId,
        actorRole: "farmer",
        action: "RECEIPT_CREATED",
        actionType: "create",
        category: "WAREHOUSE",
        targetType: "warehouse_receipt",
        targetLabel: receiptCode,
        details: JSON.stringify({
          warehouseCode: input.warehouseCode,
          grainType: input.grainType,
          quantityKg: input.quantityKg,
          grade: input.grade,
        }),
        ipAddress: "system",
      },
    });

    return {
      success: true,
      receiptCode,
      errors: [],
      warnings: validation.warnings,
    };
  } catch (err) {
    return {
      success: false,
      receiptCode: null,
      errors: [err instanceof Error ? err.message : "Receipt creation failed"],
      warnings: [],
    };
  }
}

export async function getReceiptByCode(code: string) {
  try {
    const db = await getDb();
    if (!db) return null;

    return await db.warehouseReceipt.findFirst({
      where: { receiptCode: code, deletedAt: null },
      include: {
        warehouse: true,
      },
    });
  } catch {
    return null;
  }
}

export async function verifyReceiptOwnership(
  receiptCode: string,
  userId: string
): Promise<boolean> {
  try {
    const db = await getDb();
    if (!db) return false;

    const receipt = await db.warehouseReceipt.findFirst({
      where: { receiptCode, userId, deletedAt: null },
    });

    return receipt !== null;
  } catch {
    return false;
  }
}
