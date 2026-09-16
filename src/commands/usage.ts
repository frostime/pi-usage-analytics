import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import {
  DEFAULT_DASHBOARD_VIEW,
  loadDashboardDefault,
  saveDashboardDefault,
  type DashboardViewSelection,
} from "../configuration/user-settings.ts";
import { openManageMenu, openStorageMenu, runCompact, runHistoryImport } from "../maintenance/manage.ts";
import type { UsageDatabase } from "../storage/usage-database.ts";
import {
  isValidDay,
  resolveRangeChoice,
  todayRange,
  type DayRange,
  type RangeChoice,
} from "../usage/calendar.ts";
import type { GroupBy, SummaryRow, UsageFilter } from "../usage/query.ts";
import {
  openDashboard,
  type DashboardAction,
  type DashboardNotice,
  type DashboardState,
} from "../ui/dashboard.ts";
import { displayDirectory } from "../ui/format.ts";

export interface UsageSubcommand {
  readonly name: string;
  /** One-line summary shown by argument completion. */
  readonly description: string;
  /** `/usage help` lines describing the actual interaction and its effects. */
  readonly details: readonly string[];
}

/** Canonical `/usage` subcommands, shared by argument completion and help. */
export const USAGE_SUBCOMMANDS: readonly UsageSubcommand[] = [
  {
    name: "save-default",
    description: "Save the current dashboard view as the default",
    details: [
      "Stores the range and grouping currently shown in this session as the default for future sessions.",
      "A filter applied with Enter is not part of the default.",
      "Requires the dashboard to have been opened first; interactive TUI only.",
    ],
  },
  {
    name: "import",
    description: "Import usage from Pi session history",
    details: [
      "Pick a range, then review a read-only scan report (file count and size) before anything is written.",
      "Backfills usage from Pi session JSONL files; already-recorded events are skipped, so re-running is safe.",
      "Requires a dialog-capable UI.",
    ],
  },
  {
    name: "compact",
    description: "Compress completed raw days into daily aggregates",
    details: [
      "Pick a cutoff (default: older than 30 days), review the affected days and row counts, then confirm.",
      "Per-message, per-session, and sub-day detail is deleted permanently; the current day is never compacted.",
      "The database file does not shrink until you reclaim space in /usage storage.",
    ],
  },
  {
    name: "storage",
    description: "Storage integrity, space reclaim, and reset",
    details: [
      "Opens a menu showing the database path, size, and row counts:",
      "- Integrity check runs SQLite's integrity check.",
      "- Reclaim unused DB space runs VACUUM; it can temporarily need extra disk space.",
      "- Reset all usage data deletes raw, daily, and dedup data after you type RESET;",
      "  timezone and dashboard defaults are kept.",
    ],
  },
  {
    name: "help",
    description: "Show usage help",
    details: ["Shows this text."],
  },
];

export function completeUsageSubcommands(prefix: string): AutocompleteItem[] | null {
  const query = prefix.trim().toLowerCase();
  const matches = USAGE_SUBCOMMANDS.filter((subcommand) => subcommand.name.startsWith(query));
  return matches.length === 0
    ? null
    : matches.map(({ name, description }) => ({ value: name, label: name, description }));
}

interface UsageCommandServices {
  openDashboard(ctx: ExtensionCommandContext, db: UsageDatabase, state: DashboardState): Promise<DashboardAction>;
  loadDashboardDefault(db: UsageDatabase): DashboardViewSelection;
  saveDashboardDefault(db: UsageDatabase, view: DashboardViewSelection): void;
  now(): number;
}

interface UsageCommandSession {
  view?: DashboardViewSelection;
}

export type UsageCommandHandler = (
  args: string,
  ctx: ExtensionCommandContext,
  db: UsageDatabase,
) => Promise<void>;

const DEFAULT_SERVICES: UsageCommandServices = {
  openDashboard,
  loadDashboardDefault,
  saveDashboardDefault,
  now: Date.now,
};

const RANGE_CHOICES: ReadonlyArray<{ label: string; choice: RangeChoice }> = [
  { label: "Today", choice: { kind: "today" } },
  { label: "Last 7 days", choice: { kind: "last-days", days: 7 } },
  { label: "Last 30 days", choice: { kind: "last-days", days: 30 } },
  { label: "This month", choice: { kind: "this-month" } },
  { label: "Previous month", choice: { kind: "previous-month" } },
  { label: "All time", choice: { kind: "all-time" } },
];

export function createUsageCommandHandler(
  serviceOverrides: Partial<UsageCommandServices> = {},
): UsageCommandHandler {
  const session: UsageCommandSession = {};
  const services = { ...DEFAULT_SERVICES, ...serviceOverrides };
  return (args, ctx, db) => handleUsageCommand(args, ctx, db, session, services);
}

