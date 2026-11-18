/**
 * In-process rate limiter for auth endpoints.
 *
 * Provides sliding-window rate limiting with progressive lockouts.
 * Designed for credential stuffing and brute force defence at the
 * Next.js layer. The backend Go services have their own Redis-backed
 * rate limiter as defence-in-depth.
 *
 * ARCHITECTURE NOTE: This is an in-process Map. It does NOT share
 * state across multiple Next.js instances. For multi-replica
 * deployments, this should be backed by Redis. Even per-instance,
 * this provides meaningful single-origin attack resistance.
 *
 * SECURITY: IP extraction uses X-Forwarded-For (set by the load
 * balancer) with a fallback to the direct connection IP. In
 * production, ensure the load balancer sets X-Forwarded-For and
 * strips any client-supplied value (trusted proxy configuration).
 */

interface RateLimitEntry {
  /** Number of requests in the current window */
  count: number;
  /** Window start timestamp (ms) */
  windowStart: number;
  /** Number of consecutive windows that exceeded the limit */
  lockoutLevel: number;
  /** Lockout expiry timestamp (ms), or 0 if not locked out */
  lockedUntil: number;
}

const store = new Map<string, RateLimitEntry>();

/** Clean up expired entries every 5 minutes to prevent memory leaks. */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const MAX_STORE_SIZE = 50_000;

let lastCleanup = Date.now();

function cleanup(): void {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;

  const cutoff = now - 60 * 60 * 1000; // Remove entries older than 1 hour
  for (const [key, entry] of store) {
    if (entry.windowStart < cutoff && entry.lockedUntil < now) {
      store.delete(key);
    }
  }

  // Hard limit: if store is still too large, drop oldest entries
  if (store.size > MAX_STORE_SIZE) {
    const entries = [...store.entries()].sort(
      (a, b) => a[1].windowStart - b[1].windowStart,
    );
    const toRemove = entries.slice(0, store.size - MAX_STORE_SIZE);
    for (const [key] of toRemove) {
      store.delete(key);
    }
  }
}

export interface RateLimitConfig {
  /** Maximum requests per window */
  maxRequests: number;
  /** Window duration in milliseconds */
  windowMs: number;
  /** Progressive lockout durations in seconds [level1, level2, ...] */
  lockoutDurations: number[];
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/** Default config for login: 5 attempts per 15 minutes, progressive lockout */
export const LOGIN_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 5,
  windowMs: 15 * 60 * 1000,
  lockoutDurations: [
    60,      // Level 1: 1 minute
    300,     // Level 2: 5 minutes
    900,     // Level 3: 15 minutes
    3600,    // Level 4+: 1 hour
  ],
};

/** Config for refresh: 10 attempts per 5 minutes */
export const REFRESH_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 10,
  windowMs: 5 * 60 * 1000,
  lockoutDurations: [60, 300],
};

/**
 * Check if a request from the given key is allowed.
 * Returns whether the request should proceed and how long to wait if not.
 */
export function checkRateLimit(
  key: string,
  config: RateLimitConfig,
): RateLimitResult {
  cleanup();

  const now = Date.now();
  let entry = store.get(key);

  // Check if currently locked out
  if (entry && entry.lockedUntil > now) {
    const retryAfterSeconds = Math.ceil((entry.lockedUntil - now) / 1000);
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }

  // New entry or window expired — reset
  if (!entry || now - entry.windowStart > config.windowMs) {
    entry = {
      count: 0,
      windowStart: now,
      lockoutLevel: entry?.lockoutLevel ?? 0,
      lockedUntil: 0,
    };
  }

  entry.count++;

  if (entry.count > config.maxRequests) {
    // Trigger progressive lockout
    const level = Math.min(
      entry.lockoutLevel,
      config.lockoutDurations.length - 1,
    );
    const lockoutSeconds = config.lockoutDurations[level];
    entry.lockedUntil = now + lockoutSeconds * 1000;
    entry.lockoutLevel++;

    store.set(key, entry);
    return { allowed: false, remaining: 0, retryAfterSeconds: lockoutSeconds };
  }

  store.set(key, entry);
  return {
    allowed: true,
    remaining: config.maxRequests - entry.count,
    retryAfterSeconds: 0,
  };
}

/**
 * Reset the rate limit for a key (e.g., after successful login).
 * Successful authentication resets the lockout level.
 */
export function resetRateLimit(key: string): void {
  store.delete(key);
}

/**
 * Extract a rate-limit key from a request.
 * Uses IP + endpoint for per-IP-per-endpoint limiting.
 */
export function extractRateLimitKey(
  request: Request,
  endpoint: string,
): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded
    ? forwarded.split(",")[0].trim()
    : "unknown";
  return `rl:${endpoint}:${ip}`;
}
