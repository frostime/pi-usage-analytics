import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { detectReportingTimezone } from "../usage/calendar.ts";
import type { UsageFact } from "../usage/fact.ts";
import type {
  GroupBy,
  QuerySpec,
  SummaryRow,
  TimelineRow,
  UsageReport,
  UsageTotals
} from "../usage/query.ts";

const SCHEMA_VERSION = 1;
const BUSY_TIMEOUT_MS = 50;
const BUSY_RETRY_DELAYS_MS = [30, 90, 240];
const COST_EPSILON = 1e-9;

export interface StorageStats {
  databasePath: string;
  bytesOnDisk: number;
  reportingTimezone: string;
  rawEvents: number;
  dailyRows: number;
  seenEvents: number;
  oldestRawDay: string | null;
  newestRawDay: string | null;
  oldestDailyDay: string | null;
  newestDailyDay: string | null;
}

export interface CompactPreview {
  cutoffExclusive: string;
  days: number;
  rawEvents: number;
  aggregateRows: number;
  oldestDay: string | null;
  newestDay: string | null;
}

export interface CompactResult {
  daysCompacted: number;
  rawEventsRemoved: number;
  aggregateRowsTouched: number;
}

export interface BatchIngestResult {
  inserted: number;
  skipped: number;
}

export type TryBatchIngestResult =
  | ({ status: "ok" } & BatchIngestResult)
  | { status: "busy" };

interface CompactGroupRow {
  day: string;
  provider: string;
  model: string;
  cwd: string;
  event_count: number;
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
  cache_write_1h_sum: number;
  cache_write_1h_reported_count: number;
  reasoning_sum: number;
  reasoning_reported_count: number;
  total_tokens: number;
  cost_input: number;
  cost_output: number;
  cost_cache_read: number;
  cost_cache_write: number;
  cost_total: number;
}

interface AggregateCheck {
  events: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  costInput: number;
  costOutput: number;
  costCacheRead: number;
  costCacheWrite: number;
  costTotal: number;
}

export class UsageDatabase {
  readonly databasePath: string;
  readonly reportingTimezone: string;
  private readonly db: DatabaseSync;

