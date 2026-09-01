---
title: Release and Pi gallery publishing
description: Minimal release gate for publishing the npm package so Pi can install and discover it.
scope:
  - /package.json
  - /README.md
updated: 2026-09-01
---

# Release

Pi discovers npm packages for its gallery through the `pi-package` keyword and loads resources from the `pi` manifest in `package.json`. This package declares `pi.extensions: ["./src/index.ts"]` and does not bundle Pi core packages.

## Release gate

```bash
npm install
npm run check
npm run pack:dry
npm view pi-usage-ledger version
```

The final command should return 404/not-found before the first publish. If the npm name has been claimed, change `name` before release; do not publish under an accidental conflicting package identity.

Inspect the dry-run tarball: it should contain `src/`, `README.md`, `LICENSE`, and `AGENTS.md`, and should not contain databases, test fixtures, or `node_modules`.

Publish:

```bash
npm publish --access public
```

After npm propagation:

```bash
pi install npm:pi-usage-ledger
```

Then verify `/usage` opens, a new turn appears, and the npm package has the `pi-package` keyword. The Pi gallery is derived from npm metadata; no separate extension bundle is required.
