---
title: Development workflow
description: Commands and checks for making changes without violating storage or Pi integration contracts.
scope:
  - /src/**
  - /test/**
  - /package.json
updated: 2026-09-01
---

# Development workflow

Use Node 22.19+ and install dev dependencies:

```bash
npm install
npm run check
npm run pack:dry
```

`npm run check` performs TypeScript checking against installed Pi peer packages and executes the test suite. Tests run TypeScript directly with Node type stripping; production Pi loads the TypeScript extension through Pi's package loader.

## High-value tests

- `test/capture.test.ts`: assistant persisted-entry matching when toolResult is the leaf.
- `test/realtime-buffer.test.ts`: agent-run batching primitives, busy-retain behavior, duplicate coalescing, and bounded pending memory.
- `test/history-import.test.ts`: all-branch import plus copied-session global dedup.
- `test/storage.test.ts`: idempotence, compaction equivalence, and late raw events after compaction.
- `test/sqlite-concurrency.test.ts`: concurrent writers plus compactor against the same WAL database.
- `test/calendar.test.ts`: reporting timezone, relative range re-resolution, and all-time bounds.
- `test/schema-migration.test.ts`: ordered schema steps, reopen stability, and newer-schema rejection.
- `test/user-settings.test.ts`: dashboard default persistence, unknown-schema fallback, and field-level repair-on-read.
- `test/usage-command-session.test.ts`: session-local dashboard view, explicit save actions (command and dashboard), argument completion, help coverage, and non-TUI isolation.

Add tests at the semantic boundary being changed rather than snapshotting TUI output.

## Database changes

Before changing schema or compaction behavior, read `src/storage/SPEC.md`. For any schema change, append the next integer-versioned step to `src/storage/schema.ts`; never modify a migration that may already have shipped. Each step and its `PRAGMA user_version` update must commit atomically. Startup must migrate deterministically or reject the database. Never reinterpret existing daily rows without an explicit migration.

## Local Pi smoke test

From the repository root:

```bash
pi -e .
```

Then use `/usage`, make one model turn, reopen `/usage`, and verify the current provider/model appears. Exercise `/usage import` only on a disposable or understood session tree during development because it intentionally scans user history when requested.


## UI changes

Dashboard changes should keep rendering pure with respect to accounting: obtain one `UsageReport`, then render it. Validate both the TUI overlay path and the non-TUI fallback. Overlay changes must remain within the Pi `0.84.x` `ctx.ui.custom`/`OverlayOptions` contract documented in `compatibility.md`.
