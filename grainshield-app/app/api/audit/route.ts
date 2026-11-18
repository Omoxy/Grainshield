import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/api/auth-guard";

async function getDb() {
  const { db } = await import("@/lib/db");
  return db;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request, ["admin"]);
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category");
    const severity = searchParams.get("severity");
    const search = searchParams.get("search");
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1") || 1);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "30") || 30));

    const db = await getDb();

    const where: Record<string, unknown> = {};

    if (category && category !== "all") {
      where.category = category.toUpperCase();
    }
    if (severity && severity !== "all") {
      where.severity = severity.toUpperCase();
    }
    if (search) {
      where.OR = [
        { action: { contains: search, mode: "insensitive" } },
        { actor: { fullName: { contains: search, mode: "insensitive" } } },
        { requestId: { contains: search, mode: "insensitive" } },
      ];
    }

    const [total, logs] = await Promise.all([
      db.auditLog.count({ where: where as never }),
      db.auditLog.findMany({
        where: where as never,
        include: {
          actor: { select: { id: true, fullName: true, role: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [criticalCount, categoryBreakdown] = await Promise.all([
      db.auditLog.count({ where: { severity: "CRITICAL", createdAt: { gte: dayAgo } } }),
      db.auditLog.groupBy({
        by: ["category"],
        _count: true,
        where: { createdAt: { gte: dayAgo } },
      }),
    ]);

    const mapped = logs.map((l) => ({
      id: l.requestId ?? l.id.slice(0, 12),
      timestamp: l.createdAt.toISOString(),
      actor: (l as unknown as { actor?: { fullName?: string } }).actor?.fullName ?? "System",
      actorRole: l.actorRole?.toLowerCase() ?? "system",
      action: l.action,
      category: l.category.toLowerCase(),
      severity: l.severity.toLowerCase(),
      target: l.targetLabel ?? l.targetId ?? "—",
      ipAddress: l.ipAddress ?? "—",
      details: l.details ?? "",
    }));

    return NextResponse.json({
      logs: mapped,
      summary: {
        criticalLast24h: criticalCount,
        categoryBreakdown: categoryBreakdown.map((c) => ({
          category: c.category.toLowerCase(),
          count: c._count,
        })),
      },
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error("[API] Audit error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
