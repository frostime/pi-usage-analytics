import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { UsageDatabase } from "../src/storage/usage-database.ts";

const worker = fileURLToPath(new URL("./helpers/concurrent-worker.ts", import.meta.url));

test("two writers and a compactor preserve all usage without SQLITE_BUSY failures", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-usage-analytics-concurrency-"));
  const dbPath = join(dir, "usage.db");
  new UsageDatabase(dbPath, "UTC").close();
  try {
    await Promise.all([
      runWorker("writer", dbPath, "a"),
      runWorker("writer", dbPath, "b"),
      runWorker("compactor", dbPath, "c"),
    ]);
    const db = new UsageDatabase(dbPath, "UTC");
    try {
      const report = db.query({
        range: { startDay: "2026-08-01", endDay: "2026-08-01", label: "day" },
        groupBy: "model",
      });
      assert.equal(report.totals.turns, 200);
      assert.equal(report.totals.input, 10_100);
      assert.equal(db.integrityCheck(), "ok");
    } finally {
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function runWorker(mode: string, dbPath: string, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--experimental-strip-types", worker, mode, dbPath, id], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${mode}/${id} exited ${code}: ${stderr}`));
    });
  });
}
