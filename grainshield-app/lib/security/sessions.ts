async function getDb() {
  try {
    const { db } = await import("@/lib/db");
    return db;
  } catch {
    return null;
  }
}

export async function createSession(params: {
  userId: string;
  jti: string;
  deviceInfo?: string;
  ipAddress?: string;
  userAgent?: string;
  ttlSeconds: number;
}): Promise<string> {
  const refreshToken = generateSecureToken();
  const db = await getDb();
  if (!db) return refreshToken;

  const expiresAt = new Date(Date.now() + params.ttlSeconds * 1000);

  await db.session.create({
    data: {
      userId: params.userId,
      refreshToken,
      jti: params.jti,
      deviceInfo: params.deviceInfo ?? null,
      ipAddress: params.ipAddress ?? null,
      userAgent: params.userAgent ?? null,
      expiresAt,
    },
  });

  return refreshToken;
}

export async function rotateSession(
  oldJti: string,
  newJti: string,
  ttlSeconds: number,
): Promise<string | null> {
  const db = await getDb();
  if (!db) return generateSecureToken();

  const session = await db.session.findUnique({ where: { jti: oldJti } });

  if (!session || session.revokedAt || session.expiresAt < new Date()) {
    if (session && !session.revokedAt) {
      await revokeAllUserSessions(session.userId, "stale_token_reuse");
    }
    return null;
  }

  const newRefreshToken = generateSecureToken();
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  await db.$transaction([
    db.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date(), revokeReason: "rotated" },
    }),
    db.session.create({
      data: {
        userId: session.userId,
        refreshToken: newRefreshToken,
        jti: newJti,
        deviceInfo: session.deviceInfo,
        ipAddress: session.ipAddress,
        userAgent: session.userAgent,
        expiresAt,
      },
    }),
  ]);

  return newRefreshToken;
}

export async function revokeSession(jti: string, reason: string): Promise<void> {
  const db = await getDb();
  if (!db) return;

  await db.session.updateMany({
    where: { jti, revokedAt: null },
    data: { revokedAt: new Date(), revokeReason: reason },
  });
}

export async function revokeAllUserSessions(
  userId: string,
  reason: string,
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const result = await db.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date(), revokeReason: reason },
  });
  return result.count;
}

export async function isSessionValid(jti: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return true; // Gracefully allow when DB unavailable

  const session = await db.session.findUnique({ where: { jti } });
  if (!session) return true; // No session tracking yet — allow
  if (session.revokedAt) return false;
  if (session.expiresAt < new Date()) return false;
  return true;
}

export async function getActiveSessions(userId: string) {
  const db = await getDb();
  if (!db) return [];

  return db.session.findMany({
    where: {
      userId,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { lastActiveAt: "desc" },
    select: {
      id: true,
      deviceInfo: true,
      ipAddress: true,
      lastActiveAt: true,
      createdAt: true,
    },
  });
}

export async function touchSession(jti: string): Promise<void> {
  const db = await getDb();
  if (!db) return;

  await db.session.updateMany({
    where: { jti, revokedAt: null },
    data: { lastActiveAt: new Date() },
  });
}

export async function cleanupExpiredSessions(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const result = await db.session.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: new Date() } },
        {
          AND: [
            { revokedAt: { not: null } },
            { revokedAt: { lt: sevenDaysAgo } },
          ],
        },
      ],
    },
  });
  return result.count;
}

function generateSecureToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
