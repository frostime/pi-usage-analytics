import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { UsageDatabase } from "../src/storage/usage-database.ts";
import type { UsageFact } from "../src/usage/fact.ts";

function fact(key: string, input: number, day = "2026-08-01"): UsageFact {
  const ordinal = Number(key.replace(/\D/g, "")) || 1;
  return {
    eventKey: key,
    eventTsMs: Date.parse(`${day}T12:00:00Z`) + ordinal,
    localDay: day,
    provider: "provider-a",
    model: "model-a",
    responseModel: null,
    api: "openai-completions",
    cwd: "/workspace/a",
    sessionId: "session-a",
    entryId: `entry-${key}`,
    entryTsMs: Date.parse(`${day}T12:00:01Z`) + ordinal,
    stopReason: "stop",
    hasErrorMessage: false,
    amounts: {
      input,
      output: 2,
      cacheRead: 20,
      cacheWrite: 1,
      cacheWrite1h: null,
      reasoning: 1,
      totalTokens: input + 23,
      cost: { input: input / 1000, output: 0.002, cacheRead: 0.003, cacheWrite: 0.001, total: input / 1000 + 0.006 },
    },
  };
}

function withDb(run: (db: UsageDatabase) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "pi-usage-ledger-test-"));
  const db = new UsageDatabase(join(dir, "usage.db"), "UTC");
  try {
    run(db);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test("ingest is idempotent", () => withDb((db) => {
  assert.equal(db.ingest(fact("event-1", 10)), true);
  assert.equal(db.ingest(fact("event-1", 10)), false);
  assert.equal(db.getStorageStats().rawEvents, 1);
  assert.equal(db.getStorageStats().seenEvents, 1);
}));

test("compact preserves analytics and import dedup registry", () => withDb((db) => {
  const a = fact("event-1", 10);
  db.ingest(a);
  const spec = { range: { startDay: "2026-08-01", endDay: "2026-08-01", label: "day" }, groupBy: "model" as const };
  const before = db.query(spec);
  const compacted = db.compactBefore("2026-08-02");
  assert.equal(compacted.rawEventsRemoved, 1);
  assert.deepEqual(db.query(spec).totals, before.totals);
  assert.equal(db.ingest(a), false);
  assert.equal(db.getStorageStats().rawEvents, 0);
  assert.equal(db.getStorageStats().seenEvents, 1);
}));

test("daily aggregates and later raw discoveries are queried together", () => withDb((db) => {
  db.ingest(fact("event-1", 10));
  db.compactBefore("2026-08-02");
  db.ingest(fact("event-2", 5));
  const spec = { range: { startDay: "2026-08-01", endDay: "2026-08-01", label: "day" }, groupBy: "model" as const };
  const mixed = db.query(spec);
  assert.equal(mixed.totals.turns, 2);
  assert.equal(mixed.totals.input, 15);
  assert.equal(db.getStorageStats().rawEvents, 1);
  db.compactBefore("2026-08-02");
  const after = db.query(spec);
  assert.deepEqual(after.totals, mixed.totals);
  assert.equal(db.getStorageStats().rawEvents, 0);
}));
