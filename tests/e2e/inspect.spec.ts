/**
 * Pointing at the page: pick an element, try a change on it, hand both over.
 *
 * Only a real browser can check this. The pick is a trusted click the page
 * must never see, the framework read happens in the page's MAIN world — a
 * separate JS realm jsdom does not have — and the style preview is judged by
 * what the browser computes, not by what was written.
 *
 * Runs on the `granted` profile for the reason `capture-and-submit.spec.ts`
 * gives: the shipped build reaches the same `chrome.scripting` calls through
 * `activeTab`, which only browser chrome can grant.
 */
import { expect, pairThroughPanel, requestCapture, tabIdOf, test, type Page } from "./fixtures"
import type { MockHost } from "./mock-host"

test.use({ extensionProfile: "granted" })

/** A button that a React development build would have rendered, fiber and all. */
const INSPECT_FIXTURE_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Settings — Example</title></head>
  <body>
    <main style="display:flex;gap:12px;padding:24px">
      <h1>Settings</h1>
      <button id="save" class="btn primary" style="padding:8px 16px;font-size:14px">Save changes</button>
    </main>
    <script>
      function SaveButton() {}
      function SettingsPage() {}
      const save = document.getElementById("save")
      save["__reactFiber$e2e"] = {
        type: "button",
        _debugSource: { fileName: "/src/SaveButton.tsx", lineNumber: 12, columnNumber: 5 },
        return: { type: SaveButton, return: { type: SettingsPage, return: null } },
      }
      save.addEventListener("click", () => { window.__pageSawClick = true })
    </script>
  </body>
</html>`

async function capturedFixture({
  panel,
  mockHost,
  serviceWorker,
  context,
  html = INSPECT_FIXTURE_HTML,
}: {
  html?: string
  panel: Page
  mockHost: MockHost
  serviceWorker: import("@playwright/test").Worker
  context: import("@playwright/test").BrowserContext
}): Promise<Page> {
  await pairThroughPanel(panel, mockHost.issueEnrollment())
  await expect(panel.getByTestId("capture-empty")).toBeVisible()
  const pageUrl = mockHost.servePage("settings", html)
  const content = await context.newPage()
  await content.goto(pageUrl)
  await requestCapture(serviceWorker, await tabIdOf(serviceWorker, pageUrl), "auto")
  await expect(panel.getByTestId("capture-preview")).toBeVisible()
  return content
}

test.describe("picking an element", () => {
  test("names the component and its source, previews an edit, and sends both", async ({
    panel,
    mockHost,
    serviceWorker,
    context,
  }) => {
    const content = await capturedFixture({ panel, mockHost, serviceWorker, context })

    await panel.getByTestId("pick-element").click()
    await expect(panel.getByTestId("pick-waiting")).toBeVisible()
    // The highlight is the extension's, in a closed shadow root on the page.
    await expect(content.locator("#__cognia-element-picker")).toHaveCount(1)
    await content.locator("#save").click()

    await expect(panel.getByTestId("pick-0")).toBeVisible()
    await expect(content.locator("#__cognia-element-picker")).toHaveCount(0)
    expect(
      await content.evaluate(() => (window as { __pageSawClick?: boolean }).__pageSawClick)
    ).toBeUndefined()
    await expect(panel.getByTestId("pick-components-0")).toContainText("SaveButton ← SettingsPage")
    await expect(panel.getByTestId("pick-source-0")).toContainText("/src/SaveButton.tsx:12:5")
    // The stamp that let the main world find the button is gone again.
    await expect(content.locator("[data-cognia-probe]")).toHaveCount(0)

    await panel.getByTestId("pick-styles-toggle-0").click()
    await panel.getByTestId("style-font-size").fill("20px")
    await expect
      .poll(() =>
        content.evaluate(() => getComputedStyle(document.getElementById("save")!).fontSize)
      )
      .toBe("20px")

    await panel.getByTestId("pick-note-0").fill("Make it the primary action")
    await panel.getByTestId("submit").click()
    await expect(panel.getByTestId("pick-0")).toHaveCount(0)

    const [submission] = mockHost.submissions()
    const sent = submission?.selectionText ?? ""
    expect(submission?.captureMode).toBe("selection")
    expect(sent).toContain("## Picked elements (1)")
    expect(sent).toContain("- Selector: `#save`")
    expect(sent).toContain("`SaveButton` → `SettingsPage`")
    expect(sent).toContain("- Written at: `/src/SaveButton.tsx:12:5`")
    expect(sent).toContain("font-size: 20px; /* was 14px */")
    expect(sent).toContain("**Requested:** Make it the primary action")
    // The cleaned markup goes with the pick.
    expect(sent).toContain("Markup (cleaned):")
    expect(sent).toContain(
      '<button id="save" class="btn primary" style="padding:8px 16px;font-size:14px">Save changes</button>'
    )
    // Sent, so the page is back to what its source says.
    await expect
      .poll(() =>
        content.evaluate(() => getComputedStyle(document.getElementById("save")!).fontSize)
      )
      .toBe("14px")
    expect(await content.locator("#save").getAttribute("style")).toBe(
      "padding:8px 16px;font-size:14px"
    )
  })

  test("Escape ends a pick without adding anything", async ({
    panel,
    mockHost,
    serviceWorker,
    context,
  }) => {
    const content = await capturedFixture({ panel, mockHost, serviceWorker, context })
    await panel.getByTestId("pick-element").click()
    await expect(content.locator("#__cognia-element-picker")).toHaveCount(1)
    await content.keyboard.press("Escape")
    await expect(panel.getByTestId("pick-element")).toBeVisible()
    await expect(content.locator("#__cognia-element-picker")).toHaveCount(0)
    await expect(panel.getByTestId("picked-elements")).toHaveCount(0)
  })
})

/** A page with a picture nobody described, rendered by a "React" build. */
const AUDIT_FIXTURE_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Gallery — Example</title></head>
  <body>
    <main>
      <h1>Gallery</h1>
      <img id="hero" src="hero.png" width="40" height="40" />
      <p id="one">First</p>
      <p id="two">Second</p>
    </main>
    <script>
      document.getElementById("one")["__reactFiber$e2e"] = { type: "p", return: null }
    </script>
  </body>
