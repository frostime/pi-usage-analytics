# Usage semantics contract

This module owns usage meaning independently of Pi integration, SQLite, and UI.

## Literal accounting

- Provider/model identity is the exact pair reported by the assistant message. Do not alias, normalize, infer upstream providers, or replace `model` with `responseModel`.
- Token and cost fields are stored as reported by Pi. Do not reconstruct `totalTokens` from component buckets and do not infer missing optional buckets.
- `cacheWrite1h` and `reasoning` distinguish `null` (not reported) from numeric `0` (reported as zero).
- Event time is the assistant message timestamp. Entry timestamp is retained separately for identity and provenance.
- Directory is the normalized absolute session `cwd`. No Git repository, worktree, symlink-resolution, or project-root semantics are inferred.

## Event identity

`identity.ts` produces a versioned content-free fingerprint from facts that survive copied session history:

- persisted entry timestamp;
- assistant message timestamp;
- API/provider/model/responseModel/stopReason/error presence;
- literal usage and cost numbers.

Session ID, session file, cwd, parent session, prompt text, assistant text, and the short Pi entry ID are deliberately excluded from identity.

Consequences:

- importing the original session and a clone of the same assistant response must deduplicate;
- resuming or tree navigation must not create usage;
- a real second model response must remain a distinct event even if the user sent identical text.

Changing identity inputs requires incrementing `IDENTITY_VERSION` and a migration strategy for `seen_events`; silently changing v1 semantics is not allowed.

## Calendar semantics

- Stored instants are UTC epoch milliseconds.
- A database has one fixed IANA reporting timezone chosen at first creation.
- `Today`, day timelines, natural weeks, and natural months use that reporting timezone.
- Weeks start Monday.
- `Last 7 days` and `Last 30 days` are calendar-day windows including today, not rolling 168/720-hour durations.
- Existing compacted history is not re-bucketed into another timezone.
