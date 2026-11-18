/**
 * GrainShield Workflow Engine
 *
 * Formal state machine framework for operational lifecycles.
 * Supports: states, transitions, guards, escalation rules,
 * timeout handling, actor attribution, rollback awareness, and audit integration.
 */

// ─────────────────────────────────────────────
// CORE TYPES
// ─────────────────────────────────────────────

export interface WorkflowActor {
  id: string;
  role: string;
  name?: string;
  ipAddress?: string;
}

export interface TransitionGuard<TContext = Record<string, unknown>> {
  name: string;
  check: (context: TContext, actor: WorkflowActor) => boolean | Promise<boolean>;
  failureMessage: string;
}

export interface EscalationRule<TState extends string = string> {
  fromState: TState;
  condition: string;
  timeoutMs?: number;
  escalateTo: TState;
  notifyRoles: string[];
  severity: "low" | "medium" | "high" | "critical";
}

export interface WorkflowTransition<
  TState extends string = string,
  TContext = Record<string, unknown>,
> {
  from: TState | TState[];
  to: TState;
  action: string;
  guards?: TransitionGuard<TContext>[];
  requiredRoles?: string[];
  requiresReason?: boolean;
  sideEffects?: ((context: TContext, actor: WorkflowActor) => void | Promise<void>)[];
}

export interface WorkflowDefinition<
  TState extends string = string,
  TContext = Record<string, unknown>,
> {
  name: string;
  version: number;
  initialState: TState;
  states: TState[];
  terminalStates: TState[];
  transitions: WorkflowTransition<TState, TContext>[];
  escalationRules?: EscalationRule<TState>[];
  timeouts?: Partial<Record<TState, { durationMs: number; escalateTo: TState }>>;
}

export interface WorkflowInstance<TState extends string = string> {
  id: string;
  workflowName: string;
  workflowVersion: number;
  entityId: string;
  entityType: string;
  currentState: TState;
  previousState: TState | null;
  stateEnteredAt: Date;
  createdAt: Date;
  updatedAt: Date;
  metadata: Record<string, unknown>;
}

export interface TransitionRecord {
  id: string;
  instanceId: string;
  fromState: string;
  toState: string;
  action: string;
  actorId: string;
  actorRole: string;
  reason?: string;
  guardResults: { name: string; passed: boolean; message?: string }[];
  timestamp: Date;
}

export interface TransitionResult {
  success: boolean;
  previousState: string;
  newState: string;
  error?: string;
  guardFailures?: { name: string; message: string }[];
  transitionRecord?: TransitionRecord;
}

// ─────────────────────────────────────────────
// WORKFLOW ENGINE
// ─────────────────────────────────────────────

export class WorkflowEngine<
  TState extends string = string,
  TContext = Record<string, unknown>,
