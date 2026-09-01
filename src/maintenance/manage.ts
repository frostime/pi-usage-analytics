import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { isAbsolute, relative, resolve } from "node:path";
import { getDefaultSessionRoot } from "../config.ts";
import type { UsageDatabase } from "../storage/usage-database.ts";
import { addDays, isValidDay, localDayFromEpochMs } from "../usage/calendar.ts";
import { discoverHistory, importHistory } from "./history-reader.ts";
import { formatBytes, plural } from "../ui/format.ts";

export async function openManageMenu(ctx: ExtensionCommandContext, db: UsageDatabase): Promise<void> {
  while (true) {
    const choice = await ctx.ui.select("Pi Usage · Manage", [
      "Import history…",
      "Compress history…",
      "Storage & integrity…",
      "Back",
    ]);
    if (!choice || choice === "Back") return;
    if (choice === "Import history…") await runHistoryImport(ctx, db);
    if (choice === "Compress history…") await runCompact(ctx, db);
    if (choice === "Storage & integrity…") await openStorageMenu(ctx, db);
  }
}

export async function runHistoryImport(ctx: ExtensionCommandContext, db: UsageDatabase): Promise<void> {
  const range = await ctx.ui.select("Import Pi history", ["Last 30 days", "All history", "Since a date…", "Cancel"]);
  if (!range || range === "Cancel") return;

  let sinceDay: string | undefined;
  if (range === "Last 30 days") {
    const today = localDayFromEpochMs(Date.now(), db.reportingTimezone);
    sinceDay = addDays(today, -29);
  } else if (range === "Since a date…") {
    const input = await ctx.ui.input("Import since", "YYYY-MM-DD");
    if (!input) return;
    if (!isValidDay(input.trim())) {
      ctx.ui.notify("Invalid date. Use YYYY-MM-DD.", "error");
      return;
    }
    sinceDay = input.trim();
  }

  const root = historyRootForContext(ctx);
  ctx.ui.setStatus("usage-analytics", "discovering history…");
  let discovery;
  try {
    discovery = await discoverHistory(root, { sinceDay, timeZone: db.reportingTimezone });
  } finally {
    ctx.ui.setStatus("usage-analytics", undefined);
  }
  if (discovery.files.length === 0) {
    ctx.ui.notify(`No Pi session JSONL files found under ${root}`, "warning");
    return;
  }

  const confirmed = await ctx.ui.confirm(
    "Import Pi history",
    `${plural(discovery.files.length, "file")} · ${formatBytes(discovery.bytes)}\n` +
      `${sinceDay ? `Only usage on/after ${sinceDay}.` : "All attributable assistant usage."}\n` +
      "Read-only scan; already known events are skipped.",
  );
  if (!confirmed) return;

  const result = await importHistory(db, discovery, { sinceDay }, (progress) => {
    if (progress.filesDone % 10 === 0 || progress.filesDone === progress.filesTotal) {
      ctx.ui.setStatus(
        "usage-analytics",
        `import ${progress.filesDone}/${progress.filesTotal} · +${progress.imported} · skip ${progress.skipped}`,
      );
    }
  }).finally(() => ctx.ui.setStatus("usage-analytics", undefined));

  ctx.ui.notify(
    `History import complete: ${result.imported} new, ${result.skipped} already known, ${result.malformed} malformed lines skipped.`,
    "info",
  );
}