</html>`

/** A page that says what it is built with in several of the ways real ones do. */
const STACK_FIXTURE_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Stack — Example</title>
    <meta name="generator" content="Hugo 0.125.4" />
    <script type="importmap">{"imports":{"vue":"https://esm.sh/vue@3.4.21"}}</script>
    <style>
      @layer theme, base, components, utilities;
      @property --tw-shadow { syntax: "*"; inherits: false; initial-value: 0 0 #0000; }
      :root { --bs-primary: #0d6efd; }
    </style>
  </head>
  <body>
    <my-widget>Widget</my-widget>
    <div x-data="{ open: false }">Menu</div>
    <script>
      window.__SENTRY__ = { version: "8.30.0" }
    </script>
  </body>
</html>`

test.describe("checking the page", () => {
  test("details the stack: versions, evidence and how the page is put together", async ({
    panel,
    mockHost,
    serviceWorker,
    context,
  }) => {
    await capturedFixture({ panel, mockHost, serviceWorker, context, html: STACK_FIXTURE_HTML })
    await panel.getByTestId("page-audit-toggle").click()
    await panel.getByTestId("insight-run-stack").click()
    await expect(panel.getByTestId("stack-group-cms")).toContainText("Hugo0.125.4")
    await expect(panel.getByTestId("stack-group-framework")).toContainText("Vue3.4.21")
    await expect(panel.getByTestId("stack-group-framework")).toContainText("Alpine.js")
    await expect(panel.getByTestId("stack-group-styling")).toContainText("Tailwind CSS· v4")
    await expect(panel.getByTestId("stack-group-styling")).toContainText("Bootstrap· v5")
    await expect(panel.getByTestId("stack-group-monitoring")).toContainText("Sentry8.30.0")
    await expect(panel.getByTestId("stack-elements")).toContainText("<my-widget>")
    await expect(panel.getByTestId("stack-fact-scripts")).toBeVisible()
    await panel.getByTestId("stack-evidence-toggle").click()
    await expect(panel.getByTestId("stack-evidence")).toContainText("esm.sh: vue@3.4.21")

    await panel.getByTestId("instruction").fill("Upgrade the widget")
    await panel.getByTestId("submit").click()
    await expect(panel.getByTestId("recent-list")).toBeVisible()
    const sent = mockHost.submissions()[0]?.selectionText ?? ""
    expect(sent).toContain('- CMS / site generator: Hugo 0.125.4 — <meta name="generator">')
    expect(sent).toContain("Tailwind CSS (v4) — @property --tw-* rules")
    expect(sent).toContain("Custom elements: <my-widget>.")
  })

  test("turns a finding into a pick, frames it with the stack, and sends both", async ({
    panel,
    mockHost,
    serviceWorker,
    context,
  }) => {
    await capturedFixture({ panel, mockHost, serviceWorker, context, html: AUDIT_FIXTURE_HTML })
    await panel.getByTestId("page-audit-toggle").click()

    await panel.getByTestId("insight-run-stack").click()
    // Read in the MAIN world: the fiber key is invisible to the isolated one.
    await expect(panel.getByTestId("stack-result")).toContainText("React")

    await panel.getByTestId("insight-run-audit").click()
    await expect(panel.getByTestId("a11y-issue-0")).toContainText("#hero")
    await panel.getByTestId("a11y-pick-0").click()
    await expect(panel.getByTestId("pick-0")).toContainText("img#hero")

    await panel.getByTestId("submit").click()
    await expect(panel.getByTestId("pick-0")).toHaveCount(0)
    const sent = mockHost.submissions()[0]?.selectionText ?? ""
    expect(sent.indexOf("## Tech stack")).toBeGreaterThanOrEqual(0)
    expect(sent.indexOf("## Tech stack")).toBeLessThan(sent.indexOf("## Picked elements (1)"))
    expect(sent).toContain("- Framework: React")
    expect(sent).toContain("- Selector: `#hero`")
    expect(sent).toContain("## Accessibility check")
    expect(sent).toContain("[critical] Image has no text alternative — `#hero`")
  })

  test("chooses several with Shift-click, and adds them with the last plain click", async ({
    panel,
    mockHost,
    serviceWorker,
    context,
  }) => {
    const content = await capturedFixture({
      panel,
      mockHost,
      serviceWorker,
      context,
      html: AUDIT_FIXTURE_HTML,
    })
    await panel.getByTestId("pick-element").click()
    await expect(content.locator("#__cognia-element-picker[data-cognia-pointing]")).toHaveCount(1)
    await content.locator("#one").click({ modifiers: ["Shift"] })
    // Still choosing, in the same pass: nothing added yet.
    await expect(content.locator("#__cognia-element-picker[data-cognia-pointing]")).toHaveCount(1)
    await expect(panel.getByTestId("pick-0")).toHaveCount(0)
    await content.locator("#two").click()
    await expect(panel.getByTestId("pick-1")).toContainText("p#two")
    await expect(panel.getByTestId("pick-0")).toContainText("#one")
    await expect(content.locator("#__cognia-element-picker")).toHaveCount(0)
  })

  test("folds a pick of a long stretch of text to a short card", async ({
    panel,
    mockHost,
    serviceWorker,
    context,
  }) => {
    const words = "This grey text is too light to read comfortably. ".repeat(12)
    const html =
      '<!doctype html><title>Long</title><body style="margin:0;padding:24px">' +
      `<main id="long" style="padding:8px"><h1>Pricing plans</h1><p>${words}</p></main><p id="short">Short</p></body>`
    const content = await capturedFixture({ panel, mockHost, serviceWorker, context, html })
    await panel.getByTestId("pick-element").click()
    await expect(content.locator("#__cognia-element-picker[data-cognia-pointing]")).toHaveCount(1)
    await content.locator("#long").click({ position: { x: 4, y: 4 }, modifiers: ["Shift"] })
    await content.locator("#short").click()
    await expect(panel.getByTestId("pick-summary-0")).toBeVisible()
    const excerpt = (await panel.getByTestId("pick-excerpt-0").boundingBox())!
    // One line, however long the text.
    expect(excerpt.height).toBeLessThan(20)
    expect((await panel.getByTestId("pick-0").boundingBox())!.height).toBeLessThan(110)
  })

  test("takes what a box dragged over the page holds, and compares them", async ({
    panel,
    mockHost,
    serviceWorker,
    context,
  }) => {
    const html =
      '<!doctype html><title>Buttons</title><body style="margin:0;padding:40px">' +
      '<div id="row" style="display:flex;gap:16px">' +
      '<button id="a" class="btn" style="font-size:14px;padding:8px 16px">One</button>' +
      '<button id="b" class="btn" style="font-size:16px;padding:8px 16px">Two</button>' +
      '<button id="c" class="btn" style="font-size:14px;padding:8px 16px">Three</button>' +
      "</div><p style='margin-top:200px'>Elsewhere</p></body>"
    const content = await capturedFixture({ panel, mockHost, serviceWorker, context, html })
    await panel.getByTestId("pick-element").click()
    await expect(content.locator("#__cognia-element-picker[data-cognia-pointing]")).toHaveCount(1)
    await content.bringToFront()
    const first = (await content.locator("#a").boundingBox())!
    const second = (await content.locator("#b").boundingBox())!
    // From above-left of the first button to below-right of the second.
    await content.mouse.move(first.x - 10, first.y - 10)
    await content.mouse.down()
    await content.mouse.move(second.x + second.width + 8, second.y + second.height + 10, {
      steps: 8,
    })
    await content.mouse.up()
    await expect(panel.getByTestId("pick-0")).toHaveCount(0)
    await content.keyboard.press("Enter")
    await expect(panel.getByTestId("pick-1")).toContainText("button#b")
    await expect(panel.getByTestId("pick-0")).toContainText("button#a")
    await expect(panel.getByTestId("pick-2")).toHaveCount(0)

    // Two buttons that should match, and do not.
    await expect(panel.getByTestId("pick-compare")).toContainText("font-size")
    await panel.getByTestId("pick-compare-include").click()
    await panel.getByTestId("instruction").fill("Make the buttons match")
    await panel.getByTestId("submit").click()
    await expect(panel.getByTestId("recent-list")).toBeVisible()
    const sent = mockHost.submissions()[0]?.selectionText ?? ""
    expect(sent).toContain("## How the picks differ")
    expect(sent).toContain("| font-size | `14px` | `16px` |")
  })

  test("takes every element alike on Alt-click", async ({
    panel,
    mockHost,
    serviceWorker,
    context,
  }) => {
    const html =
      '<!doctype html><title>Chips</title><body style="padding:40px">' +
      '<span class="chip">a</span> <span class="chip">b</span> <span class="chip">c</span>' +
      ' <span class="tag">d</span></body>'
    const content = await capturedFixture({ panel, mockHost, serviceWorker, context, html })
    await panel.getByTestId("pick-element").click()
    await expect(content.locator("#__cognia-element-picker[data-cognia-pointing]")).toHaveCount(1)
    await content
      .locator(".chip")
      .first()
      .click({ modifiers: ["Alt"] })
    await content.keyboard.press("Enter")
    await expect(panel.getByTestId("pick-2")).toBeVisible()
    await expect(panel.getByTestId("pick-3")).toHaveCount(0)
  })
})

