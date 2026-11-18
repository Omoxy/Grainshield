export function formatKes(amount: number): string {
  return `KES ${amount.toLocaleString("en-KE")}`;
}

export function formatDate(iso: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-KE", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(iso: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-KE", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function policyStatusBadgeColor(
  status: string,
): "success" | "failure" | "warning" | "gray" {
  const s = status.toLowerCase();
  if (s === "active") return "success";
  if (s === "triggered") return "failure";
  if (s === "expired") return "gray";
  if (s === "pending") return "warning";
  return "gray";
}

export function riskProgressColor(score: number): "success" | "warning" | "failure" {
  if (score <= 40) return "success";
  if (score <= 70) return "warning";
  return "failure";
}
