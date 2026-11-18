"use client";

import { useState } from "react";
import {
  Landmark,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  FileText,
  CalendarDays,
  Wallet,
} from "lucide-react";
import useSWR from "swr";

const fetcher = (url: string) =>
  fetch(url, { credentials: "include" }).then((r) => {
    if (!r.ok) throw new Error("Failed to fetch");
    return r.json();
  });

interface LoanRecord {
  id: string;
  amountKsh: number;
  disbursedDate: string | null;
  dueDate: string | null;
  interestRatePercent: number;
  status: string;
  repaidKsh: number;
  repaidPercent: number;
  collateral: string;
  collateralKg: number;
  disbursementMethod: string;
}

interface Eligibility {
  maxAmountKsh: number;
  grainValueKsh: number;
  ltvPercent: number;
  interestRatePercent: number;
  maxTenureDays: number;
  eligibleReceipts: { id: string; quantityKg: number; valueKsh: number }[];
}

const LOAN_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  active: { label: "Active", color: "bg-status-success-surface text-status-success" },
  disbursed: { label: "Active", color: "bg-status-success-surface text-status-success" },
  overdue: { label: "Overdue", color: "bg-status-danger-surface text-status-danger" },
  repaid: { label: "Repaid", color: "bg-surface-sunken text-ink-tertiary" },
  pending: { label: "Pending Approval", color: "bg-status-warning-surface text-status-warning" },
  pending_approval: { label: "Pending Approval", color: "bg-status-warning-surface text-status-warning" },
};

