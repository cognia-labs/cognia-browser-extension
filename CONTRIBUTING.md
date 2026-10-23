# Contributing

Use Node 26 and the pinned pnpm. Run `pnpm install --frozen-lockfile`, `pnpm check`, `pnpm format:check`, `pnpm test:e2e` and `pnpm zip` before opening a pull request. Install Chromium with `pnpm exec playwright install chromium` first. Preserve co-located tests, both browser locales, narrow permissions and existing storage/signing identities.

Keep vendored product snapshots unchanged unless intentionally refreshing their source and provenance. Coordinate protocol and overlay changes with the product Host. Include the actual test results, screenshots for UI changes, compatibility impact and any unverified native permission or upgrade behavior in the PR.

Use Conventional Commits and focused changes. Do not commit secrets, browser profiles, generated archives or build directories. Security reports follow [SECURITY.md](SECURITY.md).
