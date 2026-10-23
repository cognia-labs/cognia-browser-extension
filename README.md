# Cognia Browser Companion

[简体中文](README.zh-CN.md) · [Cognia](https://github.com/MaxQian888/cognia-next) · [Website](https://github.com/cognia-labs/cognia-website)

A Chrome and Edge side panel for sending the page you are reading to Cognia, and optionally letting your Cognia agent work in your browser. This repository owns the complete extension, its tests and release archives.

## Install

Download a Chrome archive from [Releases](https://github.com/cognia-labs/cognia-browser-extension/releases), extract it, open `chrome://extensions` or `edge://extensions`, enable Developer mode, and choose **Load unpacked**. Select the extracted directory containing `manifest.json`. Chrome 116 or later is required. Store publication is separate from repository releases.

In Cognia, enable Browser Access and create a Browser Companion pairing code. Open the extension panel, paste the code, and accept the optional loopback permission. Pairing, keys, origin binding and existing browser storage identifiers are preserved from the product workspace.

For an unpacked upgrade, use the same directory and **Reload** to preserve its path-derived extension ID. Moving the unpacked directory changes the ID and requires pairing again. A published store extension must retain its existing signing/store identity.

## Features

- Capture a page, article or selection as editable Markdown, with metadata and supported transcripts.
- Attach screenshots, crop a region and include additional pages; choose the Host's delivery target and follow submission status.
- Reuse saved instructions and quick actions, with English and Chinese interfaces and Host appearance synchronization.
- Opt into agent mode with per-site permission decisions. The agent can inspect pages and operate tabs through the production injected overlay.
- Stop or take over immediately; execution stays paused until explicit Resume. Revocation, disconnect, disablement and deadlines cancel pending work.

Installation grants no broad page access. Page access, agent mode, notifications, downloads and cookies are requested by their features. No static content scripts, debugger, native messaging or incognito access are enabled. See [security and privacy](SECURITY.md).

## Develop and verify

Use the Node version in `.nvmrc` and the pnpm version pinned in `package.json`:

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm check
pnpm format:check
pnpm exec playwright install chromium
pnpm test:e2e
pnpm zip
```

`pnpm build` produces `build/chrome-mv3/`; `pnpm zip` creates the installable archive under `build/`. The development build is under `build/chrome-mv3-dev/`. CI verifies an independent install, formatting, lint, types, all unit tests, real Chromium flows and archive contents.

Chromium E2E exercises the real MV3 worker, panel, Chrome APIs and injected overlay against a deterministic HTTP/WebSocket Host. The loop profile pre-grants only loopback access because Chrome's native permission bubble cannot be automated. Separate tests load the shipped manifest and assert the actual optional-permission posture. Native prompts, signing/store upgrades and the packaged Cognia Host require release acceptance; mock Host tests do not establish those results.

## Repository boundaries

`src/` and `public/` are the extension. `vendor/companion-client`, `vendor/plugin-ui` and `vendor/overlay` are pinned source snapshots with their tests. They replace monorepo-only dependencies without requiring npm publication or another checkout. `provenance/source.json` records the exact source bytes, including the current-repository revocation fixes imported at extraction.

Protocol or overlay changes must be coordinated with the Host. See [migration and compatibility](docs/migration.md) for ownership, source refresh, clean-install validation and rollback. Normal install/build/test does not contact the product repository.

AGPL-3.0-only. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
