"use client";

import { AppShell } from "@/components/layouts/AppShell";
import { useAuth } from "@/lib/auth/hooks";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) return null;

  return (
    <AppShell
      role="admin"
      userName={user?.fullName}
      accountStatus={user?.accountStatus ?? "APPROVED"}
    >
      {children}
    </AppShell>
  );
}
