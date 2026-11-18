import type { PrismaClient } from "@prisma/client";
import { recordSync } from "@/lib/services/data-confidence";

export async function syncLog(
  db: PrismaClient,
  entry: {
    source: string;
    sourceType: string;
    status: string;
    recordCount?: number;
    confidence?: number;
    errorDetail?: string;
    durationMs?: number;
  },
): Promise<void> {
  try {
    await db.dataSyncLog.create({
      data: {
        source: entry.source,
        sourceType: entry.sourceType,
        status: entry.status,
        recordCount: entry.recordCount ?? 0,
        confidence: entry.confidence ?? null,
        errorDetail: entry.errorDetail ?? null,
        durationMs: entry.durationMs ?? null,
        lastDataAt: entry.status === "success" ? new Date() : null,
      },
    });

    recordSync({
      sourceId: entry.source,
      status: entry.status as "success" | "partial" | "failed",
      timestamp: new Date(),
      latencyMs: entry.durationMs ?? 0,
      recordCount: entry.recordCount ?? 0,
      confidence: entry.confidence ?? (entry.status === "success" ? 0.9 : 0),
    });
  } catch (err) {
    console.error(`[SyncLog] Failed to write sync log for ${entry.source}:`, err);
  }
}