test.describe("measuring between elements", () => {
  test("reads the gap the browser laid out, draws it on the page, and sends it", async ({
    panel,
    mockHost,
    serviceWorker,
    context,
  }) => {
    const content = await capturedFixture({ panel, mockHost, serviceWorker, context })
    await panel.getByTestId("measure-element").click()
    await expect(panel.getByTestId("pick-waiting")).toBeVisible()
    await expect(content.locator("#__cognia-element-picker")).toHaveCount(1)
    await content.locator("h1").click()
    // Anchored on the title: the pointer on the button shows the distance.
    await content.locator("#save").hover()
    await content.locator("#save").click()

    await expect(panel.getByTestId("measure-0")).toContainText("h1 → button#save")
    // `main` lays its children out in a row, 12px apart.
    await expect(panel.getByTestId("measure-distances-0")).toContainText("↔ 12px")
    await expect(content.locator("#__cognia-element-picker")).toHaveCount(0)
    expect(
      await content.evaluate(() => (window as { __pageSawClick?: boolean }).__pageSawClick)
    ).toBeUndefined()

    // A previewed change is read back off the page: Show re-measures.
    await content.evaluate(() => {
      document.querySelector("main")!.style.gap = "16px"
    })
    await panel.getByTestId("measure-show-0").click()
    await expect(content.locator("#__cognia-element-picker")).toHaveCount(1)
    await expect(panel.getByTestId("measure-distances-0")).toContainText("↔ 16px")

    await panel.getByTestId("measure-note-0").fill("Should be 24px")
    await panel.getByTestId("submit").click()
    await expect(panel.getByTestId("measure-0")).toHaveCount(0)
    const sent = mockHost.submissions()[0]?.selectionText ?? ""
    expect(sent).toContain("## Measurements (1)")
    expect(sent).toContain("1. `button#save` is 16px to the right of `h1`")
    expect(sent).toContain("**Requested:** Should be 24px")
  })
})

/** A sign-in form whose submit fails, in a single-page app. */
const STEPS_FIXTURE_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Sign in — Example</title></head>
  <body>
    <form id="signin">
      <label for="email">Email</label>
      <input id="email" type="email" />
      <label for="password">Password</label>
      <input id="password" type="password" />
      <button id="submit" type="submit">Sign in</button>
    </form>
    <script>
      document.getElementById("signin").addEventListener("submit", (event) => {
        event.preventDefault()
        history.pushState({}, "", "/account?session=E2E-SESSION")
        console.error("E2E sign-in failed")
      })
    </script>
  </body>
