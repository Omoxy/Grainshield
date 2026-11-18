"use client";

/**
 * Auth hooks — useCurrentUser, useRequireRole, useAuth.
 *
 * The AuthProvider wraps the entire app and provides user state to all pages.
 * Token refresh runs silently on a timer so farmers never see a login screen
 * mid-session.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter, usePathname } from "next/navigation";

import type { AuthUser, UserRole } from "./types";
import {
  getCurrentUser,
  refreshToken,
  logout as logoutApi,
  getHomePage,
} from "./client";

/* ─── Context ──────────────────────────────────────────────────────────── */

interface AuthContextValue {
  /** Current authenticated user, or null if not logged in */
  user: AuthUser | null;
  /** True while the initial auth check is in progress */
  loading: boolean;
  /** Log the current user out and redirect to /login */
  logout: () => Promise<void>;
  /** Force a refresh of the current user from the server */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  logout: async () => {},
  refresh: async () => {},
});

/* ─── Provider ─────────────────────────────────────────────────────────── */

/** Minimum ms before token expiry to trigger a silent refresh. */
const REFRESH_BUFFER_MS = 120_000; // 2 minutes

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();

  const clearRefreshTimer = useCallback(() => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  }, []);

  /** Schedule a silent refresh before the token expires. */
  const scheduleRefresh = useCallback(
    (authUser: AuthUser) => {
      clearRefreshTimer();

      const nowSeconds = Math.floor(Date.now() / 1000);
      const expiresInMs = (authUser.exp - nowSeconds) * 1000;
      const refreshInMs = Math.max(expiresInMs - REFRESH_BUFFER_MS, 5000);

      refreshTimerRef.current = setTimeout(async () => {
        const refreshed = await refreshToken();
        if (refreshed) {
          setUser(refreshed);
          scheduleRefresh(refreshed);
        } else {
          // Refresh failed — session has expired
          setUser(null);
          router.push(`/login?redirect=${encodeURIComponent(window.location.pathname)}`);
        }
      }, refreshInMs);
    },
    [clearRefreshTimer, router],
  );

  /** Fetch the current user on mount. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const authUser = await getCurrentUser();
      if (cancelled) return;
      setUser(authUser);
      if (authUser) {
        scheduleRefresh(authUser);
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
      clearRefreshTimer();
    };
  }, [scheduleRefresh, clearRefreshTimer]);

  const logout = useCallback(async () => {
    clearRefreshTimer();
    await logoutApi();
    setUser(null);
    router.push("/login");
  }, [clearRefreshTimer, router]);

  const refresh = useCallback(async () => {
    const authUser = await getCurrentUser();
    setUser(authUser);
    if (authUser) {
      scheduleRefresh(authUser);
    }
  }, [scheduleRefresh]);

  return (
    <AuthContext.Provider value={{ user, loading, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

/* ─── Hooks ────────────────────────────────────────────────────────────── */

/** Access the current authenticated user and auth operations. */
export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

/** Convenience alias — returns user and loading state only. */
export function useCurrentUser(): {
  user: AuthUser | null;
  loading: boolean;
} {
  const { user, loading } = useContext(AuthContext);
  return { user, loading };
}

/**
 * Enforce that the current user has the required role.
 * If not, redirects to /login?redirect=<current path>.
 * Returns the user (guaranteed to have the role) once verified.
 */
export function useRequireRole(role: UserRole): {
  user: AuthUser | null;
  loading: boolean;
} {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) return;

    // Not authenticated
    if (!user) {
      router.replace(`/login?redirect=${encodeURIComponent(pathname)}`);
      return;
    }

    // Authenticated but wrong role
    if (!user.roles.includes(role)) {
      // Redirect to their own home page instead of showing 403
      router.replace(getHomePage(user));
    }
  }, [user, loading, role, router, pathname]);

  return { user, loading };
}
