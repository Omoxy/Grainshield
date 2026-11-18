"use client";

import {
  Wheat,
  Phone,
  Signal,
  MessageSquare,
  Globe,
  Server,
  ArrowDown,
  Shield,
} from "lucide-react";
import Link from "next/link";
import useSWR from "swr";

const fetcher = (url: string) =>
  fetch(url, { credentials: "include" }).then((r) => {
    if (!r.ok) throw new Error("Failed to fetch");
    return r.json();
  });

const SESSION_FLOW = [
  { step: "1", label: "Farmer dials *384#", detail: "Request routed through MNO USSD gateway" },
  { step: "2", label: "Gateway forwards to aggregator", detail: "Africa's Talking / Infobip receives session" },
  { step: "3", label: "GrainShield session engine", detail: "Stateful session created, farmer authenticated by MSISDN" },
  { step: "4", label: "Menu rendered & response sent", detail: "Text menu returned to farmer's handset within 2s" },
  { step: "5", label: "Farmer selects option", detail: "Input forwarded back through gateway chain" },
  { step: "6", label: "Action processed", detail: "Backend executes: balance check, claim, loan, price query" },
];

const MENU_TREE = [
  { code: "1", label: "Check Storage Balance", description: "Returns stored grain quantity, value, warehouse name, and quality grade" },
  { code: "2", label: "Market Prices", description: "Current maize prices across Eldoret, Kitale, Nairobi, Mombasa with hold/sell guidance" },
  { code: "3", label: "Loans & Finance", description: "Apply for warehouse receipt loans, check status, view repayment info" },
  { code: "4", label: "Claims", description: "File new pre-harvest or post-harvest claims, check claim status" },
  { code: "5", label: "My Alerts", description: "Weather warnings, storage alerts, price notifications, claim updates" },
];

const NETWORK_CONFIG = [
  { name: "Safaricom", shortcode: "*384#", type: "Primary MNO" },
  { name: "Airtel Kenya", shortcode: "*384#", type: "Secondary MNO" },
];

