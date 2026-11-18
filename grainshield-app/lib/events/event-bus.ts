/**
 * GrainShield Event System
 *
 * Internal event-driven operational intelligence layer.
 * Events trigger notifications, update queues, create audit records,
 * feed analytics, and trigger escalation workflows.
 *
 * Uses async processing and decoupled handlers to avoid
 * tightly coupled synchronous logic.
 */

// ─────────────────────────────────────────────
// EVENT TYPES
// ─────────────────────────────────────────────

export type EventCategory =
  | "kyc"
  | "claims"
  | "warehouse"
  | "weather"
  | "price"
  | "loan"
  | "payout"
  | "storage"
  | "fraud"
  | "system";

export type EventSeverity = "info" | "low" | "medium" | "high" | "critical";

export interface GrainShieldEvent<TPayload = Record<string, unknown>> {
  id: string;
  type: string;
  category: EventCategory;
  severity: EventSeverity;
  payload: TPayload;
  actorId?: string;
  actorRole?: string;
  entityId?: string;
  entityType?: string;
  correlationId?: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

// ─────────────────────────────────────────────
// SPECIFIC EVENT TYPES
// ─────────────────────────────────────────────

export interface KycSubmittedPayload {
  userId: string;
  documentTypes: string[];
  county: string;
}

export interface KycApprovedPayload {
  userId: string;
  reviewerId: string;
  documentsCount: number;
}

export interface ClaimSubmittedPayload {
  claimId: string;
  userId: string;
  category: string;
  amountKsh: number;
  warehouseId?: string;
  fraudScore: string;
}

export interface ClaimEscalatedPayload {
  claimId: string;
  reason: string;
  previousState: string;
  fraudScore: string;
  escalatedBy: string;
}

export interface WarehouseAnomalyPayload {
  warehouseId: string;
  warehouseCode: string;
  anomalyType: "humidity" | "temperature" | "sensor_offline" | "inventory_mismatch";
  severity: EventSeverity;
  currentValue?: number;
  threshold?: number;
  lastReading?: Date;
}

export interface PriceShockPayload {
  grainType: string;
  market: string;
  previousPrice: number;
  currentPrice: number;
  changePercent: number;
  direction: "up" | "down";
}

export interface RainfallAnomalyPayload {
  region: string;
  county: string;
  observedMm: number;
  expectedMm: number;
  deviationPercent: number;
  source: string;
  affectedFarmers: number;
}

export interface StorageRiskPayload {
  warehouseId: string;
  riskType: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  affectedQuantityKg: number;
  affectedValueKsh: number;
  farmersAffected: number;
}

export interface LoanOverduePayload {
  loanId: string;
  loanCode: string;
  userId: string;
  amountKsh: number;
  daysOverdue: number;
  collateralId: string;
}

export interface PayoutCompletedPayload {
  transactionId: string;
  claimId?: string;
  loanId?: string;
  amountKsh: number;
  method: string;
  reference: string;
  recipientPhone: string;
}

// ─────────────────────────────────────────────
// EVENT HANDLER
// ─────────────────────────────────────────────

export type EventHandler<TPayload = Record<string, unknown>> = (
  event: GrainShieldEvent<TPayload>,
) => void | Promise<void>;

interface HandlerRegistration {
  eventType: string;
  handler: EventHandler<unknown>;
  priority: number;
  name: string;
}

// ─────────────────────────────────────────────
// EVENT BUS
// ─────────────────────────────────────────────

class EventBus {
  private handlers: HandlerRegistration[] = [];
  private deadLetterQueue: { event: GrainShieldEvent; error: string; failedAt: Date }[] = [];
  private eventLog: GrainShieldEvent[] = [];
  private maxLogSize = 1000;

  on<TPayload>(
    eventType: string,
    handler: EventHandler<TPayload>,
    options?: { priority?: number; name?: string },
  ): () => void {
    const registration: HandlerRegistration = {
      eventType,
      handler: handler as EventHandler<unknown>,
      priority: options?.priority ?? 0,
      name: options?.name ?? `handler_${this.handlers.length}`,
    };

    this.handlers.push(registration);
    this.handlers.sort((a, b) => b.priority - a.priority);

    // Return unsubscribe function
    return () => {
      const idx = this.handlers.indexOf(registration);
      if (idx >= 0) this.handlers.splice(idx, 1);
    };
  }

  onCategory(
    category: EventCategory,
    handler: EventHandler,
    options?: { priority?: number; name?: string },
  ): () => void {
    const registration: HandlerRegistration = {
      eventType: `__category:${category}`,
      handler: handler as EventHandler<unknown>,
      priority: options?.priority ?? 0,
      name: options?.name ?? `category_handler_${this.handlers.length}`,
    };

    this.handlers.push(registration);
    this.handlers.sort((a, b) => b.priority - a.priority);

    return () => {
      const idx = this.handlers.indexOf(registration);
      if (idx >= 0) this.handlers.splice(idx, 1);
    };
  }

