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

  return ctx.ui.custom<DashboardAction>(
    (tui, theme, _keybindings, done) => {
      let view: "summary" | "timeline" = state.filter ? "timeline" : "summary";
      let selected = 0;
      let scrollOffset = 0;

      const refresh = () => tui.requestRender();

      return {
        render(width: number): string[] {
          const pageSize = dashboardPageSize(tui.terminal.rows);
          if (selected < scrollOffset) scrollOffset = selected;
          if (selected >= scrollOffset + pageSize) scrollOffset = Math.max(0, selected - pageSize + 1);

          return renderOverlayPanel({
            report,
            state,
            view,
            selected,
            scrollOffset,
            pageSize,
            theme,
            width,
            reportingTimezone: db.reportingTimezone,
          });
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
            refresh();
            return;
          }
          if (matchesKey(data, Key.down)) {
            selected = Math.min(report.summary.length - 1, selected + 1);
            refresh();
            return;
          }
          if (matchesKey(data, Key.enter)) {
            done({ type: "inspect", row: report.summary[selected] });
          }
        },
      };
    },
    {
      overlay: true,
      overlayOptions: {
        anchor: "center",
        width: "88%",
        minWidth: 58,
        maxHeight: "84%",
        margin: 1,
      },
    },
  );
}

interface OverlayRenderInput {
  report: UsageReport;
  state: DashboardState;
  view: "summary" | "timeline";
  selected: number;
  scrollOffset: number;
  pageSize: number;
  theme: ThemeLike;
  width: number;
  reportingTimezone: string;
}

export function renderOverlayPanel(input: OverlayRenderInput): string[] {
  const { report, state, view, selected, scrollOffset, pageSize, theme, reportingTimezone } = input;
  const width = Math.max(4, input.width);
  const innerWidth = Math.max(1, width - 2);
  const body: string[] = [];

  const context = state.filterLabel ? `${state.filterLabel} · ${state.range.label}` : `${state.range.label} · ${groupLabel(state.groupBy)}`;
  body.push(joinSides(theme.bold("Pi Usage Analytics"), theme.fg("dim", context), innerWidth));
  body.push(theme.fg("dim", truncateToWidth(`${reportingTimezone} · ${report.totals.turns} turns`, innerWidth)));
  body.push(rule(theme, innerWidth));
  body.push(...renderMetricStrip(report, theme, innerWidth));
  body.push(rule(theme, innerWidth));
  body.push(renderTabs(view, theme, innerWidth));

  if (view === "summary") {
    body.push(...renderSummary(report.summary, state.groupBy, selected, scrollOffset, pageSize, theme, innerWidth));
  } else {
    body.push(...renderTimeline(report, pageSize, theme, innerWidth));
  }

  body.push(rule(theme, innerWidth));
  body.push(theme.fg("dim", truncateToWidth(renderHints(state, view), innerWidth)));

  return frame(body, theme, width);
}

function dashboardPageSize(terminalRows: number): number {
  const overlayHeight = Math.max(12, Math.floor(terminalRows * 0.84));
  return Math.max(3, Math.min(14, overlayHeight - 11));
}

function renderMetricStrip(report: UsageReport, theme: ThemeLike, width: number): string[] {
  const t = report.totals;
  const metrics = [
    theme.fg("accent", theme.bold(formatCost(t.cost))) + theme.fg("dim", " cost"),
    theme.bold(formatTokens(t.input)) + theme.fg("dim", " input"),
    theme.bold(formatTokens(t.cacheRead)) + theme.fg("dim", " cache"),
    theme.bold(formatTokens(t.output)) + theme.fg("dim", " output"),
  ];

  const oneLine = metrics.join(theme.fg("dim", "   │   "));
  if (visibleWidth(oneLine) <= width) return [oneLine];

  return [
    metrics.slice(0, 2).join(theme.fg("dim", "   │   ")),
    metrics.slice(2).join(theme.fg("dim", "   │   ")),
  ];
}

function renderTabs(view: "summary" | "timeline", theme: ThemeLike, width: number): string {
  const summary = view === "summary" ? theme.fg("accent", theme.bold("● Summary")) : theme.fg("dim", "○ Summary");
  const timeline = view === "timeline" ? theme.fg("accent", theme.bold("● Timeline")) : theme.fg("dim", "○ Timeline");
  return truncateToWidth(`${summary}    ${timeline}`, width);
}

function renderSummary(
  rows: SummaryRow[],
  groupBy: GroupBy,
  selected: number,
  offset: number,
  pageSize: number,
  theme: ThemeLike,
  width: number,
): string[] {
  if (rows.length === 0) return [theme.fg("muted", "No usage recorded for this range.")];

  const labelWidth = Math.max(12, Math.min(42, width - 43));
  const header = rowLine(groupLabel(groupBy), "Input", "Cache", "Output", "Cost", labelWidth);
  const lines = [theme.fg("dim", truncateToWidth(header, width))];
  const visible = rows.slice(offset, offset + pageSize);

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
    const clipped = truncateToWidth(text, Math.max(1, width - 2));
    lines.push(index === selected ? theme.fg("accent", `› ${clipped}`) : `  ${clipped}`);
  });

  if (rows.length > pageSize) {
    lines.push(theme.fg("dim", joinSides(`Rows ${offset + 1}–${Math.min(rows.length, offset + pageSize)}`, `${rows.length} total`, width)));
  }
  return lines;
}

function renderTimeline(report: UsageReport, pageSize: number, theme: ThemeLike, width: number): string[] {
  if (report.timeline.length === 0) return [theme.fg("muted", "No usage recorded for this range.")];
  const labelWidth = 12;
  const lines = [theme.fg("dim", truncateToWidth(rowLine("Date", "Input", "Cache", "Output", "Cost", labelWidth), width))];
  const rows = report.timeline.slice(-pageSize);
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
    lines.push(theme.fg("dim", `Latest ${rows.length} of ${report.timeline.length} days`));
  }
  return lines;
}

function frame(lines: string[], theme: ThemeLike, width: number): string[] {
  const innerWidth = Math.max(1, width - 2);
  const border = (text: string) => theme.fg("border", text);
  const output = [border(`╭${"─".repeat(innerWidth)}╮`)];
  for (const line of lines) {
    const clipped = truncateToWidth(line, innerWidth);
    const padding = " ".repeat(Math.max(0, innerWidth - visibleWidth(clipped)));
    output.push(border("│") + clipped + padding + border("│"));
  }
  output.push(border(`╰${"─".repeat(innerWidth)}╯`));
  return output;
}

function rule(theme: ThemeLike, width: number): string {
  return theme.fg("border", "─".repeat(Math.max(1, width)));
}

function joinSides(left: string, right: string, width: number): string {
  const leftWidth = visibleWidth(left);
  const rightClipped = truncateToWidth(right, Math.max(0, width - leftWidth - 1));
  const gap = Math.max(1, width - leftWidth - visibleWidth(rightClipped));
  return truncateToWidth(`${left}${" ".repeat(gap)}${rightClipped}`, width);
}

function renderHints(state: DashboardState, view: "summary" | "timeline"): string {
  if (state.filter) return "Esc back   ←→ view   r range   m manage   q close";
  if (view === "summary") return "↑↓ select   Enter inspect   ←→ view   r range   g group   m manage   q close";
  return "←→ view   r range   g group   m manage   q close";
}

function rowLine(label: string, input: string, cache: string, output: string, cost: string, labelWidth: number): string {
  return [fit(label, labelWidth), leftPad(input, 8), leftPad(cache, 8), leftPad(output, 8), leftPad(cost, 10)].join(" ");
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
