---
title: Developer documentation index
description: Routes maintainers to the smallest document that answers architecture, correctness, development, compatibility, or release questions.
updated: 2026-09-01
---

# Developer docs

- [architecture.md](architecture.md) — Read before changing module boundaries or adding a new data path. Maps responsibilities and dependency direction.
- [data-lifecycle.md](data-lifecycle.md) — Read when touching capture, import, dedup, querying, compaction, or timezone behavior. Explains the cross-module correctness model.
- [development.md](development.md) — Read when setting up, testing, debugging, or adding migrations.
- [compatibility.md](compatibility.md) — Read before using newer Pi lifecycle/session APIs or changing the supported runtime range.
- [release.md](release.md) — Read before publishing to npm/Pi gallery. Contains package-manifest and release checks.

Module-level maintenance contracts live beside the code:

- `src/usage/SPEC.md`
- `src/pi/SPEC.md`
- `src/ingestion/SPEC.md`
- `src/storage/SPEC.md`
- `src/maintenance/SPEC.md`
- `src/ui/SPEC.md`
