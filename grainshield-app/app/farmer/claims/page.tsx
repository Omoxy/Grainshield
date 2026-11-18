"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Plus,
  FileText,
  Clock,
  CheckCircle2,
  XCircle,
  Banknote,
  AlertCircle,
} from "lucide-react";
import useSWR from "swr";

const fetcher = (url: string) =>
  fetch(url, { credentials: "include" }).then((r) => {
    if (!r.ok) throw new Error("Failed to fetch");
    return r.json();
  });

type ClaimStatus = "submitted" | "in_review" | "approved" | "rejected" | "paid";

interface Claim {
  id: string;
  type: string;
  warehouseReceipt: string;
  dateSubmitted: string;
  status: ClaimStatus;
  amountClaimedKsh: number;
  amountApprovedKsh?: number;
  description: string;
}

const STATUS_CONFIG: Record<ClaimStatus, { label: string; description: string; color: string; icon: typeof Clock }> = {
  submitted: { label: "Submitted", description: "Your claim has been received.", color: "bg-status-warning-surface text-status-warning", icon: Clock },
  in_review: { label: "Under Review", description: "Being reviewed by the claims team.", color: "bg-status-info-surface text-status-info", icon: FileText },
  approved: { label: "Approved", description: "Claim approved. Payment is being processed.", color: "bg-status-success-surface text-status-success", icon: CheckCircle2 },
  rejected: { label: "Not Approved", description: "This claim was not approved.", color: "bg-status-danger-surface text-status-danger", icon: XCircle },
  paid: { label: "Paid", description: "Payment has been sent to your account.", color: "bg-brand-50 text-brand-700", icon: Banknote },
};

const TABS: { key: ClaimStatus | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "submitted", label: "Submitted" },
  { key: "in_review", label: "Under Review" },
  { key: "approved", label: "Approved" },
  { key: "paid", label: "Paid" },
];

export default function ClaimsPage() {
  const [activeTab, setActiveTab] = useState<ClaimStatus | "all">("all");

  const params = new URLSearchParams();
  if (activeTab !== "all") params.set("status", activeTab);

  const { data, isLoading } = useSWR(`/api/claims?${params}`, fetcher, { revalidateOnFocus: false });

  const claims: Claim[] = data?.claims ?? [];

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="page-title">Claims</h1>
          <p className="page-subtitle">
            Protection claims and payment status
          </p>
        </div>
        <Link
          href="/farmer/claims/new"
          className="btn-primary"
        >
          <Plus style={{ width: 15, height: 15 }} />
          New Claim
        </Link>
      </div>

      {/* Status filter */}
      <div className="flex gap-0.5 mb-4 bg-surface-sunken p-0.5 overflow-x-auto w-fit">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-3 py-1.5 text-sm font-medium transition-colors whitespace-nowrap ${
              activeTab === tab.key
                ? "bg-white text-ink"
                : "text-ink-tertiary hover:text-ink-secondary"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Claims — workflow-oriented, not ticket system */}
      <div className="space-y-3">
        {claims.length === 0 && !isLoading ? (
          <div className="card p-5">
            <p className="text-sm text-ink-secondary mb-1">No active claims are currently associated with this account.</p>
            <p className="text-2xs text-ink-tertiary">
              If you have experienced grain loss due to storage conditions, weather events, or other covered causes,
              use &ldquo;New Claim&rdquo; to submit a protection claim.
            </p>
          </div>
        ) : (
          claims.map((claim) => {
            const statusCfg = STATUS_CONFIG[claim.status] ?? STATUS_CONFIG.submitted;
            const StatusIcon = statusCfg.icon;
            return (
              <div key={claim.id} className="card p-4">
                {/* Status is the primary information */}
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`badge ${statusCfg.color}`}>
                      <StatusIcon style={{ width: 11, height: 11 }} />
                      {statusCfg.label}
                    </span>
                    <span className="text-sm font-mono text-ink-muted">{claim.id}</span>
                  </div>
                  <p className="text-lg font-semibold text-ink tabular-nums">
                    KSh {claim.amountClaimedKsh.toLocaleString()}
                  </p>
                </div>

                <p className="text-sm font-medium text-ink mb-1">{claim.type}</p>
                <p className="text-sm text-ink-tertiary">{statusCfg.description}</p>

                {claim.amountApprovedKsh != null && claim.amountApprovedKsh > 0 && (
                  <p className="text-sm text-status-success font-medium mt-2 tabular-nums">
                    KSh {claim.amountApprovedKsh.toLocaleString()} paid
                  </p>
                )}

                <div className="flex items-center justify-between mt-3 pt-3 border-t border-border-subtle text-2xs text-ink-muted tabular-nums">
                  <span>Receipt: {claim.warehouseReceipt}</span>
                  <span>Submitted {claim.dateSubmitted}</span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
