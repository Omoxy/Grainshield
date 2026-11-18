import { validateCsvRow } from "./warehouse-validation";
import { createWarehouseReceipt, type ReceiptCreateResult } from "./receipt-service";

export interface CsvSyncResult {
  totalRows: number;
  successCount: number;
  errorCount: number;
  results: {
    row: number;
    receiptCode: string | null;
    success: boolean;
    errors: string[];
    warnings: string[];
  }[];
}

export async function syncFromCsv(
  rows: Record<string, string>[],
  operatorId: string
): Promise<CsvSyncResult> {
  const results: CsvSyncResult["results"] = [];
  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const { input, errors } = validateCsvRow(rows[i], i + 1);

    if (!input || errors.length > 0) {
      results.push({
        row: i + 1,
        receiptCode: null,
        success: false,
        errors,
        warnings: [],
      });
      errorCount++;
      continue;
    }

    const result = await createWarehouseReceipt(input);
    results.push({
      row: i + 1,
      receiptCode: result.receiptCode,
      success: result.success,
      errors: result.errors,
      warnings: result.warnings,
    });

    if (result.success) successCount++;
    else errorCount++;
  }

  return {
    totalRows: rows.length,
    successCount,
    errorCount,
    results,
  };
}

export function parseCsvText(text: string): Record<string, string>[] {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(",").map((v) => v.trim());
    if (values.length !== headers.length) continue;

    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j];
    }
    rows.push(row);
  }

  return rows;
}

export async function logSyncEvent(
  result: CsvSyncResult,
  operatorId: string
): Promise<void> {
  try {
    const { db } = await import("@/lib/db");

    await db.auditLog.create({
      data: {
        actorId: operatorId,
        actorRole: "operator",
        action: "INVENTORY_SYNC",
        actionType: "create",
        category: "WAREHOUSE",
        targetType: "warehouse_inventory",
        details: JSON.stringify({
          totalRows: result.totalRows,
          successCount: result.successCount,
          errorCount: result.errorCount,
          method: "csv_upload",
        }),
        ipAddress: "system",
      },
    });

    await db.dataSyncLog.create({
      data: {
        source: "warehouse_csv",
        sourceType: "warehouse",
        status: result.errorCount === 0 ? "success" : result.successCount > 0 ? "partial" : "failed",
        recordCount: result.successCount,
        confidence: result.totalRows > 0 ? result.successCount / result.totalRows : 0,
      },
    });
  } catch {
    // Non-critical — sync completed even if audit logging fails
  }
}
