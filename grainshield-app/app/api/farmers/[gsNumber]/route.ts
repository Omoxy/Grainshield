import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/api/auth-guard";
import {
  createAuditLog,
  extractIp,
  extractUserAgent,
  generateRequestId,
} from "@/lib/security/audit";
import { checkPermission } from "@/lib/security/permissions";
import { validateBody } from "@/lib/security/request-validation";
import type { UserRole } from "@/lib/auth/types";

const MOCK_FARMER = {
  id: "USR-1284",
  fullName: "John Kiprotich",
  phone: "+254 712 345 678",
  email: "john.k@email.com",
  county: "Trans Nzoia",
  ward: "Kiminini",
  village: "Kapsara",
  accountStatus: "APPROVED",
  registeredDate: "2025-04-15",
  farmingExperience: "5+ years",
  kycDocuments: [
    { type: "National ID", status: "verified", uploadedAt: "2025-04-15" },
    { type: "Selfie", status: "verified", uploadedAt: "2025-04-15" },
    { type: "Proof of Residence", status: "verified", uploadedAt: "2025-04-15" },
  ],
  storage: { totalStoredKg: 2450, receiptsCount: 2 },
  loans: { activeCount: 1, totalOutstandingKsh: 27000 },
  claims: { totalClaims: 3, pendingCount: 1 },
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ gsNumber: string }> },
) {
  try {
    const auth = await requireAuth(request, ["admin"]);
    if (!auth.ok) return auth.response;

    if (!checkPermission(auth.ctx.roles as UserRole[], "farmers", "read")) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 },
      );
    }

    const { gsNumber } = await params;

    if (!gsNumber || gsNumber.length > 50) {
      return NextResponse.json(
        { error: "Invalid farmer ID" },
        { status: 400 },
      );
    }

    return NextResponse.json({
      farmer: { ...MOCK_FARMER, id: gsNumber },
    });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

const VALID_STATUSES = [
  "PENDING_REGISTRATION",
  "EMAIL_VERIFIED",
  "PENDING_KYC",
  "KYC_IN_REVIEW",
  "APPROVED",
  "REJECTED",
  "SUSPENDED",
] as const;

const updateSchema = {
  accountStatus: {
    type: "string" as const,
    required: true,
    enum: VALID_STATUSES,
  },
  reason: {
    type: "string" as const,
    maxLength: 2000,
  },
};

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ gsNumber: string }> },
) {
  const requestId = generateRequestId();
  const ip = extractIp(request);
  const ua = extractUserAgent(request);

  try {
    const auth = await requireAuth(request, ["admin"]);
    if (!auth.ok) return auth.response;

    if (!checkPermission(auth.ctx.roles as UserRole[], "farmers", "update")) {
      return NextResponse.json(
        { error: "Insufficient permissions", requestId },
        { status: 403 },
      );
    }

    const { gsNumber } = await params;

    if (!gsNumber || gsNumber.length > 50) {
      return NextResponse.json(
        { error: "Invalid farmer ID", requestId },
        { status: 400 },
      );
    }

    const body = await request.json();

    const validation = validateBody(body, updateSchema);
    if (!validation.valid) {
      return NextResponse.json(
        { error: "Validation failed", details: validation.errors, requestId },
        { status: 400 },
      );
    }

    const { accountStatus, reason } = body as {
      accountStatus: string;
      reason?: string;
    };

    const isKycAction =
      accountStatus === "APPROVED" || accountStatus === "REJECTED";

    if (
      isKycAction &&
      accountStatus === "REJECTED" &&
      (!reason || reason.trim().length < 10)
    ) {
      return NextResponse.json(
        { error: "A reason of at least 10 characters is required for rejection", requestId },
        { status: 400 },
      );
    }

    const previousStatus = MOCK_FARMER.accountStatus;

    await createAuditLog({
      actorId: auth.ctx.sub,
      actorRole: auth.ctx.roles[0],
      action: `Farmer ${gsNumber} status changed: ${previousStatus} → ${accountStatus}`,
      actionType: "update",
      category: isKycAction ? "KYC" : "ADMIN",
      severity: isKycAction ? "WARNING" : "INFO",
      targetId: gsNumber,
      targetType: "user",
      targetLabel: gsNumber,
      previousState: { accountStatus: previousStatus },
      newState: { accountStatus, reason },
      ipAddress: ip,
      userAgent: ua,
      requestId,
    });

    console.log(
      `[FARMER UPDATE] ${gsNumber} status -> ${accountStatus}. Reason: ${reason ?? "N/A"}`,
    );

    return NextResponse.json({
      farmerId: gsNumber,
      accountStatus,
      updatedAt: new Date().toISOString(),
      message: `Farmer status updated to ${accountStatus}`,
      requestId,
    });
  } catch {
    return NextResponse.json(
      { error: "Internal server error", requestId },
      { status: 500 },
    );
  }
}
