"use client";

import { useState } from "react";
import {
  Search,
  CheckCircle2,
  Clock,
  XCircle,
  MapPin,
  Wheat,
  Users,
  ChevronDown,
} from "lucide-react";
import useSWR from "swr";

interface FarmerRecord {
  id: string;
  name: string;
  phone: string;
  county: string;
  ward: string;
  status: string;
  storedKg: number;
  activeLoansKsh: number;
  registeredDate: string;
}

const fetcher = (url: string) =>
  fetch(url, { credentials: "include" }).then((r) => {
    if (!r.ok) throw new Error("Failed to fetch");
    return r.json();
  });

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  approved: { label: "Approved", color: "bg-status-success-surface text-status-success", icon: CheckCircle2 },
  pending_kyc: { label: "Pending KYC", color: "bg-status-warning-surface text-status-warning", icon: Clock },
  kyc_in_review: { label: "KYC Review", color: "bg-status-info-surface text-status-info", icon: Clock },
  pending: { label: "Pending", color: "bg-status-warning-surface text-status-warning", icon: Clock },
  rejected: { label: "Rejected", color: "bg-status-danger-surface text-status-danger", icon: XCircle },
  suspended: { label: "Suspended", color: "bg-surface-sunken text-ink-tertiary", icon: XCircle },
};

