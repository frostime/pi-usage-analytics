import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { openDashboard, renderOverlayPanel } from "../src/ui/dashboard.ts";
import type { UsageReport } from "../src/usage/query.ts";

const report: UsageReport = {
  range: { startDay: "2026-08-26", endDay: "2026-09-01", label: "Last 7 days" },
  groupBy: "model",
  totals: { turns: 42, input: 27_800_000, output: 2_180_000, cacheRead: 146_000_000, cacheWrite: 0, totalTokens: 175_980_000, cost: 181.42 },
  summary: [
    { key: "anthropic/claude-opus-4-1", provider: "anthropic", model: "claude-opus-4-1", cwd: null, turns: 20, input: 10_200_000, output: 892_000, cacheRead: 82_100_000, cacheWrite: 0, totalTokens: 93_192_000, cost: 91.2 },
    { key: "openai-codex/gpt-5.6", provider: "openai-codex", model: "gpt-5.6", cwd: null, turns: 22, input: 8_100_000, output: 703_000, cacheRead: 36_400_000, cacheWrite: 0, totalTokens: 45_203_000, cost: 52.14 },
  ],
  timeline: [
    { day: "2026-08-31", turns: 17, input: 9_000_000, output: 700_000, cacheRead: 40_000_000, cacheWrite: 0, totalTokens: 49_700_000, cost: 60.1 },
    { day: "2026-09-01", turns: 25, input: 18_800_000, output: 1_480_000, cacheRead: 106_000_000, cacheWrite: 0, totalTokens: 126_280_000, cost: 121.32 },
  ],
};

const theme = {
  fg: (_name: string, text: string) => text,
  bold: (text: string) => text,
};

test("dashboard renderer produces a bordered overlay panel", () => {
  const lines = renderOverlayPanel({
    report,
    state: { range: report.range, groupBy: "model" },
    view: "summary",
    selected: 0,
    scrollOffset: 0,
    pageSize: 8,
    theme,
    width: 84,
    reportingTimezone: "Asia/Shanghai",
  });

  assert.match(lines[0]!, /^╭─+╮$/);
  assert.match(lines.at(-1)!, /^╰─+╯$/);
  assert.ok(lines.some((line) => line.includes("Pi Usage Analytics")));
  assert.ok(lines.some((line) => line.includes("175.98M Total Tokens")));
  assert.ok(lines.some((line) => line.includes("$181.42")));
  assert.ok(lines.some((line) => line.includes("Total") && line.includes("Input") && line.includes("Cache") && line.includes("Output")));
  assert.ok(lines.some((line) => line.includes("› anthropic/claude-opus-4-1") && line.includes("93.19M")));
  assert.ok(lines.every((line) => line.length > 0));
});

test("openDashboard requests a centered bounded overlay in TUI mode", async () => {
  let options: unknown;
  const db = {
    reportingTimezone: "Asia/Shanghai",
    query: () => report,
  };
  const ctx = {
    mode: "tui",
    ui: {
      custom: async (_factory: unknown, receivedOptions: unknown) => {
        options = receivedOptions;
        return { type: "close" };
      },
      notify: () => {},
    },
  };

  const result = await openDashboard(ctx as never, db as never, { range: report.range, groupBy: "model" });
  assert.deepEqual(result, { type: "close" });
  assert.deepEqual(options, {
    overlay: true,
    overlayOptions: {
      anchor: "center",
      width: "88%",
      minWidth: 58,
      maxHeight: "84%",
      margin: 1,
    },
  });
});


test("dashboard renderer respects narrow overlay widths", () => {
  const lines = renderOverlayPanel({
    report,
    state: { range: report.range, groupBy: "model" },
    view: "summary",
    selected: 0,
    scrollOffset: 0,
    pageSize: 3,
    theme,
    width: 30,
    reportingTimezone: "Asia/Shanghai",
  });

  assert.ok(lines.every((line) => visibleWidth(line) <= 30));
  assert.ok(lines.some((line) => line.includes("175.98M Total Tokens")));
});

test("metric strip keeps every column when the one-line layout barely fits", () => {
  // Fixture strip joins to 98 visible columns (headline 39 + separator 7 + breakdown 52).
  // At innerWidth 96 the old width estimate (separator counted as 3 instead of 7)
  // picked the one-line layout and frame() clipped the trailing output column.
  const lines = renderOverlayPanel({
    report,
    state: { range: report.range, groupBy: "model" },
    view: "summary",
    selected: 0,
    scrollOffset: 0,
    pageSize: 8,
    theme,
    width: 98,
    reportingTimezone: "Asia/Shanghai",
  });
  assert.ok(lines.some((line) => line.includes("2.18M output")));
});
