/**
 * Request rules in Chrome (ADR-0242): a saved rule catches the request a
 * page makes while it is still loading, and an agent's rule reaches only the
 * tabs its conversation holds, until the person takes over.
 *
 * Only the page half can run here. The `granted` profile adds loopback host
 * access and nothing else, and `declarativeNetRequestWithHostAccess` is asked
 * for in a click Chrome's prompt would have to answer, so the browser half
 * (headers, blocking, redirects) is covered by `sync.test.ts` and the panel
 * reporting that it still needs the grant.
 */
import contract from "@cognia/companion-client/browser-agent-protocol.json" with { type: "json" }

import { expect, openView, pairThroughPanel, tabIdOf, test, type Page } from "./fixtures"
import type { MockHost } from "./mock-host"

test.use({ extensionProfile: "granted" })

/** A page that asks for its orders before anything else on it runs. */
const ORDERS_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Orders</title>
    <script>
      fetch("/page/orders-data")
        .then(async (response) => {
          document.documentElement.dataset.result = "fetch " + response.status + " " + (await response.text())
        })
        .catch((error) => {
          document.documentElement.dataset.result = "failed " + error.message
        })
    </script>
  </head>
  <body><button onclick="this.textContent='Clicked'">Click me</button></body>
</html>`

function servePages(mockHost: MockHost) {
  mockHost.servePage("orders-data", "real orders")
  return mockHost.servePage("orders", ORDERS_HTML)
}

const resultOf = (page: Page) => page.evaluate(() => document.documentElement.dataset.result ?? "")

test.describe("saved rules", () => {
  test("hold the page's first request until its rules are in, then step aside", async ({
    panel,
    mockHost,
    context,
  }) => {
    const url = servePages(mockHost)
    await panel.getByRole("button", { name: "Use local mode", exact: true }).click()
    await openView(panel, "tools")
    await panel.getByRole("button", { name: "Request rules", exact: true }).click()
    await panel.getByTestId("rules-group-sites").fill("127.0.0.1")
    await panel.getByTestId("rules-group-add").click()
    await panel.getByTestId("rules-group-toggle").click()
    await panel.getByTestId("rules-match").fill("/page/orders-data")
    await panel.getByTestId("rules-action").click()
    await panel.getByRole("option", { name: "Answer", exact: true }).click()
    await panel.getByTestId("rules-status").fill("503")
    await panel.getByTestId("rules-body").fill("down")
    await panel.getByTestId("rules-add").click()
    await expect(panel.getByTestId("rules-rule")).toContainText("Answers 503")

    const page = await context.newPage()
    await page.goto(url)
    await expect.poll(() => resultOf(page)).toBe("fetch 503 down")

    // Paused, the next load reaches the server.
    await panel.getByRole("button", { name: "Pause rule", exact: true }).click()
    await expect(panel.getByRole("button", { name: "Resume rule", exact: true })).toBeVisible()
    await page.reload()
    await expect.poll(() => resultOf(page)).toBe("fetch 200 real orders")

    // A rule only the browser can apply says it is waiting for the grant.
    await panel.getByTestId("rules-match").fill("/page/")
    await panel.getByTestId("rules-action").click()
    await panel.getByRole("option", { name: "Request headers", exact: true }).click()
    await panel.getByTestId("rules-headers").fill("x-env: staging")
    await panel.getByTestId("rules-add").click()
    await expect(panel.getByTestId("rules-needs-dnr")).toBeVisible()
  })
})

test.describe("an agent's rules", () => {
  test("reach only its own tab, and go when the person takes over", async ({
    panel,
    mockHost,
    context,
    serviceWorker,
  }) => {
    const url = servePages(mockHost)
    const agentTab = await context.newPage()
    await agentTab.goto(url)
    const otherTab = await context.newPage()
    await otherTab.goto(url)
    const tabId = await tabIdOf(serviceWorker, url)
    await pairThroughPanel(panel, mockHost.issueEnrollment())
    await serviceWorker.evaluate(() =>
      chrome.storage.local.set({ "cognia.preferences.v1": { agentMode: true } })
    )
    await expect
      .poll(() => mockHost.agentFrames().find((frame) => frame.t === "hello"))
      .toMatchObject({ features: expect.arrayContaining(["network-rules-v1"]) })
    mockHost.sendAgentFrame({
      t: "welcome",
      v: contract.envelopeVersion,
      agentProfile: contract.agentProfile,
      connectionId: "c",
      driveAllowed: true,
    })
    mockHost.sendAgentFrame({
      t: "op",
      id: "rules",
      op: "set_network_rules",
      args: {
        session: "s",
        startTabId: tabId,
        rules: [{ match: "/page/orders-data", action: "respond", status: 418, body: "rigged" }],
      },
      deadlineMs: 30_000,
    })
    await panel.getByRole("button", { name: "Allow for this task", exact: true }).click()
    await expect
      .poll(() => mockHost.agentFrames().find((frame) => frame.id === "rules"))
      .toMatchObject({
        ok: true,
        value: { rules: [{ coverage: "page-requests", hits: 0 }] },
      })

    // The page the agent holds, on its next load; not the person's other tab.
    await agentTab.reload()
    await expect.poll(() => resultOf(agentTab)).toBe("fetch 418 rigged")
    await otherTab.reload()
    await expect.poll(() => resultOf(otherTab)).toBe("fetch 200 real orders")
    mockHost.sendAgentFrame({
      t: "op",
      id: "list",
      op: "list_network_rules",
      args: { session: "s" },
      deadlineMs: 10_000,
    })
    await expect
      .poll(() => mockHost.agentFrames().find((frame) => frame.id === "list"))
      .toMatchObject({ ok: true, value: { rules: [{ hits: 1 }] } })

    // The panel shows them; Take over, sent from the tab as the bar sends it, ends them.
    await openView(panel, "tools")
    await expect(panel.getByTestId("rules-agent")).toContainText("Answers 418")
    await serviceWorker.evaluate(async (tabId) => {
      await chrome.scripting.executeScript({
        target: { tabId },
        world: "ISOLATED",
        func: () =>
          chrome.runtime.sendMessage({
            kind: "cognia-agent-control",
            session: "s",
            action: "takeover",
          }),
      })
    }, tabId)
    await expect(panel.getByTestId("rules-agent")).toHaveCount(0)
    await agentTab.reload()
    await expect.poll(() => resultOf(agentTab)).toBe("fetch 200 real orders")
  })
})
