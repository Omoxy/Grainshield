import { NextResponse, type NextRequest } from "next/server";
import {
  checkRateLimit,
  extractRateLimitKey,
} from "@/lib/auth/rate-limit";
import {
  createAuditLog,
  extractIp,
  extractUserAgent,
  generateRequestId,
} from "@/lib/security/audit";
import { checkDuplicateIdentity } from "@/lib/services/fraud-detection";
import { validateBody } from "@/lib/security/request-validation";

const REGISTER_RATE_LIMIT = {
  maxRequests: 3,
  windowMs: 15 * 60 * 1000,
  lockoutDurations: [300, 900, 3600],
};

const registerSchema = {
  fullName: {
    type: "string" as const,
    required: true,
    minLength: 3,
    maxLength: 100,
  },
  phone: {
    type: "string" as const,
    required: true,
    minLength: 10,
    maxLength: 20,
  },
  email: {
    type: "string" as const,
    required: true,
    maxLength: 200,
    pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  },
  password: {
    type: "string" as const,
    required: true,
    minLength: 8,
    maxLength: 128,
  },
};

export async function POST(request: NextRequest) {
  const requestId = generateRequestId();
  const ip = extractIp(request);
  const ua = extractUserAgent(request);

  try {
    const rlKey = extractRateLimitKey(request, "register");
    const rl = checkRateLimit(rlKey, REGISTER_RATE_LIMIT);

    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many registration attempts. Please try again later.", requestId },
        { status: 429 },
      );
    }

    const body = await request.json();

    const validation = validateBody(body, registerSchema);
    if (!validation.valid) {
      return NextResponse.json(
        { error: "Validation failed", details: validation.errors, requestId },
        { status: 400 },
      );
    }

    const { fullName, phone, email, password } = body as {
      fullName: string;
      phone: string;
      email: string;
      password: string;
    };

    const stripped = phone.replace(/[\s-]/g, "");
    if (!stripped.startsWith("+254") || stripped.length < 12) {
      return NextResponse.json(
        { error: "Phone must be a valid Kenyan number (+254...)", requestId },
        { status: 400 },
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters", requestId },
        { status: 400 },
      );
    }

    const hasUppercase = /[A-Z]/.test(password);
    const hasLowercase = /[a-z]/.test(password);
    const hasDigit = /\d/.test(password);
    if (!hasUppercase || !hasLowercase || !hasDigit) {
      return NextResponse.json(
        {
          error: "Password must contain at least one uppercase letter, one lowercase letter, and one digit",
          requestId,
        },
        { status: 400 },
      );
    }

    const duplicateCheck = await checkDuplicateIdentity({
      phone: stripped,
      email: email.toLowerCase().trim(),
      fullName: fullName.trim(),
    }).catch(() => ({ isDuplicate: false, matches: [] }));

    if (duplicateCheck.isDuplicate) {
      await createAuditLog({
        actorRole: "anonymous",
        action: `Duplicate registration attempt: ${duplicateCheck.matches.join(", ")}`,
        actionType: "create",
        category: "AUTH",
        severity: "WARNING",
        details: `Phone: ${stripped}, Email: ${email}`,
        ipAddress: ip,
        userAgent: ua,
        requestId,
      });

      return NextResponse.json(
        { error: "An account with this phone or email already exists", requestId },
        { status: 409 },
      );
    }

    // MOCK: Generate a user ID and simulate OTP send
    const userId = `USR-${Math.floor(1000 + Math.random() * 9000)}`;

    await createAuditLog({
      actorRole: "anonymous",
      action: `New farmer registration: ${userId}`,
      actionType: "create",
      category: "AUTH",
      targetId: userId,
      targetType: "user",
      targetLabel: fullName,
      ipAddress: ip,
      userAgent: ua,
      requestId,
    });

    console.log(
      `[REGISTER] Created user ${userId} for ${email}. OTP sent to ${phone}.`,
    );

    return NextResponse.json(
      {
        userId,
        message: "Registration successful. OTP sent to your phone.",
        accountStatus: "PENDING_REGISTRATION",
        requestId,
      },
      { status: 201 },
    );
  } catch {
    return NextResponse.json(
      { error: "Internal server error", requestId },
      { status: 500 },
    );
  }
}