export default function LoansPage() {
  const [showApplyForm, setShowApplyForm] = useState(false);
  const [applyForm, setApplyForm] = useState({ amount: "", tenure: "90", receiptId: "" });
  const [applyLoading, setApplyLoading] = useState(false);
  const [applyResult, setApplyResult] = useState<{ success: boolean; message: string } | null>(null);

  const { data, isLoading, mutate } = useSWR("/api/loans", fetcher, { revalidateOnFocus: false });
  const { data: storageData } = useSWR("/api/storage", fetcher, { revalidateOnFocus: false });
  const loans: LoanRecord[] = data?.activeLoans ?? [];
  const eligibility: Eligibility | null = data?.eligibility ?? null;
  const receipts: { receiptCode: string; quantityKg: number; warehouse: string }[] = storageData?.records ?? [];

  const totalOutstanding = loans.reduce((sum, l) => sum + (l.amountKsh - l.repaidKsh), 0);

  async function submitLoanApplication() {
    if (!applyForm.amount || !applyForm.receiptId) return;
    setApplyLoading(true);
    setApplyResult(null);

    try {
      const res = await fetch("/api/loans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          warehouseReceiptId: applyForm.receiptId,
          amountKsh: Number(applyForm.amount),
          tenureDays: Number(applyForm.tenure),
        }),
      });
      const result = await res.json();
      if (!res.ok) {
        setApplyResult({ success: false, message: result.error ?? "Application failed" });
      } else {
        setApplyResult({ success: true, message: result.message ?? "Loan application submitted" });
        mutate();
      }
    } catch {
      setApplyResult({ success: false, message: "Network error" });
    } finally {
      setApplyLoading(false);
    }
  }

  return (
    <div className="max-w-5xl">
      <div className="mb-5">
        <h1 className="page-title">Loans</h1>
        <p className="page-subtitle">Borrow against your stored grain</p>
      </div>

      {/* Borrowing capacity — dominant financial anchor */}
      <div className="border border-border bg-white mb-5 overflow-hidden">
        <div className="flex flex-col md:flex-row">
          {/* Available amount — large, left-dominant */}
          <div className="md:w-[300px] flex-shrink-0 px-5 py-5 md:border-r border-b md:border-b-0 border-border-subtle">
            <div className="flex items-center gap-2 mb-3">
              <Wallet style={{ width: 14, height: 14 }} className="text-ink-muted" />
              <span className="text-2xs text-ink-muted uppercase tracking-wide">Available to Borrow</span>
              {eligibility && eligibility.maxAmountKsh > 0 && (
                <span className="badge bg-status-success-surface text-status-success text-2xs ml-auto">
                  <CheckCircle2 style={{ width: 10, height: 10 }} /> Eligible
                </span>
              )}
            </div>
            {eligibility ? (
              <>
                <p className="text-3xl font-bold text-ink tracking-[-0.02em] tabular-nums">
                  KSh {eligibility.maxAmountKsh.toLocaleString()}
                </p>
                <p className="text-2xs text-ink-muted mt-2">
                  {eligibility.interestRatePercent}% annual · up to {eligibility.maxTenureDays} days
                </p>
              </>
            ) : !isLoading ? (
              <p className="text-sm text-ink-secondary">Not currently eligible</p>
            ) : null}
          </div>

          {/* Context + action — right side */}
          <div className="flex-1 px-5 py-5">
            {eligibility ? (
              <div className="flex items-start justify-between h-full">
                <div>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between gap-8">
                      <span className="text-ink-muted">Grain collateral</span>
                      <span className="font-medium text-ink tabular-nums">KSh {eligibility.grainValueKsh.toLocaleString()}</span>
                    </div>
                    {totalOutstanding > 0 && (
                      <div className="flex items-center justify-between gap-8">
                        <span className="text-ink-muted">Outstanding balance</span>
                        <span className="font-semibold text-ink tabular-nums">KSh {totalOutstanding.toLocaleString()}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-8">
                      <span className="text-ink-muted">LTV ratio</span>
                      <span className="font-medium text-ink tabular-nums">{eligibility.ltvPercent}%</span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setShowApplyForm(!showApplyForm)}
                  className="btn-primary self-end"
                >
                  <Landmark style={{ width: 14, height: 14 }} />
                  Apply
                  <ArrowRight style={{ width: 14, height: 14 }} />
                </button>
              </div>
            ) : !isLoading ? (
              <div>
                <p className="text-sm text-ink-secondary mb-1">Deposit grain at a warehouse to access receipt-backed financing.</p>
                <p className="text-2xs text-ink-tertiary">
                  Loan eligibility requires grain deposited at a verified warehouse with an active receipt.
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Apply form — expands inline */}
      {showApplyForm && (
        <div className="border border-brand-200 bg-brand-50/30 p-5 mb-5">
          <h2 className="text-sm font-semibold text-ink mb-4">Loan Application</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-ink-secondary mb-1.5">Amount (KSh)</label>
              <input
                type="number"
                placeholder={eligibility ? `Up to ${eligibility.maxAmountKsh.toLocaleString()}` : "Enter amount"}
                value={applyForm.amount}
                onChange={(e) => setApplyForm((f) => ({ ...f, amount: e.target.value }))}
                className="input-field tabular-nums"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-secondary mb-1.5">Period</label>
              <select
                value={applyForm.tenure}
                onChange={(e) => setApplyForm((f) => ({ ...f, tenure: e.target.value }))}
                className="input-field"
              >
                <option value="30">30 days</option>
                <option value="60">60 days</option>
                <option value="90">90 days</option>
                <option value="120">120 days</option>
                <option value="180">180 days</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-secondary mb-1.5">Receipt</label>
              <select
                value={applyForm.receiptId}
                onChange={(e) => setApplyForm((f) => ({ ...f, receiptId: e.target.value }))}
                className="input-field"
              >
                <option value="">Select</option>
                {receipts.map((r) => (
                  <option key={r.receiptCode} value={r.receiptCode}>
                    {r.receiptCode} — {r.quantityKg.toLocaleString()} kg
                  </option>
                ))}
              </select>
            </div>
          </div>

          {applyResult && (
            <div className={`p-3 text-sm mb-4 ${applyResult.success ? "bg-status-success-surface text-status-success" : "bg-status-danger-surface text-status-danger"}`}>
              {applyResult.message}
            </div>
          )}

          <div className="flex items-center gap-2 p-3 bg-surface-raised text-2xs text-ink-tertiary mb-4">
            <AlertCircle style={{ width: 14, height: 14 }} className="flex-shrink-0 text-ink-muted" />
            Proceeds sent to M-Pesa within 24 hours. Receipt held as security until repayment.
          </div>

          <div className="flex gap-3">
            <button
              onClick={submitLoanApplication}
              disabled={applyLoading || !applyForm.amount || !applyForm.receiptId}
              className="btn-primary disabled:opacity-50"
            >
              {applyLoading ? "Submitting..." : "Submit Application"}
            </button>
            <button onClick={() => setShowApplyForm(false)} className="btn-secondary">Cancel</button>
          </div>
        </div>
      )}

      {/* Active loans — repayment timeline, not stacked cards */}
      {loans.length > 0 && (
        <div>
          <span className="text-2xs font-semibold text-ink-tertiary uppercase tracking-wide mb-3 block">
            Active Loans ({loans.length})
          </span>
          <div className="space-y-1">
            {loans.map((loan) => {
              const statusCfg = LOAN_STATUS_CONFIG[loan.status] ?? LOAN_STATUS_CONFIG.active;
              const repaidPct = loan.repaidPercent ?? (loan.amountKsh > 0 ? Math.round((loan.repaidKsh / loan.amountKsh) * 100) : 0);
              const balanceKsh = loan.amountKsh - loan.repaidKsh;
              return (
                <div key={loan.id} className="border border-border bg-white overflow-hidden">
                  <div className="px-4 py-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-ink font-mono">{loan.id}</span>
                        <span className={`badge text-2xs ${statusCfg.color}`}>{statusCfg.label}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-sm text-ink-muted">Balance: </span>
                        <span className="text-sm font-bold text-ink tabular-nums">KSh {balanceKsh.toLocaleString()}</span>
                      </div>
                    </div>

                    {/* Repayment bar — the visual timeline */}
                    <div className="flex items-center gap-3 mb-2">
                      <div className="flex-1 h-2 bg-surface-sunken overflow-hidden">
                        <div
                          className={`h-full transition-all ${repaidPct >= 75 ? "bg-status-success" : repaidPct >= 30 ? "bg-brand-500" : "bg-risk-medium"}`}
                          style={{ width: `${repaidPct}%` }}
                        />
                      </div>
                      <span className="text-sm font-bold text-ink tabular-nums w-12 text-right">{repaidPct}%</span>
                    </div>

                    {/* Loan details — compact row */}
                    <div className="flex items-center justify-between text-2xs text-ink-muted">
                      <div className="flex items-center gap-4">
                        <span className="tabular-nums">Borrowed: KSh {loan.amountKsh.toLocaleString()}</span>
                        <span className="tabular-nums">Repaid: KSh {loan.repaidKsh.toLocaleString()}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="flex items-center gap-1">
                          <FileText style={{ width: 11, height: 11 }} /> {loan.collateral}
                        </span>
                        {loan.dueDate && (
                          <span className="flex items-center gap-1 tabular-nums">
                            <CalendarDays style={{ width: 11, height: 11 }} /> Due {loan.dueDate}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {loans.length === 0 && !isLoading && !showApplyForm && (
        <div className="border border-border bg-white p-5">
          <p className="text-sm text-ink-secondary mb-1">No active loans on this account.</p>
          <p className="text-2xs text-ink-tertiary">
            Warehouse receipt loans are disbursed to M-Pesa within 24 hours of approval.
          </p>
        </div>
      )}
    </div>
  );
}
