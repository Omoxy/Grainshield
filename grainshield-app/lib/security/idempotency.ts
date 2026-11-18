import { NextResponse } from "next/server";

const DEFAULT_TTL_HOURS = 24;

async function getDb() {
  try {
    const { db } = await import("@/lib/db");
    return db;
  } catch {
    return null;
  }
}

export async function checkIdempotency(
  key: string,
): Promise<{ duplicate: true; response: NextResponse } | { duplicate: false }> {
  if (!key || key.length > 256) {
    return { duplicate: false };
  }

  const db = await getDb();
  if (!db) return { duplicate: false };

  const existing = await db.idempotencyKey.findUnique({ where: { key } });

  if (existing && existing.expiresAt > new Date()) {
    if (existing.response && existing.statusCode) {
      const cached = JSON.parse(existing.response);
      return {
        duplicate: true,
        response: NextResponse.json(cached, { status: existing.statusCode }),
      };
    }
    return {
      duplicate: true,
      response: NextResponse.json(
        { error: "Request already processing" },
        { status: 409 },
      ),
    };
  }

  if (existing) {
    await db.idempotencyKey.delete({ where: { key } });
  }

  await db.idempotencyKey.create({
    data: {
      key,
      expiresAt: new Date(Date.now() + DEFAULT_TTL_HOURS * 60 * 60 * 1000),
    },
  });

  return { duplicate: false };
}

export async function saveIdempotencyResponse(
  key: string,
  body: unknown,
  statusCode: number,
): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;

    await db.idempotencyKey.update({
      where: { key },
      data: {
        response: JSON.stringify(body),
        statusCode,
      },
    });
  } catch {
    // Key may have expired or been cleaned up
  }
}

export async function cleanupExpiredKeys(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const result = await db.idempotencyKey.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return result.count;
}
