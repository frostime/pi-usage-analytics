---
title: Compatibility contract
description: Defines supported Pi/Node runtime assumptions and the Pi lifecycle behavior this extension relies on.
scope:
  - /package.json
  - /src/index.ts
  - /src/pi/**
updated: 2026-09-01
---

# Compatibility

## Supported runtime

- Pi: `0.84.x` is the supported v1 line.
- Node: `>=22.19.0`, matching the Pi runtime line and providing built-in `node:sqlite` without an external native dependency.
- Characterized lifecycle run: Pi `0.84.1`, Node `24.12.0`, Windows x64.

Earlier Pi versions are not part of the support contract. The package keeps Pi core modules as `peerDependencies: "*"` because that is Pi package-manager guidance; the narrower tested/supported range is documented here and in README rather than forcing npm to install a second Pi runtime.

## Pi contracts relied on

- `turn_end` is emitted after the corresponding assistant message has been persisted to SessionManager.
- `agent_settled` marks the end of the full session-level run after automatic retry/compaction/queued continuation, and is used as the primary realtime flush boundary.
- `session_shutdown` is emitted before extension runtime teardown and is used for one final best-effort flush.
- Tool-use turns may have a toolResult leaf by `turn_end`; matching must search persisted entries.
- Session entries have stable timestamps and copied fork/clone history retains the original entry/message facts needed by identity.
- Default sessions are stored under project-specific directories beneath the Pi sessions root; custom session directories may be flat.
- Package extensions may import `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` as peer-provided Pi core modules.
- TUI mode supports `ctx.ui.custom(..., { overlay: true, overlayOptions })`; v0.1.2 uses centered percentage-sized overlays with `anchor`, `width`, `minWidth`, `maxHeight`, and `margin`.

When upgrading the supported Pi line, rerun the lifecycle/identity characterization before changing capture or identity semantics.
