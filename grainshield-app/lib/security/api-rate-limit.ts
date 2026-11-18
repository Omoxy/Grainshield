/**
 * General-purpose API rate limiter for all non-auth endpoints.
 *
 * Applies a simple sliding-window rate limit per IP address.
 * Auth endpoints use the more aggressive rate limiter in lib/auth/rate-limit.ts.
 *
 * This is an in-process Map. For multi-replica deployments, back with Redis.
 */

import { NextResponse, type NextRequest } from "next/server";

interface WindowEntry {
  count: number;
  windowStart: number;
}

const store = new Map<string, WindowEntry>();

const WINDOW_MS = 60_000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 60; // 60 requests/minute per IP
const CLEANUP_INTERVAL_MS = 2 * 60_000;
const MAX_STORE_SIZE = 100_000;

let lastCleanup = Date.now();

function cleanup(): void {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;

  const cutoff = now - WINDOW_MS * 2;
  for (const [key, entry] of store) {
    if (entry.windowStart < cutoff) {
      store.delete(key);
    }
  }

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

function extractIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded ? forwarded.split(",")[0].trim() : "unknown";
}

/**
 * Check API rate limit for a request. Returns null if allowed,
 * or a 429 response if the rate limit is exceeded.
 */
export function checkApiRateLimit(request: NextRequest): NextResponse | null {
  cleanup();

  const ip = extractIp(request);
  const key = `api:${ip}`;
  const now = Date.now();

  let entry = store.get(key);

  if (!entry || now - entry.windowStart > WINDOW_MS) {
    entry = { count: 0, windowStart: now };
  }

  entry.count++;
  store.set(key, entry);

  if (entry.count > MAX_REQUESTS_PER_WINDOW) {
    const retryAfter = Math.ceil((entry.windowStart + WINDOW_MS - now) / 1000);
    const response = NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429 },
    );
    response.headers.set("Retry-After", String(Math.max(1, retryAfter)));
    response.headers.set("X-RateLimit-Limit", String(MAX_REQUESTS_PER_WINDOW));
    response.headers.set("X-RateLimit-Remaining", "0");
    return response;
  }

  return null;
}

/**
 * Add rate limit headers to a successful response.
 */
export function addRateLimitHeaders(
  response: NextResponse,
  request: NextRequest,
): NextResponse {
  const ip = extractIp(request);
  const key = `api:${ip}`;
  const entry = store.get(key);

  if (entry) {
    const remaining = Math.max(0, MAX_REQUESTS_PER_WINDOW - entry.count);
    response.headers.set("X-RateLimit-Limit", String(MAX_REQUESTS_PER_WINDOW));
    response.headers.set("X-RateLimit-Remaining", String(remaining));
  }

  return response;
}
