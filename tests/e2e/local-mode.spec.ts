import { readFile } from "node:fs/promises"

import type { PanelDraft } from "@ext/src/lib/panel/drafts"

import { expect, openView, pairThroughPanel, requestCapture, tabIdOf, test } from "./fixtures"

test("opens local mode on the shipped manifest without optional permissions", async ({
  panel,
  serviceWorker,
}) => {
  await panel.getByRole("button", { name: "Use local mode", exact: true }).click()
  await expect(panel.getByText("Local mode", { exact: true })).toBeVisible()
  await expect(panel.getByRole("tab", { name: "Capture" })).toBeVisible()
  // The first capture needs no standing grant: access to every website is a
  // choice in Settings, not an action beside it.
  await expect(panel.getByTestId("capture-access-hint")).toBeVisible()
  await expect(panel.getByRole("button", { name: "Allow all websites", exact: true })).toBeHidden()
  await openView(panel, "settings")
  await expect(panel.getByRole("button", { name: "Allow all websites", exact: true })).toBeVisible()
  expect(await serviceWorker.evaluate(() => chrome.permissions.getAll())).toMatchObject({
    origins: [],
  })
  await panel.reload()
  await openView(panel, "send")
  await expect(panel.getByRole("button", { name: "Connect to Cognia", exact: true })).toBeVisible()
  await openView(panel, "settings")
  await expect(panel.getByRole("button", { name: "Allow all websites", exact: true })).toBeVisible()
  await expect(panel.getByLabel("Paste the pairing code")).toHaveCount(0)
})

test("shows site authorization for a hidden tab URL without installed host permissions", async ({
  panel,
  context,
  serviceWorker,
}, testInfo) => {
  await panel.getByRole("button", { name: "Use local mode", exact: true }).click()
  const url = "https://capture.example.test/page"
  await context.route(url, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<title>Permission check</title><p>A page</p>",
    })
  )
  const content = await context.newPage()
  await content.goto(url)
  await content.bringToFront()
  const tab = await serviceWorker.evaluate(async () => {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true })
    return { id: active?.id, url: active?.url }
  })
  expect(tab.id).toBeDefined()
  expect(tab.url).toBeUndefined()
  await requestCapture(serviceWorker, tab.id!, "page")
  const captureCard = panel.locator("[data-slot='card']").filter({
    has: panel.getByRole("heading", { name: "Capture", exact: true }),
  })
  await expect(
    captureCard.getByRole("button", { name: "Allow access to this site", exact: true })
  ).toBeVisible({ timeout: 1_000 })
  expect(await serviceWorker.evaluate(() => chrome.permissions.getAll())).toMatchObject({
    origins: [],
  })
  await panel.setViewportSize({ width: 360, height: 800 })
  await panel.evaluate(() => window.scrollTo(0, 0))
  await panel.screenshot({ path: testInfo.outputPath("capture-permission.png") })
})

