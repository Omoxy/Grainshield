/**
 * GrainShield Workflow Definitions
 *
 * Formal state machines for all operational lifecycles:
 * - KYC Review
 * - Claim Processing
 * - Warehouse Verification
 * - Loan Application
 * - Payout Authorization
 * - Storage Event Escalation
 */

import { WorkflowEngine, type WorkflowDefinition } from "./engine";

// ─────────────────────────────────────────────
// KYC REVIEW LIFECYCLE
// ─────────────────────────────────────────────

type KycState =
  | "documents_pending"
  | "documents_uploaded"
  | "initial_review"
  | "enhanced_review"
  | "escalated"
  | "approved"
  | "rejected"
  | "suspended";

const kycWorkflowDef: WorkflowDefinition<KycState> = {
  name: "kyc_review",
  version: 1,
  initialState: "documents_pending",
  states: [
    "documents_pending",
    "documents_uploaded",
    "initial_review",
    "enhanced_review",
    "escalated",
    "approved",
    "rejected",
    "suspended",
  ],
  terminalStates: ["approved", "rejected", "suspended"],
  transitions: [
    {
      from: "documents_pending",
      to: "documents_uploaded",
      action: "upload_documents",
      requiredRoles: ["farmer"],
    },
    {
      from: "documents_uploaded",
      to: "initial_review",
      action: "begin_review",
      requiredRoles: ["admin", "super_admin"],
    },
    {
      from: "initial_review",
      to: "approved",
      action: "approve",
      requiredRoles: ["admin", "super_admin"],
      guards: [
        {
          name: "all_documents_verified",
          check: (ctx) => (ctx as Record<string, unknown>).allDocsVerified === true,
          failureMessage: "All required documents must be verified before approval",
        },
      ],
    },
    {
      from: "initial_review",
      to: "rejected",
      action: "reject",
      requiredRoles: ["admin", "super_admin"],
      requiresReason: true,
    },
    {
      from: "initial_review",
      to: "enhanced_review",
      action: "request_enhanced_review",
      requiredRoles: ["admin", "super_admin"],
    },
    {
      from: "initial_review",
      to: "escalated",
      action: "escalate",
      requiredRoles: ["admin", "super_admin"],
      requiresReason: true,
    },
    {
      from: "enhanced_review",
      to: "approved",
      action: "approve",
      requiredRoles: ["super_admin"],
    },
    {
      from: "enhanced_review",
      to: "rejected",
      action: "reject",
      requiredRoles: ["super_admin"],
      requiresReason: true,
    },
    {
      from: "enhanced_review",
      to: "escalated",
      action: "escalate",
      requiredRoles: ["admin", "super_admin"],
      requiresReason: true,
    },
    {
      from: "escalated",
      to: "approved",
      action: "approve",
      requiredRoles: ["super_admin"],
    },
    {
      from: "escalated",
      to: "rejected",
      action: "reject",
      requiredRoles: ["super_admin"],
      requiresReason: true,
    },
    {
      from: "rejected",
      to: "documents_uploaded",
      action: "resubmit",
      requiredRoles: ["farmer"],
    },
  ],
  timeouts: {
    documents_pending: { durationMs: 7 * 24 * 60 * 60 * 1000, escalateTo: "documents_pending" },
    initial_review: { durationMs: 48 * 60 * 60 * 1000, escalateTo: "escalated" },
    enhanced_review: { durationMs: 72 * 60 * 60 * 1000, escalateTo: "escalated" },
  },
  escalationRules: [
    {
      fromState: "initial_review",
      condition: "Review not completed within 48 hours",
      timeoutMs: 48 * 60 * 60 * 1000,
      escalateTo: "escalated",
      notifyRoles: ["super_admin"],
      severity: "medium",
    },
    {
      fromState: "initial_review",
      condition: "Duplicate identity detected",
      escalateTo: "escalated",
      notifyRoles: ["super_admin"],
      severity: "high",
    },
  ],
};

// ─────────────────────────────────────────────
// CLAIM PROCESSING LIFECYCLE
// ─────────────────────────────────────────────

