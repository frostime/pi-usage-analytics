import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { createUsageCommandHandler } from "../src/commands/usage.ts";
import type { DashboardViewSelection } from "../src/configuration/user-settings.ts";
import type { UsageDatabase } from "../src/storage/usage-database.ts";
import type { DashboardAction, DashboardState } from "../src/ui/dashboard.ts";

const database = {
  reportingTimezone: "UTC",
  getBounds: () => ({ startDay: "2026-01-01", endDay: "2026-09-01" }),
} as UsageDatabase;

interface FakeContext {
  context: ExtensionCommandContext;
  notifications: Array<{ message: string; level: string }>;
}

function fakeContext(mode: "tui" | "print" = "tui", selections: string[] = []): FakeContext {
  const notifications: Array<{ message: string; level: string }> = [];
  const context = {
    mode,
    hasUI: mode === "tui",
    ui: {
      select: async () => selections.shift(),
      input: async () => undefined,
      notify: (message: string, level: string) => notifications.push({ message, level }),
    },
  } as unknown as ExtensionCommandContext;
  return { context, notifications };
}

function dashboardSequence(actions: DashboardAction[], observed: DashboardState[]) {
  return async (_ctx: ExtensionCommandContext, _db: UsageDatabase, state: DashboardState) => {
    observed.push(structuredClone(state));
    return actions.shift() ?? { type: "close" };
  };
}

test("dashboard changes stay in one command session until explicitly saved", async () => {
  const observed: DashboardState[] = [];
  const saved: DashboardViewSelection[] = [];
  let loads = 0;
  let nowMs = Date.parse("2026-09-01T12:00:00Z");
  const actions: DashboardAction[] = [{ type: "range" }, { type: "close" }, { type: "close" }];
  const handler = createUsageCommandHandler({
    openDashboard: dashboardSequence(actions, observed),
    loadDashboardDefault: () => {
      loads += 1;
      return { range: { kind: "today" }, groupBy: "model" };
    },
    saveDashboardDefault: (_db, view) => saved.push(structuredClone(view)),
    now: () => nowMs,
  });
  const { context } = fakeContext("tui", ["Last 7 days"]);

  await handler("", context, database);
  nowMs = Date.parse("2026-09-02T12:00:00Z");
  await handler("", context, database);

  assert.equal(loads, 1);
  assert.deepEqual(observed.map((state) => state.range), [
    { startDay: "2026-09-01", endDay: "2026-09-01", label: "Today" },
    { startDay: "2026-08-26", endDay: "2026-09-01", label: "Last 7 days" },
    { startDay: "2026-08-27", endDay: "2026-09-02", label: "Last 7 days" },
  ]);
  assert.deepEqual(saved, []);

  await handler("save-default", context, database);
  assert.deepEqual(saved, [{ range: { kind: "last-days", days: 7 }, groupBy: "model" }]);
});

test("a new command session initializes from the latest saved default", async () => {
  let dashboardDefault: DashboardViewSelection = { range: { kind: "today" }, groupBy: "model" };
  const firstObserved: DashboardState[] = [];
  const secondObserved: DashboardState[] = [];
  const services = {
    loadDashboardDefault: () => dashboardDefault,
    now: () => Date.parse("2026-09-01T12:00:00Z"),
  };
  const firstSession = createUsageCommandHandler({
    ...services,
    openDashboard: dashboardSequence([{ type: "close" }, { type: "close" }], firstObserved),
  });
  const { context } = fakeContext();

  await firstSession("", context, database);
  dashboardDefault = { range: { kind: "last-days", days: 30 }, groupBy: "provider" };
  await firstSession("", context, database);

  const secondSession = createUsageCommandHandler({
    ...services,
    openDashboard: dashboardSequence([{ type: "close" }], secondObserved),
  });
  await secondSession("", context, database);

  assert.deepEqual(firstObserved.map((state) => state.groupBy), ["model", "model"]);
  assert.equal(secondObserved[0]?.groupBy, "provider");
  assert.deepEqual(secondObserved[0]?.range, {
    startDay: "2026-08-03",
    endDay: "2026-09-01",
    label: "Last 30 days",
  });
});

test("a failed default save does not discard the active session view", async () => {
  const observed: DashboardState[] = [];
  const handler = createUsageCommandHandler({
    openDashboard: dashboardSequence(
      [{ type: "group" }, { type: "close" }, { type: "close" }],
      observed,
    ),
    loadDashboardDefault: () => ({ range: { kind: "today" }, groupBy: "model" }),
    saveDashboardDefault: () => {
      throw new Error("database is busy");
    },
    now: () => Date.parse("2026-09-01T12:00:00Z"),
  });
  const { context, notifications } = fakeContext("tui", ["Directory"]);

  await handler("", context, database);
  await handler("save-default", context, database);
  await handler("", context, database);

  assert.equal(observed.at(-1)?.groupBy, "directory");
  assert.match(notifications.at(-1)?.message ?? "", /default was not saved: database is busy/);
});

test("non-TUI usage ignores saved defaults and cannot save them", async () => {
  const observed: DashboardState[] = [];
  let loadCalls = 0;
  let saveCalls = 0;
  const handler = createUsageCommandHandler({
    openDashboard: dashboardSequence([{ type: "close" }], observed),
    loadDashboardDefault: () => {
      loadCalls += 1;
      return { range: { kind: "all-time" }, groupBy: "directory" };
    },
    saveDashboardDefault: () => {
      saveCalls += 1;
    },
    now: () => Date.parse("2026-09-01T12:00:00Z"),
  });
  const { context, notifications } = fakeContext("print");

  await handler("", context, database);
  await handler("save-default", context, database);

  assert.equal(loadCalls, 0);
  assert.equal(saveCalls, 0);
  assert.deepEqual(observed[0], {
    range: { startDay: "2026-09-01", endDay: "2026-09-01", label: "Today" },
    groupBy: "model",
  });
  assert.match(notifications.at(-1)?.message ?? "", /only available in the interactive TUI/);
});
