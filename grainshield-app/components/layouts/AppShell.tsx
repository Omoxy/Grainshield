"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Home,
  Warehouse,
  TrendingUp,
  Landmark,
  Bell,
  FileText,
  UserCircle,
  LogOut,
  Wheat,
  Menu,
  X,
  ClipboardList,
  Users,
  ShieldCheck,
  BarChart3,
  ScrollText,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import type { AccountStatus } from "@/lib/auth/types";
import { ACCOUNT_STATUS_LABELS, ACCOUNT_STATUS_COLORS } from "@/lib/auth/types";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  requiresKyc?: boolean;
}

const FARMER_NAV: NavItem[] = [
  { href: "/farmer/home", label: "Home", icon: Home },
  { href: "/farmer/storage", label: "Storage", icon: Warehouse, requiresKyc: true },
  { href: "/farmer/prices", label: "Market Prices", icon: TrendingUp },
  { href: "/farmer/loans", label: "Loans", icon: Landmark, requiresKyc: true },
  { href: "/farmer/alerts", label: "Alerts", icon: Bell },
  { href: "/farmer/claims", label: "Claims", icon: FileText, requiresKyc: true },
  { href: "/farmer/profile", label: "Account", icon: UserCircle },
];

const ADMIN_NAV: NavItem[] = [
  { href: "/admin/overview", label: "Operations Overview", icon: Home },
  { href: "/admin/queues", label: "Operational Queues", icon: ClipboardList },
  { href: "/admin/risk", label: "Risk Operations", icon: BarChart3 },
  { href: "/admin/verification", label: "Farmer Verification", icon: ShieldCheck },
  { href: "/admin/claims", label: "Claims Management", icon: ClipboardList },
  { href: "/admin/warehouses", label: "Warehouse Oversight", icon: Warehouse },
  { href: "/admin/finance", label: "Financial Operations", icon: Landmark },
  { href: "/admin/prices", label: "Price Intelligence", icon: TrendingUp },
  { href: "/admin/farmers", label: "Farmers", icon: Users },
  { href: "/admin/audit", label: "Audit & Governance", icon: ScrollText },
];

interface AppShellProps {
  children: React.ReactNode;
  role: "farmer" | "admin";
  userName?: string;
  userRegion?: string;
  accountStatus?: AccountStatus;
}