type ClaimState =
  | "draft"
  | "submitted"
  | "fraud_screening"
  | "in_review"
  | "evidence_requested"
  | "escalated"
  | "approved"
  | "payout_pending"
  | "paid"
  | "rejected"
  | "disputed";

const claimWorkflowDef: WorkflowDefinition<ClaimState> = {
  name: "claim_processing",
  version: 1,
  initialState: "submitted",
  states: [
    "draft",
    "submitted",
    "fraud_screening",
    "in_review",
    "evidence_requested",
    "escalated",
    "approved",
    "payout_pending",
    "paid",
    "rejected",
    "disputed",
  ],
  terminalStates: ["paid", "rejected"],
  transitions: [
    {
      from: "draft",
      to: "submitted",
      action: "submit",
      requiredRoles: ["farmer"],
    },
    {
      from: "submitted",
      to: "fraud_screening",
      action: "begin_screening",
      requiredRoles: ["admin", "super_admin"],
    },
    {
      from: "fraud_screening",
      to: "in_review",
      action: "pass_screening",
      requiredRoles: ["admin", "super_admin"],
    },
    {
      from: "fraud_screening",
      to: "escalated",
      action: "flag_suspicious",
      requiredRoles: ["admin", "super_admin"],
      requiresReason: true,
    },
    {
      from: "fraud_screening",
      to: "rejected",
      action: "reject_fraud",
      requiredRoles: ["super_admin"],
      requiresReason: true,
    },
    {
      from: "in_review",
      to: "evidence_requested",
      action: "request_evidence",
      requiredRoles: ["admin", "super_admin"],
    },
    {
      from: "in_review",
      to: "approved",
      action: "approve",
      requiredRoles: ["admin", "super_admin"],
      guards: [
        {
          name: "within_exposure_limit",
          check: (ctx) => {
            const c = ctx as Record<string, unknown>;
            return (c.amountKsh as number) <= (c.exposureLimit as number);
          },
          failureMessage: "Claim amount exceeds authorized exposure limit",
        },
      ],
    },
    {
      from: "in_review",
      to: "rejected",
      action: "reject",
      requiredRoles: ["admin", "super_admin"],
      requiresReason: true,
    },
    {
      from: "in_review",
      to: "escalated",
      action: "escalate",
      requiredRoles: ["admin", "super_admin"],
      requiresReason: true,
    },
    {
      from: "evidence_requested",
      to: "in_review",
      action: "evidence_provided",
      requiredRoles: ["farmer"],
    },
    {
      from: "evidence_requested",
      to: "rejected",
      action: "evidence_timeout",
      requiredRoles: ["admin", "super_admin"],
    },
    {
      from: "escalated",
      to: "approved",
      action: "approve",
      requiredRoles: ["super_admin"],
    },
    {
      from: "escalated",
      to: "rejected",
      action: "reject",
      requiredRoles: ["super_admin"],
      requiresReason: true,
    },
    {
      from: "approved",
      to: "payout_pending",
      action: "initiate_payout",
      requiredRoles: ["admin", "super_admin"],
    },
    {
      from: "payout_pending",
      to: "paid",
      action: "confirm_payment",
      requiredRoles: ["admin", "super_admin"],
    },
    {
      from: "payout_pending",
      to: "approved",
      action: "payment_failed",
      requiredRoles: ["admin", "super_admin"],
    },
    {
      from: "rejected",
      to: "disputed",
      action: "dispute",
      requiredRoles: ["farmer"],
      requiresReason: true,
    },
    {
      from: "disputed",
      to: "in_review",
      action: "reopen_review",
      requiredRoles: ["super_admin"],
    },
    {
      from: "disputed",
      to: "rejected",
      action: "uphold_rejection",
      requiredRoles: ["super_admin"],
      requiresReason: true,
    },
  ],
  timeouts: {
    submitted: { durationMs: 24 * 60 * 60 * 1000, escalateTo: "escalated" },
    in_review: { durationMs: 72 * 60 * 60 * 1000, escalateTo: "escalated" },
    evidence_requested: { durationMs: 7 * 24 * 60 * 60 * 1000, escalateTo: "escalated" },
    payout_pending: { durationMs: 48 * 60 * 60 * 1000, escalateTo: "escalated" },
  },
  escalationRules: [
    {
      fromState: "fraud_screening",
      condition: "Fraud score HIGH",
      escalateTo: "escalated",
      notifyRoles: ["super_admin"],
      severity: "high",
    },
    {
      fromState: "in_review",
      condition: "Claim exceeds KSh 100,000",
      escalateTo: "escalated",
      notifyRoles: ["super_admin"],
      severity: "medium",
    },
    {
      fromState: "in_review",
      condition: "Multiple claims from same warehouse in 7 days",
      escalateTo: "escalated",
      notifyRoles: ["super_admin"],
      severity: "high",
    },
  ],
};