</html>`

test.describe("steps to reproduce", () => {
  test("records what the person did while recording, never what they typed", async ({
    panel,
    mockHost,
    serviceWorker,
    context,
  }) => {
    const content = await capturedFixture({
      panel,
      mockHost,
      serviceWorker,
      context,
      html: STEPS_FIXTURE_HTML,
    })
    await panel.getByTestId("page-tools-toggle").click()
    await panel.getByTestId("dev-record").click()
    await expect(panel.getByTestId("dev-recording")).toBeVisible()

    await content.locator("#email").fill("ann@e2e.test")
    await content.locator("#password").fill("E2E-HUNTER2")
    await content.locator("#password").press("Enter")
    await expect.poll(() => content.evaluate(() => location.pathname)).toBe("/account")

    await panel.getByTestId("dev-attach").click()
    await expect(panel.getByTestId("dev-report-steps")).toBeVisible()
    await panel.getByTestId("submit").click()
    await expect(panel.getByTestId("recent-list")).toBeVisible()

    const sent = mockHost.submissions()[0]?.selectionText ?? ""
    expect(sent).toContain("### Steps to reproduce")
    expect(sent).toContain('Entered text in `#email` "Email"')
    expect(sent).toContain("Entered a password in `#password`")
    expect(sent).toContain("Pressed Enter in `#password`")
    expect(sent).toContain("Submitted `#signin`")
    expect(sent).toContain("Navigated to /account")
    expect(sent).toContain("[error] E2E sign-in failed")
    for (const secret of ["ann@e2e.test", "E2E-HUNTER2", "E2E-SESSION"])
      expect(sent).not.toContain(secret)
  })
})

test.describe("performance of the visit", () => {
  test("reads the browser's own timeline and sends it", async ({
    panel,
    mockHost,
    serviceWorker,
    context,
  }) => {
    await capturedFixture({ panel, mockHost, serviceWorker, context })
    await panel.getByTestId("page-audit-toggle").click()
    await panel.getByTestId("insight-run-perf").click()
    await expect(panel.getByTestId("perf-result")).toBeVisible()
    await expect(panel.getByTestId("perf-vital-fcp")).toBeVisible()
    await expect(panel.getByTestId("perf-vital-ttfb")).toBeVisible()
    await panel.getByTestId("instruction").fill("Make it faster")
    await panel.getByTestId("submit").click()
    await expect(panel.getByTestId("recent-list")).toBeVisible()
    const sent = mockHost.submissions()[0]?.selectionText ?? ""
    expect(sent).toContain("## Performance (this visit)")
    expect(sent).toMatch(/- First contentful paint: \d/)
    expect(sent).toMatch(/- DOM: \d+ elements/)
  })
})

test.describe("editing the page's words", () => {
  test("types over the page's copy and sends each change as before and after", async ({
    panel,
    mockHost,
    serviceWorker,
    context,
  }) => {
    const content = await capturedFixture({ panel, mockHost, serviceWorker, context })
    await panel.getByTestId("text-edit-start").click()
    await expect(panel.getByTestId("text-editing")).toBeVisible()
    await expect.poll(() => content.evaluate(() => document.designMode)).toBe("on")

    await content.locator("h1").click()
    await content.keyboard.press("End")
    await content.keyboard.type(" and privacy")
    await expect(content.locator("h1")).toHaveText("Settings and privacy")

    await panel.getByTestId("text-edit-done").click()
    await expect(panel.getByTestId("text-change-0")).toContainText("Settings and privacy")
    expect(await content.evaluate(() => document.designMode)).toBe("off")
    await panel.getByTestId("submit").click()
    await expect(panel.getByTestId("recent-list")).toBeVisible()
    const sent = mockHost.submissions()[0]?.selectionText ?? ""
    expect(sent).toContain("## Text changes (1)")
    expect(sent).toContain('   - Before: "Settings"\n   - After: "Settings and privacy"')
  })

  test("unwinds every edit through the browser's undo", async ({
    panel,
    mockHost,
    serviceWorker,
    context,
  }) => {
    const content = await capturedFixture({ panel, mockHost, serviceWorker, context })
    await panel.getByTestId("text-edit-start").click()
    await expect.poll(() => content.evaluate(() => document.designMode)).toBe("on")
    await content.locator("h1").click()
    await content.keyboard.press("End")
    await content.keyboard.type(" draft")
    await expect(content.locator("h1")).toHaveText("Settings draft")
    await panel.getByTestId("text-edit-undo").click()
    await expect(content.locator("h1")).toHaveText("Settings")
    expect(await content.evaluate(() => document.designMode)).toBe("off")
    await expect(panel.getByTestId("text-changes")).toHaveCount(0)
  })
})

test.describe("SEO and link previews", () => {
  test("reads the head and outline as the page has them, and sends the findings", async ({
    panel,
    mockHost,
    serviceWorker,
    context,
  }) => {
    await capturedFixture({ panel, mockHost, serviceWorker, context })
    await panel.getByTestId("page-audit-toggle").click()
    await panel.getByTestId("insight-run-seo").click()
    await expect(panel.getByTestId("seo-result")).toBeVisible()
    await expect(panel.getByTestId("seo-card-title")).toHaveText("Settings — Example")
    await panel.getByTestId("seo-outline-toggle").click()
    await expect(panel.getByTestId("seo-outline")).toContainText("Settings")
    await panel.getByTestId("instruction").fill("Improve the SEO")
    await panel.getByTestId("submit").click()
    await expect(panel.getByTestId("recent-list")).toBeVisible()
    const sent = mockHost.submissions()[0]?.selectionText ?? ""
    expect(sent).toContain("## SEO and link previews")
    expect(sent).toContain('- Title: "Settings — Example" (18)')
    expect(sent).toContain("- [warning] No meta description")
    expect(sent).toContain("h1 Settings")
  })
})

/** A banner wider than any window, in grey too light to read, and a clipped label. */
const LAYOUT_FIXTURE_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Layout — Example</title></head>
  <body style="margin:0;background:#ffffff">
    <div id="wide" style="width:3000px;color:#aaaaaa">Wide banner</div>
    <p id="label" style="width:40px;overflow:hidden;white-space:nowrap">A label far too long for its box</p>
  </body>
