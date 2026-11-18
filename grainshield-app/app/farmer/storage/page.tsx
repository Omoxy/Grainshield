"use client";

import {
  Warehouse,
  MapPin,
  CheckCircle2,
  AlertTriangle,
  Wheat,
  Clock,
} from "lucide-react";
import useSWR from "swr";

const fetcher = (url: string) =>
  fetch(url, { credentials: "include" }).then((r) => {
    if (!r.ok) throw new Error("Failed to fetch");
    return r.json();
  });

const HEALTH_DISPLAY: Record<string, { label: string; summary: string; color: string; icon: typeof CheckCircle2; bgStrip: string }> = {
  safe: {
    label: "Conditions acceptable",
    summary: "Stored grain remains within acceptable storage conditions. No action required.",
    color: "text-status-success",
    icon: CheckCircle2,
    bgStrip: "bg-green-50 border-b-green-200",
  },
  caution: {
    label: "Requires attention",
    summary: "Storage conditions have been flagged. Review with your warehouse operator.",
    color: "text-status-warning",
    icon: AlertTriangle,
    bgStrip: "bg-yellow-50 border-b-yellow-200",
  },
  risk: {
    label: "Action needed",
    summary: "Conditions are outside acceptable range. Contact your warehouse immediately.",
    color: "text-status-danger",
    icon: AlertTriangle,
    bgStrip: "bg-red-50 border-b-red-200",
  },
};

interface StorageReceipt {
  id: string;
  warehouseName: string;
  location: string;
  grainType: string;
  quantityKg: number;
  grade: string;
  depositDate: string;
  daysInStorage: number;
  temperatureC: number | null;
  humidityPct: number | null;
  moisturePct: number | null;
  healthStatus: "safe" | "caution" | "risk";
}

export default function StoragePage() {
  const { data, isLoading } = useSWR("/api/storage", fetcher, { revalidateOnFocus: false });

  const receipts: StorageReceipt[] = data?.receipts ?? [];
  const totalKg = data?.summary?.totalStoredKg ?? 0;

  const cautionReceipts = receipts.filter((r) => r.healthStatus !== "safe");
  const safeReceipts = receipts.filter((r) => r.healthStatus === "safe");

  return (
    <div className="max-w-5xl">
      <div className="mb-5">
        <h1 className="page-title">Storage</h1>
        <p className="page-subtitle">
          Your grain deposits and warehouse receipt records
        </p>
      </div>

      {/* Total stored — large number anchor, not a card grid */}
      {receipts.length > 0 && (
        <div className="flex items-end gap-3 mb-5">
          <Wheat style={{ width: 18, height: 18 }} className="text-brand-700 mb-1" />
          <p className="text-2xl font-bold text-ink tracking-[-0.02em] tabular-nums">
            {totalKg.toLocaleString()} kg
          </p>
          <span className="text-sm text-ink-muted mb-0.5">
            across {receipts.length} receipt{receipts.length !== 1 ? "s" : ""}
          </span>
        </div>
      )}

      {/* Receipts requiring attention — shown first, condition-led */}
      {cautionReceipts.length > 0 && (
        <div className="mb-5">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle style={{ width: 13, height: 13 }} className="text-status-warning" />
            <span className="text-2xs font-semibold text-ink-tertiary uppercase tracking-wide">Requires Attention</span>
          </div>
          <div className="space-y-3">
            {cautionReceipts.map((record) => (
              <ReceiptCard key={record.id} record={record} />
            ))}
          </div>
        </div>
      )}

      {/* Safe receipts */}
      {safeReceipts.length > 0 && (
        <div>
          {cautionReceipts.length > 0 && (
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 style={{ width: 13, height: 13 }} className="text-status-success" />
              <span className="text-2xs font-semibold text-ink-tertiary uppercase tracking-wide">All Clear</span>
            </div>
          )}
          <div className="space-y-3">
            {safeReceipts.map((record) => (
              <ReceiptCard key={record.id} record={record} />
            ))}
          </div>
        </div>
      )}

      {receipts.length === 0 && !isLoading && (
        <div className="border border-border bg-white p-5">
          <p className="text-sm text-ink-secondary mb-1">No grain currently in storage</p>
          <p className="text-2xs text-ink-tertiary">
            Storage records appear here once grain has been deposited at a verified warehouse.
            Contact your nearest warehouse operator to arrange a deposit.
          </p>
        </div>
      )}
    </div>
  );
}

function ReceiptCard({ record }: { record: StorageReceipt }) {
  const health = HEALTH_DISPLAY[record.healthStatus] ?? HEALTH_DISPLAY.safe;
  const HealthIcon = health.icon;

  return (
    <div className="border border-border bg-white overflow-hidden">
      {/* Condition strip — color-coded header */}
      <div className={`px-4 py-2 border-b ${health.bgStrip} flex items-center justify-between`}>
        <div className="flex items-center gap-2">
          <HealthIcon style={{ width: 13, height: 13 }} className={health.color} />
          <span className={`text-sm font-medium ${health.color}`}>{health.label}</span>
        </div>
        {record.grade && (
          <span className="badge bg-brand-50 text-brand-700">Grade {record.grade}</span>
        )}
      </div>

      <div className="px-4 py-3">
        {/* Quantity — dominant */}
        <p className="text-xl font-bold text-ink tabular-nums mb-1">
          {record.quantityKg.toLocaleString()} kg
        </p>
        <p className="text-2xs text-ink-tertiary mb-3">{health.summary}</p>

        {/* Warehouse + details — two-column */}
        <div className="flex items-start gap-8 py-3 border-y border-border-subtle">
          <div className="flex-1">
            <div className="flex items-center gap-1.5 mb-2">
              <Warehouse style={{ width: 13, height: 13 }} className="text-ink-muted" />
              <span className="text-sm font-medium text-ink">{record.warehouseName}</span>
            </div>
            {record.location && (
              <div className="flex items-center gap-1.5 text-2xs text-ink-muted">
                <MapPin style={{ width: 11, height: 11 }} />
                <span>{record.location}</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-5 text-sm">
            <div>
              <p className="text-2xs text-ink-muted mb-0.5">Grain</p>
              <p className="font-medium text-ink">{record.grainType ?? "Maize"}</p>
            </div>
            <div>
              <p className="text-2xs text-ink-muted mb-0.5 flex items-center gap-1">
                <Clock style={{ width: 11, height: 11 }} /> Stored
              </p>
              <p className="font-medium text-ink tabular-nums">{record.daysInStorage ?? "—"} days</p>
            </div>
          </div>
        </div>

        {/* Receipt reference */}
        <div className="mt-3 flex items-center justify-between text-2xs text-ink-muted">
          <span className="font-mono">{record.id}</span>
          <span className="tabular-nums">Deposited {record.depositDate}</span>
        </div>
      </div>
    </div>
  );
}
