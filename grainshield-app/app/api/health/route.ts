import { NextResponse } from "next/server";
import { getPlatformHealth } from "@/lib/services/resilience";
import { assessConfidence } from "@/lib/services/data-confidence";
import { validateEnvironment } from "@/lib/env-validation";

export async function GET() {
  const start = Date.now();

  try {
    const [platform, confidence, envErrors, dbHealth, queueHealth] = await Promise.allSettled([
      Promise.resolve(getPlatformHealth()),
      Promise.resolve(assessConfidence()),
      Promise.resolve(validateEnvironment()),
      checkDatabaseConnection(),
      checkQueueHealth(),
    ]);

    const envErrs = envErrors.status === "fulfilled" ? envErrors.value : ["check failed"];
    const dbHealthy = dbHealth.status === "fulfilled" ? dbHealth.value : { connected: false, latencyMs: -1 };
    const queueOk = queueHealth.status === "fulfilled" ? queueHealth.value : false;

    const isHealthy = dbHealthy.connected && envErrs.length === 0;

    return NextResponse.json(
      {
        status: isHealthy ? "healthy" : "degraded",
        platform: platform.status === "fulfilled" ? platform.value : null,
        dataConfidence: confidence.status === "fulfilled" ? confidence.value : null,
        environment: {
          valid: envErrs.length === 0,
          errors: process.env.NODE_ENV === "production" ? envErrs.length : envErrs,
        },
        database: dbHealthy,
        queues: { operational: queueOk },
        responseTimeMs: Date.now() - start,
        timestamp: new Date().toISOString(),
        version: process.env.APP_VERSION ?? "0.1.0",
        region: "KE-UG/TN",
      },
      { status: isHealthy ? 200 : 503 }
    );
  } catch (err) {
    console.error("[API] Health check error:", err);
    return NextResponse.json(
      {
        status: "error",
        responseTimeMs: Date.now() - start,
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

async function checkDatabaseConnection(): Promise<{
  connected: boolean;
  latencyMs: number;
}> {
  const start = Date.now();
  try {
    const { db } = await import("@/lib/db");
    await db.$queryRaw`SELECT 1`;
    return { connected: true, latencyMs: Date.now() - start };
  } catch {
    return { connected: false, latencyMs: Date.now() - start };
  }
}

async function checkQueueHealth(): Promise<boolean> {
  try {
    const { getKycReviewQueue } = await import("@/lib/services/operational-queues");
    const queue = await getKycReviewQueue();
    return queue !== null;
  } catch {
    return true;
  }
}
