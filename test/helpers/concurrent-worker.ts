import { UsageDatabase } from "../../src/storage/usage-database.ts";
import type { UsageFact } from "../../src/usage/fact.ts";

const [mode, dbPath, id] = process.argv.slice(2);
if (!mode || !dbPath) process.exit(2);
const db = new UsageDatabase(dbPath, "UTC");
try {
  if (mode === "writer") {
    for (let i = 0; i < 100; i += 1) db.ingest(makeFact(`${id}-${i}`, i + 1));
  } else if (mode === "compactor") {
    for (let i = 0; i < 12; i += 1) {
      db.compactBefore("2026-08-02");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  } else {
    process.exitCode = 2;
  }
} finally {
  db.close();
}

function makeFact(key: string, input: number): UsageFact {
  const offset = Number(id === "b") * 100_000 + input;
  return {
    eventKey: `concurrent-${key}`,
    eventTsMs: Date.parse("2026-08-01T12:00:00Z") + offset,
    localDay: "2026-08-01",
    provider: "p",
    model: "m",
    responseModel: null,
    api: "api",
    cwd: "/w",
    sessionId: id ?? null,
    entryId: key,
    entryTsMs: Date.parse("2026-08-01T12:00:01Z") + offset,
    stopReason: "stop",
    hasErrorMessage: false,
    amounts: {
      input,
      output: 1,
      cacheRead: 2,
      cacheWrite: 0,
      cacheWrite1h: null,
      reasoning: null,
      totalTokens: input + 3,
      cost: { input: input / 1_000_000, output: 0.000001, cacheRead: 0.000001, cacheWrite: 0, total: input / 1_000_000 + 0.000002 },
    },
  };
}
