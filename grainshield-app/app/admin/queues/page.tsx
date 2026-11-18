"use client";

import { useState } from "react";
import {
  ShieldCheck,
  FileText,
  Warehouse,
  Landmark,
  AlertTriangle,
  Clock,
  ChevronRight,
  ArrowUpDown,
  User,
  Shield,
  Banknote,
  Activity,
  Zap,
} from "lucide-react";

type Priority = "critical" | "high" | "medium" | "low";
type QueueTab = "kyc" | "claims" | "warehouse" | "loans";

interface Indicator {
  label: string;
  value: string;
  severity: "info" | "warning" | "danger";
}

interface QueueItem {
  id: string;
  entityId: string;
  entityType: string;
  priority: Priority;
  priorityScore: number;
  title: string;
  subtitle: string;
  status: string;
  age: string;
  ageMs: number;
  indicators: Indicator[];
  metadata: Record<string, unknown>;
}

const KYC_ITEMS: QueueItem[] = [
  { id: "q1", entityId: "USR-1301", entityType: "user", priority: "critical", priorityScore: 85, title: "Samuel Kibet", subtitle: "Trans Nzoia · +254 722 111 222", status: "KYC_IN_REVIEW", age: "3d", ageMs: 259200000, indicators: [{ label: "Malware detected", value: "Infected file", severity: "danger" }, { label: "Overdue", value: "3d", severity: "danger" }], metadata: { county: "Trans Nzoia", documentsCount: 3 } },
  { id: "q2", entityId: "USR-1302", entityType: "user", priority: "high", priorityScore: 55, title: "Grace Wanjiru", subtitle: "Uasin Gishu · +254 733 444 555", status: "PENDING_KYC", age: "2d", ageMs: 172800000, indicators: [{ label: "Duplicate suspicion", value: "Hash match found", severity: "warning" }, { label: "Overdue", value: "2d", severity: "danger" }], metadata: { county: "Uasin Gishu", documentsCount: 3 } },
  { id: "q3", entityId: "USR-1303", entityType: "user", priority: "medium", priorityScore: 25, title: "Peter Koech", subtitle: "Uasin Gishu · +254 712 888 999", status: "PENDING_KYC", age: "18h", ageMs: 64800000, indicators: [{ label: "Low quality", value: "1 file(s) < 10KB", severity: "warning" }], metadata: { county: "Uasin Gishu", documentsCount: 3 } },
  { id: "q4", entityId: "USR-1304", entityType: "user", priority: "medium", priorityScore: 20, title: "Faith Cheptoo", subtitle: "Trans Nzoia · +254 700 222 333", status: "PENDING_KYC", age: "12h", ageMs: 43200000, indicators: [{ label: "Incomplete docs", value: "2/3 uploaded", severity: "warning" }], metadata: { county: "Trans Nzoia", documentsCount: 2 } },
  { id: "q5", entityId: "USR-1305", entityType: "user", priority: "low", priorityScore: 5, title: "Daniel Mutai", subtitle: "Uasin Gishu · +254 711 555 666", status: "PENDING_KYC", age: "4h", ageMs: 14400000, indicators: [], metadata: { county: "Uasin Gishu", documentsCount: 3 } },
];

