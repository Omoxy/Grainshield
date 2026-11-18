import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/api/auth-guard";
import { checkPermission } from "@/lib/security/permissions";
import { validatePagination } from "@/lib/security/request-validation";
import type { UserRole } from "@/lib/auth/types";

async function getDb() {
  const { db } = await import("@/lib/db");
  return db;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request, ["admin"]);
    if (!auth.ok) return auth.response;

    if (!checkPermission(auth.ctx.roles as UserRole[], "farmers", "read")) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 },
      );
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const search = searchParams.get("search");
    const county = searchParams.get("county");
    const { page, limit } = validatePagination({
      page: searchParams.get("page"),
      limit: searchParams.get("limit"),
    });

    const db = await getDb();

    const where: Record<string, unknown> = {
      role: "FARMER",
      deletedAt: null,
    };

    if (status) {
      const statusMap: Record<string, string> = {
        approved: "APPROVED",
        pending: "PENDING_KYC",
        rejected: "REJECTED",
        suspended: "SUSPENDED",
      };
      if (statusMap[status]) {
        where.accountStatus = statusMap[status];
      }
    }

    if (county) {
      where.farmerProfile = {
        county: { contains: county, mode: "insensitive" },
      };
    }

    if (search) {
      const q = search.slice(0, 100);
      where.OR = [
        { fullName: { contains: q, mode: "insensitive" } },
        { phone: { contains: q } },
        { email: { contains: q, mode: "insensitive" } },
        { id: { contains: q } },
      ];
    }

    const [total, users] = await Promise.all([
      db.user.count({ where: where as never }),
      db.user.findMany({
        where: where as never,
        include: {
          farmerProfile: true,
          warehouseReceipts: {
            where: { deletedAt: null },
            select: { quantityKg: true },
          },
          loans: {
            where: { status: { in: ["ACTIVE", "DISBURSED"] } },
            select: { amountKsh: true },
          },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    const farmers = users.map((u) => ({
      id: u.id,
      name: u.fullName,
      phone: u.phone,
      email: u.email,
      county: u.farmerProfile?.county ?? "—",
      ward: u.farmerProfile?.ward ?? "—",
      status: u.accountStatus.toLowerCase(),
      storedKg: u.warehouseReceipts.reduce((s, r) => s + r.quantityKg, 0),
      activeLoansKsh: u.loans.reduce((s, l) => s + l.amountKsh, 0),
      registeredDate: u.createdAt.toISOString().split("T")[0],
    }));

    const [totalRegistered, kycApproved, pendingKyc, withLoans] = await Promise.all([
      db.user.count({ where: { role: "FARMER", deletedAt: null } }),
      db.user.count({ where: { role: "FARMER", accountStatus: "APPROVED", deletedAt: null } }),
      db.user.count({ where: { role: "FARMER", accountStatus: { in: ["PENDING_KYC", "KYC_IN_REVIEW"] }, deletedAt: null } }),
      db.loan.groupBy({
        by: ["userId"],
        where: { status: { in: ["ACTIVE", "DISBURSED"] } },
      }),
    ]);

    return NextResponse.json({
      summary: {
        totalRegistered,
        kycApproved,
        pendingKyc,
        withActiveLoans: withLoans.length,
      },
      farmers,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error("[API] Farmers error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
