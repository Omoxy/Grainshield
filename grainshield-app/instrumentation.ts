export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initializeOperationalSystem } = await import("@/lib/jobs/sync-orchestrator");
    initializeOperationalSystem().catch((err) => {
      console.error("[Instrumentation] Failed to initialize operational system:", err);
    });
  }
}
