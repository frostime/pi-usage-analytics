import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { UsageDatabase } from "../storage/usage-database.ts";
import type { DayRange } from "../usage/calendar.ts";
import type { GroupBy, SummaryRow, UsageFilter, UsageReport } from "../usage/query.ts";
import { displayDirectory, formatCost, formatTokens } from "./format.ts";

export type DashboardAction =
  | { type: "close" }
  | { type: "range" }
  | { type: "group" }
  | { type: "manage" }
  | { type: "inspect"; row: SummaryRow }
  | { type: "clear-filter" };

export interface DashboardState {
  range: DayRange;
  groupBy: GroupBy;
  filter?: UsageFilter;
  filterLabel?: string;
}

interface ThemeLike {
  fg(name: string, text: string): string;
  bold(text: string): string;
}

export async function openDashboard(
  ctx: ExtensionCommandContext,
  db: UsageDatabase,
  state: DashboardState,
): Promise<DashboardAction> {
  const report = db.query({ range: state.range, groupBy: state.groupBy, filter: state.filter });

  if (ctx.mode !== "tui") {
    ctx.ui.notify(renderPlainReport(report, state).join("\n"), "info");
    return { type: "close" };
  }

  return ctx.ui.custom<DashboardAction>((tui, theme, _keybindings, done) => {
    let view: "summary" | "timeline" = state.filter ? "timeline" : "summary";
    let selected = 0;
    let scrollOffset = 0;

    const refresh = () => tui.requestRender();

    return {
      render(width: number): string[] {
        const lines: string[] = [];
        const innerWidth = Math.max(24, width);
        const title = state.filterLabel ? `Pi Usage · ${state.filterLabel}` : "Pi Usage";
        lines.push(theme.fg("accent", theme.bold(truncateToWidth(title, innerWidth))));
        lines.push(
          theme.fg(
            "dim",
            truncateToWidth(`${state.range.label} · ${groupLabel(state.groupBy)} · ${db.reportingTimezone}`, innerWidth),
          ),
        );
        lines.push("");
        lines.push(...renderTotals(report, theme, innerWidth));
        lines.push("");

        if (view === "summary") {
          lines.push(theme.fg("accent", theme.bold("Summary")) + theme.fg("dim", "   ←→ Timeline"));
          lines.push(...renderSummary(report.summary, state.groupBy, selected, scrollOffset, theme, innerWidth));
        } else {
          lines.push(theme.fg("accent", theme.bold("Timeline")) + theme.fg("dim", "   ←→ Summary"));
          lines.push(...renderTimeline(report, theme, innerWidth));
        }

        lines.push("");
        const hints = state.filter
          ? "esc back · r range · m manage · q close"
          : view === "summary"
            ? "↑↓ select · enter inspect · ←→ view · r range · g group · m manage · q close"
            : "←→ view · r range · g group · m manage · q close";
        lines.push(theme.fg("dim", truncateToWidth(hints, innerWidth)));
        return lines;
      },
      invalidate() {},
      handleInput(data: string): void {
        if (matchesKey(data, Key.escape)) {
          done(state.filter ? { type: "clear-filter" } : { type: "close" });
          return;
        }
        if (data === "q" || data === "Q") {
          done({ type: "close" });
          return;
        }
        if (data === "r" || data === "R") {
          done({ type: "range" });
          return;
        }
        if (data === "g" || data === "G") {
          done({ type: "group" });
          return;
        }
        if (data === "m" || data === "M") {
          done({ type: "manage" });
          return;
        }
        if (matchesKey(data, Key.left) || matchesKey(data, Key.right)) {
          view = view === "summary" ? "timeline" : "summary";
          refresh();
          return;
        }
        if (view !== "summary" || state.filter || report.summary.length === 0) return;
        if (matchesKey(data, Key.up)) {
          selected = Math.max(0, selected - 1);
          if (selected < scrollOffset) scrollOffset = selected;
          refresh();
          return;
        }
        if (matchesKey(data, Key.down)) {
          selected = Math.min(report.summary.length - 1, selected + 1);
          if (selected >= scrollOffset + 12) scrollOffset = selected - 11;
          refresh();
          return;
        }
        if (matchesKey(data, Key.enter)) {
          done({ type: "inspect", row: report.summary[selected] });
        }
      },
    };
  });
}

