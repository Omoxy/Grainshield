type LoginResult =
  | "SUCCESS"
  | "INVALID_CREDENTIALS"
  | "ACCOUNT_LOCKED"
  | "ACCOUNT_SUSPENDED"
  | "RATE_LIMITED";

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
const LOCKOUT_DURATIONS_MS = [
  60 * 1000,
  5 * 60 * 1000,
  15 * 60 * 1000,
  60 * 60 * 1000,
];
const SUSPICIOUS_WINDOW_MS = 24 * 60 * 60 * 1000;
const SUSPICIOUS_IP_THRESHOLD = 3;

async function getDb() {
  try {
    const { db } = await import("@/lib/db");
    return db;
  } catch {
    return null;
  }
}

export async function recordLoginAttempt(params: {
  identifier: string;
  ipAddress: string;
  userAgent?: string;
  result: LoginResult;
  userId?: string;
  failReason?: string;
}): Promise<void> {
  try {
    const db = await getDb();
    if (!db) {
      console.log(
        `[LOGIN] ${params.result} | ${params.identifier} | ip=${params.ipAddress}`,
      );
      return;
    }

    await db.loginAttempt.create({
      data: {
        identifier: params.identifier,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent ?? null,
        result: params.result as never,
        userId: params.userId ?? null,
        failReason: params.failReason ?? null,
      },
    });
  } catch (err) {
    console.error("[LOGIN TRACKER] Failed to record attempt:", err);
  }
}

export async function checkAccountLockout(
  identifier: string,
): Promise<{ locked: boolean; retryAfterSeconds: number }> {
  const db = await getDb();
  if (!db) return { locked: false, retryAfterSeconds: 0 };

  const windowStart = new Date(Date.now() - LOCKOUT_WINDOW_MS);

  const recentFailures = await db.loginAttempt.count({
    where: {
      identifier,
      result: "INVALID_CREDENTIALS",
      createdAt: { gte: windowStart },
    },
  });

  if (recentFailures < LOCKOUT_THRESHOLD) {
    return { locked: false, retryAfterSeconds: 0 };
  }

  const lockoutLevel = Math.min(
    Math.floor((recentFailures - LOCKOUT_THRESHOLD) / LOCKOUT_THRESHOLD),
    LOCKOUT_DURATIONS_MS.length - 1,
  );
  const lockoutMs = LOCKOUT_DURATIONS_MS[lockoutLevel];

  const lastFailure = await db.loginAttempt.findFirst({
    where: {
      identifier,
      result: "INVALID_CREDENTIALS",
      createdAt: { gte: windowStart },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!lastFailure) {
    return { locked: false, retryAfterSeconds: 0 };
  }

  const lockExpiresAt = lastFailure.createdAt.getTime() + lockoutMs;
  const now = Date.now();

  if (now < lockExpiresAt) {
    return {
      locked: true,
      retryAfterSeconds: Math.ceil((lockExpiresAt - now) / 1000),
    };
  }

  return { locked: false, retryAfterSeconds: 0 };
}

export async function detectSuspiciousLogin(params: {
  userId: string;
  ipAddress: string;
}): Promise<{ suspicious: boolean; reason?: string }> {
  const db = await getDb();
  if (!db) return { suspicious: false };

  const windowStart = new Date(Date.now() - SUSPICIOUS_WINDOW_MS);

  const recentLogins = await db.loginAttempt.findMany({
    where: {
      userId: params.userId,
      result: "SUCCESS",
      createdAt: { gte: windowStart },
    },
    select: { ipAddress: true },
    distinct: ["ipAddress"],
  });

  const uniqueIps = new Set(recentLogins.map((l: { ipAddress: string }) => l.ipAddress));
  uniqueIps.add(params.ipAddress);

  if (uniqueIps.size >= SUSPICIOUS_IP_THRESHOLD) {
    return {
      suspicious: true,
      reason: `Login from ${uniqueIps.size} distinct IPs in 24h`,
    };
  }

  return { suspicious: false };
}

export async function getLoginHistory(userId: string, limit = 20) {
  const db = await getDb();
  if (!db) return [];

  return db.loginAttempt.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      ipAddress: true,
      userAgent: true,
      result: true,
      createdAt: true,
    },
  });
}
