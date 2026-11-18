import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/api/auth-guard";
import {
  createAuditLog,
  extractIp,
  extractUserAgent,
  generateRequestId,
} from "@/lib/security/audit";
import { checkClaimFraud } from "@/lib/services/fraud-detection";
import { validateBody } from "@/lib/security/request-validation";
import { checkPermission } from "@/lib/security/permissions";
import type { UserRole } from "@/lib/auth/types";

async function getDb() {
  const { db } = await import("@/lib/db");
  return db;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request, ["farmer", "admin"]);
    if (!auth.ok) return auth.response;

    if (!checkPermission(auth.ctx.roles as UserRole[], "claims", "read")) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 },
      );
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const search = searchParams.get("search");
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1") || 1);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "20") || 20));

    const db = await getDb();
    const isFarmer = auth.ctx.roles.includes("farmer" as UserRole);

    const where: Record<string, unknown> = {};
    if (isFarmer) {
      where.userId = auth.ctx.sub;
    }
    if (status) {
      where.status = status.toUpperCase();
    }

    if (search) {
      const searchFilter = [
        { claimCode: { contains: search, mode: "insensitive" } },
      ];
      if (!isFarmer) {
        searchFilter.push({ user: { fullName: { contains: search, mode: "insensitive" } } } as never);
      }
      where.OR = searchFilter;
    }

    const [total, claims] = await Promise.all([
      db.claim.count({ where: where as never }),
      db.claim.findMany({
        where: where as never,
        include: {
          warehouseReceipt: {
            select: { receiptCode: true, warehouse: { select: { name: true } } },
          },
          user: {
            select: { id: true, fullName: true },
          },
        },
        orderBy: { dateSubmitted: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    const PRE_HARVEST = ["DROUGHT", "EXCESS_RAINFALL", "FLOOD_EXPOSURE", "CROP_STRESS", "PEST_OUTBREAK_FIELD", "HARVEST_FAILURE", "WEATHER_HARVEST"];

    const mapped = claims.map((c) => ({
      id: c.claimCode,
      farmer: (c as unknown as { user?: { fullName?: string } }).user?.fullName ?? "Unknown",
      farmerId: (c as unknown as { user?: { id?: string } }).user?.id ?? "",
      stage: PRE_HARVEST.includes(c.category) ? "pre_harvest" : "post_harvest",
      type: c.category.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()),
      warehouseReceipt: c.warehouseReceipt.receiptCode,
      warehouse: c.warehouseReceipt.warehouse.name,
      amountClaimedKsh: c.amountClaimedKsh,
      amountApprovedKsh: c.amountApprovedKsh,
      dateSubmitted: c.dateSubmitted.toISOString().split("T")[0],
      status: c.status.toLowerCase(),
      description: c.description,
      fraudScore: c.fraudScore?.toLowerCase() ?? "low",
    }));

    const scope = isFarmer ? { userId: auth.ctx.sub } : {};
    const [totalClaims, pendingCount, approvedCount, paidAgg, fraudFlagsCount] = await Promise.all([
      db.claim.count({ where: scope }),
      db.claim.count({ where: { ...scope, status: { in: ["SUBMITTED", "IN_REVIEW"] } } }),
      db.claim.count({ where: { ...scope, status: "APPROVED" } }),
      db.claim.aggregate({
        where: { ...scope, status: "PAID" },
        _sum: { amountApprovedKsh: true },
      }),
      db.claim.count({ where: { ...scope, fraudScore: "HIGH" } }),
    ]);

    return NextResponse.json({
      summary: {
        totalClaims,
        pendingCount,
        approvedCount,
        totalPaidKsh: paidAgg._sum.amountApprovedKsh ?? 0,
        fraudFlagsCount,
      },
      claims: mapped,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error("[API] Claims error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

const VALID_CATEGORIES = [
  "storage_spoilage",
  "moisture_damage",
  "contamination",
  "pest_damage",
  "warehouse_handling",
  "weather_harvest",
  "drought",
  "excess_rainfall",
  "flood_exposure",
  "crop_stress",
  "pest_outbreak_field",
  "harvest_failure",
  "quality_degradation",
] as const;

const claimSchema = {
  category: {
    type: "string" as const,
    required: true,
    enum: VALID_CATEGORIES,
  },
  warehouseReceiptId: {
    type: "string" as const,
    required: true,
    maxLength: 100,
  },
  description: {
    type: "string" as const,
    required: true,
    minLength: 10,
    maxLength: 2000,
  },
  estimatedLossKsh: {
    type: "number" as const,
    min: 0,
    max: 10000000,
  },
};

export async function POST(request: NextRequest) {
  const requestId = generateRequestId();
  const ip = extractIp(request);
  const ua = extractUserAgent(request);

  try {
    const auth = await requireAuth(request, ["farmer"]);
    if (!auth.ok) return auth.response;

    if (!checkPermission(auth.ctx.roles as UserRole[], "claims", "create")) {
      return NextResponse.json(
        { error: "Insufficient permissions", requestId },
        { status: 403 },
      );
    }

    const body = await request.json();

    const validation = validateBody(body, claimSchema);
    if (!validation.valid) {
      return NextResponse.json(
        { error: "Validation failed", details: validation.errors, requestId },
        { status: 400 },
      );
    }

    const { category, warehouseReceiptId, description, estimatedLossKsh } =
      body as {
        category: string;
        warehouseReceiptId: string;
        description: string;
        estimatedLossKsh?: number;
      };

    const db = await getDb();

    const receipt = await db.warehouseReceipt.findFirst({
      where: { receiptCode: warehouseReceiptId, userId: auth.ctx.sub, deletedAt: null },
    });

    if (!receipt) {
      return NextResponse.json(
        { error: "Invalid or unauthorized warehouse receipt", requestId },
        { status: 400 },
      );
    }

    const fraudResult = await checkClaimFraud({
      userId: auth.ctx.sub,
      warehouseReceiptId,
      category,
      amountKsh: estimatedLossKsh ?? 0,
      description,
    }).catch(() => ({
      score: "LOW" as const,
      confidence: 0,
      flags: [],
      shouldEscalate: false,
    }));

    const claimCount = await db.claim.count();
    const claimCode = `CLM-${new Date().getFullYear()}-${String(claimCount + 1).padStart(4, "0")}`;

    const categoryMap: Record<string, string> = {
      storage_spoilage: "STORAGE_SPOILAGE",
      moisture_damage: "MOISTURE_DAMAGE",
      contamination: "CONTAMINATION",
      pest_damage: "PEST_DAMAGE",
      warehouse_handling: "WAREHOUSE_HANDLING",
      weather_harvest: "WEATHER_HARVEST",
    };

    const claim = await db.claim.create({
      data: {
        claimCode,
        userId: auth.ctx.sub,
        warehouseReceiptId: receipt.id,
        category: (categoryMap[category] ?? "STORAGE_SPOILAGE") as never,
        description,
        amountClaimedKsh: estimatedLossKsh ?? 0,
        fraudScore: fraudResult.score as never,
        fraudConfidence: fraudResult.confidence,
        fraudNotes: fraudResult.flags.length > 0 ? fraudResult.flags.join("; ") : null,
        escalated: fraudResult.shouldEscalate,
        escalatedAt: fraudResult.shouldEscalate ? new Date() : null,
        escalatedReason: fraudResult.shouldEscalate ? "Auto-escalated by fraud detection" : null,
      },
    });

    await createAuditLog({
      actorId: auth.ctx.sub,
      actorRole: auth.ctx.roles[0],
      action: `Claim ${claimCode} submitted: ${category}`,
      actionType: "create",
      category: "CLAIMS",
      severity: fraudResult.shouldEscalate ? "WARNING" : "INFO",
      targetId: claim.id,
      targetType: "claim",
      targetLabel: `${category} — ${warehouseReceiptId}`,
      newState: {
        category,
        warehouseReceiptId,
        estimatedLossKsh,
        fraudScore: fraudResult.score,
        fraudFlags: fraudResult.flags,
      },
      ipAddress: ip,
      userAgent: ua,
      requestId,
    });

    return NextResponse.json(
      {
        claimId: claimCode,
        status: "submitted",
        category,
        warehouseReceiptId,
        estimatedLossKsh: estimatedLossKsh ?? 0,
        fraudScore: fraudResult.score,
        message: "Claim submitted successfully. You will be notified when review begins.",
        requestId,
      },
      { status: 201 },
    );
  } catch (err) {
    console.error("[API] Claim creation error:", err);
    return NextResponse.json(
      { error: "Internal server error", requestId },
      { status: 500 },
    );
  }
}
