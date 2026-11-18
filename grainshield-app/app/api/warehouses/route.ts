import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/api/auth-guard";
import { checkPermission } from "@/lib/security/permissions";
import type { UserRole } from "@/lib/auth/types";
import {
  getWarehouseSummaries,
  getPortfolioSummary,
  getWarehouseById,
} from "@/lib/integrations/warehouse/warehouse-sync-service";

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request, ["admin"]);
    if (!auth.ok) return auth.response;

    if (!checkPermission(auth.ctx.roles as UserRole[], "warehouses", "read")) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 },
      );
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    const status = searchParams.get("status");
    const county = searchParams.get("county");

    if (id) {
      if (id.length > 50) {
        return NextResponse.json({ error: "Invalid warehouse ID" }, { status: 400 });
      }
      const warehouse = await getWarehouseById(id);
      if (!warehouse) {
        return NextResponse.json({ error: "Warehouse not found" }, { status: 404 });
      }
      return NextResponse.json({ warehouse });
    }

    const validStatuses = ["operational", "warning", "offline", "maintenance"];
    if (status && !validStatuses.includes(status)) {
      return NextResponse.json({ error: "Invalid status filter" }, { status: 400 });
    }

    const [warehouses, summary] = await Promise.all([
      getWarehouseSummaries({ status: status ?? undefined, county: county ?? undefined }),
      getPortfolioSummary(),
    ]);

    return NextResponse.json({
      summary,
      warehouses,
    });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