const CLAIMS_ITEMS: QueueItem[] = [
  { id: "c1", entityId: "CLM-2025-0095", entityType: "claim", priority: "critical", priorityScore: 90, title: "CLM-2025-0095 — STORAGE SPOILAGE", subtitle: "Elijah Bor · Kitale Grain Depot", status: "SUBMITTED", age: "4d", ageMs: 345600000, indicators: [{ label: "Fraud score", value: "HIGH", severity: "danger" }, { label: "Escalated", value: "Auto-escalated", severity: "danger" }, { label: "Overdue", value: "4d", severity: "danger" }], metadata: { amountKsh: 67000, fraudScore: "HIGH", category: "STORAGE_SPOILAGE" } },
  { id: "c2", entityId: "CLM-2025-0094", entityType: "claim", priority: "high", priorityScore: 55, title: "CLM-2025-0094 — MOISTURE DAMAGE", subtitle: "Mary Chebet · Eldoret Central", status: "IN_REVIEW", age: "2d", ageMs: 172800000, indicators: [{ label: "High value", value: "KSh 45,000", severity: "warning" }, { label: "Fraud score", value: "MEDIUM", severity: "warning" }], metadata: { amountKsh: 45000, fraudScore: "MEDIUM", category: "MOISTURE_DAMAGE" } },
  { id: "c3", entityId: "CLM-2025-0093", entityType: "claim", priority: "medium", priorityScore: 30, title: "CLM-2025-0093 — PEST DAMAGE", subtitle: "James Rotich · Moiben Facility", status: "SUBMITTED", age: "1d", ageMs: 86400000, indicators: [{ label: "Weather corr.", value: "Low confidence", severity: "info" }], metadata: { amountKsh: 12000, fraudScore: "LOW", category: "PEST_DAMAGE" } },
  { id: "c4", entityId: "CLM-2025-0092", entityType: "claim", priority: "medium", priorityScore: 20, title: "CLM-2025-0092 — CONTAMINATION", subtitle: "Alice Jeptoo · Endebess Cooperative", status: "SUBMITTED", age: "18h", ageMs: 64800000, indicators: [], metadata: { amountKsh: 8500, fraudScore: "LOW", category: "CONTAMINATION" } },
];

const WAREHOUSE_ITEMS: QueueItem[] = [
  { id: "w1", entityId: "WH-005", entityType: "warehouse", priority: "critical", priorityScore: 75, title: "Turbo Collection Center (WH-005)", subtitle: "Turbo, Uasin Gishu", status: "OFFLINE", age: "27d", ageMs: 2332800000, indicators: [{ label: "No sensor data", value: "—", severity: "danger" }, { label: "Risk flag", value: "Pending maintenance", severity: "danger" }, { label: "Overdue inspection", value: "27d", severity: "warning" }], metadata: { storedKg: 0, utilizationPct: 0, farmersCount: 0 } },
  { id: "w2", entityId: "WH-002", entityType: "warehouse", priority: "high", priorityScore: 45, title: "Kitale Grain Depot (WH-002)", subtitle: "Kitale Town, Trans Nzoia", status: "WARNING", age: "5d", ageMs: 432000000, indicators: [{ label: "Humidity", value: "67%", severity: "danger" }, { label: "Risk flag", value: "Elevated humidity", severity: "warning" }], metadata: { storedKg: 118000, utilizationPct: 79, farmersCount: 62 } },
];

const LOAN_ITEMS: QueueItem[] = [
  { id: "l1", entityId: "LN-2025-0022", entityType: "loan", priority: "critical", priorityScore: 80, title: "LN-2025-0022 — KSh 120,000", subtitle: "Joseph Langat · Eldoret Central", status: "ACTIVE", age: "45d", ageMs: 3888000000, indicators: [{ label: "Overdue", value: "15 days", severity: "danger" }, { label: "LTV ratio", value: "92%", severity: "danger" }, { label: "Low repayment", value: "5%", severity: "warning" }], metadata: { amountKsh: 120000, ltvPct: 92, repaymentPct: 5 } },
  { id: "l2", entityId: "LN-2025-0020", entityType: "loan", priority: "high", priorityScore: 50, title: "LN-2025-0020 — KSh 85,000", subtitle: "Rose Kiplagat · Moiben Facility", status: "ACTIVE", age: "30d", ageMs: 2592000000, indicators: [{ label: "Collateral at risk", value: "Storage risk detected", severity: "danger" }, { label: "Due soon", value: "5 days", severity: "warning" }], metadata: { amountKsh: 85000, ltvPct: 65, repaymentPct: 20 } },
  { id: "l3", entityId: "LN-2025-0018", entityType: "loan", priority: "medium", priorityScore: 25, title: "LN-2025-0018 — KSh 40,000", subtitle: "Daniel Kiptoo · Kitale Grain Depot", status: "DISBURSED", age: "10d", ageMs: 864000000, indicators: [{ label: "LTV ratio", value: "68%", severity: "warning" }], metadata: { amountKsh: 40000, ltvPct: 68, repaymentPct: 0 } },
];

