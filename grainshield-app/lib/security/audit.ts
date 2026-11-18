type AuditCategory =
  | "AUTH" | "KYC" | "CLAIMS" | "LOANS" | "STORAGE"
  | "WAREHOUSE" | "PAYOUT" | "RISK" | "ROLES"
  | "PERMISSIONS" | "SYSTEM" | "ADMIN";

type AuditSeverity = "INFO" | "WARNING" | "CRITICAL";

interface AuditEvent {
  actorId?: string | null;
  actorRole: string;
  action: string;
  actionType: string;
  category: AuditCategory;
  severity?: AuditSeverity;
  targetId?: string | null;
  targetType?: string;
  targetLabel?: string;
  previousState?: Record<string, unknown> | null;
  newState?: Record<string, unknown> | null;
  details?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string;
}

async function getDb() {
  try {
    const { db } = await import("@/lib/db");
    return db;
  } catch {
    return null;
  }
}

export async function createAuditLog(event: AuditEvent): Promise<void> {
  try {
    const db = await getDb();
    if (!db) {
      console.log(
        `[AUDIT] ${event.severity ?? "INFO"} | ${event.category} | ${event.action}` +
          (event.actorId ? ` | actor=${event.actorId}` : "") +
          (event.targetId ? ` | target=${event.targetId}` : "") +
          (event.ipAddress ? ` | ip=${event.ipAddress}` : ""),
      );
      return;
    }

    await db.auditLog.create({
      data: {
        actorId: event.actorId ?? null,
        actorRole: event.actorRole,
        action: event.action,
        actionType: event.actionType,
        category: event.category as never,
        severity: (event.severity ?? "INFO") as never,
        targetId: event.targetId ?? null,
        targetType: event.targetType ?? null,
        targetLabel: event.targetLabel ?? null,
        previousState: event.previousState
          ? JSON.stringify(event.previousState)
          : null,
        newState: event.newState
          ? JSON.stringify(event.newState)
          : null,
        details: event.details ?? null,
        ipAddress: event.ipAddress ?? null,
        userAgent: event.userAgent ?? null,
        requestId: event.requestId ?? null,
      },
    });
  } catch (err) {
    console.error("[AUDIT] Failed to write audit log:", err);
  }
}

export function extractIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded ? forwarded.split(",")[0].trim() : "unknown";
}

export function extractUserAgent(request: Request): string {
  return request.headers.get("user-agent") ?? "unknown";
}

export function generateRequestId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
