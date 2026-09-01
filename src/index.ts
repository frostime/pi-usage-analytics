import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getDatabasePath } from "./config.ts";
import { handleUsageCommand } from "./commands/usage.ts";
import { captureTurnUsage } from "./pi/capture.ts";
import { UsageDatabase } from "./storage/usage-database.ts";

export default function piUsageLedger(pi: ExtensionAPI): void {
  let database: UsageDatabase | null = null;
  let lastCaptureError = "";
  let lastCaptureErrorAt = 0;

  const getDb = (): UsageDatabase => {
    if (!database) database = new UsageDatabase(getDatabasePath());
    return database;
  };

  pi.on("turn_end", (event, ctx) => {
    try {
      captureTurnUsage(event, ctx, getDb());
    } catch (error) {
      notifyCaptureError(ctx, error);
    }
  });

  pi.on("session_shutdown", () => {
    database?.close();
    database = null;
  });

  pi.registerCommand("usage", {
    description: "Local token/cost usage analytics",
    handler: async (args, ctx) => {
      try {
        await handleUsageCommand(args, ctx, getDb());
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Pi Usage Ledger: ${message}`, "error");
      }
    },
  });

  function notifyCaptureError(ctx: ExtensionContext, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const now = Date.now();
    if (message === lastCaptureError && now - lastCaptureErrorAt < 60_000) return;
    lastCaptureError = message;
    lastCaptureErrorAt = now;
    ctx.ui.notify(`Pi Usage Ledger could not record this turn: ${message}`, "warning");
  }
}
