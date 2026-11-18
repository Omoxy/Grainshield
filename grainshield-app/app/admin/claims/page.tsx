"use client";

import { useState } from "react";
import {
  Search,
  CheckCircle2,
  XCircle,
  Clock,
  Banknote,
  Eye,
  Shield,
  Loader2,
  ChevronRight,
  AlertTriangle,
} from "lucide-react";
import useSWR from "swr";

const fetcher = (url: string) =>
  fetch(url, { credentials: "include" }).then((r) => {
    if (!r.ok) throw new Error("Failed to fetch");
    return r.json();
  });

type ClaimStatus = "submitted" | "in_review" | "approved" | "rejected" | "paid";

interface AdminClaim {
  id: string;
  farmer: string;
  farmerId: string;
  stage: "pre_harvest" | "post_harvest";
  type: string;
  warehouseReceipt: string;
  warehouse: string;
  amountClaimedKsh: number;
  amountApprovedKsh?: number;
  dateSubmitted: string;
  status: ClaimStatus;
  fraudScore: string;
  description: string;
}

const STATUS_CONFIG: Record<ClaimStatus, { label: string; color: string; icon: typeof Clock }> = {
  submitted: { label: "Submitted", color: "bg-orange-50 text-risk-high", icon: Clock },
  in_review: { label: "In Review", color: "bg-status-info-surface text-status-info", icon: Eye },
  approved: { label: "Approved", color: "bg-status-success-surface text-status-success", icon: CheckCircle2 },
  rejected: { label: "Rejected", color: "bg-status-danger-surface text-status-danger", icon: XCircle },
  paid: { label: "Paid Out", color: "bg-brand-50 text-brand-700", icon: Banknote },
};

const FRAUD_COLORS: Record<string, string> = {
  low: "text-status-success bg-status-success-surface",
  medium: "text-status-warning bg-status-warning-surface",
  high: "text-status-danger bg-status-danger-surface",
};

const WORKFLOW_STAGES: { key: ClaimStatus; label: string; icon: typeof Clock }[] = [
  { key: "submitted", label: "Submitted", icon: Clock },
  { key: "in_review", label: "In Review", icon: Eye },
  { key: "approved", label: "Approved", icon: CheckCircle2 },
  { key: "paid", label: "Paid", icon: Banknote },
];

