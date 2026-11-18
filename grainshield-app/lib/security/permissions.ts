import type { UserRole } from "@/lib/auth/types";

type Resource =
  | "claims"
  | "kyc"
  | "warehouses"
  | "loans"
  | "farmers"
  | "audit"
  | "risk"
  | "prices"
  | "payouts"
  | "storage"
  | "alerts";

type Action =
  | "read"
  | "create"
  | "update"
  | "delete"
  | "approve"
  | "reject"
  | "export";

const PERMISSION_MATRIX: Record<UserRole, Record<Resource, Action[]>> = {
  farmer: {
    claims: ["read", "create"],
    kyc: ["read", "create"],
    warehouses: [],
    loans: ["read", "create"],
    farmers: [],
    audit: [],
    risk: [],
    prices: ["read"],
    payouts: [],
    storage: ["read"],
    alerts: ["read", "update"],
  },
  admin: {
    claims: ["read", "create", "update", "approve", "reject", "export"],
    kyc: ["read", "update", "approve", "reject", "export"],
    warehouses: ["read", "create", "update", "delete"],
    loans: ["read", "update", "approve", "reject", "export"],
    farmers: ["read", "update", "export"],
    audit: ["read", "export"],
    risk: ["read", "update", "export"],
    prices: ["read", "create", "update"],
    payouts: ["read", "approve", "export"],
    storage: ["read", "export"],
    alerts: ["read", "create", "update"],
  },
};

export function hasPermission(
  role: UserRole,
  resource: Resource,
  action: Action,
): boolean {
  const rolePerms = PERMISSION_MATRIX[role];
  if (!rolePerms) return false;
  const resourcePerms = rolePerms[resource];
  if (!resourcePerms) return false;
  return resourcePerms.includes(action);
}

export function checkPermission(
  roles: UserRole[],
  resource: Resource,
  action: Action,
): boolean {
  return roles.some((role) => hasPermission(role, resource, action));
}

export function getPermissionsForRole(role: UserRole): Record<Resource, Action[]> {
  return PERMISSION_MATRIX[role] ?? ({} as Record<Resource, Action[]>);
}