const QUEUE_MAP: Record<QueueTab, QueueItem[]> = {
  kyc: KYC_ITEMS,
  claims: CLAIMS_ITEMS,
  warehouse: WAREHOUSE_ITEMS,
  loans: LOAN_ITEMS,
};

const PRIORITY_STYLES: Record<Priority, { bg: string; border: string; text: string; dot: string; badge: string }> = {
  critical: { bg: "bg-red-50", border: "border-l-risk-critical", text: "text-risk-critical", dot: "bg-risk-critical", badge: "bg-status-danger-surface text-risk-critical" },
  high: { bg: "bg-orange-50", border: "border-l-risk-high", text: "text-risk-high", dot: "bg-risk-high", badge: "bg-orange-50 text-risk-high" },
  medium: { bg: "bg-yellow-50", border: "border-l-risk-medium", text: "text-risk-medium", dot: "bg-risk-medium", badge: "bg-status-warning-surface text-risk-medium" },
  low: { bg: "bg-surface-raised", border: "border-l-border-strong", text: "text-ink-tertiary", dot: "bg-ink-faint", badge: "bg-surface-sunken text-ink-tertiary" },
};

const INDICATOR_STYLES = {
  info: "bg-status-info-surface text-status-info border-blue-200",
  warning: "bg-status-warning-surface text-status-warning border-yellow-200",
  danger: "bg-status-danger-surface text-status-danger border-red-200",
};

const QUEUE_TABS: { key: QueueTab; label: string; icon: typeof ShieldCheck }[] = [
  { key: "kyc", label: "KYC Review", icon: ShieldCheck },
  { key: "claims", label: "Claims Review", icon: FileText },
  { key: "warehouse", label: "Warehouse Risk", icon: Warehouse },
  { key: "loans", label: "Loan Exposure", icon: Landmark },
];

