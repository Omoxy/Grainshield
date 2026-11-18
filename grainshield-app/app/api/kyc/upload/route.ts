import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/api/auth-guard";
import {
  validateFileContent,
  computeSha256,
  sanitizeFilename,
  generateSecureFilePath,
} from "@/lib/security/file-validation";
import {
  createAuditLog,
  extractIp,
  extractUserAgent,
  generateRequestId,
} from "@/lib/security/audit";
import {
  checkRateLimit,
  extractRateLimitKey,
} from "@/lib/auth/rate-limit";

const UPLOAD_RATE_LIMIT = {
  maxRequests: 10,
  windowMs: 15 * 60 * 1000,
  lockoutDurations: [300, 900],
};

const MAX_TOTAL_UPLOAD_SIZE = 15 * 1024 * 1024; // 15MB total

export async function POST(request: NextRequest) {
  const requestId = generateRequestId();
  const ip = extractIp(request);
  const ua = extractUserAgent(request);

  try {
    const auth = await requireAuth(request, ["farmer"]);
    if (!auth.ok) return auth.response;

    const rlKey = extractRateLimitKey(request, "kyc-upload");
    const rl = checkRateLimit(rlKey, UPLOAD_RATE_LIMIT);

    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many upload attempts. Please try again later.", requestId },
        { status: 429 },
      );
    }

    const formData = await request.formData();
    const userId = formData.get("userId") as string | null;
    const nationalId = formData.get("nationalId") as File | null;
    const selfie = formData.get("selfie") as File | null;
    const proofOfResidence = formData.get("proofOfResidence") as File | null;

    if (!userId) {
      return NextResponse.json(
        { error: "userId is required", requestId },
        { status: 400 },
      );
    }

    if (userId !== auth.ctx.sub) {
      await createAuditLog({
        actorId: auth.ctx.sub,
        actorRole: auth.ctx.roles[0],
        action: `KYC upload denied: userId mismatch (sent ${userId}, token ${auth.ctx.sub})`,
        actionType: "create",
        category: "KYC",
        severity: "WARNING",
        ipAddress: ip,
        requestId,
      });
      return NextResponse.json(
        { error: "Unauthorized: userId does not match authenticated user", requestId },
        { status: 403 },
      );
    }

    if (!nationalId) {
      return NextResponse.json(
        { error: "National ID document is required", requestId },
        { status: 400 },
      );
    }

    const files = [
      { name: "nationalId", file: nationalId, type: "NATIONAL_ID" },
      { name: "selfie", file: selfie, type: "SELFIE" },
      { name: "proofOfResidence", file: proofOfResidence, type: "PROOF_OF_RESIDENCE" },
    ].filter((f): f is { name: string; file: File; type: string } => f.file !== null);

    const totalSize = files.reduce((sum, f) => sum + f.file.size, 0);
    if (totalSize > MAX_TOTAL_UPLOAD_SIZE) {
      return NextResponse.json(
        { error: `Total upload size exceeds ${MAX_TOTAL_UPLOAD_SIZE / 1024 / 1024}MB limit`, requestId },
        { status: 400 },
      );
    }

    const documents = [];

    for (const { name, file, type } of files) {
      const validationResult = await validateFileContent(file);
      if (!validationResult.valid) {
        return NextResponse.json(
          { error: `${name}: ${validationResult.error}`, requestId },
          { status: 400 },
        );
      }

      const sha256 = await computeSha256(file);
      const safeName = sanitizeFilename(file.name);
      const extension = safeName.split(".").pop() ?? "bin";
      const storagePath = generateSecureFilePath(userId, type, extension);

      // In production: check sha256 against known fraudulent documents
      // In production: upload to encrypted object storage with signed URL
      // In production: queue antivirus scan job

      documents.push({
        type,
        fileName: safeName,
        size: file.size,
        mimeType: file.type,
        sha256,
        storagePath,
        status: "pending_review" as const,
        scanStatus: "pending" as const,
        uploadedAt: new Date().toISOString(),
      });
    }

    await createAuditLog({
      actorId: auth.ctx.sub,
      actorRole: auth.ctx.roles[0],
      action: `KYC documents uploaded: ${documents.map((d) => d.type).join(", ")}`,
      actionType: "create",
      category: "KYC",
      targetId: userId,
      targetType: "user",
      targetLabel: `${documents.length} document(s)`,
      newState: {
        documents: documents.map((d) => ({
          type: d.type,
          fileName: d.fileName,
          sha256: d.sha256,
        })),
      },
      ipAddress: ip,
      userAgent: ua,
      requestId,
    });

    console.log(
      `[KYC UPLOAD] ${documents.length} documents uploaded for user ${userId}`,
    );

    return NextResponse.json({
      userId,
      accountStatus: "PENDING_KYC",
      documents,
      message: "KYC documents uploaded successfully. Your application is under review.",
      requestId,
    });
  } catch {
    return NextResponse.json(
      { error: "Internal server error", requestId },
      { status: 500 },
    );
  }
}
