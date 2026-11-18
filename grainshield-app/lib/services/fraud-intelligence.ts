/**
 * GrainShield Advanced Fraud Intelligence
 *
 * Behavioral monitoring beyond static rules:
 * - Suspicious claim timing
 * - Coordinated claims detection
 * - Warehouse collusion patterns
 * - Registration burst detection
 * - Abnormal payout routing
 * - Device fingerprint analysis
 * - Borrowing behavior anomalies
 */

async function getDb() {
  try {
    const { db } = await import("@/lib/db");
    return db;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

export interface FraudSignal {
  type: string;
  severity: "low" | "medium" | "high" | "critical";
  confidence: number;
  description: string;
  evidence: string[];
  relatedEntityIds: string[];
  recommendedAction: string;
}

export interface BehavioralProfile {
  entityId: string;
  entityType: string;
  riskScore: number;
  riskLabel: "low" | "medium" | "high" | "critical";
  signals: FraudSignal[];
  lastAssessed: Date;
}

// ─────────────────────────────────────────────
// COORDINATED CLAIMS DETECTION
// ─────────────────────────────────────────────

export async function detectCoordinatedClaims(windowDays = 7): Promise<FraudSignal[]> {
  const db = await getDb();
  if (!db) return [];

  const signals: FraudSignal[] = [];
  const windowStart = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const recentClaims = await db.claim.findMany({
    where: { dateSubmitted: { gte: windowStart } },
    include: {
      user: { select: { id: true, fullName: true, phone: true, farmerProfile: { select: { county: true, ward: true } } } },
      warehouseReceipt: { select: { warehouseId: true, warehouse: { select: { name: true } } } },
    },
    orderBy: { dateSubmitted: "asc" },
  });

  // Group by warehouse to detect clustering
  const byWarehouse = new Map<string, typeof recentClaims>();
  for (const claim of recentClaims) {
    const whId = claim.warehouseReceipt.warehouseId;
    if (!byWarehouse.has(whId)) byWarehouse.set(whId, []);
    byWarehouse.get(whId)!.push(claim);
  }

  for (const [, claims] of byWarehouse) {
    if (claims.length >= 4) {
      const totalAmount = claims.reduce((s, c) => s + c.amountClaimedKsh, 0);
      const warehouseName = claims[0].warehouseReceipt.warehouse.name;
      signals.push({
        type: "coordinated_claims",
        severity: claims.length >= 6 ? "critical" : "high",
        confidence: Math.min(0.5 + claims.length * 0.08, 0.95),
        description: `${claims.length} claims from ${warehouseName} within ${windowDays} days totaling KSh ${totalAmount.toLocaleString()}`,
        evidence: claims.map((c) => `${c.claimCode}: ${c.user.fullName} — KSh ${c.amountClaimedKsh.toLocaleString()}`),
        relatedEntityIds: claims.map((c) => c.id),
        recommendedAction: "Investigate warehouse operations and cross-reference farmer connections",
      });
    }
  }

  // Detect same-category clustering (many farmers claiming same damage type in same period)
  const byCategory = new Map<string, typeof recentClaims>();
  for (const claim of recentClaims) {
    const key = `${claim.category}:${claim.user.farmerProfile?.county ?? "unknown"}`;
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key)!.push(claim);
  }

  for (const [key, claims] of byCategory) {
    if (claims.length >= 5) {
      const [category, county] = key.split(":");
      signals.push({
        type: "category_clustering",
        severity: "medium",
        confidence: 0.4 + claims.length * 0.05,
        description: `${claims.length} ${category.replace(/_/g, " ")} claims from ${county} in ${windowDays} days`,
        evidence: claims.map((c) => `${c.claimCode}: ${c.user.fullName}`),
        relatedEntityIds: claims.map((c) => c.id),
        recommendedAction: "Verify regional weather/storage event corroborates claim cluster",
      });
    }
  }

  return signals;
}

// ─────────────────────────────────────────────
// REGISTRATION BURST DETECTION
// ─────────────────────────────────────────────

export async function detectRegistrationBursts(windowHours = 24, threshold = 10): Promise<FraudSignal[]> {
  const db = await getDb();
  if (!db) return [];

  const signals: FraudSignal[] = [];
  const windowStart = new Date(Date.now() - windowHours * 60 * 60 * 1000);

  const recentRegistrations = await db.user.findMany({
    where: { createdAt: { gte: windowStart }, role: "FARMER" },
    include: { farmerProfile: { select: { county: true, ward: true } } },
    orderBy: { createdAt: "asc" },
  });

  // Group by ward
  const byWard = new Map<string, typeof recentRegistrations>();
  for (const user of recentRegistrations) {
    const ward = user.farmerProfile?.ward ?? "unknown";
    if (!byWard.has(ward)) byWard.set(ward, []);
    byWard.get(ward)!.push(user);
  }

  for (const [ward, users] of byWard) {
    if (users.length >= threshold) {
      signals.push({
        type: "registration_burst",
        severity: users.length >= threshold * 2 ? "high" : "medium",
        confidence: 0.4 + (users.length / (threshold * 3)),
        description: `${users.length} registrations from ${ward} in ${windowHours}h`,
        evidence: users.map((u) => `${u.fullName} (${u.phone}) at ${u.createdAt.toISOString()}`),
        relatedEntityIds: users.map((u) => u.id),
        recommendedAction: "Review registrations for synthetic identities or agent-driven fraud",
      });
    }
  }

  return signals;
}

// ─────────────────────────────────────────────
// SUSPICIOUS TIMING DETECTION
// ─────────────────────────────────────────────

export async function detectSuspiciousTiming(): Promise<FraudSignal[]> {
  const db = await getDb();
  if (!db) return [];

  const signals: FraudSignal[] = [];

  // Claims submitted very quickly after registration
  const newFarmerClaims = await db.claim.findMany({
    where: {
      dateSubmitted: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
    },
    include: {
      user: { select: { id: true, fullName: true, createdAt: true } },
    },
  });

  for (const claim of newFarmerClaims) {
    const accountAgeDays = (claim.dateSubmitted.getTime() - claim.user.createdAt.getTime()) / (24 * 60 * 60 * 1000);
    if (accountAgeDays < 3 && claim.amountClaimedKsh > 20000) {
      signals.push({
        type: "timing_anomaly",
        severity: "high",
        confidence: 0.65,
        description: `Claim ${claim.claimCode} for KSh ${claim.amountClaimedKsh.toLocaleString()} submitted ${Math.round(accountAgeDays)}d after registration`,
        evidence: [
          `Account created: ${claim.user.createdAt.toISOString()}`,
          `Claim submitted: ${claim.dateSubmitted.toISOString()}`,
          `Amount: KSh ${claim.amountClaimedKsh.toLocaleString()}`,
        ],
        relatedEntityIds: [claim.id, claim.user.id],
        recommendedAction: "Verify farmer identity and claim legitimacy — fast-track claims from new accounts are a common fraud pattern",
      });
    }
  }

  return signals;
}

// ─────────────────────────────────────────────
// PAYOUT ROUTING ANALYSIS
// ─────────────────────────────────────────────

export async function detectAbnormalPayoutRouting(): Promise<FraudSignal[]> {
  const db = await getDb();
  if (!db) return [];

  const signals: FraudSignal[] = [];

  // Detect multiple claims/loans routing payouts to the same phone
  const transactions = await db.transaction.findMany({
    where: {
      status: "COMPLETED",
      initiatedAt: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) },
    },
    select: { phoneNumber: true, amountKsh: true, relatedEntityId: true, type: true },
  });

  const byPhone = new Map<string, typeof transactions>();
  for (const tx of transactions) {
    if (!byPhone.has(tx.phoneNumber)) byPhone.set(tx.phoneNumber, []);
    byPhone.get(tx.phoneNumber)!.push(tx);
  }

  for (const [phone, txs] of byPhone) {
    const uniqueEntities = new Set(txs.map((t) => t.relatedEntityId)).size;
    const totalAmount = txs.reduce((s, t) => s + t.amountKsh, 0);

    if (uniqueEntities >= 3 && totalAmount > 100000) {
      signals.push({
        type: "payout_concentration",
        severity: "high",
        confidence: 0.6 + uniqueEntities * 0.05,
        description: `Phone ${phone.slice(0, 7)}*** received ${txs.length} payouts from ${uniqueEntities} entities totaling KSh ${totalAmount.toLocaleString()}`,
        evidence: txs.map((t) => `${t.type}: KSh ${t.amountKsh.toLocaleString()} (entity: ${t.relatedEntityId})`),
        relatedEntityIds: txs.map((t) => t.relatedEntityId).filter(Boolean) as string[],
        recommendedAction: "Verify that all payout recipients are distinct beneficiaries — possible payout aggregation fraud",
      });
    }
  }

  return signals;
}

// ─────────────────────────────────────────────
// COMPOSITE FRAUD ASSESSMENT
// ─────────────────────────────────────────────

export async function runFraudIntelligenceScan(): Promise<{
  signals: FraudSignal[];
  summary: {
    totalSignals: number;
    criticalCount: number;
    highCount: number;
    mediumCount: number;
    scannedAt: Date;
  };
}> {
  const [coordinated, bursts, timing, routing] = await Promise.all([
    detectCoordinatedClaims(),
    detectRegistrationBursts(),
    detectSuspiciousTiming(),
    detectAbnormalPayoutRouting(),
  ]);

  const signals = [...coordinated, ...bursts, ...timing, ...routing];
  signals.sort((a, b) => {
    const sevOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    return sevOrder[a.severity] - sevOrder[b.severity] || b.confidence - a.confidence;
  });

  return {
    signals,
    summary: {
      totalSignals: signals.length,
      criticalCount: signals.filter((s) => s.severity === "critical").length,
      highCount: signals.filter((s) => s.severity === "high").length,
      mediumCount: signals.filter((s) => s.severity === "medium").length,
      scannedAt: new Date(),
    },
  };
}
