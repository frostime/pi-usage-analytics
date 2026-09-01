---
title: Architecture
description: Defines module ownership and dependency direction for Pi Usage Ledger.
scope:
  - /src/**
updated: 2026-09-01
---

# Architecture

The system is a local usage ledger with two ingest paths and one analytics read model.

```mermaid
flowchart TD
    P[Pi turn_end] --> N[pi/ normalize + persisted-entry match]
    H[Manual JSONL import] --> N2[pi/ normalize]
    N --> U[usage/ literal semantics + identity + calendar]
    N2 --> U
    U --> D[storage/ UsageDatabase]
    D --> R[raw usage_events]
    D --> S[seen_events]
    D --> A[daily usage_daily]
    R --> Q[raw + daily query]
    A --> Q
    Q --> C[commands/ + ui/]
    M[maintenance/] --> D
    H --> M
```

## Ownership

| Module | Owns | Must not own |
|---|---|---|
| `usage/` | literal usage semantics, event identity, reporting calendar, query DTOs | Pi APIs, JSONL traversal, SQLite, TUI |
| `pi/` | Pi event/session translation and persisted-entry matching | accounting reinterpretation, persistence |
| `storage/` | schema, migrations, exact dedup, raw/daily mixed queries, compact transactions | Pi lifecycle or user interaction |
| `maintenance/` | explicit import/compact/storage workflows | hidden background jobs |
| `ui/` | terminal rendering and formatting | persistence or accounting rules |
| `commands/` | `/usage` routing and interaction state | database internals |

`UsageDatabase` is intentionally a deep module rather than a repository interface: SQLite-specific concurrency, migrations, dedup, compaction, and mixed queries are one cohesive knowledge boundary. There is no second storage implementation to abstract over.

## Dependency rule

`usage/` depends only on platform primitives. Pi integration may depend on `usage/`; storage may depend on `usage/`; UI consumes query results. No module may reach through `UsageDatabase` to operate on tables directly.