export async function runCompact(ctx: ExtensionCommandContext, db: UsageDatabase): Promise<void> {
  const today = localDayFromEpochMs(Date.now(), db.reportingTimezone);
  const choice = await ctx.ui.select("Compress raw usage history", [
    "Older than 30 days (recommended)",
    "Older than 7 days",
    "All completed days",
    "Before a date…",
    "Cancel",
  ]);
  if (!choice || choice === "Cancel") return;

  let cutoffExclusive: string;
  if (choice === "Older than 30 days (recommended)") cutoffExclusive = addDays(today, -29);
  else if (choice === "Older than 7 days") cutoffExclusive = addDays(today, -6);
  else if (choice === "All completed days") cutoffExclusive = today;
  else {
    const input = await ctx.ui.input("Compress before", "YYYY-MM-DD (date itself is kept)");
    if (!input) return;
    const trimmed = input.trim();
    if (!isValidDay(trimmed)) {
      ctx.ui.notify("Invalid date. Use YYYY-MM-DD.", "error");
      return;
    }
    cutoffExclusive = trimmed;
  }

  if (cutoffExclusive > today) {
    ctx.ui.notify("The current natural day is never compressed.", "warning");
    cutoffExclusive = today;
  }

  const preview = db.previewCompact(cutoffExclusive);
  if (preview.rawEvents === 0) {
    ctx.ui.notify("No eligible raw events to compress.", "info");
    return;
  }

  const confirmed = await ctx.ui.confirm(
    "Compress history",
    [
      `${preview.oldestDay} → ${preview.newestDay}`,
      `${plural(preview.days, "completed day")}`,
      `${preview.rawEvents} raw events → ${preview.aggregateRows} daily provider/model/directory rows`,
      "",
      "Preserved: day/week/month totals, provider/model/directory breakdown, token buckets, cost, turn count, import dedup.",
      "Lost: individual-message, session-level, and sub-day detail for compressed events.",
      "",
      "This information loss is irreversible. Continue?",
    ].join("\n"),
  );
  if (!confirmed) return;

  const result = db.compactBefore(cutoffExclusive, (day, completed, total) => {
    ctx.ui.setStatus("usage-analytics", `compress ${completed}/${total} · ${day}`);
  });
  ctx.ui.setStatus("usage-analytics", undefined);
  ctx.ui.notify(
    `Compressed ${result.daysCompacted} days; removed ${result.rawEventsRemoved} raw events. SQLite file size may not shrink until space is reclaimed.`,
    "info",
  );
}

export async function openStorageMenu(ctx: ExtensionCommandContext, db: UsageDatabase): Promise<void> {
  while (true) {
    const stats = db.getStorageStats();
    const title = [
      "Pi Usage · Storage",
      `DB ${stats.databasePath}`,
      `Size ${formatBytes(stats.bytesOnDisk)} · raw ${stats.rawEvents} · daily ${stats.dailyRows} · seen ${stats.seenEvents}`,
      `Timezone ${stats.reportingTimezone}`,
    ].join("\n");
    const choice = await ctx.ui.select(title, ["Integrity check", "Reclaim unused DB space", "Reset all usage data", "Back"]);
    if (!choice || choice === "Back") return;

    if (choice === "Integrity check") {
      const result = db.integrityCheck();
      ctx.ui.notify(result === "ok" ? "SQLite integrity check: ok" : `SQLite integrity check:\n${result}`, result === "ok" ? "info" : "error");
    }

    if (choice === "Reclaim unused DB space") {
      const confirmed = await ctx.ui.confirm(
        "Reclaim unused DB space",
        "VACUUM rewrites the SQLite database and can temporarily require additional disk space. Run it now?",
      );
      if (confirmed) {
        ctx.ui.setStatus("usage-analytics", "vacuuming database…");
        try {
          db.vacuum();
          ctx.ui.notify(`Database compacted. Current footprint: ${formatBytes(db.getStorageStats().bytesOnDisk)}`, "info");
        } finally {
          ctx.ui.setStatus("usage-analytics", undefined);
        }
      }
    }

    if (choice === "Reset all usage data") {
      const first = await ctx.ui.confirm(
        "Reset all usage data",
        "Delete raw events, daily aggregates, and dedup history? Reporting timezone is kept.",
      );
      if (!first) continue;
      const typed = await ctx.ui.input("Type RESET to confirm", "RESET");
      if (typed !== "RESET") {
        ctx.ui.notify("Reset cancelled.", "info");
        continue;
      }
      db.resetUsageData();
      ctx.ui.notify("All usage data deleted.", "info");
    }
  }
}

function historyRootForContext(ctx: ExtensionCommandContext): string {
  const defaultRoot = resolve(getDefaultSessionRoot());
  const currentSessionDir = resolve(ctx.sessionManager.getSessionDir());
  const rel = relative(defaultRoot, currentSessionDir);
  const currentIsInsideDefaultRoot = rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  return currentIsInsideDefaultRoot ? defaultRoot : currentSessionDir;
}