  constructor(databasePath: string, initialTimezone = detectReportingTimezone()) {
    this.databasePath = databasePath;
    mkdirSync(dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.configure();
    this.migrate();
    this.reportingTimezone = this.getOrCreateSetting("reporting_timezone", initialTimezone);
  }

  close(): void {
    this.db.close();
  }

  ingest(fact: UsageFact): boolean {
    return this.ingestBatch([fact]).inserted === 1;
  }

  ingestBatch(facts: UsageFact[]): BatchIngestResult {
    if (facts.length === 0) return { inserted: 0, skipped: 0 };
    return this.immediateTransaction(() => this.insertUsageFacts(facts));
  }

  tryIngestBatch(facts: UsageFact[]): TryBatchIngestResult {
    if (facts.length === 0) return { status: "ok", inserted: 0, skipped: 0 };
    try {
      const result = this.immediateTransaction(() => this.insertUsageFacts(facts), false);
      return { status: "ok", ...result };
    } catch (error) {
      if (isBusyError(error)) return { status: "busy" };
      throw error;
    }
  }

  query(spec: QuerySpec): UsageReport {
    const summary = this.querySummary(spec);
    const timeline = this.queryTimeline(spec);
    const totals = sumSummary(summary);
    return { range: spec.range, groupBy: spec.groupBy, summary, timeline, totals };
  }

  querySummary(spec: QuerySpec): SummaryRow[] {
    const group = groupSql(spec.groupBy);
    const { where, params: filterParams } = filterSql(spec.filter);
    const sql = `
      WITH combined AS (
        SELECT local_day AS day, provider, model, cwd,
               1 AS turns, input, output, cache_read, cache_write, total_tokens, cost_total
        FROM usage_events
        WHERE local_day BETWEEN ? AND ?
        UNION ALL
        SELECT day, provider, model, cwd,
               event_count AS turns, input, output, cache_read, cache_write, total_tokens, cost_total
        FROM usage_daily
        WHERE day BETWEEN ? AND ?
      )
      SELECT ${group.key} AS key,
             ${group.provider} AS provider,
             ${group.model} AS model,
             ${group.cwd} AS cwd,
             SUM(turns) AS turns,
             SUM(input) AS input,
             SUM(output) AS output,
             SUM(cache_read) AS cache_read,
             SUM(cache_write) AS cache_write,
             SUM(total_tokens) AS total_tokens,
             SUM(cost_total) AS cost
      FROM combined
      ${where}
      GROUP BY ${group.groupBy}
      ORDER BY cost DESC, key ASC
    `;
    const params = [
      spec.range.startDay,
      spec.range.endDay,
      spec.range.startDay,
      spec.range.endDay,
      ...filterParams,
    ];
    return this.db.prepare(sql).all(...params).map(toSummaryRow);
  }

  queryTimeline(spec: QuerySpec): TimelineRow[] {
    const { where, params: filterParams } = filterSql(spec.filter);
    const sql = `
      WITH combined AS (
        SELECT local_day AS day, provider, model, cwd,
               1 AS turns, input, output, cache_read, cache_write, total_tokens, cost_total
        FROM usage_events
        WHERE local_day BETWEEN ? AND ?
        UNION ALL
        SELECT day, provider, model, cwd,
               event_count AS turns, input, output, cache_read, cache_write, total_tokens, cost_total
        FROM usage_daily
        WHERE day BETWEEN ? AND ?
      )
      SELECT day,
             SUM(turns) AS turns,
             SUM(input) AS input,
             SUM(output) AS output,
             SUM(cache_read) AS cache_read,
             SUM(cache_write) AS cache_write,
             SUM(total_tokens) AS total_tokens,
             SUM(cost_total) AS cost
      FROM combined
      ${where}
      GROUP BY day
      ORDER BY day ASC
    `;
    const params = [
      spec.range.startDay,
      spec.range.endDay,
      spec.range.startDay,
      spec.range.endDay,
      ...filterParams,
    ];
    return this.db.prepare(sql).all(...params).map(toTimelineRow);
  }

  getBounds(): { startDay: string | null; endDay: string | null } {
    const row = this.db
      .prepare(
        `SELECT MIN(day) AS start_day, MAX(day) AS end_day
         FROM (
           SELECT local_day AS day FROM usage_events
           UNION ALL
           SELECT day FROM usage_daily
         )`,
      )
      .get() as Record<string, unknown> | undefined;
    return {
      startDay: stringOrNull(row?.start_day),
      endDay: stringOrNull(row?.end_day),
    };
  }

  getStorageStats(): StorageStats {
    const raw = this.db
      .prepare(
        `SELECT COUNT(*) AS count, MIN(local_day) AS oldest, MAX(local_day) AS newest
         FROM usage_events`,
      )
      .get() as Record<string, unknown>;
    const daily = this.db
      .prepare(`SELECT COUNT(*) AS count, MIN(day) AS oldest, MAX(day) AS newest FROM usage_daily`)
      .get() as Record<string, unknown>;
    const seen = this.db.prepare(`SELECT COUNT(*) AS count FROM seen_events`).get() as Record<string, unknown>;

    return {
      databasePath: this.databasePath,
      bytesOnDisk: databaseFootprintBytes(this.databasePath),
      reportingTimezone: this.reportingTimezone,
      rawEvents: toNumber(raw.count),
      dailyRows: toNumber(daily.count),
      seenEvents: toNumber(seen.count),
      oldestRawDay: stringOrNull(raw.oldest),
      newestRawDay: stringOrNull(raw.newest),
      oldestDailyDay: stringOrNull(daily.oldest),
      newestDailyDay: stringOrNull(daily.newest),
    };
  }

  previewCompact(cutoffExclusive: string): CompactPreview {
    const count = this.db
      .prepare(
        `SELECT COUNT(*) AS events, COUNT(DISTINCT local_day) AS days,
                MIN(local_day) AS oldest, MAX(local_day) AS newest
         FROM usage_events WHERE local_day < ?`,
      )
      .get(cutoffExclusive) as Record<string, unknown>;
    const groups = this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM (
           SELECT 1 FROM usage_events
           WHERE local_day < ?
           GROUP BY local_day, provider, model, cwd
         )`,
      )
      .get(cutoffExclusive) as Record<string, unknown>;
    return {
      cutoffExclusive,
      days: toNumber(count.days),
      rawEvents: toNumber(count.events),
      aggregateRows: toNumber(groups.count),
      oldestDay: stringOrNull(count.oldest),
      newestDay: stringOrNull(count.newest),
    };
  }

  compactBefore(cutoffExclusive: string, onDay?: (day: string, completed: number, total: number) => void): CompactResult {
    const days = this.db
      .prepare(`SELECT DISTINCT local_day AS day FROM usage_events WHERE local_day < ? ORDER BY local_day ASC`)
      .all(cutoffExclusive)
      .map((row) => String((row as Record<string, unknown>).day));

    let rawEventsRemoved = 0;
    let aggregateRowsTouched = 0;
    let completed = 0;
    for (const day of days) {
      const result = this.compactDay(day);
      rawEventsRemoved += result.rawEventsRemoved;
      aggregateRowsTouched += result.aggregateRowsTouched;
      completed += 1;
      onDay?.(day, completed, days.length);
    }
    return { daysCompacted: completed, rawEventsRemoved, aggregateRowsTouched };
  }

  integrityCheck(): string {
    const rows = this.db.prepare(`PRAGMA integrity_check`).all() as Record<string, unknown>[];
    return rows.map((row) => String(Object.values(row)[0] ?? "")).join("\n");
  }

  vacuum(): void {
    this.retryBusy(() => this.db.exec(`VACUUM`));
  }

  resetUsageData(): void {
    this.immediateTransaction(() => {
      this.db.exec(`DELETE FROM usage_events; DELETE FROM usage_daily; DELETE FROM seen_events;`);
    });
  }

  private insertUsageFacts(facts: UsageFact[]): BatchIngestResult {
    const seenStatement = this.db.prepare(
      `INSERT OR IGNORE INTO seen_events
         (event_key, event_ts_ms, entry_ts_ms, first_seen_at_ms)
       VALUES (?, ?, ?, ?)`,
    );
    const eventStatement = this.db.prepare(
      `INSERT INTO usage_events (
         event_key, event_ts_ms, local_day,
         provider, model, response_model, api, cwd,
         session_id, entry_id, entry_ts_ms, stop_reason, has_error_message,
         input, output, cache_read, cache_write, cache_write_1h, reasoning, total_tokens,
         cost_input, cost_output, cost_cache_read, cost_cache_write, cost_total
       ) VALUES (
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       )`,
    );

    let inserted = 0;
    let skipped = 0;
    const firstSeenAtMs = Date.now();
    for (const fact of facts) {
      const seen = seenStatement.run(fact.eventKey, fact.eventTsMs, fact.entryTsMs, firstSeenAtMs);
      if (Number(seen.changes) === 0) {
        skipped += 1;
        continue;
      }

      const a = fact.amounts;
      eventStatement.run(
        fact.eventKey,
        fact.eventTsMs,
        fact.localDay,
        fact.provider,
        fact.model,
        fact.responseModel,
        fact.api,
        fact.cwd,
        fact.sessionId,
        fact.entryId,
        fact.entryTsMs,
        fact.stopReason,
        fact.hasErrorMessage ? 1 : 0,
        a.input,
        a.output,
        a.cacheRead,
        a.cacheWrite,
        a.cacheWrite1h,
        a.reasoning,
        a.totalTokens,
        a.cost.input,
        a.cost.output,
        a.cost.cacheRead,
        a.cost.cacheWrite,
        a.cost.total,
      );
      inserted += 1;
    }
    return { inserted, skipped };
  }

  private compactDay(day: string): { rawEventsRemoved: number; aggregateRowsTouched: number } {
    return this.immediateTransaction(() => {
      const groups = this.db
        .prepare(
          `SELECT local_day AS day, provider, model, cwd,
                  COUNT(*) AS event_count,
                  SUM(input) AS input,
                  SUM(output) AS output,
                  SUM(cache_read) AS cache_read,
                  SUM(cache_write) AS cache_write,
                  SUM(COALESCE(cache_write_1h, 0)) AS cache_write_1h_sum,
                  SUM(CASE WHEN cache_write_1h IS NULL THEN 0 ELSE 1 END) AS cache_write_1h_reported_count,
                  SUM(COALESCE(reasoning, 0)) AS reasoning_sum,
                  SUM(CASE WHEN reasoning IS NULL THEN 0 ELSE 1 END) AS reasoning_reported_count,
                  SUM(total_tokens) AS total_tokens,
                  SUM(cost_input) AS cost_input,
                  SUM(cost_output) AS cost_output,
                  SUM(cost_cache_read) AS cost_cache_read,
                  SUM(cost_cache_write) AS cost_cache_write,
                  SUM(cost_total) AS cost_total
           FROM usage_events
           WHERE local_day = ?
           GROUP BY local_day, provider, model, cwd`,
        )
        .all(day)
        .map(toCompactGroupRow);

      if (groups.length === 0) return { rawEventsRemoved: 0, aggregateRowsTouched: 0 };

      const before = this.readDailyAggregate(day);
      const rawAggregate = aggregateCompactGroups(groups);
      const upsert = this.db.prepare(
        `INSERT INTO usage_daily (
           day, provider, model, cwd, event_count,
           input, output, cache_read, cache_write,
           cache_write_1h_sum, cache_write_1h_reported_count,
           reasoning_sum, reasoning_reported_count, total_tokens,
           cost_input, cost_output, cost_cache_read, cost_cache_write, cost_total
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(day, provider, model, cwd) DO UPDATE SET
           event_count = event_count + excluded.event_count,
           input = input + excluded.input,
           output = output + excluded.output,
           cache_read = cache_read + excluded.cache_read,
           cache_write = cache_write + excluded.cache_write,
           cache_write_1h_sum = cache_write_1h_sum + excluded.cache_write_1h_sum,
           cache_write_1h_reported_count = cache_write_1h_reported_count + excluded.cache_write_1h_reported_count,
           reasoning_sum = reasoning_sum + excluded.reasoning_sum,
           reasoning_reported_count = reasoning_reported_count + excluded.reasoning_reported_count,
           total_tokens = total_tokens + excluded.total_tokens,
           cost_input = cost_input + excluded.cost_input,
           cost_output = cost_output + excluded.cost_output,
           cost_cache_read = cost_cache_read + excluded.cost_cache_read,
           cost_cache_write = cost_cache_write + excluded.cost_cache_write,
           cost_total = cost_total + excluded.cost_total`,
      );

      for (const row of groups) {
        upsert.run(
          row.day,
          row.provider,
          row.model,
          row.cwd,
          row.event_count,
          row.input,
          row.output,
          row.cache_read,
          row.cache_write,
          row.cache_write_1h_sum,
          row.cache_write_1h_reported_count,
          row.reasoning_sum,
          row.reasoning_reported_count,
          row.total_tokens,
          row.cost_input,
          row.cost_output,
          row.cost_cache_read,
          row.cost_cache_write,
          row.cost_total,
        );
      }

      const after = this.readDailyAggregate(day);
      assertAggregateDelta(before, after, rawAggregate);
      const deleted = this.db.prepare(`DELETE FROM usage_events WHERE local_day = ?`).run(day);
      if (Number(deleted.changes) !== rawAggregate.events) {
        throw new Error(
          `compact invariant failed for ${day}: expected to delete ${rawAggregate.events} events, deleted ${String(deleted.changes)}`,
        );
      }
      return { rawEventsRemoved: rawAggregate.events, aggregateRowsTouched: groups.length };
    });
  }

  private readDailyAggregate(day: string): AggregateCheck {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS rows,
                COALESCE(SUM(event_count), 0) AS events,
                COALESCE(SUM(input), 0) AS input,
                COALESCE(SUM(output), 0) AS output,
                COALESCE(SUM(cache_read), 0) AS cache_read,
                COALESCE(SUM(cache_write), 0) AS cache_write,
                COALESCE(SUM(total_tokens), 0) AS total_tokens,
                COALESCE(SUM(cost_input), 0) AS cost_input,
                COALESCE(SUM(cost_output), 0) AS cost_output,
                COALESCE(SUM(cost_cache_read), 0) AS cost_cache_read,
                COALESCE(SUM(cost_cache_write), 0) AS cost_cache_write,
                COALESCE(SUM(cost_total), 0) AS cost_total
         FROM usage_daily WHERE day = ?`,
      )
      .get(day) as Record<string, unknown>;
    return {
      events: toNumber(row.events),
      input: toNumber(row.input),
      output: toNumber(row.output),
      cacheRead: toNumber(row.cache_read),
      cacheWrite: toNumber(row.cache_write),
      totalTokens: toNumber(row.total_tokens),
      costInput: toNumber(row.cost_input),
      costOutput: toNumber(row.cost_output),
      costCacheRead: toNumber(row.cost_cache_read),
      costCacheWrite: toNumber(row.cost_cache_write),
      costTotal: toNumber(row.cost_total),
    };
  }

  private configure(): void {
    this.db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    const journalModeRow = this.db.prepare(`PRAGMA journal_mode`).get() as Record<string, unknown>;
    const currentJournalMode = String(Object.values(journalModeRow)[0] ?? "").toLowerCase();
    if (currentJournalMode !== "wal") {
      this.retryBusy(() => this.db.exec(`PRAGMA journal_mode = WAL`));
    }
    this.db.exec(`PRAGMA synchronous = NORMAL`);
    this.db.exec(`PRAGMA foreign_keys = ON`);
  }

  private migrate(): void {
    const versionRow = this.db.prepare(`PRAGMA user_version`).get() as Record<string, unknown>;
    const version = toNumber(Object.values(versionRow)[0] ?? 0);
    if (version > SCHEMA_VERSION) {
      throw new Error(`usage database schema ${version} is newer than supported schema ${SCHEMA_VERSION}`);
    }
    if (version === SCHEMA_VERSION) return;

    this.immediateTransaction(() => {
      this.db.exec(`
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

        PRAGMA user_version = 1;
      `);
    });
  }

  private getOrCreateSetting(key: string, fallback: string): string {
    const existing = this.db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as Record<string, unknown> | undefined;
    if (existing) return String(existing.value);

    return this.immediateTransaction(() => {
      this.db.prepare(`INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)`).run(key, fallback);
      const row = this.db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as Record<string, unknown>;
      return String(row.value);
    });
  }

  private immediateTransaction<T>(fn: () => T, retry = true): T {
    const run = () => {
      this.db.exec(`BEGIN IMMEDIATE`);
      try {
        const result = fn();
        this.db.exec(`COMMIT`);
        return result;
      } catch (error) {
        try {
          this.db.exec(`ROLLBACK`);
        } catch {
          // The original error is more useful. ROLLBACK can fail if BEGIN never completed.
        }
        throw error;
      }
    };
    return retry ? this.retryBusy(run) : run();
  }

  private retryBusy<T>(fn: () => T): T {
    let lastError: unknown;
    for (let attempt = 0; attempt <= BUSY_RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        return fn();
      } catch (error) {
        lastError = error;
        if (!isBusyError(error) || attempt === BUSY_RETRY_DELAYS_MS.length) throw error;
        sleepSync(BUSY_RETRY_DELAYS_MS[attempt]);
      }
    }
    throw lastError;
  }
}