</html>`

test.describe("layout and contrast", () => {
  test("finds what makes the page scroll sideways, picks it, and fixes its contrast", async ({
    panel,
    mockHost,
    serviceWorker,
    context,
  }) => {
    await capturedFixture({ panel, mockHost, serviceWorker, context, html: LAYOUT_FIXTURE_HTML })
    await panel.getByTestId("page-audit-toggle").click()
    await panel.getByTestId("insight-run-layout").click()
    await expect(panel.getByTestId("layout-result")).toBeVisible()
    // Laid out by Chromium itself: the widths are the browser's, not a stub's.
    await expect(panel.getByTestId("layout-summary")).toContainText("3000")
    await expect(panel.getByTestId("layout-issue-0")).toContainText("div#wide")
    await expect(panel.getByTestId("layout-result")).toContainText("p#label")

    await panel.getByTestId("layout-pick-0").click()
    await expect(panel.getByTestId("pick-0")).toContainText("div#wide")
    await expect(panel.getByTestId("pick-contrast-0")).toContainText("2.32:1")
    await expect(panel.getByTestId("pick-contrast-0")).toContainText("AA ✗")
    await panel.getByTestId("pick-contrast-fix-0").click()

    await panel.getByTestId("submit").click()
    await expect(panel.getByTestId("recent-list")).toBeVisible()
    const sent = mockHost.submissions()[0]?.selectionText ?? ""
    expect(sent).toContain("## Layout check")
    expect(sent).toContain("so it scrolls sideways")
    expect(sent).toContain("- Contrast: 2.32:1 (#aaaaaa on #ffffff), fails AA for normal text")
    expect(sent).toMatch(/color: #[0-9a-f]{6};/)
  })
})

test.describe("console and network for a bug report", () => {
  test("records what the page said while reproducing, without query strings", async ({
    panel,
    mockHost,
    serviceWorker,
    context,
  }) => {
    const content = await capturedFixture({ panel, mockHost, serviceWorker, context })
    await panel.getByTestId("page-tools-toggle").click()
    await panel.getByTestId("dev-record").click()
    await expect(panel.getByTestId("dev-recording")).toBeVisible()

    const dialog = content.waitForEvent("dialog")
    await content.evaluate(async () => {
      console.error("E2E-BOOM in the save handler")
      await fetch("/no-such-endpoint?token=E2E-SECRET").catch(() => undefined)
      // A person's recording leaves the page's own dialogs to the person.
      setTimeout(() => window.confirm("Discard changes?"), 0)
    })
    await (await dialog).dismiss()

    await panel.getByTestId("dev-attach").click()
    await expect(panel.getByTestId("dev-report-text")).toContainText("E2E-BOOM")
    await panel.getByTestId("submit").click()
    await expect(panel.getByTestId("recent-list")).toBeVisible()

    const sent = mockHost.submissions()[0]?.selectionText ?? ""
    expect(sent).toContain("## Console and network")
    expect(sent).toContain("[error] E2E-BOOM in the save handler")
    expect(sent).toContain("/no-such-endpoint`")
    expect(sent).not.toContain("E2E-SECRET")
  })
})

test.describe("adjusting a pick by hand", () => {
  test("drags its edge and nudges its spacing on the page, and sends both as edits", async ({
    panel,
    mockHost,
    serviceWorker,
    context,
  }) => {
    const content = await capturedFixture({ panel, mockHost, serviceWorker, context })
    await panel.getByTestId("pick-element").click()
    await expect(content.locator("#__cognia-element-picker")).toHaveCount(1)
    await content.locator("#save").click()
    await expect(panel.getByTestId("pick-0")).toBeVisible()

    await panel.getByTestId("pick-adjust-0").click()
    await expect(panel.getByTestId("adjust-done")).toBeVisible()
    // The panel shows it running as it asks; the drag waits for the page to start.
    await expect(content.locator("#__cognia-element-picker[data-cognia-pointing]")).toHaveCount(1)
    await content.bringToFront()
    const box = (await content.locator("#save").boundingBox())!
    const before = Math.round(
      await content.evaluate(() =>
        parseFloat(getComputedStyle(document.getElementById("save")!).width)
      )
    )
    // Chromium's own pointer events, on the button's right edge.
    await content.mouse.move(box.x + box.width - 1, box.y + box.height / 2)
    await content.mouse.down()
    await content.mouse.move(box.x + box.width + 39, box.y + box.height / 2, { steps: 4 })
    await content.mouse.up()
    await content.keyboard.press("Shift+ArrowLeft")
    await content.keyboard.press("Enter")
    await expect(panel.getByTestId("adjust-done")).toHaveCount(0)
    expect(
      await content.evaluate(() => (window as { __pageSawClick?: boolean }).__pageSawClick)
    ).toBeUndefined()
    await expect
      .poll(() =>
        content.evaluate(() => getComputedStyle(document.getElementById("save")!).marginLeft)
      )
      .toBe("10px")

    await panel.getByTestId("submit").click()
    await expect(panel.getByTestId("pick-0")).toHaveCount(0)
    const sent = mockHost.submissions()[0]?.selectionText ?? ""
    expect(sent).toContain(`  width: ${before + 40}px;`)
    expect(sent).toContain("  margin: 0px 0px 0px 10px;")
  })
})

/** A page that asks its backend for orders, by fetch and by XHR, and says what came back. */
const REQUESTS_FIXTURE_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Orders — Example</title></head>
  <body>
    <button id="load">Load orders</button>
    <button id="legacy">Load by XHR</button>
    <p id="result"></p>
    <script>
      const result = document.getElementById("result")
      document.getElementById("load").addEventListener("click", async () => {
        try {
          const response = await fetch("/api/orders?page=1")
          result.textContent = "fetch " + response.status + " " + (await response.text())
        } catch (error) {
          result.textContent = "fetch failed: " + error.message
        }
      })
      document.getElementById("legacy").addEventListener("click", () => {
        const request = new XMLHttpRequest()
        request.open("GET", "/api/orders?page=2")
        request.onload = () => (result.textContent = "xhr " + request.status + " " + request.responseText)
        request.onerror = () => (result.textContent = "xhr failed")
        request.send()
      })
    </script>
  </body>
