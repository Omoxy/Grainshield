import type { PriceRecord } from "./pricing-adapter";

interface CacheEntry {
  records: PriceRecord[];
  fetchedAt: number;
  expiresAt: number;
  hitCount: number;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const STALE_SERVE_TTL_MS = 15 * 60 * 1000;

const cacheStore = new Map<string, CacheEntry>();

export function getCached(key: string): PriceRecord[] | null {
  const entry = cacheStore.get(key);
  if (!entry) return null;

  if (Date.now() < entry.expiresAt) {
    entry.hitCount++;
    return entry.records;
  }

  if (Date.now() < entry.fetchedAt + STALE_SERVE_TTL_MS) {
    entry.hitCount++;
    return entry.records;
  }

  cacheStore.delete(key);
  return null;
}

export function isFresh(key: string): boolean {
  const entry = cacheStore.get(key);
  return !!entry && Date.now() < entry.expiresAt;
}

export function isStaleButServable(key: string): boolean {
  const entry = cacheStore.get(key);
  if (!entry) return false;
  return Date.now() >= entry.expiresAt && Date.now() < entry.fetchedAt + STALE_SERVE_TTL_MS;
}

export function setCache(key: string, records: PriceRecord[], ttlMs = DEFAULT_TTL_MS): void {
  cacheStore.set(key, {
    records,
    fetchedAt: Date.now(),
    expiresAt: Date.now() + ttlMs,
    hitCount: 0,
  });
}

export function invalidate(key: string): void {
  cacheStore.delete(key);
}

export function invalidateAll(): void {
  cacheStore.clear();
}

export function getCacheStats(): {
  keys: string[];
  totalEntries: number;
  freshCount: number;
  staleCount: number;
} {
  const keys = Array.from(cacheStore.keys());
  let freshCount = 0;
  let staleCount = 0;

  for (const key of keys) {
    if (isFresh(key)) freshCount++;
    else if (isStaleButServable(key)) staleCount++;
  }

  return { keys, totalEntries: keys.length, freshCount, staleCount };
}
