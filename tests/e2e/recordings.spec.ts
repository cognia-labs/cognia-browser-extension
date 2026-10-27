/**
 * Recording for a test in Chrome (ADR-0242, `recording-v1`): the person's
 * real keystrokes and clicks become steps, the recorder comes back after a
 * load, a password never reaches storage, and an agent can record in its own
 * tab and read the Playwright test made from it.
 */
import contract from "@cognia/companion-client/browser-agent-protocol.json" with { type: "json" }

import {
  expect,
  openView,
  pairThroughPanel,
  requestCapture,
  tabIdOf,
  test,
  type Page,
} from "./fixtures"
import type { MockHost } from "./mock-host"

test.use({ extensionProfile: "granted" })

const LOGIN_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Sign in</title></head>
  <body>
    <form action="/page/done">
      <label for="email">Email</label><input id="email" name="email" />
      <label for="password">Password</label><input id="password" type="password" />
      <button type="submit">Sign in</button>
    </form>
  </body>
</html>`

const DONE_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Welcome</title></head>
  <body><h1>Welcome</h1><button onclick="this.textContent='Thanks'">Say thanks</button></body>
</html>`

type StoredRecording = {
  id: string
  steps: { action: string; value?: string; secret?: boolean; url?: string; assertion?: unknown }[]
}

const stored = (worker: import("@playwright/test").Worker) =>
  worker.evaluate(async () => {
    const value = await chrome.storage.local.get("cognia.recordings.v1")
    return (value["cognia.recordings.v1"] ?? []) as unknown
  }) as Promise<StoredRecording[]>

async function openLogin(mockHost: MockHost, context: import("@playwright/test").BrowserContext) {
  mockHost.servePage("done", DONE_HTML)
  const url = mockHost.servePage("login", LOGIN_HTML)
  const page = await context.newPage()
  await page.goto(url)
  return { page, url }
}

test("records what the person does, across a load, and never a password", async ({
  panel,
  mockHost,
  serviceWorker,
  context,
}) => {
  await panel.getByRole("button", { name: "Use local mode", exact: true }).click()
  const { page, url } = await openLogin(mockHost, context)
  await requestCapture(serviceWorker, await tabIdOf(serviceWorker, url), "auto")
  await expect(panel.getByTestId("capture-preview")).toBeVisible()
  await openView(panel, "tools")
  await panel.getByRole("button", { name: "Record a test", exact: true }).click()
  await panel.getByTestId("recordings-start").click()
  await expect(panel.getByTestId("recordings-stop")).toBeVisible()
  await expect(page.locator("#__cognia-recording-badge")).toBeAttached()

  await page.getByLabel("Email").fill("")
  await page.getByLabel("Email").pressSequentially("me@shop.test")
  await page.getByLabel("Password").pressSequentially("hunter2")
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForURL(/\/page\/done/)
  // Back in after the load: the next click is recorded too.
  await expect(page.locator("#__cognia-recording-badge")).toBeAttached()
  await page.getByRole("button", { name: "Say thanks" }).click()
  await expect
    .poll(async () => (await stored(serviceWorker))[0]?.steps.at(-1)?.action)
    .toBe("click")

  await panel.getByTestId("recordings-stop").click()
  await expect(panel.getByTestId("recordings-start")).toBeVisible()
  await expect(page.locator("#__cognia-recording-badge")).toHaveCount(0)

  const [recording] = await stored(serviceWorker)
  expect(recording!.steps.map((step) => [step.action, step.value, step.secret])).toEqual([
    ["navigate", undefined, undefined],
    ["fill", "me@shop.test", undefined],
    ["fill", undefined, true],
    ["click", undefined, undefined],
    ["assert", undefined, undefined],
    ["click", undefined, undefined],
  ])
  expect(JSON.stringify(recording)).not.toContain("hunter2")
  await expect(panel.getByTestId("recordings-item")).toContainText("6 steps")
})

