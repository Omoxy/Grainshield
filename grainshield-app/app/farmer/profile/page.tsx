"use client";

import {
  UserCircle,
  Phone,
  Mail,
  MapPin,
  Shield,
  FileText,
  CheckCircle2,
  Clock,
  Upload,
  Lock,
  Smartphone,
  AlertCircle,
} from "lucide-react";
import useSWR from "swr";

const fetcher = (url: string) =>
  fetch(url, { credentials: "include" }).then((r) => {
    if (!r.ok) throw new Error("Failed to fetch");
    return r.json();
  });

interface ProfileData {
  fullName: string;
  phone: string;
  email: string;
  county: string;
  ward: string;
  village: string;
  accountStatus: string;
  registeredDate: string;
  kycDocuments: { id: string; type: string; status: string; uploadedDate: string }[];
}

const DOC_STATUS: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  verified: { label: "Verified", color: "bg-status-success-surface text-status-success", icon: CheckCircle2 },
  approved: { label: "Verified", color: "bg-status-success-surface text-status-success", icon: CheckCircle2 },
  pending: { label: "Being Reviewed", color: "bg-status-warning-surface text-status-warning", icon: Clock },
  pending_review: { label: "Being Reviewed", color: "bg-status-warning-surface text-status-warning", icon: Clock },
  rejected: { label: "Resubmission Needed", color: "bg-status-danger-surface text-status-danger", icon: Shield },
};

const ACCOUNT_STATUS_DISPLAY: Record<string, { label: string; detail: string; bg: string; border: string; textPrimary: string; textSecondary: string; icon: typeof CheckCircle2 }> = {
  APPROVED: {
    label: "Account verified",
    detail: "All account features are active.",
    bg: "!bg-status-success-surface",
    border: "!border-green-200",
    textPrimary: "text-green-800",
    textSecondary: "text-green-700/70",
    icon: CheckCircle2,
  },
  PENDING_KYC: {
    label: "Verification in progress",
    detail: "Your documents are being reviewed. You will receive an SMS when complete.",
    bg: "!bg-status-warning-surface",
    border: "!border-yellow-200",
    textPrimary: "text-yellow-800",
    textSecondary: "text-yellow-700/70",
    icon: Clock,
  },
  REJECTED: {
    label: "Additional documents required",
    detail: "Some documents could not be verified. Please review and resubmit.",
    bg: "!bg-status-danger-surface",
    border: "!border-red-200",
    textPrimary: "text-red-800",
    textSecondary: "text-red-700/70",
    icon: Shield,
  },
};

