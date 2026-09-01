import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { UsageDatabase } from "../src/storage/usage-database.ts";
import { captureTurnUsage } from "../src/pi/capture.ts";

const message = {
  role: "assistant",
  timestamp: Date.parse("2026-08-01T10:00:00Z"),
  api: "openai-completions",
  provider: "provider-a",
  model: "model-a",
  stopReason: "toolUse",
  usage: {
    input: 10,
    output: 2,
    cacheRead: 3,
    cacheWrite: 0,
    totalTokens: 15,
    cost: { input: 0.01, output: 0.02, cacheRead: 0.003, cacheWrite: 0, total: 0.033 },
  },
};

test("turn_end capture finds the assistant entry even when a toolResult is the leaf", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-usage-capture-test-"));
  const db = new UsageDatabase(join(dir, "usage.db"), "UTC");
  try {
    const assistant = { type: "message", id: "a", parentId: "u", timestamp: "2026-08-01T10:00:01.000Z", message };
    const tool = { type: "message", id: "t", parentId: "a", timestamp: "2026-08-01T10:00:02.000Z", message: { role: "toolResult", timestamp: Date.parse("2026-08-01T10:00:02Z") } };
    const ctx = {
      sessionManager: {
        getEntries: () => [assistant, tool],
        getHeader: () => ({ type: "session", version: 3, id: "s1", cwd: "/project/a" }),
      },
    } as any;
    const event = { type: "turn_end", turnIndex: 0, message, toolResults: [] } as any;
    assert.equal(captureTurnUsage(event, ctx, db), true);
    assert.equal(db.getStorageStats().rawEvents, 1);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
