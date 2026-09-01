# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/2.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2026-09-02

### Changed
- Dashboard leads with **Total Tokens**: the headline shows total tokens next to cost, with input / cache read / output as explanatory breakdowns, and the Summary and Timeline tables gain a Total column. Terminals narrower than 76 columns switch to a compact Total + Cost layout so the essential numbers survive.

## [0.2.0] - 2026-09-01

Published from commit [`f82720d`](https://github.com/frostime/pi-usage-analytics/commit/f82720dfc9b9e1811ec8ed62aea2795539acea9a) (no git tag was cut for this release).

### Added
- `/usage` dashboard for Pi: group usage by Provider/Model, Provider, or working directory, with a daily timeline and time ranges (today, last 7/30 days, this/previous month, all time, custom range).
- History import (`/usage import`) backfills usage from existing Pi session files, deduplicated against already-recorded events.
- Compaction (`/usage compact`) converts old raw events into permanent daily aggregates after a preview; `/usage storage` reclaims unused database space.
- Local-first storage in SQLite (WAL mode) at `~/.pi/agent/usage-analytics/usage.db`. Only usage metadata is stored — never prompt text, assistant responses, thinking, tool arguments, or tool output.

[Unreleased]: https://github.com/frostime/pi-usage-analytics/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/frostime/pi-usage-analytics/compare/f82720dfc9b9e1811ec8ed62aea2795539acea9a...v0.3.0
[0.2.0]: https://github.com/frostime/pi-usage-analytics/commit/f82720dfc9b9e1811ec8ed62aea2795539acea9a
