# Cognia Browser Companion

This repository owns the independently installed Chrome/Edge extension. The Cognia Host remains in [cognia-next](https://github.com/MaxQian888/cognia-next).

- Use Node 26 and the packageManager-pinned pnpm. Install here with `pnpm install --frozen-lockfile`. No parent configuration, sibling checkout, workspace package or network source read may be needed by development, tests, builds or packaging.
- Preserve Chrome MV3, Chrome 116+, optional permission prompts, origin-bound pairing, DPoP device authentication, HTTP capture/status and the negotiated `agent-safe-v1` driving profile. Incognito is disabled. Never add broad install permissions as a testing workaround.
- Keep extension strings in both `public/_locales/en/messages.json` and `public/_locales/zh_CN/messages.json`. Components use the extension's existing browser message API.
- Co-locate meaningful Jest/RTL tests. `pnpm test`, `pnpm test:scripts`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build`, `pnpm zip` and `pnpm test:e2e` are the acceptance commands. Do not run coverage unless requested.
- `vendor/` contains pinned AGPL product snapshots, not independently edited forks. `provenance/source.json` records source revision, dirty-source status and SHA-256 for every imported source. Refresh vendor inputs explicitly and update the hashes; ordinary builds never read another repository.
- Keep the UI snapshot's Tailwind source scan and the injected overlay ABI coupled to their vendored bytes. Host compatibility is checked separately from Chromium's deterministic Host fixture.
- Preserve cancellation at every asynchronous boundary, durable pause until explicit Resume, and the worker as the only writer of session/site-question state. Already dispatched Chrome APIs cannot be rolled back.
- Keep credentials and generated build output out of Git. Preserve AGPL and extraction provenance in `NOTICE`. Review `.github/workflows/release.yml` before altering release behavior; store publishing remains an explicit manual action.