export default function AdminFarmersPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [expandedFarmer, setExpandedFarmer] = useState<string | null>(null);

  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("limit", "20");
  if (statusFilter !== "all") params.set("status", statusFilter);
  if (search) params.set("search", search);

  const { data, isLoading } = useSWR(`/api/farmers?${params}`, fetcher, { revalidateOnFocus: false });

  const farmers: FarmerRecord[] = data?.farmers ?? [];
  const summary = data?.summary;
  const pagination = data?.pagination;

  const approvedPct = summary?.totalRegistered
    ? Math.round(((summary?.kycApproved ?? 0) / summary.totalRegistered) * 100)
    : 0;

  return (
    <div className="max-w-7xl">
      <div className="mb-4">
        <h1 className="page-title">Farmers</h1>
        <p className="page-subtitle">Registered accounts and verification status</p>
      </div>

      {/* Registry health bar — single horizontal strip, not card grid */}
      <div className="flex items-stretch border border-border bg-white mb-5 overflow-hidden">
        <div className="flex-1 px-4 py-3 border-r border-border-subtle">
          <div className="flex items-center gap-2">
            <Users style={{ width: 14, height: 14 }} className="text-ink-muted" />
            <span className="text-2xs text-ink-muted uppercase tracking-wide">Registered</span>
          </div>
          <p className="text-xl font-bold text-ink tabular-nums mt-1">{summary?.totalRegistered ?? "—"}</p>
        </div>
        <div className="flex-1 px-4 py-3 border-r border-border-subtle">
          <span className="text-2xs text-ink-muted uppercase tracking-wide">KYC Approved</span>
          <div className="flex items-end gap-2 mt-1">
            <p className="text-xl font-bold text-status-success tabular-nums">{summary?.kycApproved ?? "—"}</p>
            {summary?.totalRegistered > 0 && (
              <span className="text-2xs text-ink-muted mb-0.5 tabular-nums">{approvedPct}%</span>
            )}
          </div>
          {summary?.totalRegistered > 0 && (
            <div className="w-full h-1 bg-surface-sunken mt-2">
              <div className="h-full bg-status-success transition-all" style={{ width: `${approvedPct}%` }} />
            </div>
          )}
        </div>
        <div className="flex-1 px-4 py-3 border-r border-border-subtle">
          <span className="text-2xs text-ink-muted uppercase tracking-wide">Pending KYC</span>
          <p className="text-xl font-bold text-status-warning tabular-nums mt-1">{summary?.pendingKyc ?? "—"}</p>
        </div>
        <div className="flex-1 px-4 py-3">
          <span className="text-2xs text-ink-muted uppercase tracking-wide">With Active Loans</span>
          <p className="text-xl font-bold text-ink tabular-nums mt-1">{summary?.withActiveLoans ?? "—"}</p>
        </div>
      </div>

      {/* Inline search + filter — not wrapped in a card */}
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
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="input-field w-auto"
        >
          <option value="all">All Status</option>
          <option value="approved">Approved</option>
          <option value="pending">Pending KYC</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      {/* Farmer records — expandable rows, not a traditional table */}
      <div className="space-y-1">
        {farmers.map((farmer) => {
          const statusCfg = STATUS_CONFIG[farmer.status] ?? STATUS_CONFIG.pending;
          const StatusIcon = statusCfg.icon;
          const isExpanded = expandedFarmer === farmer.id;
          return (
            <div key={farmer.id} className="bg-white border border-border overflow-hidden">
              <button
                onClick={() => setExpandedFarmer(isExpanded ? null : farmer.id)}
                className="w-full text-left px-4 py-3 hover:bg-surface-raised transition-colors"
              >
                <div className="flex items-center gap-4">
                  {/* Name + status: primary */}
                  <div className="w-[220px] flex-shrink-0">
                    <p className="text-sm font-semibold text-ink">{farmer.name}</p>
                    <p className="text-2xs text-ink-muted">{farmer.phone}</p>
                  </div>

                  {/* Status badge */}
                  <div className="w-[110px] flex-shrink-0">
                    <span className={`badge ${statusCfg.color}`}>
                      <StatusIcon style={{ width: 11, height: 11 }} />
                      {statusCfg.label}
                    </span>
                  </div>

                  {/* Location */}
                  <div className="flex-1 min-w-0">
                    <span className="flex items-center gap-1 text-sm text-ink-secondary">
                      <MapPin style={{ width: 12, height: 12 }} className="text-ink-faint flex-shrink-0" />
                      <span className="truncate">{farmer.ward}, {farmer.county}</span>
                    </span>
                  </div>

                  {/* Grain */}
                  <div className="w-[100px] flex-shrink-0 text-right">
                    {farmer.storedKg > 0 ? (
                      <span className="text-sm font-medium text-ink flex items-center justify-end gap-1">
                        <Wheat style={{ width: 12, height: 12 }} className="text-brand-600" />
                        {farmer.storedKg.toLocaleString()} kg
                      </span>
                    ) : (
                      <span className="text-sm text-ink-faint">—</span>
                    )}
                  </div>

                  {/* Expand indicator */}
                  <ChevronDown
                    style={{ width: 14, height: 14 }}
                    className={`text-ink-faint flex-shrink-0 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                  />
                </div>
              </button>

              {isExpanded && (
                <div className="px-4 pb-4 pt-1 border-t border-border-subtle bg-surface-raised">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <div>
                      <p className="text-2xs text-ink-muted mb-0.5">Farmer ID</p>
                      <p className="text-sm font-mono text-ink">{farmer.id}</p>
                    </div>
                    <div>
                      <p className="text-2xs text-ink-muted mb-0.5">Registered</p>
                      <p className="text-sm text-ink tabular-nums">{farmer.registeredDate}</p>
                    </div>
                    <div>
                      <p className="text-2xs text-ink-muted mb-0.5">Active Loans</p>
                      <p className="text-sm font-medium text-ink tabular-nums">
                        {farmer.activeLoansKsh > 0 ? `KSh ${farmer.activeLoansKsh.toLocaleString()}` : "None"}
                      </p>
                    </div>
                    <div>
                      <p className="text-2xs text-ink-muted mb-0.5">Stored Grain</p>
                      <p className="text-sm font-medium text-ink tabular-nums">
                        {farmer.storedKg > 0 ? `${farmer.storedKg.toLocaleString()} kg` : "None"}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {farmers.length === 0 && !isLoading && (
          <div className="py-8 px-5">
            <p className="text-sm text-ink-secondary mb-1">No farmer records match the current search or filter.</p>
            <p className="text-2xs text-ink-tertiary">
              Registered farmers appear here after completing initial account creation.
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
  );
}
