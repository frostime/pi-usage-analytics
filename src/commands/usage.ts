import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { UsageDatabase } from "../storage/usage-database.ts";
import {
  isValidDay,
  lastCalendarDaysRange,
  previousMonthRange,
  thisMonthRange,
  todayRange,
  type DayRange,
} from "../usage/calendar.ts";
import type { GroupBy, SummaryRow, UsageFilter } from "../usage/query.ts";
import { openDashboard, type DashboardState } from "../ui/dashboard.ts";
import { displayDirectory } from "../ui/format.ts";
import { openManageMenu, openStorageMenu, runCompact, runHistoryImport } from "../maintenance/manage.ts";

export async function handleUsageCommand(args: string, ctx: ExtensionCommandContext, db: UsageDatabase): Promise<void> {
  const command = args.trim().toLowerCase();
  if (command === "import" || command === "compact" || command === "compress" || command === "storage") {
    if (!ctx.hasUI) {
      ctx.ui.notify(`/${command === "compress" ? "usage compact" : `usage ${command}`} requires dialog-capable UI.`, "error");
      return;
    }
  }
  if (command === "import") return runHistoryImport(ctx, db);
  if (command === "compact" || command === "compress") return runCompact(ctx, db);
  if (command === "storage") return openStorageMenu(ctx, db);
  if (command === "help") return showHelp(ctx);
  if (command) {
    ctx.ui.notify(`Unknown /usage subcommand: ${args.trim()}\nRun /usage help for available commands.`, "error");
    return;
  }

  let state: DashboardState = {
    range: todayRange(Date.now(), db.reportingTimezone),
    groupBy: "model",
  };

  while (true) {
    const action = await openDashboard(ctx, db, state);
    if (action.type === "close") return;
    if (action.type === "manage") {
      if (!ctx.hasUI) {
        ctx.ui.notify("Usage maintenance requires an interactive UI. Use /usage import, /usage compact, or /usage storage.", "warning");
        return;
      }
      await openManageMenu(ctx, db);
      continue;
    }
    if (action.type === "range") {
      if (!ctx.hasUI) return;
      const range = await chooseRange(ctx, db);
      if (range) state = { ...state, range };
      continue;
    }
    if (action.type === "group") {
      if (!ctx.hasUI) return;
      const groupBy = await chooseGroup(ctx);
      if (groupBy) state = { ...state, groupBy, filter: undefined, filterLabel: undefined };
      continue;
    }
    if (action.type === "inspect") {
      const filter = filterFromRow(state.groupBy, action.row);
      state = { ...state, filter, filterLabel: labelFromRow(state.groupBy, action.row) };
      continue;
    }
    if (action.type === "clear-filter") {
      state = { ...state, filter: undefined, filterLabel: undefined };
    }
  }
}

async function chooseRange(ctx: ExtensionCommandContext, db: UsageDatabase): Promise<DayRange | null> {
  const choice = await ctx.ui.select("Usage range", [
    "Today",
    "Last 7 days",
    "Last 30 days",
    "This month",
    "Previous month",
    "All time",
    "Custom…",
    "Cancel",
  ]);
  if (!choice || choice === "Cancel") return null;
  const now = Date.now();
  if (choice === "Today") return todayRange(now, db.reportingTimezone);
  if (choice === "Last 7 days") return lastCalendarDaysRange(7, now, db.reportingTimezone);
  if (choice === "Last 30 days") return lastCalendarDaysRange(30, now, db.reportingTimezone);
  if (choice === "This month") return thisMonthRange(now, db.reportingTimezone);
  if (choice === "Previous month") return previousMonthRange(now, db.reportingTimezone);
  if (choice === "All time") {
    const bounds = db.getBounds();
    const today = todayRange(now, db.reportingTimezone).endDay;
    return {
      startDay: bounds.startDay ?? today,
      endDay: bounds.endDay ?? today,
      label: "All time",
    };
  }

  const start = await ctx.ui.input("Custom range · start", "YYYY-MM-DD");
  if (!start) return null;
  const end = await ctx.ui.input("Custom range · end", "YYYY-MM-DD");
  if (!end) return null;
  const startDay = start.trim();
  const endDay = end.trim();
  if (!isValidDay(startDay) || !isValidDay(endDay) || startDay > endDay) {
    ctx.ui.notify("Invalid range. Use YYYY-MM-DD and make sure start ≤ end.", "error");
    return null;
  }
  return { startDay, endDay, label: `${startDay} → ${endDay}` };
}

async function chooseGroup(ctx: ExtensionCommandContext): Promise<GroupBy | null> {
  const choice = await ctx.ui.select("Group usage by", ["Provider / Model", "Provider", "Directory", "Cancel"]);
  if (!choice || choice === "Cancel") return null;
  if (choice === "Provider") return "provider";
  if (choice === "Directory") return "directory";
  return "model";
}

function filterFromRow(groupBy: GroupBy, row: SummaryRow): UsageFilter {
  if (groupBy === "provider") return { provider: row.provider ?? row.key };
  if (groupBy === "directory") return { cwd: row.cwd ?? row.key };
  return { provider: row.provider ?? undefined, model: row.model ?? undefined };
}

function labelFromRow(groupBy: GroupBy, row: SummaryRow): string {
  return groupBy === "directory" ? displayDirectory(row.cwd ?? row.key) : row.key;
}

function showHelp(ctx: ExtensionCommandContext): void {
  ctx.ui.notify(
    [
      "Pi Usage Ledger",
      "",
      "/usage           Open the interactive dashboard",
      "/usage import    Manually scan Pi session history",
      "/usage compact   Compress completed raw days into daily aggregates",
      "/usage storage   Storage, integrity, VACUUM, reset",
      "/usage help      Show this help",
      "",
      "No history scan or compaction runs in the background.",
    ].join("\n"),
    "info",
  );
}