// ─────────────────────────────────────────────
// WAREHOUSE VERIFICATION LIFECYCLE
// ─────────────────────────────────────────────

type WarehouseVerificationState =
  | "scheduled"
  | "inspection_in_progress"
  | "report_pending"
  | "review"
  | "passed"
  | "conditional_pass"
  | "failed"
  | "remediation_required"
  | "reinspection_scheduled";

const warehouseVerificationDef: WorkflowDefinition<WarehouseVerificationState> = {
  name: "warehouse_verification",
  version: 1,
  initialState: "scheduled",
  states: [
    "scheduled",
    "inspection_in_progress",
    "report_pending",
    "review",
    "passed",
    "conditional_pass",
    "failed",
    "remediation_required",
    "reinspection_scheduled",
  ],
  terminalStates: ["passed", "failed"],
  transitions: [
    { from: "scheduled", to: "inspection_in_progress", action: "begin_inspection", requiredRoles: ["admin", "super_admin"] },
    { from: "inspection_in_progress", to: "report_pending", action: "complete_inspection", requiredRoles: ["admin", "super_admin"] },
    { from: "report_pending", to: "review", action: "submit_report", requiredRoles: ["admin", "super_admin"] },
    { from: "review", to: "passed", action: "approve", requiredRoles: ["admin", "super_admin"] },
    { from: "review", to: "conditional_pass", action: "conditional_approve", requiredRoles: ["admin", "super_admin"] },
    { from: "review", to: "failed", action: "fail", requiredRoles: ["super_admin"], requiresReason: true },
    { from: "review", to: "remediation_required", action: "require_remediation", requiredRoles: ["admin", "super_admin"], requiresReason: true },
    { from: "conditional_pass", to: "passed", action: "conditions_met", requiredRoles: ["admin", "super_admin"] },
    { from: "conditional_pass", to: "failed", action: "conditions_not_met", requiredRoles: ["super_admin"] },
    { from: "remediation_required", to: "reinspection_scheduled", action: "schedule_reinspection", requiredRoles: ["admin", "super_admin"] },
    { from: "reinspection_scheduled", to: "inspection_in_progress", action: "begin_inspection", requiredRoles: ["admin", "super_admin"] },
  ],
  timeouts: {
    scheduled: { durationMs: 14 * 24 * 60 * 60 * 1000, escalateTo: "scheduled" },
    report_pending: { durationMs: 48 * 60 * 60 * 1000, escalateTo: "review" },
    remediation_required: { durationMs: 30 * 24 * 60 * 60 * 1000, escalateTo: "failed" },
  },
};

// ─────────────────────────────────────────────
// LOAN APPLICATION LIFECYCLE
// ─────────────────────────────────────────────

type LoanState =
  | "application_submitted"
  | "collateral_assessment"
  | "credit_review"
  | "approval_pending"
  | "approved"
  | "disbursement_pending"
  | "disbursed"
  | "active"
  | "overdue"
  | "repaid"
  | "defaulted"
  | "rejected"
  | "written_off";

