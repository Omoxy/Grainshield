async function getDb() {
  try {
    const { db } = await import("@/lib/db");
    return db;
  } catch {
    return null;
  }
}

interface FraudCheckResult {
  score: "LOW" | "MEDIUM" | "HIGH";
  confidence: number;
  flags: string[];
  shouldEscalate: boolean;
}

const DUPLICATE_WINDOW_DAYS = 30;
const MAX_CLAIMS_PER_MONTH = 3;
const HIGH_VALUE_THRESHOLD_KSH = 50000;

export async function checkClaimFraud(params: {
  userId: string;
  warehouseReceiptId: string;
  category: string;
  amountKsh: number;
  eventDate?: Date;
  eventLocation?: string;
  description: string;
}): Promise<FraudCheckResult> {
  const db = await getDb();
  if (!db) {
    return { score: "LOW", confidence: 0, flags: [], shouldEscalate: false };
  }

  const flags: string[] = [];
  let riskPoints = 0;

  const dupWindow = new Date(
    Date.now() - DUPLICATE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );

  const [recentClaims, receiptClaims, userClaimCount] = await Promise.all([
    db.claim.findMany({
      where: {
        userId: params.userId,
        category: params.category as never,
        dateSubmitted: { gte: dupWindow },
        status: { not: "REJECTED" },
      },
      select: {
        id: true,
        claimCode: true,
        amountClaimedKsh: true,
        description: true,
      },
    }),
    db.claim.findMany({
      where: {
        warehouseReceiptId: params.warehouseReceiptId,
        status: { not: "REJECTED" },
      },
      select: { id: true, category: true, amountClaimedKsh: true },
    }),
    db.claim.count({
      where: {
        userId: params.userId,
        dateSubmitted: { gte: dupWindow },
      },
    }),
  ]);

  if (recentClaims.length > 0) {
    flags.push(
      `Duplicate category: ${recentClaims.length} similar claim(s) in ${DUPLICATE_WINDOW_DAYS} days`,
    );
    riskPoints += 30;
  }

  const totalReceiptClaimed = receiptClaims.reduce(
    (sum: number, c: { amountClaimedKsh: number }) => sum + c.amountClaimedKsh,
    0,
  );
  const receipt = await db.warehouseReceipt.findUnique({
    where: { id: params.warehouseReceiptId },
    select: { estimatedValueKsh: true, quantityKg: true },
  });

  if (receipt?.estimatedValueKsh) {
    const claimRatio =
      (totalReceiptClaimed + params.amountKsh) / receipt.estimatedValueKsh;
    if (claimRatio > 1.0) {
      flags.push(
        `Total claims (${Math.round(claimRatio * 100)}%) exceed receipt value`,
      );
      riskPoints += 40;
    } else if (claimRatio > 0.8) {
      flags.push(
        `Total claims at ${Math.round(claimRatio * 100)}% of receipt value`,
      );
      riskPoints += 15;
    }
  }

  if (userClaimCount >= MAX_CLAIMS_PER_MONTH) {
    flags.push(
      `High frequency: ${userClaimCount} claims in ${DUPLICATE_WINDOW_DAYS} days`,
    );
    riskPoints += 20;
  }

  if (params.amountKsh > HIGH_VALUE_THRESHOLD_KSH) {
    flags.push(`High value claim: KSh ${params.amountKsh.toLocaleString()}`);
    riskPoints += 10;
  }

  if (params.eventDate) {
    const daysSinceEvent = Math.floor(
      (Date.now() - params.eventDate.getTime()) / (24 * 60 * 60 * 1000),
    );
    if (daysSinceEvent > 90) {
      flags.push(`Late submission: event was ${daysSinceEvent} days ago`);
      riskPoints += 25;
    }
  }

  let score: "LOW" | "MEDIUM" | "HIGH";
  if (riskPoints >= 50) score = "HIGH";
  else if (riskPoints >= 25) score = "MEDIUM";
  else score = "LOW";

  const confidence = Math.min(riskPoints / 100, 1.0);

  return {
    score,
    confidence,
    flags,
    shouldEscalate: score === "HIGH",
  };
}

export async function checkDuplicateIdentity(params: {
  phone: string;
  email: string;
  fullName: string;
  excludeUserId?: string;
}): Promise<{ isDuplicate: boolean; matches: string[] }> {
  const db = await getDb();
  if (!db) {
    return { isDuplicate: false, matches: [] };
  }

  const matches: string[] = [];

  const [phoneMatch, emailMatch] = await Promise.all([
    db.user.findFirst({
      where: {
        phone: params.phone,
        id: params.excludeUserId ? { not: params.excludeUserId } : undefined,
      },
      select: { id: true },
    }),
    db.user.findFirst({
      where: {
        email: params.email,
        id: params.excludeUserId ? { not: params.excludeUserId } : undefined,
      },
      select: { id: true },
    }),
  ]);

  if (phoneMatch) matches.push("phone");
  if (emailMatch) matches.push("email");

  return { isDuplicate: matches.length > 0, matches };
}
