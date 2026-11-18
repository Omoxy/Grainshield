import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/api/auth-guard";
import { checkPermission } from "@/lib/security/permissions";
import { validateBody } from "@/lib/security/request-validation";
import {
  createAuditLog,
  extractIp,
  extractUserAgent,
  generateRequestId,
} from "@/lib/security/audit";
import type { UserRole } from "@/lib/auth/types";

const LTV_PERCENT = 60;
const INTEREST_RATE = 14;
const MAX_TENURE_DAYS = 180;

async function getDb() {
  const { db } = await import("@/lib/db");
  return db;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request, ["farmer", "admin"]);
    if (!auth.ok) return auth.response;

    if (!checkPermission(auth.ctx.roles as UserRole[], "loans", "read")) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 },
      );
    }

    const db = await getDb();
    const isFarmer = auth.ctx.roles.includes("farmer" as UserRole);
    const userId = isFarmer ? auth.ctx.sub : undefined;

    const receipts = await db.warehouseReceipt.findMany({
      where: { ...(userId ? { userId } : {}), deletedAt: null },
      select: {
        receiptCode: true,
        quantityKg: true,
        estimatedValueKsh: true,
      },
    });

    const totalGrainValueKsh = receipts.reduce((s, r) => s + (r.estimatedValueKsh ?? 0), 0);
    const maxEligibleKsh = Math.floor(totalGrainValueKsh * (LTV_PERCENT / 100));

    const activeLoans = await db.loan.findMany({
      where: {
        ...(userId ? { userId } : {}),
        status: { in: ["ACTIVE", "DISBURSED", "PENDING_APPROVAL", "APPROVED"] },
      },
      include: {
        warehouseReceipt: {
          select: { receiptCode: true, quantityKg: true },
        },
        repayments: {
          select: { amountKsh: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const totalOutstanding = activeLoans.reduce((s, l) => {
      const repaid = l.repayments.reduce((rs, r) => rs + r.amountKsh, 0);
      return s + (l.amountKsh - repaid);
    }, 0);

    return NextResponse.json({
      eligibility: {
        maxAmountKsh: Math.max(0, maxEligibleKsh - totalOutstanding),
        grainValueKsh: totalGrainValueKsh,
        ltvPercent: LTV_PERCENT,
        interestRatePercent: INTEREST_RATE,
        maxTenureDays: MAX_TENURE_DAYS,
        eligibleReceipts: receipts.map((r) => ({
          id: r.receiptCode,
          quantityKg: r.quantityKg,
          valueKsh: r.estimatedValueKsh ?? 0,
        })),
      },
      activeLoans: activeLoans.map((l) => {
        const repaid = l.repayments.reduce((s, r) => s + r.amountKsh, 0);
        return {
          id: l.loanCode,
          amountKsh: l.amountKsh,
          disbursedDate: l.disbursedAt?.toISOString().split("T")[0] ?? null,
          dueDate: l.dueDate?.toISOString().split("T")[0] ?? null,
          interestRatePercent: l.interestRatePercent,
          repaidKsh: repaid,
          repaidPercent: l.amountKsh > 0 ? Math.round((repaid / l.amountKsh) * 100) : 0,
          status: l.status.toLowerCase(),
          collateral: l.warehouseReceipt.receiptCode,
          collateralKg: l.warehouseReceipt.quantityKg,
          disbursementMethod: l.disbursementMethod ?? "M-Pesa",
        };
      }),
      totalOutstanding,
    });
  } catch (err) {
    console.error("[API] Loans error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

const loanSchema = {
  amountKsh: {
    type: "number" as const,
    required: true,
    min: 1000,
    max: 10000000,
  },
  tenureDays: {
    type: "number" as const,
    required: true,
    min: 30,
    max: 365,
  },
  warehouseReceiptId: {
    type: "string" as const,
    required: true,
    maxLength: 100,
  },
  purpose: {
    type: "string" as const,
    maxLength: 500,
  },
};

export async function POST(request: NextRequest) {
  const requestId = generateRequestId();
  const ip = extractIp(request);
  const ua = extractUserAgent(request);

  try {
    const auth = await requireAuth(request, ["farmer"]);
    if (!auth.ok) return auth.response;

    if (!checkPermission(auth.ctx.roles as UserRole[], "loans", "create")) {
      return NextResponse.json(
        { error: "Insufficient permissions", requestId },
        { status: 403 },
      );
    }

    const body = await request.json();

    const validation = validateBody(body, loanSchema);
    if (!validation.valid) {
      return NextResponse.json(
        { error: "Validation failed", details: validation.errors, requestId },
        { status: 400 },
      );
    }

    const { amountKsh, tenureDays, warehouseReceiptId, purpose } = body as {
      amountKsh: number;
      tenureDays: number;
      warehouseReceiptId: string;
      purpose?: string;
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

    const maxLoan = Math.floor((receipt.estimatedValueKsh ?? 0) * (LTV_PERCENT / 100));
    if (amountKsh > maxLoan) {
      return NextResponse.json(
        {
          error: `Loan amount exceeds maximum eligible amount of KSh ${maxLoan.toLocaleString()}`,
          requestId,
        },
        { status: 400 },
      );
    }

    if (tenureDays > MAX_TENURE_DAYS) {
      return NextResponse.json(
        { error: `Tenure exceeds maximum of ${MAX_TENURE_DAYS} days`, requestId },
        { status: 400 },
      );
    }

    const loanCount = await db.loan.count();
    const loanCode = `LN-${new Date().getFullYear()}-${String(loanCount + 1).padStart(4, "0")}`;

    const loan = await db.loan.create({
      data: {
        loanCode,
        userId: auth.ctx.sub,
        warehouseReceiptId: receipt.id,
        amountKsh,
        interestRatePercent: INTEREST_RATE,
        tenureDays,
        purpose: purpose ?? null,
      },
    });

    await createAuditLog({
      actorId: auth.ctx.sub,
      actorRole: auth.ctx.roles[0],
      action: `Loan application ${loanCode}: KSh ${amountKsh} for ${tenureDays} days`,
      actionType: "create",
      category: "LOANS",
      targetId: loan.id,
      targetType: "loan",
      targetLabel: `${warehouseReceiptId} — KSh ${amountKsh}`,
      newState: { amountKsh, tenureDays, warehouseReceiptId, purpose },
      ipAddress: ip,
      userAgent: ua,
      requestId,
    });

    return NextResponse.json(
      {
        loanId: loanCode,
        amountKsh,
        tenureDays,
        interestRatePercent: INTEREST_RATE,
        collateral: warehouseReceiptId,
        status: "pending_approval",
        disbursementMethod: "M-Pesa",
        message: "Loan application submitted. You will receive an SMS once approved.",
        requestId,
      },
      { status: 201 },
    );
  } catch (err) {
    console.error("[API] Loan creation error:", err);
    return NextResponse.json(
      { error: "Internal server error", requestId },
      { status: 500 },
    );
  }
}