export default function ProfilePage() {
  const { data, isLoading } = useSWR("/api/profile", fetcher, { revalidateOnFocus: false });

  const profile: ProfileData | null = data?.profile ?? null;

  const accountCfg = ACCOUNT_STATUS_DISPLAY[profile?.accountStatus ?? ""] ?? ACCOUNT_STATUS_DISPLAY.PENDING_KYC;
  const AccountIcon = accountCfg.icon;

  if (!profile && !isLoading) {
    return (
      <div className="max-w-4xl">
        <div className="card p-5 text-center">
          <AlertCircle style={{ width: 16, height: 16 }} className="text-ink-faint mx-auto mb-1.5" />
          <p className="text-sm text-ink-muted">Account information unavailable.</p>
        </div>
      </div>
    );
  }

  if (!profile) return null;

  return (
    <div className="max-w-4xl">
      <div className="mb-5">
        <h1 className="page-title">Your Account</h1>
        <p className="page-subtitle">
          Personal details and account status
        </p>
      </div>

      {/* Account Status */}
      <div className={`card ${accountCfg.bg} ${accountCfg.border} p-4 mb-4 flex items-center gap-4`}>
        <AccountIcon style={{ width: 18, height: 18 }} className={`${accountCfg.textPrimary} flex-shrink-0`} />
        <div>
          <p className={`text-sm font-semibold ${accountCfg.textPrimary}`}>{accountCfg.label}</p>
          <p className={`text-2xs ${accountCfg.textSecondary}`}>{accountCfg.detail}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Personal Information */}
        <div className="lg:col-span-2 space-y-4">
          <div className="card p-4">
            <span className="label-caps">Personal Information</span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
              <InfoRow icon={UserCircle} label="Full Name" value={profile.fullName} />
              <InfoRow icon={Phone} label="Phone" value={profile.phone} />
              <InfoRow icon={Mail} label="Email" value={profile.email || "—"} />
              <InfoRow icon={MapPin} label="County" value={profile.county || "—"} />
              <InfoRow icon={MapPin} label="Ward" value={profile.ward || "—"} />
              <InfoRow icon={MapPin} label="Village" value={profile.village || "—"} />
            </div>
          </div>

          {/* Documents */}
          <div className="card p-4">
            <span className="label-caps">Submitted Documents</span>
            <div className="space-y-2 mt-4">
              {profile.kycDocuments.length > 0 ? profile.kycDocuments.map((doc) => {
                const statusCfg = DOC_STATUS[doc.status] ?? DOC_STATUS.pending;
                const StatusIcon = statusCfg.icon;
                return (
                  <div key={doc.id} className="flex items-center justify-between p-3 bg-surface-raised">
                    <div className="flex items-center gap-3">
                      <FileText style={{ width: 16, height: 16 }} className="text-ink-muted" />
                      <div>
                        <p className="text-sm font-medium text-ink">{doc.type}</p>
                        <p className="text-2xs text-ink-muted tabular-nums">Submitted {doc.uploadedDate}</p>
                      </div>
                    </div>
                    <span className={`badge ${statusCfg.color}`}>
                      <StatusIcon style={{ width: 11, height: 11 }} />
                      {statusCfg.label}
                    </span>
                  </div>
                );
              }) : (
                <div className="py-3">
                  <p className="text-sm text-ink-secondary mb-0.5">No documents have been submitted yet.</p>
                  <p className="text-2xs text-ink-tertiary">Upload your National ID and proof of residence to complete account verification.</p>
                </div>
              )}
            </div>
            <button className="mt-4 link-action flex items-center gap-1.5">
              <Upload style={{ width: 14, height: 14 }} />
              Upload Additional Document
            </button>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <div className="card p-4">
            <span className="label-caps">Account Security</span>
            <div className="space-y-2 mt-4">
              <button className="w-full flex items-center gap-3 p-3 bg-surface-raised hover:bg-surface-sunken transition-colors text-left">
                <Lock style={{ width: 16, height: 16 }} className="text-ink-muted" />
                <div>
                  <p className="text-sm font-medium text-ink">Change Password</p>
                </div>
              </button>
              <button className="w-full flex items-center gap-3 p-3 bg-surface-raised hover:bg-surface-sunken transition-colors text-left">
                <Smartphone style={{ width: 16, height: 16 }} className="text-ink-muted" />
                <div>
                  <p className="text-sm font-medium text-ink">USSD PIN</p>
                  <p className="text-2xs text-ink-muted">For *384# access</p>
                </div>
              </button>
            </div>
          </div>

          <div className="card p-4">
            <span className="label-caps">Account</span>
            <div className="space-y-3 text-sm mt-4">
              <div className="flex justify-between">
                <span className="text-ink-tertiary">Member since</span>
                <span className="font-medium text-ink tabular-nums">{profile.registeredDate}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-tertiary">Status</span>
                <span className="flex items-center gap-1 font-medium">
                  {profile.accountStatus === "APPROVED" && (
                    <>
                      <CheckCircle2 style={{ width: 13, height: 13 }} className="text-status-success" />
                      <span className="text-status-success">Verified</span>
                    </>
                  )}
                  {profile.accountStatus === "PENDING_KYC" && (
                    <>
                      <Clock style={{ width: 13, height: 13 }} className="text-status-warning" />
                      <span className="text-status-warning">Under review</span>
                    </>
                  )}
                  {profile.accountStatus === "REJECTED" && (
                    <>
                      <Shield style={{ width: 13, height: 13 }} className="text-status-danger" />
                      <span className="text-status-danger">Action needed</span>
                    </>
                  )}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: typeof UserCircle; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <Icon style={{ width: 16, height: 16 }} className="text-ink-muted mt-0.5 flex-shrink-0" />
      <div>
        <p className="text-2xs text-ink-muted">{label}</p>
        <p className="text-sm font-medium text-ink">{value}</p>
      </div>
    </div>
  );
}
