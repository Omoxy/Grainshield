/**
 * GrainShield Grain Lot Traceability
 *
 * Lifecycle tracking for grain lots:
 * - Intake timestamping
 * - Storage movement history
 * - Receipt linkage
 * - Claim linkage
 * - Warehouse transfer records
 * - Quality score history
 *
 * Supports origin traceability, timeline reconstruction,
 * dispute resolution, and warehouse accountability.
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

export interface GrainLotTimeline {
  lotCode: string;
  grainType: string;
  status: string;
  originCounty: string;
  originWard: string;
  intakeDate: Date;
  currentWarehouse: string;
  initialQuantityKg: number;
  currentQuantityKg: number;
  qualityScore: number | null;
  events: TimelineEvent[];
  linkedReceipts: string[];
  linkedClaims: string[];
}

export interface TimelineEvent {
  id: string;
  timestamp: Date;
  type: "intake" | "transfer" | "quality_check" | "adjustment" | "release" | "write_off" | "claim_filed" | "claim_resolved";
  description: string;
  actor?: string;
  quantityKg?: number;
  location?: string;
  metadata?: Record<string, unknown>;
}

export interface TraceabilitySummary {
  totalLots: number;
  activeLots: number;
  totalQuantityKg: number;
  averageQualityScore: number;
  lotsWithClaims: number;
  lotsAtRisk: number;
}

// ─────────────────────────────────────────────
// LOT LIFECYCLE
// ─────────────────────────────────────────────

export async function createGrainLot(params: {
  warehouseId: string;
  farmerId: string;
  warehouseReceiptId?: string;
  grainType: string;
  quantityKg: number;
  grade: "A" | "B" | "C";
  moistureAtIntake?: number;
  temperatureAtIntake?: number;
  originCounty?: string;
  originWard?: string;
  performedBy: string;
  performedByRole: string;
}): Promise<{ lotCode: string; id: string } | null> {
  const db = await getDb();
  if (!db) return null;

  const count = await db.grainLot.count();
  const lotCode = `GL-${new Date().getFullYear()}-${String(count + 1).padStart(4, "0")}`;

  const lot = await db.grainLot.create({
    data: {
      lotCode,
      warehouseId: params.warehouseId,
      warehouseReceiptId: params.warehouseReceiptId,
      farmerId: params.farmerId,
      grainType: params.grainType,
      quantityKg: params.quantityKg,
      currentQuantityKg: params.quantityKg,
      grade: params.grade,
      status: "INTAKE",
      moistureAtIntake: params.moistureAtIntake,
      temperatureAtIntake: params.temperatureAtIntake,
      originCounty: params.originCounty,
      originWard: params.originWard,
    },
  });

  await db.grainLotMovement.create({
    data: {
      grainLotId: lot.id,
      movementType: "intake",
      toLocation: params.warehouseId,
      quantityKg: params.quantityKg,
      performedBy: params.performedBy,
      performedByRole: params.performedByRole,
      reference: params.warehouseReceiptId,
    },
  });

  if (params.moistureAtIntake != null) {
    await db.grainLotQualityLog.create({
      data: {
        grainLotId: lot.id,
        qualityScore: computeQualityScore(params.moistureAtIntake, params.temperatureAtIntake),
        moisturePct: params.moistureAtIntake,
        temperatureC: params.temperatureAtIntake,
        source: "manual",
      },
    });
  }

  return { lotCode, id: lot.id };
}

export async function recordMovement(params: {
  grainLotId: string;
  movementType: "transfer" | "release" | "adjustment" | "write_off";
  fromLocation?: string;
  toLocation?: string;
  quantityKg: number;
  reason?: string;
  performedBy: string;
  performedByRole: string;
  reference?: string;
}): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  const lot = await db.grainLot.findUnique({ where: { id: params.grainLotId } });
  if (!lot) return false;

  await db.grainLotMovement.create({
    data: {
      grainLotId: params.grainLotId,
      movementType: params.movementType,
      fromLocation: params.fromLocation,
      toLocation: params.toLocation,
      quantityKg: params.quantityKg,
      reason: params.reason,
      performedBy: params.performedBy,
      performedByRole: params.performedByRole,
      reference: params.reference,
    },
  });

  let newQuantity = lot.currentQuantityKg;
  let newStatus = lot.status;

  if (params.movementType === "release") {
    newQuantity -= params.quantityKg;
    if (newQuantity <= 0) newStatus = "RELEASED";
  } else if (params.movementType === "write_off") {
    newQuantity -= params.quantityKg;
    if (newQuantity <= 0) newStatus = "WRITTEN_OFF";
  } else if (params.movementType === "transfer") {
    newStatus = "IN_TRANSIT";
  }

  await db.grainLot.update({
    where: { id: params.grainLotId },
    data: {
      currentQuantityKg: Math.max(0, newQuantity),
      status: newStatus,
      releaseDate: newStatus === "RELEASED" ? new Date() : undefined,
    },
  });

  return true;
}

// ─────────────────────────────────────────────
// TIMELINE RECONSTRUCTION
// ─────────────────────────────────────────────

export async function getGrainLotTimeline(lotId: string): Promise<GrainLotTimeline | null> {
  const db = await getDb();
  if (!db) return null;

  const lot = await db.grainLot.findUnique({
    where: { id: lotId },
    include: {
      movements: { orderBy: { createdAt: "asc" } },
      qualityLog: { orderBy: { recordedAt: "asc" } },
    },
  });

  if (!lot) return null;

  const events: TimelineEvent[] = [];

  for (const mv of lot.movements) {
    events.push({
      id: mv.id,
      timestamp: mv.createdAt,
      type: mv.movementType as TimelineEvent["type"],
      description: buildMovementDescription(mv.movementType, mv.quantityKg, mv.fromLocation, mv.toLocation, mv.reason),
      actor: mv.performedBy,
      quantityKg: mv.quantityKg,
      location: mv.toLocation ?? mv.fromLocation ?? undefined,
      metadata: { reference: mv.reference },
    });
  }

  for (const ql of lot.qualityLog) {
    events.push({
      id: ql.id,
      timestamp: ql.recordedAt,
      type: "quality_check",
      description: `Quality score: ${ql.qualityScore.toFixed(0)}/100 — Moisture: ${ql.moisturePct ?? "—"}%, Temp: ${ql.temperatureC ?? "—"}°C`,
      actor: ql.inspector ?? undefined,
      metadata: {
        qualityScore: ql.qualityScore,
        moisturePct: ql.moisturePct,
        temperatureC: ql.temperatureC,
        source: ql.source,
      },
    });
  }

  events.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  // Fetch linked claims
  const claims = lot.warehouseReceiptId
    ? await db.claim.findMany({
        where: { warehouseReceiptId: lot.warehouseReceiptId },
        select: { claimCode: true },
      })
    : [];

  return {
    lotCode: lot.lotCode,
    grainType: lot.grainType,
    status: lot.status,
    originCounty: lot.originCounty ?? "—",
    originWard: lot.originWard ?? "—",
    intakeDate: lot.intakeDate,
    currentWarehouse: lot.warehouseId,
    initialQuantityKg: lot.quantityKg,
    currentQuantityKg: lot.currentQuantityKg,
    qualityScore: lot.qualityScore,
    events,
    linkedReceipts: lot.warehouseReceiptId ? [lot.warehouseReceiptId] : [],
    linkedClaims: claims.map((c) => c.claimCode),
  };
}

// ─────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────

export async function getTraceabilitySummary(): Promise<TraceabilitySummary> {
  const db = await getDb();
  if (!db) {
    return { totalLots: 0, activeLots: 0, totalQuantityKg: 0, averageQualityScore: 0, lotsWithClaims: 0, lotsAtRisk: 0 };
  }

  const [totalLots, activeLots, aggregate] = await Promise.all([
    db.grainLot.count(),
    db.grainLot.count({ where: { status: { in: ["INTAKE", "STORED"] } } }),
    db.grainLot.aggregate({
      _sum: { currentQuantityKg: true },
      _avg: { qualityScore: true },
    }),
  ]);

  return {
    totalLots,
    activeLots,
    totalQuantityKg: aggregate._sum.currentQuantityKg ?? 0,
    averageQualityScore: aggregate._avg.qualityScore ?? 0,
    lotsWithClaims: 0,
    lotsAtRisk: 0,
  };
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function computeQualityScore(moisturePct: number, temperatureC?: number | null): number {
  let score = 100;
  // Optimal maize moisture: 12-14%
  if (moisturePct > 14) score -= (moisturePct - 14) * 5;
  if (moisturePct < 10) score -= (10 - moisturePct) * 3;
  // Optimal storage temp: 15-25°C
  if (temperatureC != null) {
    if (temperatureC > 25) score -= (temperatureC - 25) * 3;
    if (temperatureC < 15) score -= (15 - temperatureC) * 2;
  }
  return Math.max(0, Math.min(100, score));
}

function buildMovementDescription(
  type: string,
  qty: number,
  from?: string | null,
  to?: string | null,
  reason?: string | null,
): string {
  const qtyStr = `${qty.toLocaleString()} kg`;
  switch (type) {
    case "intake": return `Grain intake: ${qtyStr} received at ${to ?? "warehouse"}`;
    case "transfer": return `Transfer: ${qtyStr} from ${from ?? "—"} to ${to ?? "—"}`;
    case "release": return `Released: ${qtyStr}${reason ? ` — ${reason}` : ""}`;
    case "adjustment": return `Adjustment: ${qtyStr}${reason ? ` — ${reason}` : ""}`;
    case "write_off": return `Written off: ${qtyStr}${reason ? ` — ${reason}` : ""}`;
    default: return `${type}: ${qtyStr}`;
  }
}