test.describe("local tools without a Host", () => {
  test.use({ extensionProfile: "granted" })

  test("captures, checks, edits, copies and exports with no Host installed", async ({
    panel,
    context,
    serviceWorker,
  }, testInfo) => {
    // Only a page fixture: this test never starts the mock Host fixture.
    const url = "http://127.0.0.1:43210/local-page?private=hidden"
    await context.route("http://127.0.0.1:43210/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html lang="en"><head><title>Local page</title></head>
          <body><main><h1>Local page</h1><p>Original local content</p>
          <button id="save" style="font-size:14px">Save changes</button></main></body></html>`,
      })
    )
    const content = await context.newPage()
    await content.goto(url)
    await panel.getByRole("button", { name: "Use local mode", exact: true }).click()
    await requestCapture(serviceWorker, await tabIdOf(serviceWorker, url), "page")
    await expect(panel.getByLabel("Captured text (editable)")).toHaveValue(/Original local content/)
    await openView(panel, "inspect")
    await panel.getByRole("button", { name: /^Pick element/ }).click()
    await expect(content.locator("#__cognia-element-picker")).toHaveCount(1)
    await content.locator("#save").click()
    await expect(panel.getByRole("button", { name: /1\. button#save/ })).toBeVisible()
    await panel.getByRole("button", { name: "Adjust styles" }).click()
    await panel.getByLabel("font-size", { exact: true }).fill("20px")
    await expect(content.locator("#save")).toHaveCSS("font-size", "20px")

    // The audit opens with the Inspect tab.
    await panel.getByRole("button", { name: "Check SEO", exact: true }).click()
    await expect(panel.getByText("No meta description", { exact: true })).toBeVisible()
    await openView(panel, "send")
    await panel.getByLabel("Title", { exact: true }).fill("Reviewed local page")
    await panel.getByLabel("Captured text (editable)").fill("Reviewed local content")
    await panel
      .getByRole("textbox", { name: "What would you like to do with this?" })
      .fill("Fix the page")
    await expect(panel.getByRole("button", { name: "Start task", exact: true })).toHaveCount(0)
    await expect(panel.getByTestId("agent-settings")).toHaveCount(0)

    await context.grantPermissions(["clipboard-read", "clipboard-write"])
    await panel.bringToFront()
    await panel.getByRole("button", { name: "Copy as prompt", exact: true }).click()
    const copied = await panel.evaluate(() => navigator.clipboard.readText())
    expect(copied).toContain("Reviewed local content")
    expect(copied).toContain("font-size: 20px;")
    expect(copied).toContain("## SEO")
    expect(copied).not.toContain("private=hidden")

    const downloading = panel.waitForEvent("download")
    await panel.getByRole("button", { name: "Export .md", exact: true }).click()
    const download = await downloading
    const exported = await readFile((await download.path())!, "utf8")
    expect(exported).toContain(copied)
    expect(exported).toContain("Exported from Cognia Browser Companion")
    await expect
      .poll(() =>
        serviceWorker.evaluate(async () => {
          const draft = (await chrome.storage.session.get("cognia.draft.v1"))["cognia.draft.v1"] as
            PanelDraft | undefined
          return draft?.captured?.readableText?.text
        })
      )
      .toBe("Reviewed local content")
    await panel.reload()
    await expect(panel.getByLabel("Captured text (editable)")).toHaveValue("Reviewed local content")
    await expect(panel.getByLabel("Title", { exact: true })).toHaveValue("Reviewed local page")
    await panel.setViewportSize({ width: 360, height: 800 })
    await panel.screenshot({ path: testInfo.outputPath("local-mode.png"), fullPage: true })
    await panel.evaluate(() => window.scrollTo(0, 0))
    await panel.screenshot({ path: testInfo.outputPath("local-mode-top.png") })
  })

  test("pairs through the existing form after local use and retains the capture", async ({
    panel,
    mockHost,
    context,
    serviceWorker,
  }) => {
    await panel.getByRole("button", { name: "Use local mode", exact: true }).click()
    const url = mockHost.servePage(
      "local-to-host",
      "<title>Local draft</title><p>Keep this draft</p>"
    )
    const content = await context.newPage()
    await content.goto(url)
    await requestCapture(serviceWorker, await tabIdOf(serviceWorker, url), "page")
    await expect(panel.getByLabel("Captured text (editable)")).toHaveValue(/Keep this draft/)
    await panel.getByLabel("Captured text (editable)").fill("Reviewed before pairing")
    await panel.getByRole("button", { name: "Connect to Cognia", exact: true }).click()
    await pairThroughPanel(panel, mockHost.issueEnrollment())
    await expect(panel.getByLabel("Captured text (editable)")).toHaveValue(
      "Reviewed before pairing"
    )
    await panel
      .getByRole("textbox", { name: "What would you like to do with this?" })
      .fill("Review this")
    await panel.getByRole("button", { name: "Start task", exact: true }).click()
    await expect.poll(() => mockHost.submissions()).toHaveLength(1)
    expect(mockHost.submissions()[0]?.readableText).toBe("Reviewed before pairing")
  })
})
