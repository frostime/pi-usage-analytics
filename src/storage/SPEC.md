# Storage contract

`UsageDatabase` is the sole owner of persistence, schema migration, deduplication, mixed raw/daily queries, and destructive compaction.

## Tables and durability roles

- `seen_events`: permanent exact dedup registry. Compaction must never delete keys.
- `usage_events`: raw per-assistant-event facts. These may be deleted only by explicit compaction/reset.
- `usage_daily`: permanent day × provider × model × cwd additive aggregates.
- `settings`: database semantic settings such as reporting timezone.

## Ingest transactions

`ingestBatch()` persists multiple distinct canonical events in one transaction; batching must never collapse their event identities. A duplicate event key is skipped through `seen_events` exactly as with single-event ingest.

`tryIngestBatch()` is the realtime-friendly path: it performs one short transaction attempt and reports `busy` instead of applying the storage module's maintenance retry policy. It must remain atomic: a `busy` result means the caller retains the whole pending batch for a later attempt.

## Query invariant

A day may legally contain both a daily aggregate and later-imported raw events. Every analytics query must therefore aggregate:

`usage_daily UNION ALL usage_events`

then group the combined stream. Never introduce a day state that assumes a day is exclusively raw or exclusively compacted.

This is what makes the following sequence correct without special repair state:

1. compact old raw events;
2. later import a previously unseen event for that old day;
3. query daily aggregate + new raw event;
4. compact again when desired.

## Compaction

Compaction is destructive only at event/session/sub-day detail level. Provider/model/directory day analytics must remain numerically equivalent.

- Current reporting day is never eligible.
- Each day is one `BEGIN IMMEDIATE` transaction; the whole multi-day command is deliberately not one long writer transaction.
- Additive token/count fields must match exactly before raw deletion.
- Cost deltas may differ only within the implementation's floating-point tolerance.
- Delete raw rows only after aggregate verification succeeds.
- Any failure rolls back that day. Previously completed days remain valid and the command is safely repeatable.

## Concurrency

The database uses WAL, `synchronous=NORMAL`, a short SQLite busy timeout, and bounded retry for operations that are allowed to wait. SQLite still serializes writers across processes.

Realtime ingestion must use the non-retrying batch attempt and defer on `SQLITE_BUSY`; it is lower responsibility than Pi Coding responsiveness. Explicit maintenance/import operations may use bounded retry because the user is already waiting for those operations.

Do not add a daemon, worker thread, durable spool, or fallback log unless reproducible pressure cannot be contained by the current process-local batching and SQLite policy.

## Schema changes

`PRAGMA user_version` is authoritative. A runtime must refuse to open a schema newer than it understands. Migrations must preserve the query and dedup invariants above.
