import { NextResponse } from "next/server";
import { runFraudIntelligenceScan } from "@/lib/services/fraud-intelligence";

export async function GET() {
  try {
    const result = await runFraudIntelligenceScan();
    return NextResponse.json(result);
  } catch (err) {
    console.error("[API] Fraud scan error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
