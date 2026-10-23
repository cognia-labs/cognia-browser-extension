# Cognia Browser Companion

[简体中文](README.zh-CN.md) · [Cognia](https://github.com/MaxQian888/cognia-next) · [Website](https://github.com/cognia-labs/cognia-website)

A Chrome and Edge side panel for sending the page you are reading to Cognia, and optionally letting your Cognia agent work in your browser. This repository owns the complete extension, its tests and release archives.

## Install

Download a Chrome archive from [Releases](https://github.com/cognia-labs/cognia-browser-extension/releases), extract it, open `chrome://extensions` or `edge://extensions`, enable Developer mode, and choose **Load unpacked**. Select the extracted directory containing `manifest.json`. Chrome 116 or later is required. Store publication is separate from repository releases.

In Cognia, enable Browser Access and create a Browser Companion pairing code. Open the extension panel, paste the code, and accept the optional loopback permission. Pairing, keys, origin binding and existing browser storage identifiers are preserved from the product workspace.

For an unpacked upgrade, use the same directory and **Reload** to preserve its path-derived extension ID. Moving the unpacked directory changes the ID and requires pairing again. A published store extension must retain its existing signing/store identity.

## Features

- Pick several elements in one pass: Shift-, ⌘- or Ctrl-click adds or removes one, Alt-click takes every element alike (same tag and classes), and a box dragged over the page takes the controls, headings, text and images inside it, previewed as it is drawn. Chosen elements stay outlined and numbered until Enter, Done or a last plain click adds them all. With two or more picks the panel compares their computed styles — the properties that differ, odd values marked — and can send that table with the task. Each pick folds to one line with its component, note and edit status, and can be located or removed from there; a batch arrives folded, a single pick open.
- The keyboard focus check draws the Tab order as numbered stops joined by curved arrows that draw in sequence; a jump back up the page is a red dashed arrow, and stops with findings are red.
- Pointing at the page feels alive: the highlight glides from element to element following its rounded corners, and a pick confirms with a green pulse before the overlay goes — never in the screenshot, and none of it when the system asks for reduced motion. New picks, measurements and attachments ease into the panel; a whole page of captured text stays in a scrolling box with its size shown, opened with Show more.
- The panel is laid out as cards — capture, inspect & edit, page tools, page audit, recent tasks and settings — each headed by what it is for, with the inspect tools as tiles that show which one is running. Colours follow the Host's appearance.
- Capture a page, article or selection as editable Markdown, with metadata and supported transcripts.
- Attach screenshots, crop a region and include additional pages; choose the Host's delivery target and follow submission status.
- Pick elements on the page for your agent: each pick carries a unique selector, role and text, computed styles, parent layout, a screenshot and — in development builds of React, Vue, Svelte and Angular — the component chain and source position. Try style and text edits live on the page and send them as a before/after change request.
- Record the console, the page's requests and the steps you take — clicks, keys, form submits, navigation, never what you type — while reproducing a bug, and attach the report; lay a design export over the page to compare (opacity, offset, difference blend) and measure the difference — the visible page against the mock, pixel by pixel, as a mismatch share, the regions that differ and a highlighted image that is attached; open the page at phone, tablet, laptop and desktop viewport sizes; and simulate the page's own requests (Requestly) — make matching fetch, XHR and beacon calls fail, answer with a status, headers and body, change the server's real answer (JSON merged in, status and headers replaced), wait, or go to another address — matched by URL part, `*` wildcard or `/regular expression/`, with one-click presets (offline, slow, server error, empty list, signed out, flaky), a limit to the first few matches or a chance of striking, and rules that can be paused. Rules last until the page reloads, or, kept, come back in that tab before the page's own scripts run (asking for that site's permission only then); requests caught are logged as they happen, and the simulated ones are named in what is sent so their failures are not taken for the backend's.
- Float the tools on the page itself: a draggable, collapsible toolbar (VisBug, UiToolbar) picks, measures, adjusts the last pick, edits the page's text and takes a screenshot to mark up — each run exactly as the panel's own button would, for as long as the panel is open. It is never picked, checked, recorded or captured in a screenshot. Dragged to the top or bottom edge it lies down and docks there; it keeps its size on screen at any zoom, and once a page that does not fit is zoomed in — the browser's zoom or a pinch — a minimap shows the whole page as a wireframe with the visible part boxed and the picks marked. Click or drag on it to scroll there; it can also be shown or hidden from the toolbar at any zoom. Snapping is opt-in, under the toolbar's tile in the panel: once on, the toolbar glides to the nearer side when let go (and to the middle when let go near it), or along the top or bottom to a side or the middle, and stays attached there as the window and zoom change.
- Shift-click to pick several elements in one pass; picks from development builds also carry the component's props and state (React's state hooks in call order or a class's state, Vue's data and setup state), with secrets redacted. Copy the reviewed context as one prompt for another tool, or save it as a Markdown file.
- Measure between elements on the page: click one, then another, to see the gap — or, when one holds the other, the inset on every side — drawn on the page in CSS pixels, with near-miss alignment flagged. Shift-click keeps measuring from the same element; "Show & re-measure" reads the numbers again after a previewed edit. Each measurement carries a note of what it should be.
- Mark up screenshots before sending: boxes, arrows, freehand strokes and numbered markers in four colours, with undo. The marks are drawn into the image and each marker's note travels as text; "Mark up screen" captures the visible area straight into the editor, and marking up again starts from the clean shot.
- The picker shows each margin and padding in pixels and the element's font as you point. "Edit text" makes the page's words editable in place (Design Mode); "Done" reads every change back as before → after for the agent to make in the source, and "Undo all" unwinds them through the browser's own undo.
- Picks carry the element's cleaned markup (no form values, handlers or scripts); copy any pick as HTML plus its CSS, with your previewed edits. "Adjust on page" resizes a pick by dragging its right or bottom edge and nudges its margin with the arrow keys (Shift for 10px, Alt to shrink, P for padding); Enter keeps the result as style edits and Escape puts the element back. A pick with text shows its contrast against what is behind it, rated for WCAG AA and AAA, and offers the nearest colour that passes as a one-click edit.
- Check the page before sending: a WCAG 2.2 AA first pass (alternative text, names, labels, contrast, headings, target size and more) whose findings become picks in one click; the page's design tokens (colours, type scale, spacing, radii, shadows, CSS variables, breakpoints) with a screen eyedropper; what it is built with (Wappalyzer) — app and UI frameworks, CMS and site generators, component libraries, styling, state libraries, build tools, libraries, analytics, monitoring, payments, auth and hosting, with versions from the page's globals, its generator tag and the package versions in its CDN addresses and import map, each with the evidence it rests on, plus how much script and CSS the page loads, over what protocol and from which other sites; and how this visit performed — Web Vitals (LCP, CLS, slowest interaction, FCP, TTFB, blocked time) from the browser's own timeline, scripts behind long frames, render-blocking, largest and slowest resources, third parties and oversized images; and SEO and link previews — title, description, canonical, robots, Open Graph and Twitter tags, structured data and the heading outline, with a preview of the card a shared link shows; a keyboard focus check that numbers the Tab stops on the page and finds positive tabindex, stops nobody can see, focus jumping back up the page and clickable things the keyboard cannot reach; and a layout check at the current window size — what makes the page scroll sideways, text cut off by its box, stretched images and text under 12px — whose findings, like the accessibility ones, can be shown on the page or picked. Each is sent only while it stays included.
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
```

`pnpm build` produces `build/chrome-mv3/`; `pnpm zip` creates the installable archive under `build/`. The development build is under `build/chrome-mv3-dev/`. CI verifies an independent install, formatting, lint, types, all unit tests, real Chromium flows and archive contents. `pnpm test:e2e` packages first, tests that build, then verifies the archive still contains exactly those bytes. Archives include project and dependency notices plus the exact source commit.

Chromium E2E exercises the real MV3 worker, panel, Chrome APIs and injected overlay against a deterministic HTTP/WebSocket Host. The loop profile pre-grants only loopback access because Chrome's native permission bubble cannot be automated. Separate tests load the shipped manifest and assert the actual optional-permission posture. Native prompts, signing/store upgrades and the packaged Cognia Host require release acceptance; mock Host tests do not establish those results.

## Repository boundaries

`src/` and `public/` are the extension. `vendor/companion-client`, `vendor/plugin-ui` and `vendor/overlay` are pinned source snapshots with their tests. They replace monorepo-only dependencies without requiring npm publication or another checkout. `provenance/source.json` records the exact source bytes, including the current-repository revocation fixes imported at extraction.

Protocol or overlay changes must be coordinated with the Host. See [migration and compatibility](docs/migration.md) for ownership, source refresh, clean-install validation and rollback. Normal install/build/test does not contact the product repository.

Release retries resolve the exact tag, recover interrupted drafts and retain existing asset bytes. A different archive requires a new version; published assets are never replaced.

AGPL-3.0-only. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