</html>`

test.describe("simulating requests", () => {
  test("answers and fails the page's own requests, and says so in what is sent", async ({
    panel,
    mockHost,
    serviceWorker,
    context,
  }) => {
    const content = await capturedFixture({
      panel,
      mockHost,
      serviceWorker,
      context,
      html: REQUESTS_FIXTURE_HTML,
    })
    await panel.getByTestId("page-tools-toggle").click()
    await panel.getByTestId("mock-match").fill("/api/orders*")
    await panel.getByTestId("mock-action").click()
    await panel.getByRole("option", { name: "Respond with" }).click()
    await panel.getByTestId("mock-status").fill("503")
    await panel.getByTestId("mock-body").fill('{"error":"down"}')
    await panel.getByTestId("mock-delay").fill("0")
    await panel.getByTestId("mock-add").click()
    await expect(panel.getByTestId("mock-rule-0")).toContainText("Answers 503")

    await content.locator("#load").click()
    await expect(content.locator("#result")).toHaveText('fetch 503 {"error":"down"}')
    await content.locator("#legacy").click()
    await expect(content.locator("#result")).toHaveText('xhr 503 {"error":"down"}')
    await panel.getByTestId("mock-refresh").click()
    await expect(panel.getByTestId("mock-hits-0")).toHaveText("2 matched")

    // Replaced by a failure: the page sees a dropped connection.
    await panel.getByTestId("mock-remove-0").click()
    await expect(panel.getByTestId("mock-rule-0")).toHaveCount(0)
    await panel.getByTestId("mock-match").fill("/api/orders*")
    await panel.getByTestId("mock-action").click()
    await panel.getByRole("option", { name: "Fail (network error)" }).click()
    await panel.getByTestId("mock-add").click()
    await content.locator("#load").click()
    await expect(content.locator("#result")).toHaveText("fetch failed: Failed to fetch")

    await panel.getByTestId("instruction").fill("Show a friendly error when orders fail")
    await panel.getByTestId("submit").click()
    await expect(panel.getByTestId("recent-list")).toBeVisible()
    const sent = mockHost.submissions()[0]?.selectionText ?? ""
    expect(sent).toContain("## Simulated requests (1)")
    expect(sent).toContain("- Any method `/api/orders*` → network error — matched 1 time")

    // A reload takes the rules away, and the panel says so.
    await content.reload()
    await panel.getByTestId("mock-refresh").click()
    await expect(panel.getByTestId("mock-lost")).toBeVisible()
    await panel.getByTestId("mock-clear").click()
    await expect(panel.getByTestId("mock-rules")).toHaveCount(0)
  })
})

/** A page that asks for orders as it loads, and can ask its own data in other ways. */
const KEPT_REQUESTS_FIXTURE_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Orders on load — Example</title></head>
  <body>
    <p id="result">waiting</p>
    <button id="modify">Fetch data</button>
    <button id="modify-xhr">XHR data</button>
    <button id="legacy">Fetch legacy</button>
    <p id="other"></p>
    <script>
      const result = document.getElementById("result")
      const other = document.getElementById("other")
      fetch("/api/orders?page=1")
        .then((response) => (result.textContent = "load " + response.status))
        .catch((error) => (result.textContent = "load failed: " + error.message))
      const show = (label) => async (response) =>
        (other.textContent = label + " " + response.status + " " + (await response.text()))
      document.getElementById("modify").addEventListener("click", () =>
        fetch("/page/orders-data").then(show("fetch"))
      )
      document.getElementById("legacy").addEventListener("click", () =>
        fetch("/api/legacy/orders").then(show("redirect"))
      )
      document.getElementById("modify-xhr").addEventListener("click", () => {
        const request = new XMLHttpRequest()
        request.open("GET", "/page/orders-data")
        request.onload = () => (other.textContent = "xhr " + request.status + " " + request.responseText)
        request.send()
      })
    </script>
  </body>
</html>`

test.describe("simulating requests across reloads", () => {
  test("keeps a rule for the requests a page makes as it loads, changes real answers, and redirects", async ({
    panel,
    mockHost,
    serviceWorker,
    context,
  }) => {
    mockHost.servePage("orders-data", '{"orders":[1,2],"total":2}')
    const content = await capturedFixture({
      panel,
      mockHost,
      serviceWorker,
      context,
      html: KEPT_REQUESTS_FIXTURE_HTML,
    })
    await expect(content.locator("#result")).toHaveText(/^load \d+$/)
    await panel.getByTestId("page-tools-toggle").click()
    await panel.getByTestId("mock-match").fill("/api/orders*")
    await panel.getByTestId("mock-preset-offline").click()
    await panel.getByTestId("mock-add").click()
    await expect(panel.getByTestId("mock-rule-0")).toContainText("Fails with a network error")
    await panel.getByTestId("mock-keep").click()
    await expect(panel.getByTestId("mock-keep")).toBeChecked()

    // Back before the page's own scripts run: its first request fails too.
    await content.reload()
    await expect(content.locator("#result")).toHaveText("load failed: Failed to fetch")
    await panel.getByTestId("mock-refresh").click()
    await expect(panel.getByTestId("mock-lost")).toHaveCount(0)
    await expect(panel.getByTestId("mock-hits-0")).toHaveText("1 matched")
    await panel.getByTestId("mock-log-toggle").click()
    await expect(panel.getByTestId("mock-log-0")).toContainText("/api/orders?page=1")
    await expect(panel.getByTestId("mock-log-0")).toContainText("network error")

    // The server's own answer, changed: merged into its JSON, by fetch and by XHR.
    await panel.getByTestId("mock-match").fill("/page/orders-data")
    await panel.getByTestId("mock-action").click()
    await panel.getByRole("option", { name: "Change the real response" }).click()
    await panel.getByTestId("mock-body").fill('{"total":0}')
    await panel.getByTestId("mock-add").click()
    await expect(panel.getByTestId("mock-rule-1")).toContainText("Real response, changed")
    await content.locator("#modify").click()
    await expect(content.locator("#other")).toHaveText('fetch 200 {"orders":[1,2],"total":0}')
    await content.locator("#modify-xhr").click()
    await expect(content.locator("#other")).toHaveText('xhr 200 {"orders":[1,2],"total":0}')

    // Sent elsewhere: the matched part of the address replaced.
    await panel.getByTestId("mock-match").fill("/api/legacy/orders")
    await panel.getByTestId("mock-action").click()
    await panel.getByRole("option", { name: "Send elsewhere" }).click()
    await panel.getByTestId("mock-target").fill("/page/orders-data")
    await panel.getByTestId("mock-add").click()
    await content.locator("#legacy").click()
    await expect(content.locator("#other")).toHaveText('redirect 200 {"orders":[1,2],"total":2}')

    // Paused, the load goes through again; cleared, nothing comes back on reload.
    await panel.getByTestId("mock-toggle-0").click()
    await content.reload()
    await expect(content.locator("#result")).toHaveText(/^load \d+$/)
    await panel.getByTestId("mock-clear").click()
    await expect(panel.getByTestId("mock-rules")).toHaveCount(0)
    await content.reload()
    await expect(content.locator("#result")).toHaveText(/^load \d+$/)
    expect(
      await serviceWorker.evaluate(() =>
        chrome.scripting.getRegisteredContentScripts({ ids: ["cognia-request-mocks"] })
      )
    ).toEqual([])
  })
})

