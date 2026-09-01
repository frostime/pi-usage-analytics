import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { UsageDatabase } from "../src/storage/usage-database.ts";
import { discoverHistory, importHistory } from "../src/maintenance/history-reader.ts";

function assistantEntry(id: string, parentId: string | null, messageTs: number, entryTs: string, input: number) {
  return {
    type: "message",
    id,
    parentId,
    timestamp: entryTs,
    message: {
      role: "assistant",
      timestamp: messageTs,
      api: "openai-completions",
      provider: "provider-a",
      model: "model-a",
      stopReason: "stop",
      usage: {
        input,
        output: 2,
        cacheRead: 3,
        cacheWrite: 0,
        totalTokens: input + 5,
        cost: { input: 0.01, output: 0.02, cacheRead: 0.003, cacheWrite: 0, total: 0.033 },
      },
    },
  };
}

test("history import scans all branches and deduplicates copied sessions globally", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-usage-import-test-"));
  const sessions = join(dir, "sessions");
  mkdirSync(join(sessions, "--project-a--"), { recursive: true });
  const db = new UsageDatabase(join(dir, "usage.db"), "UTC");
  try {
    const headerA = { type: "session", version: 3, id: "s1", timestamp: "2026-08-01T00:00:00.000Z", cwd: "/project/a" };
    const a = assistantEntry("a", null, Date.parse("2026-08-01T10:00:00Z"), "2026-08-01T10:00:01.000Z", 10);
    const branch = assistantEntry("b", "a", Date.parse("2026-08-01T11:00:00Z"), "2026-08-01T11:00:01.000Z", 20);
    writeFileSync(join(sessions, "--project-a--", "one.jsonl"), [headerA, a, branch].map((value) => JSON.stringify(value)).join("\n") + "\n");

    const headerClone = { ...headerA, id: "s2", parentSession: "one.jsonl" };
    writeFileSync(join(sessions, "--project-a--", "clone.jsonl"), [headerClone, a].map((value) => JSON.stringify(value)).join("\n") + "\n");

    const discovery = await discoverHistory(sessions);
    const result = await importHistory(db, discovery, {});
    assert.equal(result.imported, 2);
    assert.equal(result.skipped, 1);
    const report = db.query({
      range: { startDay: "2026-08-01", endDay: "2026-08-01", label: "day" },
      groupBy: "model",
    });
    assert.equal(report.totals.turns, 2);
    assert.equal(report.totals.input, 30);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
