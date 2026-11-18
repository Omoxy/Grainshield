/**
 * Auth API client — login, logout, token refresh, current user.
 *
 * All tokens are stored in httpOnly cookies (set by the server-side API route).
 * This module never touches localStorage or exposes any secret.
 */

import type { AuthUser, LoginResponse, MeResponse, UserRole } from "./types";

const AUTH_BASE = "/api/auth";

/** Error thrown when an auth operation fails. */
export class AuthError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * Log in with credentials. The API route sets an httpOnly cookie —
 * no token is ever returned to JS. Role is resolved server-side.
 */
export async function login(
  identifier: string,
  password: string,
): Promise<LoginResponse> {
  const res = await fetch(`${AUTH_BASE}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ identifier, password }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "Login failed" }));
    throw new AuthError(body.error ?? "Login failed", res.status);
  }
  return res.json();
}

/** Log out — clears the httpOnly cookie server-side. */
export async function logout(): Promise<void> {
  await fetch(`${AUTH_BASE}/logout`, {
    method: "POST",
    credentials: "same-origin",
  });
}

/** Get the current authenticated user. Returns null if not logged in. */
export async function getCurrentUser(): Promise<AuthUser | null> {
  const res = await fetch(`${AUTH_BASE}/me`, {
    credentials: "same-origin",
    cache: "no-store",
  });

  if (!res.ok) {
    return null;
  }

  const data: MeResponse = await res.json();
  return data.authenticated ? data.user : null;
}

/**
 * Silently refresh the token. Called automatically by the AuthProvider
 * before the current token expires. Farmers must never see a login
 * screen mid-session.
 */
export async function refreshToken(): Promise<AuthUser | null> {
  const res = await fetch(`${AUTH_BASE}/refresh`, {
    method: "POST",
    credentials: "same-origin",
  });

  if (!res.ok) {
    return null;
  }

  const data: MeResponse = await res.json();
  return data.authenticated ? data.user : null;
}

/** Check if a user has a specific role. */
export function hasRole(user: AuthUser | null, role: UserRole): boolean {
  if (!user) return false;
  return user.roles.includes(role);
}

/** Check if a user has any of the specified roles. */
export function hasAnyRole(
  user: AuthUser | null,
  roles: UserRole[],
): boolean {
  if (!user) return false;
  return roles.some((r) => user.roles.includes(r));
}

/**
 * Get the role-specific home page for a user after login.
 * Used for redirect-after-login and the root / page.
 */
export function getHomePage(user: AuthUser): string {
  const role = user.roles[0];
  switch (role) {
    case "farmer":
      return "/farmer/home";
    case "admin":
      return "/admin/overview";
    default:
      return "/login";
  }
}