export function AppShell({
  children,
  role,
  userName,
  userRegion,
  accountStatus = "APPROVED",
}: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navItems = role === "farmer" ? FARMER_NAV : ADMIN_NAV;
  const isApproved = accountStatus === "APPROVED";

  const isActive = (href: string) => {
    if (href === "/farmer/home" || href === "/admin/overview") {
      return pathname === href;
    }
    return pathname.startsWith(href);
  };

  const currentPageLabel = navItems.find((item) => isActive(item.href))?.label ?? "";

  const initials = userName
    ? userName.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()
    : role === "admin" ? "AD" : "FA";

  return (
    <div className="flex h-screen overflow-hidden bg-surface-secondary">
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-40 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-50 w-[232px] flex-shrink-0 flex flex-col transition-transform duration-200 lg:translate-x-0 ${
          mobileMenuOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        style={{ background: "var(--sidebar-bg)" }}
      >
        <div className="px-3.5 pt-4 pb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wheat className="text-white/70" style={{ width: 15, height: 15 }} />
            <span className="text-[13.5px] font-semibold text-white/90 tracking-[-0.01em]">
              GrainShield
            </span>
            {role === "admin" && (
              <span className="text-2xs text-white/30 uppercase tracking-widest ml-0.5">
                Ops
              </span>
            )}
          </div>
          <button
            className="lg:hidden text-white/50 hover:text-white/80 transition-colors"
            onClick={() => setMobileMenuOpen(false)}
          >
            <X className="w-4.5 h-4.5" />
          </button>
        </div>

        {role === "farmer" && accountStatus !== "APPROVED" && (
          <div className="mx-3 mb-1.5 px-2.5 py-1.5" style={{ background: "rgba(255,255,255,0.05)" }}>
            <p className="text-2xs text-white/35 uppercase tracking-wide mb-0.5">Status</p>
            <span className={`inline-flex items-center gap-1.5 px-1.5 py-0.5 text-2xs font-medium ${ACCOUNT_STATUS_COLORS[accountStatus]}`}>
              {ACCOUNT_STATUS_LABELS[accountStatus]}
            </span>
          </div>
        )}

        <nav className="flex-1 px-2.5 py-0.5 space-y-px overflow-y-auto">
          {role === "admin" && (
            <div className="px-2 pt-1.5 pb-1.5">
              <span className="text-2xs font-medium text-white/20 uppercase tracking-widest">Navigation</span>
            </div>
          )}
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            const locked = role === "farmer" && item.requiresKyc && !isApproved;

            return (
              <Link
                key={item.href}
                href={locked ? "/farmer/profile" : item.href}
                onClick={() => setMobileMenuOpen(false)}
                className={`sidebar-nav-item ${
                  active
                    ? "text-white"
                    : locked
                      ? "text-white/20 cursor-not-allowed"
                      : "text-white/55 hover:text-white/80"
                }`}
                style={{
                  background: active ? "var(--sidebar-active-bg)" : undefined,
                }}
                onMouseEnter={(e) => {
                  if (!active && !locked) {
                    e.currentTarget.style.background = "var(--sidebar-hover-bg)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!active) {
                    e.currentTarget.style.background = "";
                  }
                }}
              >
                <Icon
                  className="flex-shrink-0"
                  style={{
                    width: 15,
                    height: 15,
                    opacity: active ? 1 : locked ? 0.2 : 0.5,
                  }}
                />
                <span className="truncate">{item.label}</span>
                {locked && (
                  <span className="ml-auto text-2xs text-white/20 bg-white/8 px-1.5 py-0.5">
                    KYC
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="px-2.5 pb-3 mt-auto">
          <div
            className="px-2 py-2"
            style={{ borderTop: "1px solid var(--sidebar-border)" }}
          >
            <p className="text-sm font-medium text-white/70 truncate">{userName ?? "User"}</p>
            {userRegion && (
              <p className="text-2xs text-white/30 truncate mt-0.5">{userRegion}</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => router.push("/")}
            className="sidebar-nav-item text-white/35 hover:text-white/60 w-full"
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--sidebar-hover-bg)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "";
            }}
          >
            <LogOut style={{ width: 15, height: 15 }} />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-11 bg-white border-b border-border flex items-center justify-between px-4 lg:px-5 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <button
              className="lg:hidden p-1 text-ink-muted hover:text-ink-secondary transition-colors"
              onClick={() => setMobileMenuOpen(true)}
            >
              <Menu className="w-4.5 h-4.5" />
            </button>
            <span className="text-sm font-medium text-ink">{currentPageLabel}</span>
          </div>

          <div className="flex items-center gap-1.5">
            {role === "farmer" && accountStatus === "APPROVED" && (
              <span className="hidden sm:inline-flex items-center gap-1 text-2xs font-medium text-status-success bg-status-success-surface px-1.5 py-0.5">
                Verified
              </span>
            )}
            <button
              type="button"
              className="relative p-1 text-ink-muted hover:text-ink-secondary transition-colors"
              aria-label="Notifications"
            >
              <Bell style={{ width: 16, height: 16 }} />
              <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-risk-critical" />
            </button>
            <div className="w-6 h-6 bg-brand-100 text-brand-800 flex items-center justify-center text-2xs font-semibold">
              {initials}
            </div>
          </div>
        </header>

        {role === "farmer" && !isApproved && (
          <div className="bg-status-warning-surface border-b border-yellow-200 px-4 lg:px-5 py-2 flex items-center gap-2.5">
            <ShieldCheck className="w-3.5 h-3.5 text-status-warning flex-shrink-0" />
            <p className="text-sm font-medium text-yellow-900 flex-1 min-w-0">
              KYC verification incomplete — some features restricted
            </p>
            <Link
              href="/farmer/profile"
              className="text-2xs font-semibold text-status-warning hover:text-yellow-800 bg-yellow-100 px-2 py-0.5 whitespace-nowrap transition-colors"
            >
              Complete KYC
            </Link>
          </div>
        )}

        <main className="flex-1 overflow-y-auto px-4 lg:px-5 py-4">
          {children}
        </main>
      </div>
    </div>
  );
}