const loanWorkflowDef: WorkflowDefinition<LoanState> = {
  name: "loan_application",
  version: 1,
  initialState: "application_submitted",
  states: [
    "application_submitted",
    "collateral_assessment",
    "credit_review",
    "approval_pending",
    "approved",
    "disbursement_pending",
    "disbursed",
    "active",
    "overdue",
    "repaid",
    "defaulted",
    "rejected",
    "written_off",
  ],
  terminalStates: ["repaid", "defaulted", "written_off"],
  transitions: [
    { from: "application_submitted", to: "collateral_assessment", action: "assess_collateral", requiredRoles: ["admin", "super_admin"] },
    { from: "collateral_assessment", to: "credit_review", action: "collateral_verified", requiredRoles: ["admin", "super_admin"] },
    { from: "collateral_assessment", to: "rejected", action: "collateral_insufficient", requiredRoles: ["admin", "super_admin"], requiresReason: true },
    { from: "credit_review", to: "approval_pending", action: "credit_cleared", requiredRoles: ["admin", "super_admin"] },
    { from: "credit_review", to: "rejected", action: "credit_denied", requiredRoles: ["admin", "super_admin"], requiresReason: true },
    { from: "approval_pending", to: "approved", action: "approve", requiredRoles: ["super_admin"] },
    { from: "approval_pending", to: "rejected", action: "reject", requiredRoles: ["super_admin"], requiresReason: true },
    { from: "approved", to: "disbursement_pending", action: "initiate_disbursement", requiredRoles: ["admin", "super_admin"] },
    { from: "disbursement_pending", to: "disbursed", action: "confirm_disbursement", requiredRoles: ["admin", "super_admin"] },
    { from: "disbursement_pending", to: "approved", action: "disbursement_failed", requiredRoles: ["admin", "super_admin"] },
    { from: "disbursed", to: "active", action: "activate", requiredRoles: ["admin", "super_admin"] },
    { from: "active", to: "overdue", action: "mark_overdue", requiredRoles: ["admin", "super_admin"] },
    { from: "active", to: "repaid", action: "mark_repaid", requiredRoles: ["admin", "super_admin"] },
    { from: "overdue", to: "active", action: "payment_received", requiredRoles: ["admin", "super_admin"] },
    { from: "overdue", to: "repaid", action: "mark_repaid", requiredRoles: ["admin", "super_admin"] },
    { from: "overdue", to: "defaulted", action: "mark_defaulted", requiredRoles: ["super_admin"] },
    { from: "defaulted", to: "written_off", action: "write_off", requiredRoles: ["super_admin"] },
    { from: "rejected", to: "application_submitted", action: "reapply", requiredRoles: ["farmer"] },
  ],
  timeouts: {
    application_submitted: { durationMs: 48 * 60 * 60 * 1000, escalateTo: "application_submitted" },
    approval_pending: { durationMs: 24 * 60 * 60 * 1000, escalateTo: "approval_pending" },
    disbursement_pending: { durationMs: 24 * 60 * 60 * 1000, escalateTo: "disbursement_pending" },
  },
};

// ─────────────────────────────────────────────
// PAYOUT AUTHORIZATION LIFECYCLE
// ─────────────────────────────────────────────

type PayoutState =
  | "initiated"
  | "compliance_check"
  | "authorization_pending"
  | "authorized"
  | "processing"
  | "completed"
  | "failed"
  | "reversed"
  | "blocked";

const payoutWorkflowDef: WorkflowDefinition<PayoutState> = {
  name: "payout_authorization",
  version: 1,
  initialState: "initiated",
  states: [
    "initiated",
    "compliance_check",
    "authorization_pending",
    "authorized",
    "processing",
    "completed",
    "failed",
    "reversed",
    "blocked",
  ],
  terminalStates: ["completed", "blocked"],
  transitions: [
    { from: "initiated", to: "compliance_check", action: "begin_compliance", requiredRoles: ["admin", "super_admin"] },
    { from: "compliance_check", to: "authorization_pending", action: "compliance_passed", requiredRoles: ["admin", "super_admin"] },
    { from: "compliance_check", to: "blocked", action: "compliance_failed", requiredRoles: ["admin", "super_admin"], requiresReason: true },
    { from: "authorization_pending", to: "authorized", action: "authorize", requiredRoles: ["super_admin"] },
    { from: "authorization_pending", to: "blocked", action: "block", requiredRoles: ["super_admin"], requiresReason: true },
    { from: "authorized", to: "processing", action: "begin_processing", requiredRoles: ["admin", "super_admin"] },
    { from: "processing", to: "completed", action: "confirm_payment", requiredRoles: ["admin", "super_admin"] },
    { from: "processing", to: "failed", action: "payment_failed", requiredRoles: ["admin", "super_admin"] },
    { from: "failed", to: "processing", action: "retry_payment", requiredRoles: ["admin", "super_admin"] },
    { from: "failed", to: "blocked", action: "block", requiredRoles: ["super_admin"], requiresReason: true },
    { from: "completed", to: "reversed", action: "reverse", requiredRoles: ["super_admin"], requiresReason: true },
  ],
  timeouts: {
    authorization_pending: { durationMs: 4 * 60 * 60 * 1000, escalateTo: "authorization_pending" },
    processing: { durationMs: 30 * 60 * 1000, escalateTo: "processing" },
  },
};