export default function UssdOperationsPage() {
  const { data: healthData } = useSWR("/api/health", fetcher, { revalidateOnFocus: false });

  const ussdService = healthData?.platform?.services?.find(
    (s: { serviceId: string }) => s.serviceId === "ussd_gateway" || s.serviceId === "notification_service"
  );

  return (
    <div className="min-h-screen" style={{ background: "#F3F4F1" }}>
      {/* Header */}
      <div className="bg-white border-b border-border">
        <div className="max-w-6xl mx-auto px-5 sm:px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Link href="/" className="flex items-center gap-2">
                <Wheat style={{ width: 15, height: 15 }} className="text-brand-700" />
                <span className="text-[13.5px] font-semibold text-ink tracking-[-0.01em]">GrainShield</span>
              </Link>
              <span className="text-ink-faint mx-0.5">/</span>
              <span className="text-sm font-medium text-ink-tertiary">USSD Channel</span>
            </div>
            <Link href="/" className="link-action">
              Back to Portal
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-5 sm:px-6 py-5">
        <div className="mb-5">
          <h1 className="page-title">USSD Channel Architecture</h1>
          <p className="page-subtitle">
            Telecom gateway integration, session routing, and service menu structure for *384#
          </p>
        </div>

        {/* Network Configuration */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          {NETWORK_CONFIG.map((network) => (
            <div key={network.name} className="card p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <Signal style={{ width: 15, height: 15 }} className="text-brand-700" />
                  <div>
                    <h3 className="text-sm font-semibold text-ink">{network.name}</h3>
                    <p className="text-2xs text-ink-muted font-mono">{network.shortcode}</p>
                  </div>
                </div>
                <span className="badge bg-surface-raised text-ink-tertiary">
                  {network.type}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Gateway Status */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          <div className="card p-3">
            <p className="label-caps mb-1">Gateway Status</p>
            <div className="flex items-center gap-2">
              <span className={`status-dot ${
                ussdService?.status === "healthy" ? "bg-status-success"
                  : ussdService?.status === "degraded" ? "bg-status-warning"
                  : ussdService ? "bg-status-danger"
                  : "bg-ink-faint"
              }`} />
              <p className={`text-sm font-semibold capitalize ${
                ussdService?.status === "healthy" ? "text-status-success"
                  : ussdService?.status === "degraded" ? "text-status-warning"
                  : ussdService ? "text-status-danger"
                  : "text-ink-muted"
              }`}>
                {ussdService?.status ?? "Not connected"}
              </p>
            </div>
          </div>
          <div className="card p-3">
            <p className="label-caps mb-1">Session Engine</p>
            <p className="text-sm font-medium text-ink">Redis-backed stateful</p>
            <p className="text-2xs text-ink-muted mt-0.5">180s session TTL per USSD spec</p>
          </div>
          <div className="card p-3">
            <p className="label-caps mb-1">Failover</p>
            <p className="text-sm font-medium text-ink">SMS fallback enabled</p>
            <p className="text-2xs text-ink-muted mt-0.5">Auto-SMS on USSD timeout or network failure</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          {/* Session Flow */}
          <div className="card p-4">
            <div className="flex items-center gap-1.5 mb-3">
              <Server style={{ width: 13, height: 13 }} className="text-ink-muted" />
              <span className="label-caps">Session Architecture</span>
            </div>
            <div className="space-y-0">
              {SESSION_FLOW.map((step, i) => (
                <div key={step.step}>
                  <div className="flex items-start gap-2.5 py-2">
                    <span className="w-5 h-5 bg-brand-50 flex items-center justify-center flex-shrink-0 text-2xs font-bold text-brand-700">
                      {step.step}
                    </span>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-ink">{step.label}</p>
                      <p className="text-2xs text-ink-muted mt-0.5">{step.detail}</p>
                    </div>
                  </div>
                  {i < SESSION_FLOW.length - 1 && (
                    <div className="flex justify-start ml-2">
                      <ArrowDown style={{ width: 12, height: 12 }} className="text-border" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Service Menu Tree */}
          <div className="card p-4">
            <div className="flex items-center gap-1.5 mb-3">
              <MessageSquare style={{ width: 13, height: 13 }} className="text-ink-muted" />
              <span className="label-caps">Service Menu (*384#)</span>
            </div>
            <div className="space-y-1.5">
              {MENU_TREE.map((item) => (
                <div key={item.code} className="flex items-start gap-2.5 p-2.5 bg-surface-raised">
                  <span className="w-5 h-5 bg-brand-100 text-brand-700 flex items-center justify-center text-sm font-bold flex-shrink-0">
                    {item.code}
                  </span>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-ink">{item.label}</p>
                    <p className="text-2xs text-ink-muted mt-0.5">{item.description}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 pt-3 border-t border-border-subtle">
              <div className="flex items-start gap-1.5 text-2xs text-ink-muted">
                <Globe style={{ width: 12, height: 12 }} className="mt-0.5 flex-shrink-0" />
                <p>Available on Safaricom and Airtel Kenya. Sessions are network-independent via aggregator API gateway.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Security & Authentication */}
        <div className="card p-4 mb-4">
          <div className="flex items-center gap-1.5 mb-3">
            <Shield style={{ width: 13, height: 13 }} className="text-ink-muted" />
            <span className="label-caps">Authentication & Security</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <p className="text-sm font-medium text-ink mb-0.5">Farmer Identity</p>
              <p className="text-sm text-ink-tertiary">MSISDN + 4-digit PIN</p>
              <p className="text-2xs text-ink-muted mt-0.5">Phone number auto-linked on registration. PIN hashed with bcrypt.</p>
            </div>
            <div>
              <p className="text-sm font-medium text-ink mb-0.5">Session Security</p>
              <p className="text-sm text-ink-tertiary">Per-session token, no replay</p>
              <p className="text-2xs text-ink-muted mt-0.5">Each session gets unique ID. Expired sessions cannot be resumed.</p>
            </div>
            <div>
              <p className="text-sm font-medium text-ink mb-0.5">Rate Limiting</p>
              <p className="text-sm text-ink-tertiary">Max 5 sessions/minute per MSISDN</p>
              <p className="text-2xs text-ink-muted mt-0.5">Prevents brute-force PIN attempts and gateway abuse.</p>
            </div>
          </div>
        </div>

        {/* Integration Layer */}
        <div className="card p-4">
          <div className="flex items-center gap-1.5 mb-3">
            <Phone style={{ width: 13, height: 13 }} className="text-ink-muted" />
            <span className="label-caps">Telecom Integration Layer</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <p className="text-sm font-medium text-ink mb-0.5">Gateway Provider</p>
              <p className="text-sm text-ink-tertiary">Africa&apos;s Talking USSD API</p>
              <p className="text-2xs text-ink-muted mt-0.5">Aggregator-level abstraction for multi-network routing</p>
            </div>
            <div>
              <p className="text-sm font-medium text-ink mb-0.5">Session Management</p>
              <p className="text-sm text-ink-tertiary">Stateful, network-independent</p>
              <p className="text-2xs text-ink-muted mt-0.5">Redis-backed session persistence with 180s TTL</p>
            </div>
            <div>
              <p className="text-sm font-medium text-ink mb-0.5">Callback URL</p>
              <p className="text-2xs text-ink-tertiary font-mono">/api/ussd/callback</p>
              <p className="text-2xs text-ink-muted mt-0.5">POST endpoint receives session events from aggregator</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
