import type { DatabaseSync } from "node:sqlite";

export interface SchemaMigration {
  readonly version: number;
  apply(database: DatabaseSync): void;
}

export const SCHEMA_MIGRATIONS: readonly SchemaMigration[] = [
  {
    version: 1,
    apply(database) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS seen_events (
          event_key TEXT PRIMARY KEY,
          event_ts_ms INTEGER NOT NULL,
          entry_ts_ms INTEGER NOT NULL,
          first_seen_at_ms INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS usage_events (
          event_key TEXT PRIMARY KEY REFERENCES seen_events(event_key),
          event_ts_ms INTEGER NOT NULL,
          local_day TEXT NOT NULL,
          provider TEXT NOT NULL,
          model TEXT NOT NULL,
          response_model TEXT,
          api TEXT,
          cwd TEXT NOT NULL,
          session_id TEXT,
          entry_id TEXT,
          entry_ts_ms INTEGER NOT NULL,
          stop_reason TEXT,
          has_error_message INTEGER NOT NULL,
          input INTEGER NOT NULL,
          output INTEGER NOT NULL,
          cache_read INTEGER NOT NULL,
          cache_write INTEGER NOT NULL,
          cache_write_1h INTEGER,
          reasoning INTEGER,
          total_tokens INTEGER NOT NULL,
          cost_input REAL NOT NULL,
          cost_output REAL NOT NULL,
          cost_cache_read REAL NOT NULL,
          cost_cache_write REAL NOT NULL,
          cost_total REAL NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_usage_events_day ON usage_events(local_day);
        CREATE INDEX IF NOT EXISTS idx_usage_events_model_day ON usage_events(provider, model, local_day);
        CREATE INDEX IF NOT EXISTS idx_usage_events_cwd_day ON usage_events(cwd, local_day);

        CREATE TABLE IF NOT EXISTS usage_daily (
          day TEXT NOT NULL,
          provider TEXT NOT NULL,
          model TEXT NOT NULL,
          cwd TEXT NOT NULL,
          event_count INTEGER NOT NULL,
          input INTEGER NOT NULL,
          output INTEGER NOT NULL,
          cache_read INTEGER NOT NULL,
          cache_write INTEGER NOT NULL,
          cache_write_1h_sum INTEGER NOT NULL,
          cache_write_1h_reported_count INTEGER NOT NULL,
          reasoning_sum INTEGER NOT NULL,
          reasoning_reported_count INTEGER NOT NULL,
          total_tokens INTEGER NOT NULL,
          cost_input REAL NOT NULL,
          cost_output REAL NOT NULL,
          cost_cache_read REAL NOT NULL,
          cost_cache_write REAL NOT NULL,
          cost_total REAL NOT NULL,
          PRIMARY KEY(day, provider, model, cwd)
        ) WITHOUT ROWID;

        CREATE INDEX IF NOT EXISTS idx_usage_daily_model_day ON usage_daily(provider, model, day);
        CREATE INDEX IF NOT EXISTS idx_usage_daily_cwd_day ON usage_daily(cwd, day);
      `);
    },
  },
];

export const SCHEMA_VERSION = SCHEMA_MIGRATIONS.at(-1)?.version ?? 0;
