# Pi integration contract

This module translates Pi runtime/session facts into the usage semantics defined by `src/usage/`.

## Realtime capture

Attributed model usage is captured from `turn_end`, not `message_end`.

At `turn_end`, locate the persisted assistant `message` entry by matching the event assistant message against persisted session entries. Do not assume the current leaf is the assistant entry: after tool use the leaf can already be a `toolResult` entry.

If the persisted assistant entry cannot be found or cannot be normalized without guessing, fail that capture and surface a throttled warning. Do not fabricate an entry identity.

## Included usage

V1 headline accounting includes only assistant messages with explicit `provider`, `model`, and Pi `usage` data.

The following are intentionally excluded from headline totals:

- tool-result-reported nested usage;
- compaction usage;
- branch-summary usage.

They lack the same reliable provider/model attribution and may overlap nested session usage. Adding them later requires an explicit reconciliation contract; do not simply sum them into the main ledger.

## History semantics

History import reads JSONL files as data. It must not load them through APIs that rewrite/migrate the user's session files.

Every persisted assistant entry in a session file is eligible, including entries on inactive `/tree` branches, because those model calls already happened and incurred usage.

Copied session files are expected. Global event identity, not session/file identity, prevents double counting.
