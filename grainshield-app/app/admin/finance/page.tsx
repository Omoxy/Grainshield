"use client";

import { useState } from "react";
import {
  Banknote,
  Clock,
  CheckCircle2,
  XCircle,
  Shield,
  AlertTriangle,
  Receipt,
  CreditCard,
  Activity,
  Wallet,
  ArrowRight,
} from "lucide-react";
import useSWR from "swr";

const fetcher = (url: string) =>
  fetch(url, { credentials: "include" }).then((r) => {
    if (!r.ok) throw new Error("Failed to fetch");
    return r.json();
  });

type PayoutStatus = "initiated" | "compliance_check" | "authorization_pending" | "authorized" | "processing" | "completed" | "failed" | "reversed" | "blocked";

interface PayoutRecord {
  id: string;
  payoutCode: string;
  type: string;
  status: PayoutStatus;
  amountKsh: number;
  recipientPhone: string;
  relatedCode: string;
  authorizationLevel: string;
  initiatedAt: string;
  completedAt?: string | null;
  failureReason?: string | null;
}

interface LoanExposureItem {
  loanCode: string;
  farmer: string;
  amountKsh: number;
  repaidKsh: number;
  collateralValueKsh: number;
  ltvPct: number;
  daysUntilDue: number;
  health: string;
  warehouse: string;
}

const PAYOUT_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  initiated: { label: "Initiated", color: "bg-surface-sunken text-ink-tertiary" },
  compliance_check: { label: "Compliance", color: "bg-status-info-surface text-status-info" },
  authorization_pending: { label: "Auth Pending", color: "bg-status-warning-surface text-status-warning" },
  authorized: { label: "Authorized", color: "bg-brand-50 text-brand-700" },
  processing: { label: "Processing", color: "bg-brand-100 text-brand-800" },
  completed: { label: "Completed", color: "bg-status-success-surface text-status-success" },
  failed: { label: "Failed", color: "bg-status-danger-surface text-status-danger" },
  reversed: { label: "Reversed", color: "bg-orange-50 text-risk-high" },
  blocked: { label: "Blocked", color: "bg-status-danger-surface text-risk-critical" },
};

const LOAN_HEALTH_CONFIG: Record<string, { label: string; color: string }> = {
  healthy: { label: "Healthy", color: "bg-status-success-surface text-status-success" },
  watch: { label: "Watch", color: "bg-status-warning-surface text-status-warning" },
  substandard: { label: "Substandard", color: "bg-orange-50 text-risk-high" },
  doubtful: { label: "Doubtful", color: "bg-status-danger-surface text-status-danger" },
  loss: { label: "Loss", color: "bg-status-danger-surface text-risk-critical" },
};