async function handleUsageCommand(
  args: string,
  ctx: ExtensionCommandContext,
  db: UsageDatabase,
  session: UsageCommandSession,
  services: UsageCommandServices,
): Promise<void> {
  const command = args.trim().toLowerCase();
  if (command === "save-default") return saveCurrentViewAsDefault(ctx, db, session, services);

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

  if (ctx.mode !== "tui") {
    await services.openDashboard(ctx, db, {
      range: todayRange(services.now(), db.reportingTimezone),
      groupBy: DEFAULT_DASHBOARD_VIEW.groupBy,
    });
    return;
  }

  session.view ??= services.loadDashboardDefault(db);
  let state = dashboardState(db, session.view, services.now());

  while (true) {
    const action = await services.openDashboard(ctx, db, state);
    if (action.type === "close") return;
    if (action.type === "save-default") {
      const view = session.view;
      if (view) state = { ...state, notice: noticeForSave(saveViewDefault(db, view, services)) };
      continue;
    }

    // Any other interaction dismisses the previous save notice.
    state = { ...state, notice: undefined };

    if (action.type === "manage") {
      await openManageMenu(ctx, db);
      state = { ...state, range: resolveSelectionRange(db, session.view.range, services.now()) };
      continue;
    }
    if (action.type === "range") {
      const range = await chooseRange(ctx);
      if (range) {
        session.view = { ...session.view, range };
        state = { ...state, range: resolveSelectionRange(db, range, services.now()) };
      }
      continue;
    }
    if (action.type === "group") {
      const groupBy = await chooseGroup(ctx);
      if (groupBy) {
        session.view = { ...session.view, groupBy };
        state = { ...state, groupBy, filter: undefined, filterLabel: undefined };
      }
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

function saveCurrentViewAsDefault(
  ctx: ExtensionCommandContext,
  db: UsageDatabase,
  session: UsageCommandSession,
  services: UsageCommandServices,
): void {
  if (ctx.mode !== "tui") {
    ctx.ui.notify("/usage save-default is only available in the interactive TUI.", "error");
    return;
  }
  if (!session.view) {
    ctx.ui.notify("Open /usage and adjust the dashboard before saving its view as the default.", "warning");
    return;
  }

  const result = saveViewDefault(db, session.view, services);
  ctx.ui.notify(result.message, result.ok ? "info" : "error");
}

interface DefaultSaveResult {
  readonly ok: boolean;
  readonly message: string;
}

function saveViewDefault(
  db: UsageDatabase,
  view: DashboardViewSelection,
  services: UsageCommandServices,
): DefaultSaveResult {
  try {
    services.saveDashboardDefault(db, view);
    return { ok: true, message: "Saved as the default view for new sessions." };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `The default view was not saved: ${message}` };
  }
}

function noticeForSave(result: DefaultSaveResult): DashboardNotice {
  return { text: result.message, tone: result.ok ? "success" : "error" };
}

function dashboardState(db: UsageDatabase, view: DashboardViewSelection, nowMs: number): DashboardState {
  return {
    range: resolveSelectionRange(db, view.range, nowMs),
    groupBy: view.groupBy,
  };
}

function resolveSelectionRange(db: UsageDatabase, choice: RangeChoice, nowMs: number): DayRange {
  const availableDays = choice.kind === "all-time" ? db.getBounds() : undefined;
  return resolveRangeChoice(choice, nowMs, db.reportingTimezone, availableDays);
}

async function chooseRange(ctx: ExtensionCommandContext): Promise<RangeChoice | null> {
  const customLabel = "Custom…";
  const cancelLabel = "Cancel";
  const choice = await ctx.ui.select("Usage range", [
    ...RANGE_CHOICES.map((option) => option.label),
    customLabel,
    cancelLabel,
  ]);
  if (!choice || choice === cancelLabel) return null;

  const predefined = RANGE_CHOICES.find((option) => option.label === choice);
  if (predefined) return predefined.choice;

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
  return { kind: "custom", startDay, endDay };
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
  const lines = [
    "Pi Usage Analytics — local token/cost ledger",
    "",
    "/usage",
    "  Opens the interactive dashboard overlay.",
    "  Keys: ↑↓ select · Enter inspect · ←→ summary/timeline · r range · g group · s save default · m maintenance · q close",
    "  Range and grouping apply to this Pi session only; press s (or run /usage save-default) to keep them.",
    "  Outside the TUI it prints a one-off Today-by-model report and cannot save defaults.",
  ];
  for (const subcommand of USAGE_SUBCOMMANDS) {
    lines.push("", `/usage ${subcommand.name}`, ...subcommand.details.map((line) => `  ${line}`));
  }
  lines.push(
    "",
    "Nothing runs in the background: history scans, compaction, VACUUM, and reset happen only when invoked here.",
  );
  ctx.ui.notify(lines.join("\n"), "info");
}
