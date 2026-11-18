"use client";

import { useState } from "react";
import {
  ShieldCheck,
  Clock,
  CheckCircle2,
  XCircle,
  Eye,
  Search,
  User,
  Phone,
  MapPin,
  Calendar,
  Loader2,
  AlertCircle,
} from "lucide-react";
import useSWR from "swr";

const fetcher = (url: string) =>
  fetch(url, { credentials: "include" }).then((r) => {
    if (!r.ok) throw new Error("Failed to fetch");
    return r.json();
  });

interface KycApplication {
  id: string;
  name: string;
  phone: string;
  county: string;
  ward: string;
  registeredDate: string;
  status: string;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  pending: { label: "Pending Review", color: "bg-status-warning-surface text-status-warning", icon: Clock },
  pending_kyc: { label: "Pending Review", color: "bg-status-warning-surface text-status-warning", icon: Clock },
  kyc_in_review: { label: "In Review", color: "bg-status-info-surface text-status-info", icon: Eye },
  approved: { label: "Approved", color: "bg-status-success-surface text-status-success", icon: CheckCircle2 },
  rejected: { label: "Rejected", color: "bg-status-danger-surface text-status-danger", icon: XCircle },
};

const TABS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
];

export default function VerificationPage() {
  const [activeTab, setActiveTab] = useState<string>("pending");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [kycAction, setKycAction] = useState<{ loading: boolean; result: string | null; success: boolean }>({
    loading: false, result: null, success: false,
  });
  const [rejectionReason, setRejectionReason] = useState("");

  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("limit", "20");
  if (activeTab !== "all") params.set("status", activeTab);
  if (search) params.set("search", search);

  const { data, isLoading, mutate } = useSWR(`/api/farmers?${params}`, fetcher, { revalidateOnFocus: false });

  const farmers: KycApplication[] = data?.farmers ?? [];
  const summary = data?.summary;
  const pagination = data?.pagination;
  const selectedApp = farmers.find((f) => f.id === selectedId) ?? null;

  async function handleKycAction(action: "APPROVED" | "REJECTED") {
    if (!selectedApp) return;
    if (action === "REJECTED" && !rejectionReason) {
      setKycAction({ loading: false, result: "Select a rejection reason", success: false });
      return;
    }

    setKycAction({ loading: true, result: null, success: false });

    try {
      const res = await fetch(`/api/farmers/${selectedApp.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          accountStatus: action,
          reason: action === "REJECTED" ? rejectionReason : undefined,
        }),
      });
      const result = await res.json();

      if (!res.ok) {
        setKycAction({ loading: false, result: result.error ?? "Action failed", success: false });
      } else {
        setKycAction({ loading: false, result: result.message ?? "Action completed", success: true });
        mutate();
      }
    } catch {
      setKycAction({ loading: false, result: "Network error", success: false });
    }
  }

  return (
    <div className="max-w-7xl">
      <div className="mb-5">
        <h1 className="page-title">Farmer Verification</h1>
        <p className="page-subtitle">KYC application queue and review</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <div className="card p-4">
          <p className="label-caps mb-1">Pending Review</p>
          <p className="metric-value-sm text-status-warning tabular-nums">{summary?.pendingKyc ?? "—"}</p>
        </div>
        <div className="card p-4">
          <p className="label-caps mb-1">KYC Approved</p>
          <p className="metric-value-sm text-status-success tabular-nums">{summary?.kycApproved ?? "—"}</p>
        </div>
        <div className="card p-4">
          <p className="label-caps mb-1">Total Registered</p>
          <p className="metric-value-sm tabular-nums">{summary?.totalRegistered ?? "—"}</p>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-5">
        {/* Queue */}
        <div className="flex-1">
          {/* Search + Tabs */}
          <div className="card p-3.5 mb-3">
            <div className="flex items-center gap-3 mb-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" style={{ width: 15, height: 15 }} />
                <input
                  type="text"
                  placeholder="Search by name or ID..."
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                  className="input-field pl-9"
                />
              </div>
            </div>
            <div className="flex gap-0.5 bg-surface-sunken p-0.5 w-fit">
              {TABS.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => { setActiveTab(tab.key); setPage(1); }}
                  className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                    activeTab === tab.key ? "bg-white text-ink" : "text-ink-tertiary hover:text-ink-secondary"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Application list */}
          <div className="space-y-2">
            {farmers.length > 0 ? farmers.map((app) => {
              const statusCfg = STATUS_CONFIG[app.status] ?? STATUS_CONFIG.pending;
              const StatusIcon = statusCfg.icon;
              const isSelected = selectedId === app.id;
              return (
                <button
                  key={app.id}
                  onClick={() => { setSelectedId(app.id); setKycAction({ loading: false, result: null, success: false }); }}
                  className={`w-full text-left card p-4 transition-all ${
                    isSelected ? "!border-brand-500 ring-1 ring-brand-500" : "hover:shadow-card-hover"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-sm font-semibold text-ink">{app.name}</p>
                        <span className={`badge ${statusCfg.color}`}>
                          <StatusIcon style={{ width: 11, height: 11 }} />
                          {statusCfg.label}
                        </span>
                      </div>
                      <p className="text-2xs text-ink-muted">{app.id} · {app.county} · {app.registeredDate}</p>
                    </div>
                    <Eye style={{ width: 16, height: 16 }} className="text-ink-faint" />
                  </div>
                </button>
              );
            }) : !isLoading ? (
              <div className="card p-5">
                <p className="text-sm text-ink-secondary mb-1">No applications match the current filter.</p>
                <p className="text-2xs text-ink-tertiary">
                  KYC applications appear here as farmers register and submit identification documents.
                </p>
              </div>
            ) : null}

            {pagination && pagination.pages > 1 && (
              <div className="flex items-center justify-between mt-3">
                <span className="text-2xs text-ink-muted">
                  Page {pagination.page} of {pagination.pages}
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
        </div>

        {/* Detail panel */}
        <div className="w-full lg:w-[400px] flex-shrink-0">
          {selectedApp ? (
            <div className="card p-4 sticky top-6">
              <div className="flex items-center justify-between mb-4">
                <p className="label-caps">Application Details</p>
                <span className={`badge ${(STATUS_CONFIG[selectedApp.status] ?? STATUS_CONFIG.pending).color}`}>
                  {(STATUS_CONFIG[selectedApp.status] ?? STATUS_CONFIG.pending).label}
                </span>
              </div>

              <div className="space-y-3 mb-4">
                <DetailRow icon={User} label="Full Name" value={selectedApp.name} />
                <DetailRow icon={Phone} label="Phone" value={selectedApp.phone} />
                <DetailRow icon={MapPin} label="Location" value={`${selectedApp.ward}, ${selectedApp.county}`} />
                <DetailRow icon={Calendar} label="Registered" value={selectedApp.registeredDate} />
              </div>

              {/* Actions */}
              {(selectedApp.status === "pending" || selectedApp.status === "pending_kyc" || selectedApp.status === "kyc_in_review") && (
                <div className="space-y-2 pt-4 border-t border-border-subtle">
                  {kycAction.result && (
                    <div className={`p-3 text-sm ${kycAction.success ? "bg-status-success-surface text-status-success" : "bg-status-danger-surface text-status-danger"}`}>
                      {kycAction.result}
                    </div>
                  )}
                  <button
                    disabled={kycAction.loading}
                    onClick={() => handleKycAction("APPROVED")}
                    className="w-full btn-primary !bg-status-success hover:!bg-green-800 disabled:opacity-50 justify-center"
                  >
                    {kycAction.loading ? <Loader2 style={{ width: 14, height: 14 }} className="animate-spin" /> : <CheckCircle2 style={{ width: 14, height: 14 }} />}
                    {kycAction.loading ? "Processing..." : "Approve"}
                  </button>
                  <button
                    disabled={kycAction.loading}
                    onClick={() => handleKycAction("REJECTED")}
                    className="w-full btn-secondary !text-status-danger !border-red-200 hover:!bg-status-danger-surface disabled:opacity-50 justify-center"
                  >
                    <XCircle style={{ width: 14, height: 14 }} /> Reject
                  </button>
                  <div className="mt-2">
                    <label className="block text-2xs text-ink-muted mb-1">Rejection Reason (if rejecting)</label>
                    <select
                      value={rejectionReason}
                      onChange={(e) => setRejectionReason(e.target.value)}
                      className="input-field"
                    >
                      <option value="">Select reason</option>
                      <option value="Unclear / blurry documents">Unclear / blurry documents</option>
                      <option value="ID does not match selfie">ID does not match selfie</option>
                      <option value="Missing required documents">Missing required documents</option>
                      <option value="Suspected fraud">Suspected fraud</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="card p-5">
              <p className="text-sm text-ink-secondary mb-1">Select an application to review.</p>
              <p className="text-2xs text-ink-tertiary">
                Application details, submitted documents, and approval actions appear here.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DetailRow({ icon: Icon, label, value }: { icon: typeof User; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <Icon style={{ width: 16, height: 16 }} className="text-ink-muted flex-shrink-0" />
      <div>
        <p className="text-2xs text-ink-muted">{label}</p>
        <p className="text-sm font-medium text-ink">{value}</p>
      </div>
    </div>
  );
}
