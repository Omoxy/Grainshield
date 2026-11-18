/**
 * POST /api/auth/resend-otp
 *
 * Resends OTP to the user's registered phone number.
 * Accepts { userId }
 * Returns { message }
 *
 * MOCK: Always succeeds with a 60-second cooldown simulation.
 * In production, this rate-limits and proxies to SMS gateway.
 */

import { NextResponse, type NextRequest } from "next/server";

interface ResendOtpBody {
  userId?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: ResendOtpBody = await request.json();
    const { userId } = body;

    if (!userId) {
      return NextResponse.json(
        { error: "userId is required" },
        { status: 400 }
      );
    }

    console.log(`[MOCK RESEND-OTP] Resending OTP for user ${userId}`);

    return NextResponse.json({
      message: "OTP resent successfully",
      cooldownSeconds: 60,
    });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
