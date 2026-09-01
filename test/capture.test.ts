import test from "node:test";
import assert from "node:assert/strict";
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
  const assistant = { type: "message", id: "a", parentId: "u", timestamp: "2026-08-01T10:00:01.000Z", message };
  const tool = { type: "message", id: "t", parentId: "a", timestamp: "2026-08-01T10:00:02.000Z", message: { role: "toolResult", timestamp: Date.parse("2026-08-01T10:00:02Z") } };
  const ctx = {
    sessionManager: {
      getEntries: () => [assistant, tool],
      getHeader: () => ({ type: "session", version: 3, id: "s1", cwd: "/project/a" }),
    },
  } as any;
  const event = { type: "turn_end", turnIndex: 0, message, toolResults: [] } as any;

  const fact = captureTurnUsage(event, ctx);
  assert.ok(fact);
  assert.equal(fact.provider, "provider-a");
  assert.equal(fact.model, "model-a");
  assert.equal(fact.entryId, "a");
  assert.ok(fact.eventKey.length > 20);
  assert.equal("localDay" in fact, false);
});