export default function FinancialOperationsPage() {
  const [payoutFilter, setPayoutFilter] = useState<string>("all");

  const { data: summaryData } = useSWR("/api/finance", fetcher, { revalidateOnFocus: false });
  const { data: payoutsData } = useSWR(`/api/finance?type=payouts${payoutFilter !== "all" ? `&status=${payoutFilter}` : ""}`, fetcher, { revalidateOnFocus: false });
  const { data: loansData } = useSWR("/api/finance?type=loans", fetcher, { revalidateOnFocus: false });

  const summary = summaryData?.summary;
  const payouts: PayoutRecord[] = payoutsData?.payouts ?? [];
  const loanExposure: LoanExposureItem[] = loansData?.loans ?? [];

  const pendingAuth = payouts.filter((p) => p.status === "authorization_pending");
  const overdueLoans = loanExposure.filter((l) => l.daysUntilDue < 0);

  return (
    <div className="max-w-7xl">
      <div className="mb-4">
        <h1 className="page-title">Financial Operations</h1>
        <p className="page-subtitle">Payout pipeline, loan exposure, and reconciliation</p>
      </div>

      {/* Pending authorization — action-first, not buried in a metric strip */}
      {pendingAuth.length > 0 && (
        <div className="border-2 border-yellow-300 bg-status-warning-surface mb-5 p-4">
          <div className="flex items-center gap-3 mb-3">
            <Shield style={{ width: 16, height: 16 }} className="text-status-warning flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-yellow-800">
                {pendingAuth.length} payout{pendingAuth.length > 1 ? "s" : ""} awaiting authorization
              </p>
              <p className="text-2xs text-yellow-700/70 tabular-nums">
                Total: KSh {pendingAuth.reduce((s, p) => s + p.amountKsh, 0).toLocaleString()}
              </p>
            </div>
          </div>
          <div className="space-y-1.5">
            {pendingAuth.map((p) => (
              <div key={p.id} className="flex items-center justify-between bg-white/70 border border-yellow-200 px-3 py-2">
                <div>
                  <span className="text-sm font-mono font-semibold text-ink">{p.payoutCode}</span>
                  <span className="text-2xs text-ink-muted ml-2">{p.type.replace(/_/g, " ")}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-bold text-ink tabular-nums">KSh {p.amountKsh.toLocaleString()}</span>
                  <button className="btn-primary text-2xs py-1 !bg-status-success hover:!bg-green-800">
                    <CheckCircle2 style={{ width: 11, height: 11 }} /> Authorize
                  </button>
                  <button className="btn-secondary text-2xs py-1 !text-status-danger !border-red-200">
                    <XCircle style={{ width: 11, height: 11 }} /> Block
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Financial position — horizontal flow, not card grid */}
      <div className="flex items-stretch border border-border bg-white mb-5 overflow-hidden">
        <FinCell label="Payouts This Month" value={summary ? `KSh ${(summary.totalPayoutsThisMonth / 1000).toFixed(0)}K` : "—"} icon={Banknote} />
        <FinCell label="Pending Payouts" value={summary ? `KSh ${(summary.pendingPayouts / 1000).toFixed(0)}K` : "—"} icon={Clock} alert />
        <FinCell label="Loan Exposure" value={summary ? `KSh ${(summary.totalLoanExposure / 1e6).toFixed(1)}M` : "—"} icon={CreditCard} />
        <FinCell label="Overdue" value={summary ? `KSh ${(summary.overdueLoans / 1000).toFixed(0)}K` : "—"} icon={AlertTriangle} alert />
        <FinCell label="Reconciled" value={summary ? `${summary.reconciled}%` : "—"} icon={CheckCircle2} subtext={summary ? `${summary.unreconciled} pending` : ""} />
      </div>

      {/* Two-panel: Payout flow + Loan book */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
        {/* Payout pipeline — timeline-like flow */}
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Receipt style={{ width: 13, height: 13 }} className="text-ink-muted" />
              <span className="text-2xs font-semibold text-ink-tertiary uppercase tracking-wide">Payout Pipeline</span>
            </div>
            <div className="flex gap-0.5 bg-surface-sunken p-0.5">
              {["all", "authorization_pending", "processing", "completed", "failed"].map((f) => {
                const label = f === "all" ? "All" : f === "authorization_pending" ? "Pending" : f.charAt(0).toUpperCase() + f.slice(1);
                return (
                  <button
                    key={f}
                    onClick={() => setPayoutFilter(f)}
                    className={`px-2 py-1 text-2xs font-medium transition-colors ${
                      payoutFilter === f ? "bg-white text-ink" : "text-ink-muted hover:text-ink-secondary"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1">
            {payouts.length > 0 ? payouts.map((payout) => {
              const statusCfg = PAYOUT_STATUS_CONFIG[payout.status] ?? PAYOUT_STATUS_CONFIG.initiated;
              return (
                <div key={payout.id} className="border border-border bg-white px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex flex-col items-center gap-0.5">
                        <span className={`w-2 h-2 rounded-full ${
                          payout.status === "completed" ? "bg-status-success"
                            : payout.status === "failed" ? "bg-status-danger"
                            : payout.status === "authorization_pending" ? "bg-status-warning"
                            : "bg-ink-faint"
                        }`} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-ink font-mono">{payout.payoutCode}</span>
                          <span className={`badge text-2xs ${statusCfg.color}`}>{statusCfg.label}</span>
                          {payout.authorizationLevel === "elevated" && (
                            <span className="badge text-2xs bg-brand-50 text-brand-700">Elevated</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-2xs text-ink-muted mt-0.5">
                          <span className="font-mono">{payout.relatedCode}</span>
                          <ArrowRight style={{ width: 10, height: 10 }} className="text-ink-faint" />
                          <span className="capitalize">{payout.type.replace(/_/g, " ")}</span>
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-ink tabular-nums">KSh {payout.amountKsh.toLocaleString()}</p>
                      <p className="text-2xs text-ink-muted tabular-nums">
                        {new Date(payout.initiatedAt).toISOString().split("T")[0]}
                      </p>
                    </div>
                  </div>
                </div>
              );
            }) : (
              <div className="border border-border bg-white px-4 py-5">
                <p className="text-sm text-ink-secondary mb-0.5">No payout records match the current filter.</p>
                <p className="text-2xs text-ink-tertiary">Payouts are created when claims are approved or loan disbursements are authorized.</p>
              </div>
            )}
          </div>
        </div>

        {/* Loan book — compact, health-first */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Wallet style={{ width: 13, height: 13 }} className="text-ink-muted" />
              <span className="text-2xs font-semibold text-ink-tertiary uppercase tracking-wide">Loan Book</span>
            </div>
            {summary && (
              <span className="text-2xs text-ink-muted">LTV <span className="font-bold text-ink">{summary.portfolioLtv}%</span></span>
            )}
          </div>

          {overdueLoans.length > 0 && (
            <div className="border-2 border-red-200 bg-status-danger-surface p-3 mb-2">
              <p className="text-2xs font-semibold text-status-danger">{overdueLoans.length} overdue loan{overdueLoans.length > 1 ? "s" : ""}</p>
            </div>
          )}

          <div className="space-y-1">
            {loanExposure.length > 0 ? loanExposure.map((loan) => {
              const hCfg = LOAN_HEALTH_CONFIG[loan.health] ?? LOAN_HEALTH_CONFIG.healthy;
              const repayPct = loan.amountKsh > 0 ? Math.round((loan.repaidKsh / loan.amountKsh) * 100) : 0;
              return (
                <div key={loan.loanCode} className="border border-border bg-white px-4 py-3">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-mono font-semibold text-ink">{loan.loanCode}</span>
                      <span className={`badge text-2xs ${hCfg.color}`}>{hCfg.label}</span>
                    </div>
                    <span className="text-sm font-bold text-ink tabular-nums">KSh {loan.amountKsh.toLocaleString()}</span>
                  </div>
                  <p className="text-2xs text-ink-muted mb-2">{loan.farmer} · {loan.warehouse}</p>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-surface-sunken">
                      <div
                        className={`h-full ${repayPct >= 75 ? "bg-status-success" : repayPct >= 30 ? "bg-brand-500" : "bg-risk-high"}`}
                        style={{ width: `${repayPct}%` }}
                      />
                    </div>
                    <span className="text-2xs font-mono text-ink-muted w-8 text-right tabular-nums">{repayPct}%</span>
                  </div>
                  <div className="flex items-center justify-between text-2xs text-ink-muted mt-1.5 tabular-nums">
                    <span>LTV: {loan.ltvPct}%</span>
                    <span>
                      {loan.daysUntilDue < 0 ? (
                        <span className="text-status-danger font-medium">{Math.abs(loan.daysUntilDue)}d overdue</span>
                      ) : (
                        <span>{loan.daysUntilDue}d remaining</span>
                      )}
                    </span>
                  </div>
                </div>
              );
            }) : (
              <div className="border border-border bg-white px-4 py-5">
                <p className="text-sm text-ink-secondary mb-0.5">No active loans in the portfolio.</p>
                <p className="text-2xs text-ink-tertiary">Loan exposure appears here when farmers borrow against warehouse receipts.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Reconciliation — inline progress, not a separate card section */}
      {summary && (
        <div className="border border-border bg-white px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Activity style={{ width: 13, height: 13 }} className="text-ink-muted" />
              <span className="text-2xs font-semibold text-ink-tertiary uppercase tracking-wide">Reconciliation</span>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <span className="text-ink-muted">Matched: <span className="font-bold text-status-success tabular-nums">{summary.reconciledCount}</span></span>
              <span className="text-ink-muted">Pending: <span className="font-bold text-status-warning tabular-nums">{summary.unreconciled}</span></span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1 h-2 bg-surface-sunken">
              <div className="h-full bg-status-success" style={{ width: `${summary.reconciled}%` }} />
            </div>
            <span className="text-sm font-bold text-ink tabular-nums w-12 text-right">{summary.reconciled}%</span>
          </div>
        </div>
      )}
    </div>
  );
}

function FinCell({
  label,
  value,
  icon: Icon,
  alert,
  subtext,
}: {
  label: string;
  value: string;
  icon: typeof Banknote;
  alert?: boolean;
  subtext?: string;
}) {
  return (
    <div className="flex-1 px-4 py-3 border-r border-border-subtle last:border-r-0">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon style={{ width: 12, height: 12 }} className={alert ? "text-risk-medium" : "text-ink-muted"} />
        <p className="text-2xs text-ink-muted uppercase tracking-wide">{label}</p>
      </div>
      <p className={`text-sm font-bold tabular-nums ${alert ? "text-risk-medium" : "text-ink"}`}>{value}</p>
      {subtext && <p className="text-2xs text-ink-muted mt-0.5">{subtext}</p>}
    </div>
  );
}
