"use client";

import { AppShell } from "@/components/layouts/AppShell";
import { useAuth } from "@/lib/auth/hooks";

export default function FarmerLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) return null;

  return (
    <AppShell
      role="farmer"
      userName={user?.fullName}
      accountStatus={user?.accountStatus ?? "PENDING_KYC"}
    >
      {children}
    </AppShell>
  );
}