// ─────────────────────────────────────────────
// STORAGE EVENT ESCALATION LIFECYCLE
// ─────────────────────────────────────────────

type StorageEventState =
  | "detected"
  | "acknowledged"
  | "investigating"
  | "mitigation_active"
  | "resolved"
  | "escalated_critical"
  | "insurance_triggered"
  | "closed";

const storageEventDef: WorkflowDefinition<StorageEventState> = {
  name: "storage_event_escalation",
  version: 1,
  initialState: "detected",
  states: [
    "detected",
    "acknowledged",
    "investigating",
    "mitigation_active",
    "resolved",
    "escalated_critical",
    "insurance_triggered",
    "closed",
  ],
  terminalStates: ["closed"],
  transitions: [
    { from: "detected", to: "acknowledged", action: "acknowledge", requiredRoles: ["admin", "super_admin"] },
    { from: "acknowledged", to: "investigating", action: "begin_investigation", requiredRoles: ["admin", "super_admin"] },
    { from: "investigating", to: "mitigation_active", action: "begin_mitigation", requiredRoles: ["admin", "super_admin"] },
    { from: "investigating", to: "resolved", action: "resolve", requiredRoles: ["admin", "super_admin"] },
    { from: "investigating", to: "escalated_critical", action: "escalate_critical", requiredRoles: ["admin", "super_admin"], requiresReason: true },
    { from: "mitigation_active", to: "resolved", action: "resolve", requiredRoles: ["admin", "super_admin"] },
    { from: "mitigation_active", to: "escalated_critical", action: "escalate_critical", requiredRoles: ["admin", "super_admin"], requiresReason: true },
    { from: "escalated_critical", to: "insurance_triggered", action: "trigger_insurance", requiredRoles: ["super_admin"] },
    { from: "escalated_critical", to: "resolved", action: "resolve", requiredRoles: ["super_admin"] },
    { from: "resolved", to: "closed", action: "close", requiredRoles: ["admin", "super_admin"] },
    { from: "insurance_triggered", to: "closed", action: "close", requiredRoles: ["super_admin"] },
  ],
  timeouts: {
    detected: { durationMs: 30 * 60 * 1000, escalateTo: "escalated_critical" },
    acknowledged: { durationMs: 2 * 60 * 60 * 1000, escalateTo: "escalated_critical" },
    investigating: { durationMs: 24 * 60 * 60 * 1000, escalateTo: "escalated_critical" },
  },
};

// ─────────────────────────────────────────────
// ENGINE INSTANCES
// ─────────────────────────────────────────────

export const kycWorkflow = new WorkflowEngine(kycWorkflowDef);
export const claimWorkflow = new WorkflowEngine(claimWorkflowDef);
export const warehouseVerificationWorkflow = new WorkflowEngine(warehouseVerificationDef);
export const loanWorkflow = new WorkflowEngine(loanWorkflowDef);
export const payoutWorkflow = new WorkflowEngine(payoutWorkflowDef);
export const storageEventWorkflow = new WorkflowEngine(storageEventDef);

// Re-export state types for UI
export type { KycState, ClaimState, WarehouseVerificationState, LoanState, PayoutState, StorageEventState };
