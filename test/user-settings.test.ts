import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  DEFAULT_DASHBOARD_VIEW,
  loadDashboardDefault,
  saveDashboardDefault,
} from "../src/configuration/user-settings.ts";
import { UsageDatabase } from "../src/storage/usage-database.ts";

const SETTING_KEY = "dashboard_default_view";

function withDatabase(run: (database: UsageDatabase) => void): void {
  const directory = mkdtempSync(join(tmpdir(), "pi-usage-settings-test-"));
  const database = new UsageDatabase(join(directory, "usage.db"), "UTC");
  try {
    run(database);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

test("dashboard defaults round-trip through SQLite", () => withDatabase((database) => {
  const expected = {
    range: { kind: "last-days", days: 7 } as const,
    groupBy: "directory" as const,
  };

  assert.deepEqual(loadDashboardDefault(database), DEFAULT_DASHBOARD_VIEW);
  saveDashboardDefault(database, expected);
  assert.deepEqual(loadDashboardDefault(database), expected);
}));

test("malformed or unknown dashboard default formats use the complete default", () => withDatabase((database) => {
  database.writeSetting(SETTING_KEY, "not-json");
  assert.deepEqual(loadDashboardDefault(database), DEFAULT_DASHBOARD_VIEW);

  database.writeSetting(SETTING_KEY, JSON.stringify({
    schema: 99,
    range: { kind: "last-days", days: 7 },
    groupBy: "directory",
  }));
  assert.deepEqual(loadDashboardDefault(database), DEFAULT_DASHBOARD_VIEW);
}));

test("invalid fields in a known schema fall back independently", () => withDatabase((database) => {
  database.writeSetting(SETTING_KEY, JSON.stringify({
    schema: 1,
    range: { kind: "last-days", days: 12 },
    groupBy: "provider",
  }));
  assert.deepEqual(loadDashboardDefault(database), {
    range: { kind: "today" },
    groupBy: "provider",
  });

  database.writeSetting(SETTING_KEY, JSON.stringify({
    schema: 1,
    range: { kind: "custom", startDay: "2026-08-01", endDay: "2026-08-03" },
    groupBy: "account",
  }));
  assert.deepEqual(loadDashboardDefault(database), {
    range: { kind: "custom", startDay: "2026-08-01", endDay: "2026-08-03" },
    groupBy: "model",
  });
}));
