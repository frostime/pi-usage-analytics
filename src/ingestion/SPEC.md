# Realtime ingestion contract

This module owns the process-local lifetime of already-normalized, identified usage facts before they reach the durable SQLite ledger.

## Responsibility boundary

Realtime ingestion optimizes for Pi Coding responsiveness over synchronous telemetry durability.

- `turn_end` facts may remain only in memory until a later flush opportunity.
- `agent_settled` is the primary batch boundary because one user request may contain many tool-driven turns.
- A SQLite writer conflict must not cause a long realtime wait. If a fast batch attempt reports `SQLITE_BUSY`, retain the batch and retry at a later flush opportunity.
- The buffer is deliberately not a durable queue. Process termination can lose pending facts; manual history import is the recovery path because Pi session JSONL contains the persisted assistant messages.

## Identity and batching

Batching changes transaction frequency, not accounting identity. Keep every assistant response as a distinct identified fact until SQLite deduplication runs. Never pre-aggregate multiple turns into one synthetic event: history import must still be able to reconcile individual persisted assistant entries.

Duplicate event keys inside one process-local pending batch may be coalesced because they represent the same canonical event.

## Bounded memory

The pending buffer must be bounded. If it reaches its configured limit while SQLite remains unavailable, dropping old pending facts is acceptable telemetry loss and must not block or crash Pi. Do not add a fallback spool file, daemon, worker, or second durability layer solely to make this buffer lossless.

## Flush opportunities

The runtime should make best-effort flush attempts at:

- `agent_settled`;
- before serving `/usage` commands when practical;
- `session_shutdown` before closing the database connection.

A failed best-effort flush does not invalidate the underlying Pi session history and must not fail the agent lifecycle.
