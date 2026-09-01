import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getDatabasePath } from "./config.ts";
import { handleUsageCommand } from "./commands/usage.ts";
import { RealtimeUsageBuffer } from "./ingestion/realtime-buffer.ts";
import { captureTurnUsage } from "./pi/capture.ts";
import { UsageDatabase } from "./storage/usage-database.ts";

export default function piUsageAnalytics(pi: ExtensionAPI): void {
  let database: UsageDatabase | null = null;
  const realtime = new RealtimeUsageBuffer();
  let lastCaptureError = "";
  let lastCaptureErrorAt = 0;

  const getDb = (): UsageDatabase => {
    if (!database) database = new UsageDatabase(getDatabasePath());
    return database;
  };

  pi.on("turn_end", (event, ctx) => {
    try {
      const fact = captureTurnUsage(event, ctx);
      if (!fact) return;
      const result = realtime.push(fact);
      if (result.dropped > 0) {
        notifyCaptureError(
          ctx,
          new Error("realtime buffer reached its limit; oldest pending usage will require /usage import to recover"),
        );
      }
    } catch (error) {
      notifyCaptureError(ctx, error);
    }
  });

  pi.on("agent_settled", (_event, ctx) => {
    flushRealtime(ctx);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (realtime.size > 0) flushRealtime(ctx);
    database?.close();
    database = null;
  });

  pi.registerCommand("usage", {
    description: "Local token/cost usage analytics",
    handler: async (args, ctx) => {
      try {
        flushRealtime(ctx);
        await handleUsageCommand(args, ctx, getDb());
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Pi Usage Analytics: ${message}`, "error");
      }
    },
  });

  function flushRealtime(ctx: ExtensionContext): void {
    if (realtime.size === 0) return;
    try {
      // SQLITE_BUSY is an expected eventual-consistency case. The buffer keeps
      // pending facts for the next settled/command/shutdown flush opportunity.
      realtime.flush(getDb());
    } catch (error) {
      notifyCaptureError(ctx, error);
    }
  }

  function notifyCaptureError(ctx: ExtensionContext, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const now = Date.now();
    if (message === lastCaptureError && now - lastCaptureErrorAt < 60_000) return;
    lastCaptureError = message;
    lastCaptureErrorAt = now;
    ctx.ui.notify(`Pi Usage Analytics could not record recent usage: ${message}`, "warning");
  }
}
