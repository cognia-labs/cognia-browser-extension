# Migration and compatibility

The standalone repository owns the extension, assets, tests and release archives. The product repository continues to own the Cognia Host, shared source packages and in-app browser overlay. Repository separation changes development ownership, not runtime permissions, pairing endpoints, key slots, preference/session storage keys or the negotiated protocol.

## Pinned inputs

`provenance/source.json` records the product revision, dirty-working-tree status and original SHA-256 of 229 imported files. This extraction intentionally includes the revocation/protocol hardening completed in the same session. It does not claim those bytes were all present in the named committed revision.

| Input                                                  | Local snapshot                       | Contract                                                  |
| ------------------------------------------------------ | ------------------------------------ | --------------------------------------------------------- |
| Device authentication, capture/status and agent schema | `vendor/companion-client/src/`       | Host wire compatibility, stable origin/storage identity   |
| Shared UI primitives                                   | `vendor/plugin-ui/src/`              | Tailwind source scan, React peers, Host appearance tokens |
| Page agent overlay                                     | `vendor/overlay/overlay.injected.js` | Exact executable bytes and overlay ABI 1                  |

The snapshots are checked in and licensed with the product. `file:vendor/*` dependencies and local aliases require no parent workspace, npm pre-publication or sibling checkout. `pnpm standalone:check` rejects escaping local dependencies, including symlinks, and checks the complete recursive vendor inventory and hashes. Refresh vendor sources deliberately from a known product checkout, update provenance hashes, reinstall, then run all checks; ordinary builds never fetch source automatically.

## Host compatibility remains an executable gate

Driving requires envelope v1, the `agent-safe-v1` profile, overlay ABI 1, a Host drive grant, local agent mode and site permission. Legacy peers remain capture/status-only. Unknown envelopes are refused. These requirements preserve fail-closed behavior while Host and extension ship independently.

The parent migration adds `integrations/browser-companion.json` with an immutable extension commit. Its `e2e-browser-extension` CI job checks out that exact commit, compares the shared client and overlay bytes against the proposed Host source, and runs the standalone checks and Chromium suite. A source mismatch requires an explicit consumer refresh, tests and pin update. A branch name or silently changing latest package is insufficient.

`provenance/host-contract.json` additionally freezes 220 product-side source and dependency inputs: companion crates, Host entry points, build scripts and protocol files. The parent gate compares inventories symmetrically and checks every hash, so additions, removals and same-profile auth/schema changes require review. This conservative source fence can also require a refresh after an unrelated Rust dependency or protocol edit; it is not a claim of complete real-Host E2E coverage. Review compatibility, regenerate the Host snapshot from the proposed product source, test the consumer, then update the immutable product pin. Custom build generators must keep their inputs in this inventory; external build inputs require an explicit gate extension.

Changes to authorization retire old Host connections; rapid revoke/regrant cannot revive queued work. Stop/Take over cancels immediately and persists pause until Resume. No already-dispatched Chrome call can be recalled. These semantics stay covered by the product Rust tests and the standalone runtime/Chromium tests.

### Host baseline refresh: 2026-10-23

The extraction merge reviews product revision `bef52bd74080ae4fa7d94b4f2598700f8b8d0862`. Its 220-input inventory is unchanged; 26 hashes change for dependency updates, generated command/schema catalogs, OIDC person bindings and workspace/browser gateway work. The portable client, injected overlay, browser agent envelope/profile and browser-companion WebSocket implementation retain their accepted bytes. OIDC registration changes preserve the extension's owner-invitation pairing path; workspace-runtime recording and page updates use the separate browser gateway.

The previous snapshot rejects this Host at `Cargo.lock`; the reviewed snapshot passes all 232 product/consumer inputs. This refresh changes Host provenance and this receipt only. Consumer CI still runs the complete standalone checks, Chromium flows and archive verification. Product Rust validation and any unrelated baseline failures are recorded in the parent extraction ledger; the real-Host/native-prompt and Edge/store acceptance limits below remain applicable.

## Tooling adaptations

The source tree and all public resources were retained. Path-only test/config adaptations remove the parent tsconfig, root Jest/Playwright fixture paths and `../lib/browser` overlay import. Test diagnostics remain redacted. Node Web APIs are installed in a local Jest environment, with docblocks pointing to it; no product runtime is bootstrapped for unit tests. A saved-prompt test now waits for the edit dialog to close before deleting the prompt; its behavioral assertions are preserved.

The source remains checked by TypeScript 7. The official TypeScript 6 API compatibility alias supplies ESLint, which cannot load the native 7.0 compiler API. See the [TypeScript migration guidance](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-6.0). The application keeps WXT's strict indexed-access checks; the additional E2E/vendor test config keeps the original product test graph's indexed-access setting.

## Upgrade, release and rollback

GitHub releases contain a tested Chrome MV3 archive. The same package supports Edge. Creating a version tag packages first, runs Chromium against that exact build and rechecks every archive byte before publication; it does not submit to either browser store. Store publishing requires its existing account, listing and signing identity.

Every archive includes `LICENSE.txt`, `NOTICE.txt`, `THIRD_PARTY_NOTICES.txt` and `SOURCE.txt`. Dependency notices come from the frozen installation, including shipped Tailwind CSS; missing or empty notices fail the build. Version-specific upstream fallbacks are documented under `licenses/`. The source file links the exact Git commit and marks local dirty builds.

The publisher resolves `refs/tags/<version>` including annotated tags, checks that it still names the tested commit, uploads into a draft and publishes only after verification. Retries find interrupted drafts through the authenticated releases list and compare existing asset digests. Existing public assets are preserved; different bytes require a new version. Same-tag workflow runs are serialized. Administrator force-retagging during the final API call remains outside the client-side transaction; keep release tags protected.

Unpacked extension IDs depend on the absolute installation path. Upgrade in the same directory and reload; moving it changes the origin and requires pairing again. The shipped manifest does not introduce a signing key to impersonate an old extension. Preserve the store identity for store upgrades.

Keep the previous tested archive to roll back. Restore it into the same unpacked directory, or use the store's supported rollback process. If the Host loses profile compatibility, it fails closed for driving while capture/status remain available. Do not roll back the revocation fixes to restore a permissive legacy driving path.

## Acceptance limits

The full Chromium suite exercises production worker/panel/Chrome APIs/overlay against a deterministic Host. A separate shipped-manifest suite asserts optional permissions and documents the loopback-only pregrant used by flow tests. Native browser permission prompts, actual packaged Host plus installed extension, store identity upgrades and real Edge remain release acceptance items. They are not represented by mock Host test results.
