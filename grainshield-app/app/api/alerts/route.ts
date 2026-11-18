import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/api/auth-guard";

async function getDb() {
  const { db } = await import("@/lib/db");
  return db;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request, ["farmer", "admin"]);
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category") ?? "all";
    const unreadOnly = searchParams.get("unreadOnly") === "true";
    const limitParam = searchParams.get("limit");
    const limit = Math.min(100, Math.max(1, parseInt(limitParam ?? "20") || 20));

    const db = await getDb();
    const isFarmer = auth.ctx.roles.includes("farmer" as never);

    const where: Record<string, unknown> = {};

    if (isFarmer) {
      where.OR = [{ userId: auth.ctx.sub }, { userId: null }];
    }

    if (category !== "all") {
      const categoryMap: Record<string, string> = {
        weather: "WEATHER",
        storage: "STORAGE",
        price: "PRICE",
        claims: "CLAIMS",
      };
      if (categoryMap[category]) {
        where.category = categoryMap[category];
      }
    }

    if (unreadOnly) {
      where.read = false;
    }

    const [alerts, unreadCount] = await Promise.all([
      db.alert.findMany({
        where: where as never,
        orderBy: { createdAt: "desc" },
        take: limit,
      }),
      db.alert.count({
        where: {
          ...(isFarmer ? { OR: [{ userId: auth.ctx.sub }, { userId: null }] } : {}),
          read: false,
        } as never,
      }),
    ]);

    return NextResponse.json({
      alerts: alerts.map((a) => ({
        id: a.id,
        category: a.category.toLowerCase(),
        severity: a.severity.toLowerCase(),
        title: a.title,
        message: a.message,
        createdAt: a.createdAt.toISOString(),
        read: a.read,
      })),
      totalCount: alerts.length,
      unreadCount,
    });
  } catch (err) {
    console.error("[API] Alerts error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request, ["farmer"]);
    if (!auth.ok) return auth.response;

    const body = await request.json();
    const { alertIds, markAll } = body as { alertIds?: string[]; markAll?: boolean };

    if (!alertIds && !markAll) {
      return NextResponse.json(
        { error: "Provide alertIds array or markAll: true" },
        { status: 400 },
      );
    }

    const db = await getDb();

    if (markAll) {
      const result = await db.alert.updateMany({
        where: {
          OR: [{ userId: auth.ctx.sub }, { userId: null }],
          read: false,
        },
        data: { read: true, readAt: new Date() },
      });
      return NextResponse.json({
        message: `${result.count} alert(s) marked as read`,
        unreadCount: 0,
      });
    }

    if (alertIds && alertIds.length > 0) {
      const safeIds = alertIds.slice(0, 100);
      const result = await db.alert.updateMany({
        where: {
          id: { in: safeIds },
          OR: [{ userId: auth.ctx.sub }, { userId: null }],
        },
        data: { read: true, readAt: new Date() },
      });
      return NextResponse.json({
        message: `${result.count} alert(s) marked as read`,
      });
    }

    return NextResponse.json({ message: "No alerts updated" });
  } catch (err) {
    console.error("[API] Alerts mark-read error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