> {
  private definition: WorkflowDefinition<TState, TContext>;
  private onTransitionCallbacks: ((record: TransitionRecord) => void | Promise<void>)[] = [];

  constructor(definition: WorkflowDefinition<TState, TContext>) {
    this.definition = definition;
    this.validateDefinition();
  }

  private validateDefinition(): void {
    const { states, transitions, terminalStates, initialState } = this.definition;

    if (!states.includes(initialState)) {
      throw new Error(`Initial state "${initialState}" not in states list`);
    }

    for (const ts of terminalStates) {
      if (!states.includes(ts)) {
        throw new Error(`Terminal state "${ts}" not in states list`);
      }
    }

    for (const t of transitions) {
      const froms = Array.isArray(t.from) ? t.from : [t.from];
      for (const f of froms) {
        if (!states.includes(f)) {
          throw new Error(`Transition from unknown state "${f}"`);
        }
      }
      if (!states.includes(t.to)) {
        throw new Error(`Transition to unknown state "${t.to}"`);
      }
    }
  }

  getName(): string {
    return this.definition.name;
  }

  getDefinition(): WorkflowDefinition<TState, TContext> {
    return this.definition;
  }

  createInstance(entityId: string, entityType: string, metadata?: Record<string, unknown>): WorkflowInstance<TState> {
    const now = new Date();
    return {
      id: generateWorkflowId(),
      workflowName: this.definition.name,
      workflowVersion: this.definition.version,
      entityId,
      entityType,
      currentState: this.definition.initialState,
      previousState: null,
      stateEnteredAt: now,
      createdAt: now,
      updatedAt: now,
      metadata: metadata ?? {},
    };
  }

  getAvailableTransitions(currentState: TState, actorRole?: string): WorkflowTransition<TState, TContext>[] {
    return this.definition.transitions.filter((t) => {
      const froms = Array.isArray(t.from) ? t.from : [t.from];
      if (!froms.includes(currentState)) return false;
      if (actorRole && t.requiredRoles && !t.requiredRoles.includes(actorRole)) return false;
      return true;
    });
  }

  isTerminal(state: TState): boolean {
    return this.definition.terminalStates.includes(state);
  }

  async transition(
    instance: WorkflowInstance<TState>,
    action: string,
    actor: WorkflowActor,
    context: TContext,
    reason?: string,
  ): Promise<TransitionResult> {
    // Find matching transition
    const transition = this.definition.transitions.find((t) => {
      const froms = Array.isArray(t.from) ? t.from : [t.from];
      return froms.includes(instance.currentState) && t.action === action;
    });

    if (!transition) {
      return {
        success: false,
        previousState: instance.currentState,
        newState: instance.currentState,
        error: `No transition "${action}" from state "${instance.currentState}"`,
      };
    }

    // Check terminal state
    if (this.isTerminal(instance.currentState)) {
      return {
        success: false,
        previousState: instance.currentState,
        newState: instance.currentState,
        error: `Cannot transition from terminal state "${instance.currentState}"`,
      };
    }

    // Check role authorization
    if (transition.requiredRoles && !transition.requiredRoles.includes(actor.role)) {
      return {
        success: false,
        previousState: instance.currentState,
        newState: instance.currentState,
        error: `Role "${actor.role}" not authorized for action "${action}"`,
      };
    }

    // Check reason requirement
    if (transition.requiresReason && !reason) {
      return {
        success: false,
        previousState: instance.currentState,
        newState: instance.currentState,
        error: `Action "${action}" requires a reason`,
      };
    }

    // Run guards
    const guardResults: { name: string; passed: boolean; message?: string }[] = [];
    if (transition.guards) {
      for (const guard of transition.guards) {
        try {
          const passed = await guard.check(context, actor);
          guardResults.push({ name: guard.name, passed, message: passed ? undefined : guard.failureMessage });
        } catch (err) {
          guardResults.push({
            name: guard.name,
            passed: false,
            message: `Guard error: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }

      const failures = guardResults.filter((g) => !g.passed);
      if (failures.length > 0) {
        return {
          success: false,
          previousState: instance.currentState,
          newState: instance.currentState,
          error: "Transition blocked by guards",
          guardFailures: failures.map((f) => ({ name: f.name, message: f.message ?? "Guard check failed" })),
        };
      }
    }

    // Execute transition
    const previousState = instance.currentState;
    const now = new Date();

    instance.previousState = previousState;
    instance.currentState = transition.to;
    instance.stateEnteredAt = now;
    instance.updatedAt = now;

    // Create transition record
    const record: TransitionRecord = {
      id: generateWorkflowId(),
      instanceId: instance.id,
      fromState: previousState,
      toState: transition.to,
      action,
      actorId: actor.id,
      actorRole: actor.role,
      reason,
      guardResults,
      timestamp: now,
    };

    // Execute side effects
    if (transition.sideEffects) {
      for (const effect of transition.sideEffects) {
        try {
          await effect(context, actor);
        } catch (err) {
          console.error(`[Workflow] Side effect error in ${this.definition.name}:`, err);
        }
      }
    }

    // Notify listeners
    for (const cb of this.onTransitionCallbacks) {
      try {
        await cb(record);
      } catch (err) {
        console.error(`[Workflow] Transition callback error:`, err);
      }
    }

    return {
      success: true,
      previousState,
      newState: transition.to,
      transitionRecord: record,
    };
  }

  onTransition(callback: (record: TransitionRecord) => void | Promise<void>): void {
    this.onTransitionCallbacks.push(callback);
  }

  getEscalationRules(): EscalationRule<TState>[] {
    return this.definition.escalationRules ?? [];
  }

  getTimeout(state: TState): { durationMs: number; escalateTo: TState } | undefined {
    return this.definition.timeouts?.[state];
  }

  checkTimeoutEscalation(instance: WorkflowInstance<TState>): {
    shouldEscalate: boolean;
    escalateTo?: TState;
    overdueMs?: number;
  } {
    const timeout = this.getTimeout(instance.currentState);
    if (!timeout) return { shouldEscalate: false };

    const elapsed = Date.now() - instance.stateEnteredAt.getTime();
    if (elapsed > timeout.durationMs) {
      return {
        shouldEscalate: true,
        escalateTo: timeout.escalateTo,
        overdueMs: elapsed - timeout.durationMs,
      };
    }

    return { shouldEscalate: false };
  }
}

// ─────────────────────────────────────────────
// UTILITY
// ─────────────────────────────────────────────

function generateWorkflowId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
