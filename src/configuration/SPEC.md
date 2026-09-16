# Configuration contract

`configuration/` contains two distinct kinds of application configuration. `config-home.ts` derives local file locations; `user-settings.ts` defines durable user-owned defaults. Consumers import the specific file they need. Do not add an `index.ts` that hides this distinction.

## Dashboard default view

- The dashboard default is stored as one `dashboard_default_view` record in the database `settings` table.
- Its JSON value carries its own integer `schema`, independent of SQLite `PRAGMA user_version`.
- The stored range is a range choice, not dates resolved from a relative choice.
- Missing data, malformed JSON, and unknown schemas use the complete built-in default.
- Within a known schema, an invalid range or grouping field falls back independently.
- Loading never repairs or writes the stored record. Only an explicit user save action (`/usage save-default` or the dashboard `s` key) writes it.
- Each durable setting has named load/save functions. Do not add a generic application-setting registry without a concrete need.

This module does not decide whether the caller is interactive or which Pi session is active. Those decisions belong to the command layer.
