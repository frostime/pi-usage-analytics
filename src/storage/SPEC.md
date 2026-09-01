# Storage contract

`UsageDatabase` is the sole owner of persistence, schema migration, deduplication, mixed raw/daily queries, and destructive compaction.

## Tables and durability roles

- `seen_events`: permanent exact dedup registry. Compaction must never delete keys.
- `usage_events`: raw per-assistant-event facts. These may be deleted only by explicit compaction/reset.
- `usage_daily`: permanent day × provider × model × cwd additive aggregates.
- `settings`: database semantic settings such as reporting timezone.

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

The database uses WAL, `synchronous=NORMAL`, a bounded busy timeout, and bounded retry. This is a local analytics store rather than a financial ledger; avoiding long Pi hot-path stalls is preferred over `FULL` synchronous durability.

Do not add a daemon, write queue, or fallback log unless reproducible contention demonstrates the current policy is insufficient.

## Schema changes

`PRAGMA user_version` is authoritative. A runtime must refuse to open a schema newer than it understands. Migrations must preserve the query and dedup invariants above.
