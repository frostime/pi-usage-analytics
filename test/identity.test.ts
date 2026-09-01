import test from "node:test";
import assert from "node:assert/strict";
import { createUsageEventKey } from "../src/usage/identity.ts";
import type { UsageAmounts } from "../src/usage/fact.ts";

const usage: UsageAmounts = {
  input: 100,
  output: 20,
  cacheRead: 500,
  cacheWrite: 0,
  cacheWrite1h: null,
  reasoning: 5,
  totalTokens: 620,
  cost: { input: 0.1, output: 0.2, cacheRead: 0.03, cacheWrite: 0, total: 0.33 },
};

const base = {
  entryTsMs: 1_788_000_001_000,
  messageTsMs: 1_788_000_000_000,
  api: "openai-completions",
  provider: "example",
  model: "model-a",
  responseModel: null,
  stopReason: "stop",
  hasErrorMessage: false,
  usage,
};

test("clone/import copies produce the same event identity", () => {
  assert.equal(createUsageEventKey(base), createUsageEventKey({ ...base }));
});

test("a real second response is not deduplicated", () => {
  const second = createUsageEventKey({ ...base, messageTsMs: base.messageTsMs + 1, entryTsMs: base.entryTsMs + 1000 });
  assert.notEqual(createUsageEventKey(base), second);
});