test("records what is done on a page before it has finished loading", async ({
  panel,
  mockHost,
  serviceWorker,
  context,
}) => {
  await panel.getByRole("button", { name: "Use local mode", exact: true }).click()
  const { page, url } = await openLogin(mockHost, context)
  const slowUrl = mockHost.servePage(
    "slow",
    `<!doctype html><title>Slow</title><button onclick="this.textContent='Early'">Act now</button><img src="/slow/4000" alt="" />`
  )
  await requestCapture(serviceWorker, await tabIdOf(serviceWorker, url), "auto")
  await openView(panel, "tools")
  await panel.getByRole("button", { name: "Record a test", exact: true }).click()
  await panel.getByTestId("recordings-start").click()
  await expect(panel.getByTestId("recordings-stop")).toBeVisible()

  await page.goto(slowUrl, { waitUntil: "domcontentloaded" })
  await page.getByRole("button", { name: "Act now" }).click()
  expect(await page.evaluate(() => document.readyState)).not.toBe("complete")
  await expect
    .poll(async () => (await stored(serviceWorker))[0]?.steps.map((step) => step.action))
    .toEqual(["navigate", "assert", "click"])
  await panel.getByTestId("recordings-stop").click()
})

test("lets an agent record its own tab and read the test made from it", async ({
  panel,
  mockHost,
  serviceWorker,
  context,
}) => {
  const target: Page = await context.newPage()
  mockHost.servePage("done", DONE_HTML)
  const url = mockHost.servePage("welcome", DONE_HTML)
  await target.goto(url)
  const tabId = await tabIdOf(serviceWorker, url)
  await pairThroughPanel(panel, mockHost.issueEnrollment())
  await serviceWorker.evaluate(() =>
    chrome.storage.local.set({ "cognia.preferences.v1": { agentMode: true } })
  )
  await expect
    .poll(() => mockHost.agentFrames().find((frame) => frame.t === "hello"))
    .toMatchObject({ features: expect.arrayContaining(["recording-v1"]) })
  mockHost.sendAgentFrame({
    t: "welcome",
    v: contract.envelopeVersion,
    agentProfile: contract.agentProfile,
    connectionId: "c",
    driveAllowed: true,
  })
  mockHost.sendAgentFrame({
    t: "op",
    id: "start",
    op: "start_recording",
    args: { session: "s", startTabId: tabId },
    deadlineMs: 30_000,
  })
  await panel.getByRole("button", { name: "Allow for this task", exact: true }).click()
  await expect
    .poll(() => mockHost.agentFrames().find((frame) => frame.id === "start"))
    .toMatchObject({ ok: true, value: { recording: { byAgent: true } } })

  mockHost.sendAgentFrame({
    t: "op",
    id: "snapshot",
    op: "snapshot",
    args: { session: "s" },
    deadlineMs: 10_000,
  })
  await expect
    .poll(() => mockHost.agentFrames().find((frame) => frame.id === "snapshot"))
    .toMatchObject({ ok: true })
  const snapshot = mockHost.agentFrames().find((frame) => frame.id === "snapshot")!.value as {
    nodes: { role: string; ref: string }[]
  }
  const ref = snapshot.nodes.find((node) => node.role === "button")!.ref
  mockHost.sendAgentFrame({
    t: "op",
    id: "click",
    op: "act",
    args: { session: "s", ref, action: "click" },
    deadlineMs: 5_000,
  })
  await expect(target.getByRole("button", { name: "Thanks" })).toBeVisible()
  await expect.poll(async () => (await stored(serviceWorker))[0]?.steps.length).toBe(2)

  mockHost.sendAgentFrame({
    t: "op",
    id: "stop",
    op: "stop_recording",
    args: { session: "s" },
    deadlineMs: 10_000,
  })
  await expect
    .poll(() => mockHost.agentFrames().find((frame) => frame.id === "stop"))
    .toMatchObject({ ok: true, value: { recording: { stepCount: 2 } } })
  const id = (
    mockHost.agentFrames().find((frame) => frame.id === "stop")!.value as {
      recording: { id: string }
    }
  ).recording.id
  mockHost.sendAgentFrame({
    t: "op",
    id: "get",
    op: "get_recording",
    args: { session: "s", id, format: "playwright" },
    deadlineMs: 10_000,
  })
  await expect
    .poll(() => mockHost.agentFrames().find((frame) => frame.id === "get"))
    .toMatchObject({ ok: true })
  const got = mockHost.agentFrames().find((frame) => frame.id === "get")!.value as {
    playwright: string
  }
  expect(got.playwright).toContain(`await page.goto(${JSON.stringify(url)})`)
  expect(got.playwright).toContain(
    'getByRole("button", { name: "Say thanks", exact: true }).click()'
  )
})
