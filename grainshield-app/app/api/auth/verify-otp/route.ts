/**
 * POST /api/auth/verify-otp
 *
 * Verifies the OTP sent during registration.
 * Accepts { userId, otp }
 * Returns { verified, accountStatus }
 *
 * MOCK: Accepts any 6-digit code as valid.
 * In production, verifies against the OTP service.
 */

import { NextResponse, type NextRequest } from "next/server";

interface VerifyOtpBody {
  userId?: string;
  otp?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: VerifyOtpBody = await request.json();
    const { userId, otp } = body;

    if (!userId || !otp) {
      return NextResponse.json(
        { error: "userId and otp are required" },
        { status: 400 }
      );
    }

    // OTP must be 6 digits
    if (!/^\d{6}$/.test(otp)) {
      return NextResponse.json(
        { error: "OTP must be exactly 6 digits" },
        { status: 400 }
      );
    }

    // MOCK: Accept any 6-digit OTP (except 000000 which simulates failure)
    if (otp === "000000") {
      return NextResponse.json(
        { error: "Invalid or expired OTP" },
        { status: 401 }
      );
    }

    console.log(`[MOCK VERIFY-OTP] Verified OTP for user ${userId}`);

    return NextResponse.json({
      verified: true,
      userId,
      accountStatus: "EMAIL_VERIFIED",
      message: "Phone verified successfully. Please complete KYC to activate your account.",
    });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
