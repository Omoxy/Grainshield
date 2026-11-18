export type UserRole = "farmer" | "admin";

export type AccountStatus =
  | "PENDING_REGISTRATION"
  | "EMAIL_VERIFIED"
  | "PENDING_KYC"
  | "KYC_IN_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "SUSPENDED";

export interface AuthUser {
  sub: string;
  roles: UserRole[];
  exp: number;
  iat: number;
  accountStatus: AccountStatus;
  fullName: string;
  email: string;
  phone: string;
}

export interface LoginResponse {
  user: AuthUser;
  sessionTimeoutSeconds: number;
}

export interface MeResponse {
  user: AuthUser | null;
  authenticated: boolean;
}

export interface RegisterPayload {
  fullName: string;
  phone: string;
  email: string;
  password: string;
}

export interface RegisterResponse {
  user: AuthUser;
  message: string;
}

export interface VerifyOtpPayload {
  email: string;
  otp: string;
}

export const SESSION_TIMEOUT_SECONDS: Record<UserRole, number> = {
  farmer: 86400,
  admin: 7200,
} as const;

export const ROUTE_ROLE_MAP: { prefix: string; role: UserRole }[] = [
  { prefix: "/admin", role: "admin" },
  { prefix: "/farmer", role: "farmer" },
];

export const PUBLIC_ROUTES = ["/login", "/register", "/api/auth"];

export const ACCOUNT_STATUS_LABELS: Record<AccountStatus, string> = {
  PENDING_REGISTRATION: "Pending Registration",
  EMAIL_VERIFIED: "Email Verified",
  PENDING_KYC: "Pending KYC",
  KYC_IN_REVIEW: "KYC Under Review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  SUSPENDED: "Suspended",
};

export const ACCOUNT_STATUS_COLORS: Record<AccountStatus, string> = {
  PENDING_REGISTRATION: "bg-status-warning-surface text-status-warning",
  EMAIL_VERIFIED: "bg-status-info-surface text-status-info",
  PENDING_KYC: "bg-status-warning-surface text-status-warning",
  KYC_IN_REVIEW: "bg-status-info-surface text-status-info",
  APPROVED: "bg-status-success-surface text-status-success",
  REJECTED: "bg-status-danger-surface text-status-danger",
  SUSPENDED: "bg-surface-sunken text-ink-tertiary",
};

export function isKycApproved(status: AccountStatus): boolean {
  return status === "APPROVED";
}

export function canAccessFullFeatures(status: AccountStatus): boolean {
  return status === "APPROVED";
}
