# UI module specification

## Responsibility

`ui/` owns presentation of already-computed usage reports. It may format values, render the interactive dashboard, and adapt presentation to terminal dimensions. It must not query session history, change accounting semantics, or own persistence/maintenance state.

## Dashboard contract

- `/usage` uses a centered Pi overlay in TUI mode.
- The overlay is a focused modal, not a persistent sidebar and not a background widget.
- The overlay renders using the active Pi theme; do not hard-code ANSI colors.
- Range/group/maintenance pickers remain native Pi dialogs. Close the dashboard overlay before opening those dialogs; do not stack modal flows unnecessarily.
- Summary and Timeline remain the only v1 dashboard views.
- Pi-reported `totalTokens` is the primary token-usage metric. The headline must label it explicitly as **Total Tokens**; Input / Cache Read / Output are explanatory breakdowns and must not be substituted for Total.
- Summary and Timeline rows expose `Total` directly. On narrow terminals, preserve Total and Cost before optional breakdown columns.
- Summary row identity and filtering come from `UsageReport`; the UI must not reinterpret provider/model/directory values.
- The panel adapts row count to terminal height and lets Pi clamp overlay width/height on small terminals.
- Non-TUI modes retain the plain notification fallback; overlay support is never required for RPC/print/json operation.

## Complexity boundary

The dashboard may use lightweight box/table helpers local to `ui/`. Do not add a general layout framework, animation loop, mouse model, persistent side panel, or multiple-overlay controller unless a concrete product requirement justifies it.