function groupSql(groupBy: GroupBy): { key: string; provider: string; model: string; cwd: string; groupBy: string } {
  if (groupBy === "provider") {
    return { key: "provider", provider: "provider", model: "NULL", cwd: "NULL", groupBy: "provider" };
  }
  if (groupBy === "directory") {
    return { key: "cwd", provider: "NULL", model: "NULL", cwd: "cwd", groupBy: "cwd" };
  }
  return {
    key: "provider || '/' || model",
    provider: "provider",
    model: "model",
    cwd: "NULL",
    groupBy: "provider, model",
  };
}

function filterSql(filter: QuerySpec["filter"]): { where: string; params: (string | number | null)[] } {
  const clauses: string[] = [];
  const params: (string | number | null)[] = [];
  if (filter?.provider) {
    clauses.push("provider = ?");
    params.push(filter.provider);
  }
  if (filter?.model) {
    clauses.push("model = ?");
    params.push(filter.model);
  }
  if (filter?.cwd !== undefined) {
    clauses.push("cwd = ?");
    params.push(filter.cwd);
  }
  return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

function toSummaryRow(row: unknown): SummaryRow {
  const value = row as Record<string, unknown>;
  return {
    key: String(value.key ?? ""),
    provider: stringOrNull(value.provider),
    model: stringOrNull(value.model),
    cwd: value.cwd === null || value.cwd === undefined ? null : String(value.cwd),
    turns: toNumber(value.turns),
    input: toNumber(value.input),
    output: toNumber(value.output),
    cacheRead: toNumber(value.cache_read),
    cacheWrite: toNumber(value.cache_write),
    totalTokens: toNumber(value.total_tokens),
    cost: toNumber(value.cost),
  };
}

function toTimelineRow(row: unknown): TimelineRow {
  const value = row as Record<string, unknown>;
  return {
    day: String(value.day),
    turns: toNumber(value.turns),
    input: toNumber(value.input),
    output: toNumber(value.output),
    cacheRead: toNumber(value.cache_read),
    cacheWrite: toNumber(value.cache_write),
    totalTokens: toNumber(value.total_tokens),
    cost: toNumber(value.cost),
  };
}

function toCompactGroupRow(row: unknown): CompactGroupRow {
  const value = row as Record<string, unknown>;
  return {
    day: String(value.day),
    provider: String(value.provider),
    model: String(value.model),
    cwd: String(value.cwd ?? ""),
    event_count: toNumber(value.event_count),
    input: toNumber(value.input),
    output: toNumber(value.output),
    cache_read: toNumber(value.cache_read),
    cache_write: toNumber(value.cache_write),
    cache_write_1h_sum: toNumber(value.cache_write_1h_sum),
    cache_write_1h_reported_count: toNumber(value.cache_write_1h_reported_count),
    reasoning_sum: toNumber(value.reasoning_sum),
    reasoning_reported_count: toNumber(value.reasoning_reported_count),
    total_tokens: toNumber(value.total_tokens),
    cost_input: toNumber(value.cost_input),
    cost_output: toNumber(value.cost_output),
    cost_cache_read: toNumber(value.cost_cache_read),
    cost_cache_write: toNumber(value.cost_cache_write),
    cost_total: toNumber(value.cost_total),
  };
}

function aggregateCompactGroups(groups: CompactGroupRow[]): AggregateCheck {
  const result: AggregateCheck = {
    events: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    costInput: 0,
    costOutput: 0,
    costCacheRead: 0,
    costCacheWrite: 0,
    costTotal: 0,
  };
  for (const row of groups) {
    result.events += row.event_count;
    result.input += row.input;
    result.output += row.output;
    result.cacheRead += row.cache_read;
    result.cacheWrite += row.cache_write;
    result.totalTokens += row.total_tokens;
    result.costInput += row.cost_input;
    result.costOutput += row.cost_output;
    result.costCacheRead += row.cost_cache_read;
    result.costCacheWrite += row.cost_cache_write;
    result.costTotal += row.cost_total;
  }
  return result;
}

function assertAggregateDelta(before: AggregateCheck, after: AggregateCheck, expected: AggregateCheck): void {
  const integerFields: (keyof AggregateCheck)[] = ["events", "input", "output", "cacheRead", "cacheWrite", "totalTokens"];
  for (const key of integerFields) {
    if (after[key] - before[key] !== expected[key]) {
      throw new Error(`compact invariant failed for ${key}: ${after[key]} - ${before[key]} != ${expected[key]}`);
    }
  }
  const costFields: (keyof AggregateCheck)[] = [
    "costInput",
    "costOutput",
    "costCacheRead",
    "costCacheWrite",
    "costTotal",
  ];
  for (const key of costFields) {
    if (Math.abs(after[key] - before[key] - expected[key]) > COST_EPSILON) {
      throw new Error(`compact invariant failed for ${key}`);
    }
  }
}

function sumSummary(rows: SummaryRow[]): UsageTotals {
  const result: UsageTotals = { turns: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: 0 };
  for (const row of rows) {
    result.turns += row.turns;
    result.input += row.input;
    result.output += row.output;
    result.cacheRead += row.cacheRead;
    result.cacheWrite += row.cacheWrite;
    result.totalTokens += row.totalTokens;
    result.cost += row.cost;
  }
  return result;
}

function databaseFootprintBytes(path: string): number {
  let total = 0;
  for (const candidate of [path, `${path}-wal`, `${path}-shm`]) {
    if (existsSync(candidate)) total += statSync(candidate).size;
  }
  return total;
}

function toNumber(value: unknown): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  if (typeof value === "string" && value !== "") return Number(value);
  return 0;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isBusyError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /SQLITE_BUSY|database is locked|database is busy/i.test(`${error.name}: ${error.message}`);
}

function sleepSync(ms: number): void {
  const buffer = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(buffer), 0, 0, ms);
}
