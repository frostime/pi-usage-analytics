# AGENTS.md

Read `.dev/docs/index.md` before non-trivial changes. Read the nearest module `SPEC.md` before modifying usage semantics, Pi capture/import behavior, storage/compaction, or maintenance workflows.

## Non-negotiable invariants

- Never guess provider/model, total token composition, cache semantics, upstream provider, Git project identity, or missing usage fields.
- Do not put session ID/file/cwd into canonical event identity.
- Do not count tool-result, compaction, or branch-summary usage in headline totals without an explicit reconciliation design.
- All analytics queries must combine raw and daily data before aggregation.
- `seen_events` survives compaction.
- Current reporting day is never compacted.
- History import, compaction, VACUUM, and reset remain explicit user actions; no background scan/maintenance.
- Never persist prompt text, assistant text, thinking, tool arguments, or tool output.
- Capture errors must not break Pi's agent loop.

## Change workflow

1. Identify the owning module from `.dev/docs/architecture.md`.
2. Check its `SPEC.md` for preserved behavior.
3. Add/adjust semantic tests before or with the change.
4. Run `npm run check` and `npm run pack:dry` before release changes.
5. If Pi lifecycle/session behavior is assumed rather than documented by stable types, characterize it against the supported Pi line before changing identity or capture semantics.

Do not add abstraction layers (repositories, buses, daemons, background workers) without a demonstrated second implementation or reproducible pressure that the current deep module cannot contain.
