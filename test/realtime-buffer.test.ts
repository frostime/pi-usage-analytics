import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { RealtimeUsageBuffer } from "../src/ingestion/realtime-buffer.ts";
import { UsageDatabase } from "../src/storage/usage-database.ts";
import type { IdentifiedUsageFact } from "../src/usage/fact.ts";

function identifiedFact(key: string, ts = Date.parse("2026-08-01T10:00:00Z")): IdentifiedUsageFact {
  return {
    eventKey: key,
    eventTsMs: ts,
    provider: "provider-a",
    model: "model-a",
    responseModel: null,
    api: "openai-completions",
    cwd: "/project/a",
    sessionId: "session-a",
    entryId: key,
    entryTsMs: ts + 1000,
    stopReason: "stop",
    hasErrorMessage: false,
    amounts: {
      input: 10,
      output: 2,
      cacheRead: 3,
      cacheWrite: 0,
      cacheWrite1h: null,
      reasoning: null,
      totalTokens: 15,
      cost: { input: 0.01, output: 0.02, cacheRead: 0.003, cacheWrite: 0, total: 0.033 },
    },
  };
}

test("realtime buffer batches distinct turn facts and preserves per-event identity", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-usage-buffer-test-"));
  const db = new UsageDatabase(join(dir, "usage.db"), "UTC");
  try {
    const buffer = new RealtimeUsageBuffer();
    buffer.push(identifiedFact("a"));
    buffer.push(identifiedFact("b", Date.parse("2026-08-01T10:01:00Z")));
    buffer.push(identifiedFact("a"));

    assert.equal(buffer.size, 2);
    const result = buffer.flush(db);
    assert.deepEqual(result, { status: "ok", inserted: 2, skipped: 0, attempted: 2, pending: 0 });
    assert.equal(db.getStorageStats().rawEvents, 2);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("SQLITE_BUSY leaves the realtime batch pending for a later flush", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-usage-buffer-busy-test-"));
  const dbPath = join(dir, "usage.db");
  const db = new UsageDatabase(dbPath, "UTC");
  const blocker = new DatabaseSync(dbPath);
  try {
    blocker.exec("PRAGMA journal_mode = WAL; BEGIN IMMEDIATE");
    const buffer = new RealtimeUsageBuffer();
    buffer.push(identifiedFact("busy-a"));

    const busy = buffer.flush(db);
    assert.equal(busy.status, "busy");
    assert.equal(buffer.size, 1);

    blocker.exec("ROLLBACK");
    const flushed = buffer.flush(db);
    assert.equal(flushed.status, "ok");
    assert.equal(buffer.size, 0);
    assert.equal(db.getStorageStats().rawEvents, 1);
  } finally {
    try { blocker.exec("ROLLBACK"); } catch {}
    blocker.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("realtime buffer is bounded and drops the oldest pending fact instead of growing forever", () => {
  const buffer = new RealtimeUsageBuffer(2);
  buffer.push(identifiedFact("a"));
  buffer.push(identifiedFact("b"));
  const result = buffer.push(identifiedFact("c"));

  assert.equal(result.dropped, 1);
  assert.equal(buffer.size, 2);
  assert.equal(buffer.totalDropped, 1);
});
