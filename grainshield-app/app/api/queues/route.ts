import { NextRequest, NextResponse } from "next/server";
import {
  getKycReviewQueue,
  getClaimsReviewQueue,
  getWarehouseRiskQueue,
  getLoanExposureQueue,
} from "@/lib/services/operational-queues";

export async function GET(req: NextRequest) {
  const queue = req.nextUrl.searchParams.get("queue");

  try {
    switch (queue) {
      case "kyc":
        return NextResponse.json(await getKycReviewQueue());
      case "claims":
        return NextResponse.json(await getClaimsReviewQueue());
      case "warehouse":
        return NextResponse.json(await getWarehouseRiskQueue());
      case "loans":
        return NextResponse.json(await getLoanExposureQueue());
      case "all": {
        const [kyc, claims, warehouse, loans] = await Promise.all([
          getKycReviewQueue(),
          getClaimsReviewQueue(),
          getWarehouseRiskQueue(),
          getLoanExposureQueue(),
        ]);
        return NextResponse.json({ kyc, claims, warehouse, loans });
      }
      default:
        return NextResponse.json(
          { error: "Specify ?queue=kyc|claims|warehouse|loans|all" },
          { status: 400 },
        );
    }
  } catch (err) {
    console.error("[API] Queue fetch error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