function renderTotals(report: UsageReport, theme: ThemeLike, width: number): string[] {
  const t = report.totals;
  const line = [
    `Cost ${formatCost(t.cost)}`,
    `Input ${formatTokens(t.input)}`,
    `Cache read ${formatTokens(t.cacheRead)}`,
    `Output ${formatTokens(t.output)}`,
    `Turns ${t.turns}`,
  ].join("  ·  ");
  return [truncateToWidth(line, width)];
}

function renderSummary(
  rows: SummaryRow[],
  groupBy: GroupBy,
  selected: number,
  offset: number,
  theme: ThemeLike,
  width: number,
): string[] {
  if (rows.length === 0) return [theme.fg("muted", "No usage recorded for this range.")];
  const labelWidth = Math.max(12, Math.min(42, width - 45));
  const header = rowLine(groupLabel(groupBy), "Input", "Cache", "Output", "Cost", labelWidth);
  const lines = [theme.fg("dim", truncateToWidth(header, width))];
  const visible = rows.slice(offset, offset + 12);
  visible.forEach((row, localIndex) => {
    const index = offset + localIndex;
    const label = groupBy === "directory" ? displayDirectory(row.key) : row.key;
    const text = rowLine(
      label,
      formatTokens(row.input),
      formatTokens(row.cacheRead),
      formatTokens(row.output),
      formatCost(row.cost),
      labelWidth,
    );
    lines.push(index === selected ? theme.fg("accent", `> ${truncateToWidth(text, width - 2)}`) : `  ${truncateToWidth(text, width - 2)}`);
  });
  if (rows.length > 12) lines.push(theme.fg("dim", `${offset + 1}-${Math.min(rows.length, offset + 12)} / ${rows.length}`));
  return lines;
}

function renderTimeline(report: UsageReport, theme: ThemeLike, width: number): string[] {
  if (report.timeline.length === 0) return [theme.fg("muted", "No usage recorded for this range.")];
  const labelWidth = 12;
  const lines = [theme.fg("dim", truncateToWidth(rowLine("Date", "Input", "Cache", "Output", "Cost", labelWidth), width))];
  const rows = report.timeline.slice(-18);
  for (const row of rows) {
    lines.push(
      truncateToWidth(
        rowLine(
          row.day,
          formatTokens(row.input),
          formatTokens(row.cacheRead),
          formatTokens(row.output),
          formatCost(row.cost),
          labelWidth,
        ),
        width,
      ),
    );
  }
  if (report.timeline.length > rows.length) {
    lines.push(theme.fg("dim", `Showing latest ${rows.length} of ${report.timeline.length} days`));
  }
  return lines;
}

function rowLine(label: string, input: string, cache: string, output: string, cost: string, labelWidth: number): string {
  return [fit(label, labelWidth), leftPad(input, 9), leftPad(cache, 9), leftPad(output, 9), leftPad(cost, 10)].join(" ");
}

function fit(value: string, width: number): string {
  const shortened = truncateToWidth(value, width, "…");
  return shortened + " ".repeat(Math.max(0, width - visibleWidth(shortened)));
}

function leftPad(value: string, width: number): string {
  return " ".repeat(Math.max(0, width - visibleWidth(value))) + value;
}

function groupLabel(groupBy: GroupBy): string {
  if (groupBy === "provider") return "Provider";
  if (groupBy === "directory") return "Directory";
  return "Provider / Model";
}

function renderPlainReport(report: UsageReport, state: DashboardState): string[] {
  const lines = [`Pi Usage · ${state.range.label} · ${dbSafeLabel(state.groupBy)}`];
  lines.push(
    `Cost ${formatCost(report.totals.cost)} · Input ${formatTokens(report.totals.input)} · Cache read ${formatTokens(report.totals.cacheRead)} · Output ${formatTokens(report.totals.output)}`,
  );
  for (const row of report.summary.slice(0, 20)) {
    lines.push(`${row.key}: ${formatTokens(row.input)} in · ${formatTokens(row.cacheRead)} cache · ${formatTokens(row.output)} out · ${formatCost(row.cost)}`);
  }
  return lines;
}

function dbSafeLabel(groupBy: GroupBy): string {
  return groupBy === "directory" ? "by directory" : groupBy === "provider" ? "by provider" : "by model";
}
