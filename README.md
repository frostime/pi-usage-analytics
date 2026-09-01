# Pi Usage Ledger

Local usage analytics for Pi. It records attributable assistant-model usage into SQLite and gives `/usage` a lightweight interactive dashboard with provider/model, directory, and calendar-time views.

## What it tracks

For each Pi assistant response with explicit provider/model usage metadata:

- `<provider>/<model>` exactly as Pi reports it;
- input, output, cache-read, and cache-write tokens;
- Pi's reported `totalTokens` without recomputing it;
- optional reasoning/cache-write-1h fields when Pi reports them;
- Pi's estimated USD cost breakdown and total;
- normalized session cwd;
- UTC event time and a fixed reporting-timezone calendar day.

It does **not** inspect provider billing APIs and does not claim account-billing precision. Cost is the amount Pi reports for the response.

## Install

Requires Pi `0.84.x` and Node `>=22.19.0`.

```bash
pi install npm:pi-usage-ledger
```

Try a local checkout without permanent installation:

```bash
pi -e .
```

The lifecycle/identity behavior used by v1 was characterized on Pi `0.84.1` (Node `24.12.0`, Windows x64) and is implemented against the current `0.84.x` extension/session API shape. Earlier Pi lines are not supported by v1.

## Use

Run:

```text
/usage
```

The dashboard is intentionally terminal-simple. Its footer shows the available keys:

- `↑/↓`: select a summary row;
- `Enter`: inspect that provider/model/provider/directory over the timeline;
- `←/→`: switch Summary / Timeline;
- `r`: choose Today, 7d, 30d, current/previous month, all time, or custom range;
- `g`: group by Provider / Model, Provider, or Directory;
- `m`: maintenance menu;
- `q`: close.

Power-user entry points are also available:

```text
/usage import
/usage compact
/usage storage
/usage help
```

Normal use only requires remembering `/usage`.

## Time semantics

The database chooses the current OS IANA timezone when it is first created and keeps it as the reporting timezone.

- event timestamps remain absolute UTC milliseconds;
- `Today`, day timelines, weeks, and months use the stored reporting timezone;
- weeks start Monday;
- 7d/30d means calendar days including today, not rolling 168/720 hours;
- timezone does not silently change when the machine later moves to another timezone.

This is necessary because old raw events can be destructively compressed into day aggregates.

## History import

History is never scanned automatically. Use `/usage import` and choose:

- Last 30 days;
- All history;
- Since a date.

The importer reads Pi session JSONL in streaming mode, scans all persisted branches, does not modify session files, and globally deduplicates cloned/copied history. Date-limited imports prune session files that are definitely older before parsing them.

## Compress old raw data

`/usage compact` converts old event-level rows into permanent daily provider/model/directory aggregates. The recommended retention keeps the latest 30 calendar days as raw events.

Before deletion, Pi Usage Ledger shows a preview and requires confirmation. After compression you retain:

- day/week/month/date-range analytics;
- provider/model/provider/directory breakdowns;
- input/output/cache-read/cache-write totals;
- estimated cost and turn counts;
- exact import deduplication.

You lose individual-message, session-level, and sub-day detail for the compressed events.

Compaction and physical SQLite file shrinking are separate. Use `/usage storage` → **Reclaim unused DB space** to run an explicit `VACUUM` when desired.

## Storage and privacy

Default database:

```text
~/.pi/agent/usage-ledger/usage.db
```

`PI_CODING_AGENT_DIR` is respected.

The ledger does not store prompt text, assistant text, thinking, tool arguments, or tool output. It stores usage metadata and raw cwd/session provenance only while an event remains uncompressed; permanent daily rows keep cwd but not session/message detail. Dedup keys remain after compaction so a later history import cannot charge old copied messages again.

SQLite uses WAL, short transactions, and bounded lock retry so multiple Pi terminals can record into the same database. A concurrency regression test runs two writers and a compactor against one database.

## Accounting scope

V1 headline totals count only assistant responses that Pi explicitly attributes to a provider and model.

Tool-result-reported nested usage, compaction usage, and branch-summary usage are not added to the main totals because they do not carry the same reliable provider/model attribution and may overlap nested session usage. The extension prefers an incomplete-but-literal attributable total over guessed or double-counted accounting.

## Development

```bash
npm install
npm run check
npm run pack:dry
```

Developer documentation starts at `.dev/docs/index.md`. Module maintenance contracts live in `src/*/SPEC.md`. Root agent instructions are in `AGENTS.md`.

## Publish to the Pi package gallery

The package manifest contains the required `pi-package` keyword and `pi.extensions` declaration. Pi's package gallery discovers npm packages from that metadata.

Before first publish, confirm the npm name remains available:

```bash
npm view pi-usage-ledger version
```

Then:

```bash
npm run check
npm run pack:dry
npm publish --access public
```

See `.dev/docs/release.md` for the release gate.

## License

MIT