/** Tab stops in a muddle: a positive tabindex, and a card only a mouse can open. */
const FOCUS_FIXTURE_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Focus — Example</title></head>
  <body style="margin:0;padding:24px;font:16px system-ui">
    <button id="first">First</button>
    <button id="queue" tabindex="3">Queue jumper</button>
    <div id="card" style="cursor:pointer;width:200px;height:60px;background:#eef">Open card</div>
    <a id="more" href="#more">More</a>
  </body>
</html>`

test.describe("keyboard focus", () => {
  test("numbers the Tab stops on the page and finds what the keyboard cannot do", async ({
    panel,
    mockHost,
    serviceWorker,
    context,
  }) => {
    const content = await capturedFixture({
      panel,
      mockHost,
      serviceWorker,
      context,
      html: FOCUS_FIXTURE_HTML,
    })
    await panel.getByTestId("page-audit-toggle").click()
    await panel.getByTestId("insight-run-focus").click()
    await expect(panel.getByTestId("focus-summary")).toHaveText("3 Tab stops")
    await expect(content.locator("#__cognia-focus-order")).toHaveCount(1)
    await expect(panel.getByTestId("focus-issue-0")).toContainText("button#queue")
    await expect(panel.getByTestId("focus-result")).toContainText("div#card")
    await panel.getByTestId("focus-numbers").click()
    await expect(content.locator("#__cognia-focus-order")).toHaveCount(0)
    await panel.getByTestId("focus-numbers").click()
    await expect(content.locator("#__cognia-focus-order")).toHaveCount(1)

    await panel.getByTestId("instruction").fill("Fix the keyboard order")
    await panel.getByTestId("submit").click()
    await expect(panel.getByTestId("recent-list")).toBeVisible()
    const sent = mockHost.submissions()[0]?.selectionText ?? ""
    expect(sent).toContain("## Keyboard focus check (2 findings)")
    expect(sent).toContain('`#queue` (tabindex="3")')
    expect(sent).toContain("Looks clickable but the keyboard cannot reach it — `#card`")
    // Sent: the numbers leave the page with the check.
    await expect(content.locator("#__cognia-focus-order")).toHaveCount(0)
  })
})

