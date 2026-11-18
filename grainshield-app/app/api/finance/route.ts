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
    const type = searchParams.get("type") ?? "overview";

    const db = await getDb();

    if (type === "payouts") {
      const status = searchParams.get("status");
      const page = Math.max(1, parseInt(searchParams.get("page") ?? "1") || 1);
      const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") ?? "20") || 20));

      const where: Record<string, unknown> = {};
      if (status && status !== "all") {
        where.status = status.toUpperCase();
      }

      const [total, payouts] = await Promise.all([
        db.payoutRecord.count({ where: where as never }),
        db.payoutRecord.findMany({
          where: where as never,
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * limit,
          take: limit,
        }),
      ]);

      return NextResponse.json({
        payouts: payouts.map((p) => ({
          id: p.id,
          payoutCode: p.payoutCode,
          type: p.type,
          status: p.status.toLowerCase(),
          amountKsh: p.amountKsh,
          recipientPhone: p.recipientPhone,
          relatedCode: p.relatedEntityId,
          authorizationLevel: p.authorizationLevel ?? "standard",
          initiatedAt: p.createdAt.toISOString(),
          completedAt: p.processedAt?.toISOString() ?? null,
          failureReason: p.failureReason,
        })),
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      });
    }

    if (type === "loans") {
      const loans = await db.loan.findMany({
        where: { status: { in: ["ACTIVE", "DISBURSED", "DEFAULTED"] } },
        include: {
          warehouseReceipt: {
            select: {
              receiptCode: true,
              estimatedValueKsh: true,
              warehouse: { select: { name: true } },
            },
          },
          user: { select: { fullName: true } },
          repayments: { select: { amountKsh: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      });

      type LoanWithRelations = typeof loans[number] & {
        user: { fullName: string };
        repayments: { amountKsh: number }[];
        warehouseReceipt: { receiptCode: string; estimatedValueKsh: number | null; warehouse: { name: string } };
      };

      return NextResponse.json({
        loans: (loans as LoanWithRelations[]).map((l) => {
          const repaidKsh = l.repayments.reduce((s: number, r: { amountKsh: number }) => s + r.amountKsh, 0);
          const collateralValue = l.warehouseReceipt?.estimatedValueKsh ?? 0;
          const isOverdue = l.dueDate ? l.dueDate.getTime() < Date.now() : false;
          return {
            loanCode: l.loanCode,
            farmer: l.user?.fullName ?? "Unknown",
            amountKsh: l.amountKsh,
            repaidKsh,
            collateralValueKsh: collateralValue,
            ltvPct: collateralValue > 0 ? Math.round((l.amountKsh / collateralValue) * 100) : 0,
            daysUntilDue: l.dueDate ? Math.round((l.dueDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : 0,
            health: l.status === "DEFAULTED" ? "doubtful" : isOverdue ? "watch" : repaidKsh / l.amountKsh > 0.5 ? "healthy" : "watch",
            warehouse: l.warehouseReceipt?.warehouse?.name ?? "—",
            status: l.status.toLowerCase(),
          };
        }),
      });
    }

    // Default: financial overview summary
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      payoutsThisMonth,
      pendingPayouts,
      loanExposure,
      collateralValue,
      overdueLoans,
      reconciledCount,
      unreconciledCount,
    ] = await Promise.all([
      db.payoutRecord.aggregate({
        where: { status: "COMPLETED", processedAt: { gte: monthStart } },
        _sum: { amountKsh: true },
      }),
      db.payoutRecord.aggregate({
        where: { status: { in: ["INITIATED", "COMPLIANCE_CHECK", "AUTHORIZATION_PENDING", "AUTHORIZED", "PROCESSING"] } },
        _sum: { amountKsh: true },
        _count: true,
      }),
      db.loan.aggregate({
        where: { status: { in: ["ACTIVE", "DISBURSED"] } },
        _sum: { amountKsh: true },
      }),
      db.warehouseReceipt.aggregate({
        where: { deletedAt: null },
        _sum: { estimatedValueKsh: true },
      }),
      db.loan.aggregate({
        where: { status: "DEFAULTED" },
        _sum: { amountKsh: true },
        _count: true,
      }),
      db.payoutRecord.count({
        where: { reconciliationStatus: "matched" },
      }),
      db.payoutRecord.count({
        where: { reconciliationStatus: { in: ["unmatched", "disputed"] } },
      }),
    ]);

    const totalPayoutsKsh = payoutsThisMonth._sum.amountKsh ?? 0;
    const pendingPayoutsKsh = pendingPayouts._sum.amountKsh ?? 0;
    const totalLoanExposure = loanExposure._sum.amountKsh ?? 0;
    const totalCollateral = collateralValue._sum.estimatedValueKsh ?? 0;
    const totalOverdue = overdueLoans._sum?.amountKsh ?? 0;
    const totalReconciled = reconciledCount + unreconciledCount;
    const reconciledPct = totalReconciled > 0 ? Math.round((reconciledCount / totalReconciled) * 1000) / 10 : 0;

    return NextResponse.json({
      summary: {
        totalPayoutsThisMonth: totalPayoutsKsh,
        pendingPayouts: pendingPayoutsKsh,
        pendingPayoutsCount: pendingPayouts._count,
        totalLoanExposure,
        totalCollateralValue: totalCollateral,
        portfolioLtv: totalCollateral > 0 ? Math.round((totalLoanExposure / totalCollateral) * 100) : 0,
        overdueLoans: totalOverdue,
        overdueLoansCount: overdueLoans._count,
        reconciled: reconciledPct,
        unreconciled: unreconciledCount,
        reconciledCount,
      },
    });
  } catch (err) {
    console.error("[API] Finance error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
