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

type ClaimAction = "approve" | "reject" | "pay";

const VALID_TRANSITIONS: Record<string, ClaimAction[]> = {
  submitted: ["approve", "reject"],
  in_review: ["approve", "reject"],
  approved: ["pay"],
};

const STATUS_MAP: Record<ClaimAction, string> = {
  approve: "approved",
  reject: "rejected",
  pay: "paid",
};

const ACTION_PERMISSION_MAP: Record<ClaimAction, "approve" | "reject" | "update"> = {
  approve: "approve",
  reject: "reject",
  pay: "update",
};

const actionSchema = {
  action: {
    type: "string" as const,
    required: true,
    enum: ["approve", "reject", "pay"] as const,
  },
  amountApprovedKsh: {
    type: "number" as const,
    min: 1,
    max: 10000000,
  },
  reason: {
    type: "string" as const,
    maxLength: 2000,
  },
};

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ claimId: string }> },
) {
  const requestId = generateRequestId();
  const ip = extractIp(request);
  const ua = extractUserAgent(request);

  try {
    const auth = await requireAuth(request, ["admin"]);
    if (!auth.ok) return auth.response;

    const { claimId } = await params;

    if (!claimId || claimId.length > 100 || !/^CLM-\d{4}-\d{4,}$/.test(claimId)) {
      return NextResponse.json(
        { error: "Invalid claim ID format", requestId },
        { status: 400 },
      );
    }

    const body = await request.json();

    const validation = validateBody(body, actionSchema);
    if (!validation.valid) {
      return NextResponse.json(
        { error: "Validation failed", details: validation.errors, requestId },
        { status: 400 },
      );
    }

    const { action, amountApprovedKsh, reason } = body as {
      action: ClaimAction;
      amountApprovedKsh?: number;
      reason?: string;
    };

    const permAction = ACTION_PERMISSION_MAP[action];
    if (!checkPermission(auth.ctx.roles as UserRole[], "claims", permAction)) {
      return NextResponse.json(
        { error: "Insufficient permissions for this action", requestId },
        { status: 403 },
      );
    }

    // Validate state transition is allowed
    const currentStatus = "submitted"; // Will be fetched from DB in production
    const allowedActions = VALID_TRANSITIONS[currentStatus];
    if (allowedActions && !allowedActions.includes(action)) {
      return NextResponse.json(
        { error: `Action '${action}' is not allowed when claim status is '${currentStatus}'`, requestId },
        { status: 409 },
      );
    }

    if (action === "approve" && (!amountApprovedKsh || amountApprovedKsh <= 0)) {
      return NextResponse.json(
        { error: "amountApprovedKsh is required and must be positive for approval", requestId },
        { status: 400 },
      );
    }

    if (action === "reject" && (!reason || reason.trim().length < 10)) {
      return NextResponse.json(
        { error: "A rejection reason of at least 10 characters is required", requestId },
        { status: 400 },
      );
    }

    if (action === "pay") {
      // In production: verify no duplicate payout for this claim
      // and check payment idempotency key
    }

    const newStatus = STATUS_MAP[action];
    const timestamp = new Date().toISOString();

    const previousState = { status: "submitted", reviewedBy: null };

    await createAuditLog({
      actorId: auth.ctx.sub,
      actorRole: auth.ctx.roles[0],
      action: `Claim ${claimId} ${action}d`,
      actionType: action,
      category: "CLAIMS",
      severity: action === "pay" ? "CRITICAL" : "WARNING",
      targetId: claimId,
      targetType: "claim",
      targetLabel: claimId,
      previousState,
      newState: {
        status: newStatus,
        amountApprovedKsh: action === "approve" ? amountApprovedKsh : undefined,
        reason,
        reviewedBy: auth.ctx.sub,
        reviewedAt: timestamp,
      },
      ipAddress: ip,
      userAgent: ua,
      requestId,
    });

    return NextResponse.json({
      claimId,
      status: newStatus,
      action,
      amountApprovedKsh: action === "approve" ? amountApprovedKsh : undefined,
      reason: reason ?? undefined,
      reviewedBy: auth.ctx.sub,
      reviewedAt: timestamp,
      message: `Claim ${claimId} has been ${newStatus}.`,
      requestId,
    });
  } catch {
    return NextResponse.json(
      { error: "Internal server error", requestId },
      { status: 500 },
    );
  }
}