  async emit<TPayload>(
    type: string,
    category: EventCategory,
    severity: EventSeverity,
    payload: TPayload,
    options?: {
      actorId?: string;
      actorRole?: string;
      entityId?: string;
      entityType?: string;
      correlationId?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<GrainShieldEvent<TPayload>> {
    const event: GrainShieldEvent<TPayload> = {
      id: generateEventId(),
      type,
      category,
      severity,
      payload,
      actorId: options?.actorId,
      actorRole: options?.actorRole,
      entityId: options?.entityId,
      entityType: options?.entityType,
      correlationId: options?.correlationId ?? generateEventId(),
      timestamp: new Date(),
      metadata: options?.metadata,
    };

    // Log the event
    this.eventLog.push(event as GrainShieldEvent);
    if (this.eventLog.length > this.maxLogSize) {
      this.eventLog = this.eventLog.slice(-this.maxLogSize);
    }

    // Find matching handlers (specific type + category handlers)
    const matchingHandlers = this.handlers.filter(
      (h) => h.eventType === type || h.eventType === `__category:${category}`,
    );

    // Execute handlers asynchronously, catch errors for dead-letter queue
    const handlerPromises = matchingHandlers.map(async (registration) => {
      try {
        await registration.handler(event as GrainShieldEvent<unknown>);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`[EventBus] Handler "${registration.name}" failed for event "${type}":`, errorMsg);
        this.deadLetterQueue.push({
          event: event as GrainShieldEvent,
          error: `Handler "${registration.name}": ${errorMsg}`,
          failedAt: new Date(),
        });
      }
    });

    // Fire-and-forget: don't block the caller on all handlers
    Promise.all(handlerPromises).catch(() => {});

    return event;
  }

  getRecentEvents(limit = 50): GrainShieldEvent[] {
    return this.eventLog.slice(-limit);
  }

  getEventsByCategory(category: EventCategory, limit = 50): GrainShieldEvent[] {
    return this.eventLog
      .filter((e) => e.category === category)
      .slice(-limit);
  }

  getEventsBySeverity(severity: EventSeverity, limit = 50): GrainShieldEvent[] {
    return this.eventLog
      .filter((e) => e.severity === severity)
      .slice(-limit);
  }

  getDeadLetterQueue(): { event: GrainShieldEvent; error: string; failedAt: Date }[] {
    return [...this.deadLetterQueue];
  }

  clearDeadLetterQueue(): number {
    const count = this.deadLetterQueue.length;
    this.deadLetterQueue = [];
    return count;
  }

  getHandlerCount(): number {
    return this.handlers.length;
  }
}

function generateEventId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `evt_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

// ─────────────────────────────────────────────
// SINGLETON INSTANCE
// ─────────────────────────────────────────────

const globalForEventBus = globalThis as unknown as { eventBus: EventBus | undefined };
export const eventBus = globalForEventBus.eventBus ?? new EventBus();
if (process.env.NODE_ENV !== "production") {
  globalForEventBus.eventBus = eventBus;
}

// ─────────────────────────────────────────────
// CONVENIENCE EMITTERS
// ─────────────────────────────────────────────

export const events = {
  kycSubmitted: (payload: KycSubmittedPayload, actorId: string) =>
    eventBus.emit("kyc.submitted", "kyc", "info", payload, { actorId, entityId: payload.userId, entityType: "user" }),

  kycApproved: (payload: KycApprovedPayload, actorId: string) =>
    eventBus.emit("kyc.approved", "kyc", "info", payload, { actorId, entityId: payload.userId, entityType: "user" }),

  claimSubmitted: (payload: ClaimSubmittedPayload, actorId: string) =>
    eventBus.emit("claim.submitted", "claims", payload.fraudScore === "HIGH" ? "high" : "info", payload, { actorId, entityId: payload.claimId, entityType: "claim" }),

  claimEscalated: (payload: ClaimEscalatedPayload) =>
    eventBus.emit("claim.escalated", "claims", "high", payload, { entityId: payload.claimId, entityType: "claim" }),

  warehouseAnomaly: (payload: WarehouseAnomalyPayload) =>
    eventBus.emit("warehouse.anomaly", "warehouse", payload.severity, payload, { entityId: payload.warehouseId, entityType: "warehouse" }),

  priceShock: (payload: PriceShockPayload) =>
    eventBus.emit("price.shock", "price", Math.abs(payload.changePercent) > 15 ? "high" : "medium", payload, { entityType: "price" }),

  rainfallAnomaly: (payload: RainfallAnomalyPayload) =>
    eventBus.emit("weather.rainfall_anomaly", "weather", payload.deviationPercent > 50 ? "high" : "medium", payload, { entityType: "weather" }),

  storageRiskThreshold: (payload: StorageRiskPayload) =>
    eventBus.emit("storage.risk_threshold", "storage", payload.riskLevel === "critical" ? "critical" : "high", payload, { entityId: payload.warehouseId, entityType: "warehouse" }),

  loanOverdue: (payload: LoanOverduePayload) =>
    eventBus.emit("loan.overdue", "loan", payload.daysOverdue > 30 ? "high" : "medium", payload, { entityId: payload.loanId, entityType: "loan" }),

  payoutCompleted: (payload: PayoutCompletedPayload) =>
    eventBus.emit("payout.completed", "payout", "info", payload, { entityId: payload.transactionId, entityType: "transaction" }),
};