export default function AdminClaimsPage() {
  const [activeStage, setActiveStage] = useState<ClaimStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedClaim, setSelectedClaim] = useState<AdminClaim | null>(null);
  const [actionModal, setActionModal] = useState<{
    claim: AdminClaim;
    action: "approve" | "reject";
  } | null>(null);
  const [actionForm, setActionForm] = useState({
    amountApprovedKsh: "",
    reason: "",
  });
  const [actionLoading, setActionLoading] = useState(false);
  const [actionResult, setActionResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("limit", "20");
  if (activeStage !== "all") params.set("status", activeStage);
  if (search) params.set("search", search);

  const { data, isLoading, mutate } = useSWR(`/api/claims?${params}`, fetcher, { revalidateOnFocus: false });

  const claims: AdminClaim[] = data?.claims ?? [];
  const summary = data?.summary;
  const pagination = data?.pagination;

  function openAction(claim: AdminClaim, action: "approve" | "reject") {
    setActionModal({ claim, action });
    setActionForm({
      amountApprovedKsh: action === "approve" ? String(claim.amountClaimedKsh) : "",
      reason: "",
    });
    setActionResult(null);
  }

  async function submitAction() {
    if (!actionModal) return;
    setActionLoading(true);
    setActionResult(null);

    try {
      const body: Record<string, unknown> = { action: actionModal.action };
      if (actionModal.action === "approve") {
        body.amountApprovedKsh = Number(actionForm.amountApprovedKsh);
      }
      if (actionForm.reason.trim()) {
        body.reason = actionForm.reason.trim();
      }

      const res = await fetch(`/api/claims/${actionModal.claim.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(body),
      });
      const result = await res.json();

      if (!res.ok) {
        setActionResult({ success: false, message: result.error ?? "Action failed" });
      } else {
        setActionResult({ success: true, message: result.message });
        mutate();
      }
    } catch {
      setActionResult({ success: false, message: "Network error" });
    } finally {
      setActionLoading(false);
    }
  }

  const stageCounts: Record<string, number> = {
    submitted: summary?.pendingCount ?? 0,
    in_review: 0,
    approved: summary?.approvedCount ?? 0,
    paid: 0,
  };

  return (
    <div className="max-w-7xl">
      <div className="mb-4">
        <h1 className="page-title">Claims Management</h1>
        <p className="page-subtitle">Review, validate, and authorize payouts</p>
      </div>

      {/* Workflow pipeline — status progression as the primary navigation */}
      <div className="flex items-stretch gap-px bg-border mb-5 overflow-x-auto">
        <button
          onClick={() => { setActiveStage("all"); setPage(1); setSelectedClaim(null); }}
          className={`flex-1 min-w-[100px] px-4 py-3 text-left transition-colors ${
            activeStage === "all" ? "bg-white" : "bg-surface-raised hover:bg-white"
          }`}
        >
          <p className="text-2xs text-ink-muted uppercase tracking-wide">All Claims</p>
          <p className="text-lg font-bold text-ink tabular-nums mt-0.5">{summary?.totalClaims ?? "—"}</p>
          {(summary?.fraudFlagsCount ?? 0) > 0 && (
            <span className="inline-flex items-center gap-1 text-2xs text-status-danger mt-1">
              <AlertTriangle style={{ width: 10, height: 10 }} />
              {summary?.fraudFlagsCount} fraud flags
            </span>
          )}
        </button>
        {WORKFLOW_STAGES.map((stage, i) => {
          const Icon = stage.icon;
          const isActive = activeStage === stage.key;
          const count = stageCounts[stage.key];
          return (
            <button
              key={stage.key}
              onClick={() => { setActiveStage(stage.key); setPage(1); setSelectedClaim(null); }}
              className={`flex-1 min-w-[100px] px-4 py-3 text-left transition-colors relative ${
                isActive ? "bg-white" : "bg-surface-raised hover:bg-white"
              }`}
            >
              <div className="flex items-center gap-1.5">
                <Icon style={{ width: 11, height: 11 }} className="text-ink-muted" />
                <p className="text-2xs text-ink-muted uppercase tracking-wide">{stage.label}</p>
              </div>
              <p className="text-lg font-bold text-ink tabular-nums mt-0.5">{count || "—"}</p>
              {i < WORKFLOW_STAGES.length - 1 && (
                <ChevronRight style={{ width: 12, height: 12 }} className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 z-10 text-ink-faint" />
              )}
            </button>
          );
        })}
        <div className="flex-1 min-w-[100px] px-4 py-3 bg-surface-raised">
          <p className="text-2xs text-ink-muted uppercase tracking-wide">Rejected</p>
          <p className="text-lg font-bold text-ink-tertiary tabular-nums mt-0.5">
            {(summary?.totalClaims ?? 0) - (summary?.pendingCount ?? 0) - (summary?.approvedCount ?? 0) || "—"}
          </p>
        </div>
      </div>

      {/* Action Modal */}
      {actionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="card shadow-modal max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-bold text-ink mb-1">
              {actionModal.action === "approve" ? "Approve Claim" : "Reject Claim"}
            </h3>
            <p className="text-sm text-ink-tertiary mb-4">
              <span className="font-mono">{actionModal.claim.id}</span> — {actionModal.claim.farmer} — KSh {actionModal.claim.amountClaimedKsh.toLocaleString()}
            </p>

            {actionModal.action === "approve" && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-ink-secondary mb-1.5">
                  Approved Amount (KSh)
                </label>
                <input
                  type="number"
                  value={actionForm.amountApprovedKsh}
                  onChange={(e) => setActionForm((f) => ({ ...f, amountApprovedKsh: e.target.value }))}
                  className="input-field tabular-nums"
                />
              </div>
            )}

            <div className="mb-5">
              <label className="block text-sm font-medium text-ink-secondary mb-1.5">
                {actionModal.action === "reject" ? "Rejection Reason (required)" : "Notes (optional)"}
              </label>
              <textarea
                rows={3}
                value={actionForm.reason}
                onChange={(e) => setActionForm((f) => ({ ...f, reason: e.target.value }))}
                placeholder={actionModal.action === "reject"
                  ? "Explain why this claim is being rejected..."
                  : "Optional review notes..."
                }
                className="input-field resize-none"
              />
            </div>

            {actionResult && (
              <div className={`p-3 text-sm mb-4 ${actionResult.success ? "bg-status-success-surface text-status-success" : "bg-status-danger-surface text-status-danger"}`}>
                {actionResult.message}
              </div>
            )}

            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setActionModal(null)}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={submitAction}
                disabled={actionLoading}
                className={`btn-primary ${
                  actionModal.action === "reject"
                    ? "!bg-status-danger hover:!bg-red-800"
                    : "!bg-status-success hover:!bg-green-800"
                }`}
              >
                {actionLoading && <Loader2 style={{ width: 14, height: 14 }} className="animate-spin" />}
                {actionLoading
                  ? "Processing..."
                  : actionModal.action === "approve"
                    ? "Confirm Approval"
                    : "Confirm Rejection"
                }
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main content: list + detail split */}
      <div className="flex flex-col lg:flex-row gap-4">
        {/* Claims list */}
        <div className="flex-1 min-w-0">
          <div className="mb-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" style={{ width: 15, height: 15 }} />
              <input
                type="text"
                placeholder="Search by claim ID or farmer name..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                className="input-field pl-9"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            {claims.map((claim) => {
              const statusCfg = STATUS_CONFIG[claim.status] ?? STATUS_CONFIG.submitted;
              const StatusIcon = statusCfg.icon;
              const isSelected = selectedClaim?.id === claim.id;
              const isFraudFlagged = claim.fraudScore === "high";
              return (
                <button
                  key={claim.id}
                  onClick={() => setSelectedClaim(claim)}
                  className={`w-full text-left transition-all ${
                    isFraudFlagged ? "border-l-[3px] border-l-risk-critical" : "border-l-[3px] border-l-transparent"
                  } ${isSelected ? "bg-brand-50 ring-1 ring-brand-500" : "bg-white hover:bg-surface-raised"} border border-border p-3.5`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-semibold text-ink font-mono">{claim.id}</span>
                        <span className={`badge text-2xs ${statusCfg.color}`}>
                          <StatusIcon style={{ width: 10, height: 10 }} />
                          {statusCfg.label}
                        </span>
                        {isFraudFlagged && (
                          <span className="badge text-2xs bg-status-danger-surface text-status-danger">
                            <Shield style={{ width: 10, height: 10 }} />
                            FRAUD
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-ink-secondary">{claim.farmer}</p>
                      <div className="flex items-center gap-2 mt-1 text-2xs text-ink-muted">
                        <span>{claim.type}</span>
                        <span className="w-0.5 h-0.5 rounded-full bg-ink-faint" />
                        <span>{claim.warehouse}</span>
                        <span className="w-0.5 h-0.5 rounded-full bg-ink-faint" />
                        <span className="tabular-nums">{claim.dateSubmitted}</span>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-bold text-ink tabular-nums">KSh {claim.amountClaimedKsh.toLocaleString()}</p>
                      <span className={`badge text-2xs mt-1 ${
                        claim.stage === "pre_harvest" ? "bg-sky-50 text-sky-700" : "bg-stone-50 text-stone-600"
                      }`}>
                        {claim.stage === "pre_harvest" ? "Pre" : "Post"}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
            {claims.length === 0 && !isLoading && (
              <div className="py-8 px-5">
                <p className="text-sm text-ink-secondary mb-1">No claims match the current filter criteria.</p>
                <p className="text-2xs text-ink-tertiary">
                  Adjust the status filter or search terms, or check back when new claims are submitted.
                </p>
              </div>
            )}
          </div>

          {pagination && pagination.pages > 1 && (
            <div className="flex items-center justify-between mt-3 py-2">
              <span className="text-2xs text-ink-muted">
                Page {pagination.page} of {pagination.pages} ({pagination.total} total)
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(Math.max(1, page - 1))}
                  disabled={page <= 1}
                  className="btn-secondary text-2xs py-1 px-2 disabled:opacity-40"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage(Math.min(pagination.pages, page + 1))}
                  disabled={page >= pagination.pages}
                  className="btn-secondary text-2xs py-1 px-2 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Claim detail panel */}
        <div className="w-full lg:w-[380px] flex-shrink-0">
          {selectedClaim ? (() => {
            const statusCfg = STATUS_CONFIG[selectedClaim.status] ?? STATUS_CONFIG.submitted;
            const StatusIcon = statusCfg.icon;
            const canAct = selectedClaim.status === "submitted" || selectedClaim.status === "in_review";
            return (
              <div className="card sticky top-6 overflow-hidden">
                <div className={`px-5 py-4 ${statusCfg.color.split(" ")[0]}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <StatusIcon style={{ width: 14, height: 14 }} />
                    <span className="text-2xs font-bold uppercase">{statusCfg.label}</span>
                  </div>
                  <p className="text-sm font-semibold text-ink">{selectedClaim.farmer}</p>
                  <p className="text-2xs text-ink-tertiary mt-0.5 font-mono">{selectedClaim.id}</p>
                </div>

                <div className="px-5 py-4 border-b border-border-subtle">
                  <p className="text-2xl font-bold text-ink tabular-nums">KSh {selectedClaim.amountClaimedKsh.toLocaleString()}</p>
                  {selectedClaim.amountApprovedKsh != null && selectedClaim.amountApprovedKsh !== selectedClaim.amountClaimedKsh && (
                    <p className="text-sm text-status-success font-medium tabular-nums mt-0.5">
                      Approved: KSh {selectedClaim.amountApprovedKsh.toLocaleString()}
                    </p>
                  )}
                </div>

                <div className="px-5 py-4 space-y-3 border-b border-border-subtle">
                  <div className="flex justify-between">
                    <span className="text-2xs text-ink-muted">Type</span>
                    <span className="text-sm font-medium text-ink">{selectedClaim.type}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-2xs text-ink-muted">Stage</span>
                    <span className={`badge text-2xs ${
                      selectedClaim.stage === "pre_harvest" ? "bg-sky-50 text-sky-700" : "bg-stone-50 text-stone-600"
                    }`}>
                      {selectedClaim.stage === "pre_harvest" ? "Pre-Harvest" : "Post-Harvest"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-2xs text-ink-muted">Warehouse</span>
                    <span className="text-sm text-ink">{selectedClaim.warehouse}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-2xs text-ink-muted">Receipt</span>
                    <span className="text-sm text-ink font-mono">{selectedClaim.warehouseReceipt}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-2xs text-ink-muted">Submitted</span>
                    <span className="text-sm text-ink tabular-nums">{selectedClaim.dateSubmitted}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-2xs text-ink-muted">Fraud Score</span>
                    <span className={`badge text-2xs ${FRAUD_COLORS[selectedClaim.fraudScore] ?? FRAUD_COLORS.low}`}>
                      <Shield style={{ width: 10, height: 10 }} />
                      {selectedClaim.fraudScore}
                    </span>
                  </div>
                </div>

                {selectedClaim.description && (
                  <div className="px-5 py-4 border-b border-border-subtle">
                    <p className="text-2xs text-ink-muted mb-1">Description</p>
                    <p className="text-sm text-ink-secondary">{selectedClaim.description}</p>
                  </div>
                )}

                {canAct && (
                  <div className="px-5 py-4 space-y-2">
                    <button
                      onClick={() => openAction(selectedClaim, "approve")}
                      className="w-full btn-primary !bg-status-success hover:!bg-green-800 justify-center"
                    >
                      <CheckCircle2 style={{ width: 14, height: 14 }} /> Approve Claim
                    </button>
                    <button
                      onClick={() => openAction(selectedClaim, "reject")}
                      className="w-full btn-secondary !text-status-danger !border-red-200 hover:!bg-status-danger-surface justify-center"
                    >
                      <XCircle style={{ width: 14, height: 14 }} /> Reject
                    </button>
                  </div>
                )}
              </div>
            );
          })() : (
            <div className="card p-5 sticky top-6">
              <p className="text-sm text-ink-secondary mb-1">Select a claim to review details and take action.</p>
              <p className="text-2xs text-ink-tertiary">
                Claims are organized by workflow stage. Select a pipeline stage above to filter, then choose a claim.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