export default function OperationalQueuesPage() {
  const [activeQueue, setActiveQueue] = useState<QueueTab>("claims");
  const [selectedItem, setSelectedItem] = useState<QueueItem | null>(null);

  const items = QUEUE_MAP[activeQueue];
  const criticalTotal = Object.values(QUEUE_MAP).flat().filter((i) => i.priority === "critical").length;
  const highTotal = Object.values(QUEUE_MAP).flat().filter((i) => i.priority === "high").length;

  return (
    <div className="max-w-7xl">
      <div className="mb-5">
        <h1 className="page-title">Operational Queues</h1>
        <p className="page-subtitle">Items requiring action, sorted by priority</p>
      </div>

      {/* Severity banner */}
      {(criticalTotal > 0 || highTotal > 0) && (
        <div className={`card mb-4 p-4 flex items-center gap-4 ${criticalTotal > 0 ? "!bg-status-danger-surface !border-red-200" : "!bg-status-warning-surface !border-yellow-200"}`}>
          <div className={`w-9 h-9 flex items-center justify-center ${criticalTotal > 0 ? "bg-red-100" : "bg-yellow-100"}`}>
            <Zap style={{ width: 18, height: 18 }} className={criticalTotal > 0 ? "text-risk-critical" : "text-status-warning"} />
          </div>
          <div className="flex-1">
            <p className={`text-sm font-semibold ${criticalTotal > 0 ? "text-red-800" : "text-yellow-800"}`}>
              {criticalTotal > 0 ? `${criticalTotal} critical` : ""}{criticalTotal > 0 && highTotal > 0 ? " and " : ""}{highTotal > 0 ? `${highTotal} high-priority` : ""} item{(criticalTotal + highTotal) > 1 ? "s" : ""} require attention
            </p>
            <p className={`text-2xs ${criticalTotal > 0 ? "text-red-700/70" : "text-yellow-700/70"}`}>
              Escalated items pending review
            </p>
          </div>
        </div>
      )}

      {/* Queue summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        {QUEUE_TABS.map((tab) => {
          const queueItems = QUEUE_MAP[tab.key];
          const critical = queueItems.filter((i) => i.priority === "critical").length;
          const high = queueItems.filter((i) => i.priority === "high").length;
          const isActive = activeQueue === tab.key;
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => { setActiveQueue(tab.key); setSelectedItem(null); }}
              className={`text-left card p-4 transition-all ${
                isActive
                  ? "!border-brand-500 ring-1 ring-brand-500-hover"
                  : "hover:border-border-strong"
              }`}
            >
              <div className="flex items-center gap-2 mb-3">
                <Icon style={{ width: 14, height: 14 }} className={isActive ? "text-brand-600" : "text-ink-muted"} />
                <span className={`text-2xs font-semibold uppercase tracking-wide ${isActive ? "text-brand-700" : "text-ink-tertiary"}`}>
                  {tab.label}
                </span>
              </div>
              <div className="flex items-end justify-between">
                <p className="metric-value-sm tabular-nums">{queueItems.length}</p>
                <div className="flex items-center gap-1.5">
                  {critical > 0 && (
                    <span className="badge text-2xs bg-status-danger-surface text-risk-critical">{critical} CRIT</span>
                  )}
                  {high > 0 && (
                    <span className="badge text-2xs bg-orange-50 text-risk-high">{high} HIGH</span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Queue content */}
      <div className="flex flex-col lg:flex-row gap-5">
        {/* Queue list */}
        <div className="flex-1 min-w-0">
          <div className="card overflow-hidden">
            <div className="card-section-header">
              <div className="flex items-center gap-2">
                <ArrowUpDown style={{ width: 13, height: 13 }} className="text-ink-muted" />
                <span className="text-2xs font-medium text-ink-tertiary uppercase tracking-wide">
                  Sorted by priority score
                </span>
              </div>
              <span className="text-2xs text-ink-muted tabular-nums">{items.length} items</span>
            </div>

            <div>
              {items.map((item) => {
                const ps = PRIORITY_STYLES[item.priority];
                const isSelected = selectedItem?.id === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setSelectedItem(item)}
                    className={`w-full text-left px-4 py-3.5 border-l-[3px] transition-all border-b border-border-subtle last:border-b-0 ${ps.border} ${
                      isSelected ? `${ps.bg}` : "hover:bg-surface-raised"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`status-dot ${ps.dot}`} />
                          <span className="text-sm font-semibold text-ink truncate">{item.title}</span>
                          <span className={`badge text-2xs uppercase ${ps.badge}`}>
                            {item.priority}
                          </span>
                        </div>
                        <p className="text-2xs text-ink-tertiary mb-2 pl-4">{item.subtitle}</p>
                        {item.indicators.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 pl-4">
                            {item.indicators.map((ind, i) => (
                              <span key={i} className={`inline-flex items-center gap-1 px-2 py-0.5 border text-2xs font-medium ${INDICATOR_STYLES[ind.severity]}`}>
                                {ind.severity === "danger" && <AlertTriangle style={{ width: 11, height: 11 }} />}
                                {ind.label}: {ind.value}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="flex items-center gap-1 text-2xs text-ink-muted tabular-nums">
                          <Clock style={{ width: 12, height: 12 }} />
                          {item.age}
                        </span>
                        <ChevronRight style={{ width: 14, height: 14 }} className="text-ink-faint" />
                      </div>
                    </div>
                  </button>
                );
              })}

              {items.length === 0 && (
                <div className="px-5 py-8">
                  <p className="text-sm text-ink-secondary mb-1">Queue is clear — no items require attention.</p>
                  <p className="text-2xs text-ink-tertiary">
                    Items are automatically prioritized and added as they are flagged by the system or submitted by users.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Detail panel */}
        <div className="w-full lg:w-[380px] flex-shrink-0">
          {selectedItem ? (
            <div className="card sticky top-6 overflow-hidden">
              <div className={`px-5 py-4 border-b border-border-subtle ${PRIORITY_STYLES[selectedItem.priority].bg}`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`status-dot ${PRIORITY_STYLES[selectedItem.priority].dot}`} style={{ width: 8, height: 8 }} />
                  <span className={`text-2xs font-bold uppercase ${PRIORITY_STYLES[selectedItem.priority].text}`}>
                    {selectedItem.priority} Priority
                  </span>
                  <span className="text-2xs text-ink-muted ml-auto tabular-nums">Score: {selectedItem.priorityScore}</span>
                </div>
                <p className="text-sm font-semibold text-ink">{selectedItem.title}</p>
                <p className="text-2xs text-ink-tertiary mt-0.5">{selectedItem.subtitle}</p>
              </div>

              {selectedItem.indicators.length > 0 && (
                <div className="px-5 py-4 border-b border-border-subtle">
                  <p className="label-caps mb-3">Risk Indicators</p>
                  <div className="space-y-2">
                    {selectedItem.indicators.map((ind, i) => (
                      <div key={i} className={`flex items-center justify-between px-3 py-2 border ${INDICATOR_STYLES[ind.severity]}`}>
                        <span className="text-2xs font-medium">{ind.label}</span>
                        <span className="text-2xs font-bold">{ind.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="px-5 py-4 border-b border-border-subtle">
                <p className="label-caps mb-3">Details</p>
                <div className="space-y-2">
                  {Object.entries(selectedItem.metadata).map(([key, val]) => (
                    <div key={key} className="flex items-center justify-between">
                      <span className="text-2xs text-ink-tertiary">{formatMetaKey(key)}</span>
                      <span className="text-2xs font-medium text-ink tabular-nums">
                        {typeof val === "number" && key.toLowerCase().includes("ksh")
                          ? `KSh ${val.toLocaleString()}`
                          : String(val ?? "—")}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="px-5 py-4 space-y-2">
                <p className="label-caps mb-3">Actions</p>
                {activeQueue === "kyc" && (
                  <>
                    <ActionButton icon={User} label="Open Verification" href="/admin/verification" />
                    <ActionButton icon={Shield} label="Run Duplicate Check" variant="secondary" />
                  </>
                )}
                {activeQueue === "claims" && (
                  <>
                    <ActionButton icon={FileText} label="Open Claim Review" href="/admin/claims" />
                    <ActionButton icon={Shield} label="View Fraud Analysis" variant="secondary" />
                  </>
                )}
                {activeQueue === "warehouse" && (
                  <>
                    <ActionButton icon={Warehouse} label="Open Warehouse View" href="/admin/warehouses" />
                    <ActionButton icon={Activity} label="View Sensor History" variant="secondary" />
                  </>
                )}
                {activeQueue === "loans" && (
                  <>
                    <ActionButton icon={Banknote} label="Open Financial Operations" href="/admin/finance" />
                    <ActionButton icon={Activity} label="View Repayment History" variant="secondary" />
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="card p-5 sticky top-6">
              <p className="text-sm text-ink-secondary mb-1">Select an item to view details and take action.</p>
              <p className="text-2xs text-ink-tertiary">
                Items are sorted by priority score. Critical and high-priority items appear first.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ActionButton({
  icon: Icon,
  label,
  href,
  variant = "primary",
}: {
  icon: typeof User;
  label: string;
  href?: string;
  variant?: "primary" | "secondary";
}) {
  const cls = variant === "primary" ? "btn-primary" : "btn-secondary";
  const Wrapper = href ? "a" : "button";
  return (
    <Wrapper
      {...(href ? { href } : {})}
      className={`${cls} w-full justify-center`}
    >
      <Icon style={{ width: 15, height: 15 }} />
      {label}
    </Wrapper>
  );
}

function formatMetaKey(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (s) => s.toUpperCase())
    .replace(/Ksh/g, "(KSh)")
    .replace(/Pct/g, " %");
}
