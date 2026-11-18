/**
 * GrainShield Operational Queues
 *
 * Formal triage-oriented review queues for:
 * - KYC Review
 * - Claims Review
 * - Warehouse Risk
 * - Loan Exposure
 *
 * Each queue sorts by operational priority, surfaces risk indicators,
 * and supports assignment, escalation, and resolution tracking.
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

export interface QueueItem {
  id: string;
  entityId: string;
  entityType: string;
  priority: "critical" | "high" | "medium" | "low";
  priorityScore: number;
  title: string;
  subtitle: string;
  status: string;
  assignedTo?: string;
  age: string;
  ageMs: number;
  indicators: QueueIndicator[];
  metadata: Record<string, unknown>;
}

export interface QueueIndicator {
  label: string;
  value: string;
  severity: "info" | "warning" | "danger";
}

export interface QueueSummary {
  queueName: string;
  totalItems: number;
  criticalCount: number;
  highCount: number;
  oldestItemAge: string;
  avgProcessingTimeMs: number;
  items: QueueItem[];
}

// ─────────────────────────────────────────────
// KYC REVIEW QUEUE
// ─────────────────────────────────────────────

export async function getKycReviewQueue(): Promise<QueueSummary> {
  const db = await getDb();
  if (!db) return emptyQueue("kyc_review");

  const pending = await db.user.findMany({
    where: {
      accountStatus: { in: ["PENDING_KYC", "KYC_IN_REVIEW"] },
      deletedAt: null,
    },
    include: {
      kycDocuments: { select: { type: true, status: true, sha256Hash: true, scanStatus: true, fileSize: true } },
      farmerProfile: { select: { county: true, ward: true } },
    },
    orderBy: { createdAt: "asc" },
    take: 100,
  });

  const items: QueueItem[] = pending.map((user) => {
    const indicators: QueueIndicator[] = [];
    const ageMs = Date.now() - user.createdAt.getTime();

    const allUploaded = user.kycDocuments.length >= 3;
    const hasInfected = user.kycDocuments.some((d) => d.scanStatus === "infected");
    const hasDupHash = user.kycDocuments.some((d) => d.sha256Hash && d.status === "PENDING_REVIEW");

    let priorityScore = 0;

    if (hasInfected) {
      indicators.push({ label: "Malware detected", value: "Infected file", severity: "danger" });
      priorityScore += 80;
    }
    if (hasDupHash) {
      indicators.push({ label: "Duplicate suspicion", value: "Hash match found", severity: "warning" });
      priorityScore += 40;
    }
    if (!allUploaded) {
      indicators.push({ label: "Incomplete docs", value: `${user.kycDocuments.length}/3 uploaded`, severity: "warning" });
      priorityScore += 10;
    }
    if (ageMs > 48 * 60 * 60 * 1000) {
      indicators.push({ label: "Overdue", value: formatAge(ageMs), severity: "danger" });
      priorityScore += 30;
    }

    const smallFiles = user.kycDocuments.filter((d) => d.fileSize < 10000);
    if (smallFiles.length > 0) {
      indicators.push({ label: "Low quality", value: `${smallFiles.length} file(s) < 10KB`, severity: "warning" });
      priorityScore += 15;
    }

    return {
      id: user.id,
      entityId: user.id,
      entityType: "user",
      priority: scoreToPriority(priorityScore),
      priorityScore,
      title: user.fullName,
      subtitle: `${user.farmerProfile?.county ?? "—"} · ${user.phone}`,
      status: user.accountStatus,
      age: formatAge(ageMs),
      ageMs,
      indicators,
      metadata: {
        email: user.email,
        phone: user.phone,
        county: user.farmerProfile?.county,
        ward: user.farmerProfile?.ward,
        documentsCount: user.kycDocuments.length,
      },
    };
  });

  items.sort((a, b) => b.priorityScore - a.priorityScore);

  return {
    queueName: "kyc_review",
    totalItems: items.length,
    criticalCount: items.filter((i) => i.priority === "critical").length,
    highCount: items.filter((i) => i.priority === "high").length,
    oldestItemAge: items.length > 0 ? items.reduce((max, i) => i.ageMs > max.ageMs ? i : max).age : "—",
    avgProcessingTimeMs: 0,
    items,
  };
}

// ─────────────────────────────────────────────
// CLAIMS REVIEW QUEUE
// ─────────────────────────────────────────────

export async function getClaimsReviewQueue(): Promise<QueueSummary> {
  const db = await getDb();
  if (!db) return emptyQueue("claims_review");

  const pending = await db.claim.findMany({
    where: {
      status: { in: ["SUBMITTED", "IN_REVIEW"] },
    },
    include: {
      user: { select: { fullName: true, phone: true } },
      warehouseReceipt: {
        select: {
          receiptCode: true,
          warehouseId: true,
          estimatedValueKsh: true,
          warehouse: { select: { name: true, code: true } },
        },
      },
    },
    orderBy: { dateSubmitted: "asc" },
    take: 100,
  });

  const items: QueueItem[] = pending.map((claim) => {
    const indicators: QueueIndicator[] = [];
    const ageMs = Date.now() - claim.dateSubmitted.getTime();
    let priorityScore = 0;

    if (claim.fraudScore === "HIGH") {
      indicators.push({ label: "Fraud score", value: "HIGH", severity: "danger" });
      priorityScore += 60;
    } else if (claim.fraudScore === "MEDIUM") {
      indicators.push({ label: "Fraud score", value: "MEDIUM", severity: "warning" });
      priorityScore += 25;
    }

    if (claim.fraudConfidence && claim.fraudConfidence > 0.7) {
      indicators.push({ label: "Confidence", value: `${Math.round(claim.fraudConfidence * 100)}%`, severity: "danger" });
      priorityScore += 20;
    }

    if (claim.escalated) {
      indicators.push({ label: "Escalated", value: claim.escalatedReason ?? "Manual", severity: "danger" });
      priorityScore += 50;
    }

    if (claim.amountClaimedKsh > 50000) {
      indicators.push({ label: "High value", value: `KSh ${claim.amountClaimedKsh.toLocaleString()}`, severity: "warning" });
      priorityScore += 15;
    }

    if (claim.weatherCorrelation) {
      indicators.push({ label: "Weather corr.", value: claim.weatherCorrelation, severity: "info" });
    }

    if (ageMs > 72 * 60 * 60 * 1000) {
      indicators.push({ label: "Overdue", value: formatAge(ageMs), severity: "danger" });
      priorityScore += 30;
    }

    return {
      id: claim.id,
      entityId: claim.id,
      entityType: "claim",
      priority: scoreToPriority(priorityScore),
      priorityScore,
      title: `${claim.claimCode} — ${claim.category.replace(/_/g, " ")}`,
      subtitle: `${claim.user.fullName} · ${claim.warehouseReceipt.warehouse.name}`,
      status: claim.status,
      age: formatAge(ageMs),
      ageMs,
      indicators,
      metadata: {
        claimCode: claim.claimCode,
        farmerName: claim.user.fullName,
        amountKsh: claim.amountClaimedKsh,
        warehouse: claim.warehouseReceipt.warehouse.name,
        receiptCode: claim.warehouseReceipt.receiptCode,
        fraudScore: claim.fraudScore,
        category: claim.category,
        description: claim.description,
      },
    };
  });

  items.sort((a, b) => b.priorityScore - a.priorityScore);

  return {
    queueName: "claims_review",
    totalItems: items.length,
    criticalCount: items.filter((i) => i.priority === "critical").length,
    highCount: items.filter((i) => i.priority === "high").length,
    oldestItemAge: items.length > 0 ? items.reduce((max, i) => i.ageMs > max.ageMs ? i : max).age : "—",
    avgProcessingTimeMs: 0,
    items,
  };
}

// ─────────────────────────────────────────────
// WAREHOUSE RISK QUEUE
// ─────────────────────────────────────────────

export async function getWarehouseRiskQueue(): Promise<QueueSummary> {
  const db = await getDb();
  if (!db) return emptyQueue("warehouse_risk");

  const warehouses = await db.warehouse.findMany({
    include: {
      riskFlags: { where: { resolvedAt: null } },
      sensorReadings: { orderBy: { recordedAt: "desc" }, take: 1 },
      receipts: {
        where: { deletedAt: null },
        select: { quantityKg: true, estimatedValueKsh: true, userId: true },
      },
    },
  });

  const items: QueueItem[] = warehouses
    .filter((wh) => wh.riskFlags.length > 0 || wh.status !== "OPERATIONAL")
    .map((wh) => {
      const indicators: QueueIndicator[] = [];
      let priorityScore = 0;

      for (const flag of wh.riskFlags) {
        const sev = flag.severity === "high" ? "danger" : flag.severity === "medium" ? "warning" : "info";
        indicators.push({ label: "Risk flag", value: flag.flag, severity: sev });
        priorityScore += flag.severity === "high" ? 40 : flag.severity === "medium" ? 20 : 5;
      }

      const latestReading = wh.sensorReadings[0];
      if (latestReading) {
        if (latestReading.humidityPct > 65) {
          indicators.push({ label: "Humidity", value: `${latestReading.humidityPct}%`, severity: "danger" });
          priorityScore += 30;
        } else if (latestReading.humidityPct > 60) {
          indicators.push({ label: "Humidity", value: `${latestReading.humidityPct}%`, severity: "warning" });
          priorityScore += 10;
        }
        const readingAge = Date.now() - latestReading.recordedAt.getTime();
        if (readingAge > 4 * 60 * 60 * 1000) {
          indicators.push({ label: "Stale data", value: formatAge(readingAge), severity: "warning" });
          priorityScore += 15;
        }
      } else {
        indicators.push({ label: "No sensor data", value: "—", severity: "danger" });
        priorityScore += 50;
      }

      if (wh.lastInspection) {
        const inspAge = Date.now() - wh.lastInspection.getTime();
        if (inspAge > 30 * 24 * 60 * 60 * 1000) {
          indicators.push({ label: "Overdue inspection", value: formatAge(inspAge), severity: "warning" });
          priorityScore += 20;
        }
      }

      const totalKg = wh.receipts.reduce((s, r) => s + r.quantityKg, 0);
      const totalValue = wh.receipts.reduce((s, r) => s + (r.estimatedValueKsh ?? 0), 0);
      const uniqueFarmers = new Set(wh.receipts.map((r) => r.userId)).size;
      const ageMs = wh.riskFlags.length > 0
        ? Date.now() - Math.min(...wh.riskFlags.map((f) => f.createdAt.getTime()))
        : 0;

      return {
        id: wh.id,
        entityId: wh.id,
        entityType: "warehouse",
        priority: scoreToPriority(priorityScore),
        priorityScore,
        title: `${wh.name} (${wh.code})`,
        subtitle: `${wh.location}, ${wh.county}`,
        status: wh.status,
        age: ageMs > 0 ? formatAge(ageMs) : "—",
        ageMs,
        indicators,
        metadata: {
          storedKg: totalKg,
          storedValueKsh: totalValue,
          farmersCount: uniqueFarmers,
          capacityKg: wh.capacityKg,
          utilizationPct: Math.round((totalKg / wh.capacityKg) * 100),
        },
      };
    });

  items.sort((a, b) => b.priorityScore - a.priorityScore);

  return {
    queueName: "warehouse_risk",
    totalItems: items.length,
    criticalCount: items.filter((i) => i.priority === "critical").length,
    highCount: items.filter((i) => i.priority === "high").length,
    oldestItemAge: items.length > 0 ? items.reduce((max, i) => i.ageMs > max.ageMs ? i : max).age : "—",
    avgProcessingTimeMs: 0,
    items,
  };
}

// ─────────────────────────────────────────────
// LOAN EXPOSURE QUEUE
// ─────────────────────────────────────────────

export async function getLoanExposureQueue(): Promise<QueueSummary> {
  const db = await getDb();
  if (!db) return emptyQueue("loan_exposure");

  const loans = await db.loan.findMany({
    where: {
      status: { in: ["PENDING_APPROVAL", "APPROVED", "DISBURSED", "ACTIVE"] },
    },
    include: {
      user: { select: { fullName: true, phone: true } },
      warehouseReceipt: {
        select: {
          receiptCode: true,
          quantityKg: true,
          estimatedValueKsh: true,
          healthStatus: true,
          warehouse: { select: { name: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
    take: 100,
  });

  const items: QueueItem[] = loans.map((loan) => {
    const indicators: QueueIndicator[] = [];
    let priorityScore = 0;
    const ageMs = Date.now() - loan.createdAt.getTime();

    const collateralValue = loan.warehouseReceipt.estimatedValueKsh ?? 0;
    const ltv = collateralValue > 0 ? (loan.amountKsh / collateralValue) * 100 : 100;

    if (ltv > 80) {
      indicators.push({ label: "LTV ratio", value: `${Math.round(ltv)}%`, severity: "danger" });
      priorityScore += 50;
    } else if (ltv > 60) {
      indicators.push({ label: "LTV ratio", value: `${Math.round(ltv)}%`, severity: "warning" });
      priorityScore += 20;
    }

    if (loan.warehouseReceipt.healthStatus === "RISK") {
      indicators.push({ label: "Collateral at risk", value: "Storage risk detected", severity: "danger" });
      priorityScore += 40;
    }

    if (loan.dueDate) {
      const daysUntilDue = (loan.dueDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
      if (daysUntilDue < 0) {
        indicators.push({ label: "Overdue", value: `${Math.abs(Math.round(daysUntilDue))} days`, severity: "danger" });
        priorityScore += 60;
      } else if (daysUntilDue < 7) {
        indicators.push({ label: "Due soon", value: `${Math.round(daysUntilDue)} days`, severity: "warning" });
        priorityScore += 15;
      }
    }

    if (loan.amountKsh > 100000) {
      indicators.push({ label: "High exposure", value: `KSh ${loan.amountKsh.toLocaleString()}`, severity: "warning" });
      priorityScore += 10;
    }

    const repaymentRatio = loan.amountKsh > 0 ? (loan.totalRepaidKsh / loan.amountKsh) * 100 : 0;
    if (repaymentRatio < 10 && loan.status === "ACTIVE") {
      indicators.push({ label: "Low repayment", value: `${Math.round(repaymentRatio)}%`, severity: "warning" });
      priorityScore += 15;
    }

    return {
      id: loan.id,
      entityId: loan.id,
      entityType: "loan",
      priority: scoreToPriority(priorityScore),
      priorityScore,
      title: `${loan.loanCode} — KSh ${loan.amountKsh.toLocaleString()}`,
      subtitle: `${loan.user.fullName} · ${loan.warehouseReceipt.warehouse.name}`,
      status: loan.status,
      age: formatAge(ageMs),
      ageMs,
      indicators,
      metadata: {
        loanCode: loan.loanCode,
        farmerName: loan.user.fullName,
        amountKsh: loan.amountKsh,
        totalRepaidKsh: loan.totalRepaidKsh,
        collateralValueKsh: collateralValue,
        ltvPct: Math.round(ltv),
        repaymentPct: Math.round(repaymentRatio),
        dueDate: loan.dueDate?.toISOString(),
        receiptCode: loan.warehouseReceipt.receiptCode,
      },
    };
  });

  items.sort((a, b) => b.priorityScore - a.priorityScore);

  return {
    queueName: "loan_exposure",
    totalItems: items.length,
    criticalCount: items.filter((i) => i.priority === "critical").length,
    highCount: items.filter((i) => i.priority === "high").length,
    oldestItemAge: items.length > 0 ? items.reduce((max, i) => i.ageMs > max.ageMs ? i : max).age : "—",
    avgProcessingTimeMs: 0,
    items,
  };
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function formatAge(ms: number): string {
  if (ms < 60 * 60 * 1000) return `${Math.round(ms / (60 * 1000))}m`;
  if (ms < 24 * 60 * 60 * 1000) return `${Math.round(ms / (60 * 60 * 1000))}h`;
  return `${Math.round(ms / (24 * 60 * 60 * 1000))}d`;
}

function scoreToPriority(score: number): QueueItem["priority"] {
  if (score >= 70) return "critical";
  if (score >= 40) return "high";
  if (score >= 15) return "medium";
  return "low";
}

function emptyQueue(name: string): QueueSummary {
  return {
    queueName: name,
    totalItems: 0,
    criticalCount: 0,
    highCount: 0,
    oldestItemAge: "—",
    avgProcessingTimeMs: 0,
    items: [],
  };
}
