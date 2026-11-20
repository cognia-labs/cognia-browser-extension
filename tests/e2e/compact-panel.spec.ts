import { expect, requestCapture, tabIdOf, test, type Page } from "./fixtures"

test.use({ extensionProfile: "granted" })

const message = (panel: Page, key: string) =>
  panel.evaluate((key) => chrome.i18n.getMessage(key), key)

for (const width of [320, 360]) {
  test(`keeps tools compact and foldable at ${width}px`, async ({
    panel,
    context,
    serviceWorker,
  }, testInfo) => {
    await panel.setViewportSize({ width, height: 900 })
    await panel.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" })
    await panel.getByRole("button", { name: "Use local mode", exact: true }).click()
    for (const id of ["capture-now", "capture-whole-page", "capture-article"]) {
      const label = await panel
        .getByTestId(id)
        .locator("span")
        .evaluate((element) => ({
          height: element.getBoundingClientRect().height,
          lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight),
          width: element.clientWidth,
          contentWidth: element.scrollWidth,
        }))
      expect(label.height).toBeLessThanOrEqual(label.lineHeight + 1)
      expect(label.contentWidth).toBeLessThanOrEqual(label.width + 1)
    }
    const captureCard = panel.locator("[data-slot='card']").filter({
      has: panel.getByRole("heading", { name: "Capture", exact: true }),
    })
    await captureCard.screenshot({ path: testInfo.outputPath(`capture-${width}.png`) })

    const url = "http://127.0.0.1:43212/compact?view=details"
    await context.route("http://127.0.0.1:43212/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<!doctype html><html lang="en"><head><title>A page with a longer title for preview spacing</title></head><body><main><h1>Settings</h1><p id="lead">Review this page.</p><button id="save">Save changes</button></main></body></html>',
      })
    )
    const content = await context.newPage()
    await content.goto(url)
    await requestCapture(serviceWorker, await tabIdOf(serviceWorker, url), "page")
    await expect(panel.getByTestId("capture-preview")).toBeVisible()
    const spacing = await panel.getByTestId("capture-preview").evaluate((card) => {
      const bounds = card.getBoundingClientRect()
      const body = card.querySelector("[data-slot='card-content']")!
      return {
        top: body.firstElementChild!.getBoundingClientRect().top - bounds.top,
        bottom: bounds.bottom - body.lastElementChild!.getBoundingClientRect().bottom,
      }
    })
    expect(spacing.top).toBeLessThanOrEqual(13)
    expect(spacing.bottom).toBeLessThanOrEqual(13)
    await panel
      .getByTestId("capture-preview")
      .screenshot({ path: testInfo.outputPath(`preview-${width}.png`) })

    // The panel itself never scrolls: the tabs stay at the top and the
    // composer at the bottom, and only the open view scrolls between them.
    const frame = await panel.evaluate(() => ({
      scrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
    }))
    expect(frame.scrollHeight).toBeLessThanOrEqual(frame.innerHeight)
    const composer = (await panel.getByTestId("composer").boundingBox())!
    expect(composer.y + composer.height).toBeLessThanOrEqual(900 + 1)
    await expect(panel.getByTestId("copy-context")).toBeInViewport()
    const tabs = (await panel.getByRole("tablist").boundingBox())!
    expect(tabs.y).toBeLessThan(80)

    await panel.getByRole("tab", { name: await message(panel, "tabInspect") }).click()
    await panel
      .getByRole("button", { name: await message(panel, "textEditStart"), exact: true })
      .click()
    const editing = panel.getByTestId("text-editing")
    await expect(editing).toBeVisible()
    const status = await editing.getByRole("status").evaluate((element) => ({
      height: element.getBoundingClientRect().height,
      lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight),
    }))
    expect(status.height).toBeLessThanOrEqual(status.lineHeight + 1)
    const banner = (await editing.boundingBox())!
    expect(banner.height).toBeLessThanOrEqual(84)
    for (const key of ["textEditDone", "textEditUndo"]) {
      const action = (await editing
        .getByRole("button", { name: await message(panel, key), exact: true })
        .boundingBox())!
      expect(action.x).toBeGreaterThanOrEqual(banner.x)
      expect(action.x + action.width).toBeLessThanOrEqual(banner.x + banner.width + 1)
    }
    const inspect = panel.locator("[data-slot='card']").filter({
      has: panel.getByRole("heading", { name: /^Inspect & edit/ }),
    })
    await inspect.screenshot({ path: testInfo.outputPath(`editing-${width}.png`) })
    await editing
      .getByRole("button", { name: await message(panel, "textEditDone"), exact: true })
      .click()
    await expect(editing).toHaveCount(0)

    await panel.getByTestId("measure-element").click()
    await expect(panel.getByTestId("pick-waiting")).toHaveText(
      await message(panel, "measureWaiting")
    )
    const measuring = await panel.getByTestId("pick-waiting").evaluate((element) => ({
      height: element.getBoundingClientRect().height,
      lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight),
    }))
    expect(measuring.height).toBeLessThanOrEqual(measuring.lineHeight + 1)
    await expect(content.locator("#__cognia-element-picker[data-cognia-pointing]")).toHaveCount(1)
    await content.locator("#lead").click()
    await content.locator("#save").click()
    const measurement = panel.getByTestId("measure-0")
    await expect(measurement).toBeVisible()
    const measurementSpacing = await measurement.evaluate((card) => {
      const bounds = card.getBoundingClientRect()
      const body = card.querySelector("[data-slot='card-content']")!
      return {
        top: body.firstElementChild!.getBoundingClientRect().top - bounds.top,
        bottom: bounds.bottom - body.lastElementChild!.getBoundingClientRect().bottom,
      }
    })
    expect(measurementSpacing.top).toBeLessThanOrEqual(7)
    expect(measurementSpacing.bottom).toBeLessThanOrEqual(7)
    await measurement.screenshot({ path: testInfo.outputPath(`measurement-${width}.png`) })

    // The audit opens with its tab, every check folded.
    for (const key of [
      "accessTitle",
      "focusTitle",
      "layoutTitle",
      "tokensTitle",
      "stackTitle",
      "perfTitle",
      "seoTitle",
    ])
      await expect(
        panel.getByRole("button", { name: await message(panel, key), exact: true })
      ).toHaveAttribute("aria-expanded", "false")
    const auditCard = panel
      .locator("[data-slot='card']")
      .filter({ has: panel.getByTestId("page-audit-toggle") })
    await auditCard.screenshot({ path: testInfo.outputPath(`audit-${width}.png`) })
    const keyboardTool = panel.getByRole("button", {
      name: await message(panel, "focusTitle"),
      exact: true,
    })
    await keyboardTool.press("Enter")
    await expect(keyboardTool).toHaveAttribute("aria-expanded", "true")
    await keyboardTool.press("Space")
    await expect(keyboardTool).toHaveAttribute("aria-expanded", "false")
    const access = panel.getByRole("button", {
      name: await message(panel, "accessTitle"),
      exact: true,
    })
    await panel.getByTestId("insight-run-audit").click()
    await expect(panel.getByTestId("a11y-result")).toBeVisible()
    await panel.getByTestId("insight-include-audit").uncheck()
    await access.click()
    await expect(panel.getByTestId("a11y-result")).toBeHidden()
    await access.click()
    await expect(panel.getByTestId("insight-include-audit")).not.toBeChecked()

    await panel.getByRole("tab", { name: await message(panel, "tabTools") }).click()
    for (const key of ["devReportTitle", "overlayTitle", "viewportTitle"])
      await expect(
        panel.getByRole("button", { name: await message(panel, key), exact: true })
      ).toHaveAttribute("aria-expanded", "false")
    const viewportTool = panel.getByRole("button", {
      name: await message(panel, "viewportTitle"),
      exact: true,
    })
    await viewportTool.click()
    await expect(panel.getByTestId("viewport-mobile")).toBeVisible()
    await viewportTool.click()
    await expect(panel.getByTestId("viewport-mobile")).toBeHidden()
    const mocks = panel.getByRole("button", {
      name: await message(panel, "mockTitle"),
      exact: true,
    })
    await mocks.click()
    const match = panel.getByRole("textbox", {
      name: await message(panel, "mockMatch"),
      exact: true,
    })
    await match.fill("/api/draft")
    await mocks.click()
    await expect(match).toBeHidden()
    await mocks.click()
    await panel.getByTestId("page-tools-toggle").click()
    await expect(match).toBeHidden()
    await panel.getByTestId("page-tools-toggle").click()
    await expect(match).toHaveValue("/api/draft")
    expect(await panel.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width
    )
  })
}
