# Maintenance workflow contract

Maintenance is explicit user action. No startup scan, filesystem watcher, scheduled history import, automatic compaction, or automatic VACUUM is allowed in v1.

## History import

- The user chooses `Last 30 days`, `All history`, or `Since a date` before scanning.
- Date-limited discovery may prune files whose modification day is older than the requested reporting day; final event inclusion is still decided from each event's reporting day.
- Parsing is streaming JSONL; malformed lines are skipped and counted.
- Import is idempotent through `seen_events`.
- Import does not modify source session files.

## Compress history

- Default recommendation is raw retention of 30 calendar days.
- Show a dry-run summary and explicit information-loss warning before mutation.
- Preserve daily/weekly/monthly provider/model/directory analytics, token buckets, costs, turn counts, and dedup capability.
- Explicitly state that individual-message, session-level, and sub-day detail is lost.

## Physical space reclamation

Logical compaction and SQLite file shrinking are separate operations. `VACUUM` is an explicit storage action because it rewrites the database and may temporarily require additional disk space.