test.describe("the floating toolbar", () => {
  /**
   * Where the toolbar's buttons are. Its shadow root is closed, so not even
   * Playwright reaches inside: the bar is found by where the page hit-tests to
   * its host, and its buttons by the layout its own CSS gives them.
   */
  async function toolbarButtons(content: Page) {
    const top = await content.evaluate(() => {
      for (let y = 0; y < window.innerHeight; y++)
        if (document.elementFromPoint(33, y)?.id === "__cognia-toolbar") return y
      return -1
    })
    expect(top).toBeGreaterThanOrEqual(0)
    // padding 4, grip 18, gap 2; then 34px buttons 2px apart.
    const at = (index: number) => ({ x: 33, y: top + 4 + 18 + 2 + index * 36 + 17 })
    return { pick: at(0), measure: at(1), adjust: at(2), text: at(3), shot: at(4), top }
  }

  test("runs the panel's tools from the page, and is never part of what it inspects", async ({
    panel,
    mockHost,
    serviceWorker,
    context,
  }) => {
    const content = await capturedFixture({ panel, mockHost, serviceWorker, context })
    await panel.getByTestId("toolbar-toggle").click()
    await expect(content.locator("#__cognia-toolbar")).toHaveCount(1)
    await content.bringToFront()
    const buttons = await toolbarButtons(content)

    // Pick from the page: the toolbar starts the panel's own pick.
    await content.mouse.click(buttons.pick.x, buttons.pick.y)
    await expect(panel.getByTestId("pick-waiting")).toBeVisible()
    // Its buttons still answer during the pick: pressing again ends it.
    await content.mouse.click(buttons.pick.x, buttons.pick.y)
    await expect(panel.getByTestId("pick-waiting")).toHaveCount(0)
    await expect(panel.getByTestId("pick-0")).toHaveCount(0)

    await content.mouse.click(buttons.pick.x, buttons.pick.y)
    await expect(panel.getByTestId("pick-waiting")).toBeVisible()
    await expect(content.locator("#__cognia-element-picker[data-cognia-pointing]")).toHaveCount(1)
    await content.locator("#save").click()
    await expect(panel.getByTestId("pick-0")).toContainText("button#save")

    // Adjust the pick from the page, and keep it with Enter.
    await content.mouse.click(buttons.adjust.x, buttons.adjust.y)
    await expect(panel.getByTestId("adjust-done")).toBeVisible()
    // The panel shows it running as it asks; the keys wait for the page to start.
    await expect(content.locator("#__cognia-element-picker[data-cognia-pointing]")).toHaveCount(1)
    await content.keyboard.press("Shift+ArrowDown")
    await content.keyboard.press("Enter")
    await expect(panel.getByTestId("adjust-done")).toHaveCount(0)

    // Close from the page.
    await content.mouse.click(33, buttons.top + 4 + 18 + 2 + 5 * 36 + 7 + 2 + 2 * 36 + 17)
    await expect(content.locator("#__cognia-toolbar")).toHaveCount(0)
    await expect(panel.getByTestId("toolbar-toggle")).toHaveText("Floating toolbar")

    await panel.getByTestId("submit").click()
    await expect(panel.getByTestId("pick-0")).toHaveCount(0)
    const sent = mockHost.submissions()[0]?.selectionText ?? ""
    expect(sent).toContain("- Selector: `#save`")
    expect(sent).toContain("  margin: 0px 0px 10px;")
    expect(sent).not.toContain("cognia-toolbar")
  })

  test("snaps to the window's edge it is let go near, when asked to", async ({
    panel,
    mockHost,
    serviceWorker,
    context,
  }) => {
    const content = await capturedFixture({ panel, mockHost, serviceWorker, context })
    await panel.getByTestId("toolbar-toggle").click()
    const host = content.locator("#__cognia-toolbar")
    await expect(host).toHaveCount(1)
    await panel.getByTestId("toolbar-snap").click()
    await expect(panel.getByTestId("toolbar-snap")).toHaveAttribute("aria-checked", "true")
    await content.bringToFront()
    const { top } = await toolbarButtons(content)

    // Let go right of the middle, high up: it glides to the right-hand edge.
    await content.mouse.move(33, top + 13)
    await content.mouse.down()
    await content.mouse.move(700, 100, { steps: 6 })
    await content.mouse.up()
    await expect(host).toHaveAttribute("data-anchor", "end")
    await content.waitForTimeout(400)
    const width = await content.evaluate(() => window.visualViewport!.width)
    // 42 wide, 12 from the edge; let go with the grip's middle at y=100.
    const pick = { x: width - 12 - 21, y: 100 - 13 + 4 + 18 + 2 + 17 }
    expect(await content.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, pick)).toBe(
      "__cognia-toolbar"
    )
    await content.mouse.click(pick.x, pick.y)
    await expect(panel.getByTestId("pick-waiting")).toBeVisible()
    await content.mouse.click(pick.x, pick.y)
    await expect(panel.getByTestId("pick-waiting")).toHaveCount(0)
  })

  test("lies down along the bottom edge, and maps the page once it is zoomed in", async ({
    panel,
    mockHost,
    serviceWorker,
    context,
  }) => {
    const html =
      '<!doctype html><title>Long</title><body style="margin:0">' +
      '<header style="height:120px;background:#1e3a8a"></header>' +
      Array.from(
        { length: 30 },
        (_, index) =>
          `<section style="height:160px;margin:16px;background:#e2e8f0"><h2>Section ${index}</h2>` +
          `<button id="b${index}">Go ${index}</button></section>`
      ).join("") +
      "</body>"
    const content = await capturedFixture({ panel, mockHost, serviceWorker, context, html })
    await panel.getByTestId("toolbar-toggle").click()
    await expect(content.locator("#__cognia-toolbar")).toHaveAttribute(
      "data-orientation",
      "vertical"
    )
    await content.bringToFront()
    const { top } = await toolbarButtons(content)
    const height = await content.evaluate(() => window.innerHeight)

    // Dragged by its grip to the bottom, it turns and docks there.
    await content.mouse.move(33, top + 4 + 9)
    await content.mouse.down()
    await content.mouse.move(200, height / 2, { steps: 4 })
    await content.mouse.move(300, height - 20, { steps: 6 })
    await content.mouse.up()
    const host = content.locator("#__cognia-toolbar")
    await expect(host).toHaveAttribute("data-orientation", "horizontal")
    // Docked 12px from the bottom, the grip where it was let go: its buttons
    // run along it now.
    const barTop = height - 42 - 12
    const left = 300 - 13
    const at = (index: number) => ({ x: left + 4 + 18 + 2 + index * 36 + 17, y: barTop + 21 })
    await content.mouse.click(at(0).x, at(0).y)
    await expect(panel.getByTestId("pick-waiting")).toBeVisible()
    await expect(content.locator("#__cognia-element-picker[data-cognia-pointing]")).toHaveCount(1)
    await content.locator("#b2").click()
    await expect(panel.getByTestId("pick-0")).toContainText("button#b2")

    // No minimap at 100%; zoomed in, there is one, and the toolbar keeps its size.
    await expect(host).toHaveAttribute("data-minimap", "hidden")
    const tabId = await tabIdOf(serviceWorker, content.url())
    await serviceWorker.evaluate((id) => chrome.tabs.setZoom(id, 1.5), tabId)
    await expect(host).toHaveAttribute("data-minimap", "shown")
    expect(await host.evaluate((element) => element.style.transform)).toContain("scale(0.666")

    // A click low on the map scrolls the page down to there.
    const view = await content.evaluate(() => ({
      width: window.visualViewport!.width,
      scrollY: window.scrollY,
    }))
    expect(view.scrollY).toBe(0)
    // In the toolbar's pixels the map's canvas starts 12 + 6 from the right
    // and 12 + 6 + 20 + 4 from the top; the page's are 1.5 times bigger.
    const canvasLeft = view.width - (12 + 6 + 148) / 1.5
    const canvasTop = (12 + 6 + 20 + 4) / 1.5
    await content.mouse.click(canvasLeft + 70 / 1.5, canvasTop + 200 / 1.5)
    await expect.poll(() => content.evaluate(() => window.scrollY)).toBeGreaterThan(400)

    // Hidden from the toolbar, it stays hidden while zoomed.
    await content.mouse.click((at(5).x + 9) / 1.5, at(5).y / 1.5)
    await expect(host).toHaveAttribute("data-minimap", "hidden")
    await serviceWorker.evaluate((id) => chrome.tabs.setZoom(id, 1), tabId)
  })
})
