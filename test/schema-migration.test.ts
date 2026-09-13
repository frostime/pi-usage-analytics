import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { UsageDatabase } from "../src/storage/usage-database.ts";

function withDatabasePath(run: (databasePath: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), "pi-usage-schema-test-"));
  try {
    run(join(directory, "usage.db"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function pragmaNumber(database: DatabaseSync, pragma: string): number {
  const row = database.prepare(`PRAGMA ${pragma}`).get() as Record<string, unknown>;
  return Number(Object.values(row)[0]);
}

function columnNames(database: DatabaseSync, table: string): string[] {
  return (database.prepare(`PRAGMA table_info(${table})`).all() as Record<string, unknown>[])
    .map((row) => String(row.name));
}

test("a new database has the complete version 1 schema", () => withDatabasePath((databasePath) => {
  new UsageDatabase(databasePath, "UTC").close();

  const database = new DatabaseSync(databasePath);
  try {
    assert.equal(pragmaNumber(database, "user_version"), 1);
    assert.deepEqual(columnNames(database, "settings"), ["key", "value"]);
    assert.deepEqual(columnNames(database, "seen_events"), [
      "event_key", "event_ts_ms", "entry_ts_ms", "first_seen_at_ms",
    ]);
    assert.deepEqual(columnNames(database, "usage_events"), [
      "event_key", "event_ts_ms", "local_day", "provider", "model", "response_model", "api", "cwd",
      "session_id", "entry_id", "entry_ts_ms", "stop_reason", "has_error_message", "input", "output",
      "cache_read", "cache_write", "cache_write_1h", "reasoning", "total_tokens", "cost_input", "cost_output",
      "cost_cache_read", "cost_cache_write", "cost_total",
    ]);
    assert.deepEqual(columnNames(database, "usage_daily"), [
      "day", "provider", "model", "cwd", "event_count", "input", "output", "cache_read", "cache_write",
      "cache_write_1h_sum", "cache_write_1h_reported_count", "reasoning_sum", "reasoning_reported_count",
      "total_tokens", "cost_input", "cost_output", "cost_cache_read", "cost_cache_write", "cost_total",
    ]);

    const indexes = (database.prepare(
      `SELECT name FROM sqlite_schema WHERE type = 'index' AND name NOT LIKE 'sqlite_autoindex_%' ORDER BY name`,
    ).all() as Record<string, unknown>[]).map((row) => String(row.name));
    assert.deepEqual(indexes, [
      "idx_usage_daily_cwd_day",
      "idx_usage_daily_model_day",
      "idx_usage_events_cwd_day",
      "idx_usage_events_day",
      "idx_usage_events_model_day",
    ]);
  } finally {
    database.close();
  }
}));

test("opening an existing version 1 database preserves its schema and data", () => withDatabasePath((databasePath) => {
  new UsageDatabase(databasePath, "UTC").close();

  const before = new DatabaseSync(databasePath);
  before.prepare(`INSERT INTO settings(key, value) VALUES (?, ?)`).run("migration_marker", "keep-me");
  const schemaVersion = pragmaNumber(before, "schema_version");
  before.close();

  new UsageDatabase(databasePath, "UTC").close();

  const after = new DatabaseSync(databasePath);
  try {
    assert.equal(pragmaNumber(after, "user_version"), 1);
    assert.equal(pragmaNumber(after, "schema_version"), schemaVersion);
    const marker = after.prepare(`SELECT value FROM settings WHERE key = ?`).get("migration_marker") as Record<string, unknown>;
    assert.equal(marker.value, "keep-me");
  } finally {
    after.close();
  }
}));

test("a database newer than the supported schema is rejected", () => withDatabasePath((databasePath) => {
  const database = new DatabaseSync(databasePath);
  database.exec(`PRAGMA user_version = 2`);
  database.close();

  assert.throws(
    () => new UsageDatabase(databasePath, "UTC"),
    /schema 2 is newer than supported schema 1/,
  );
}));
