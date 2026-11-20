/** @jest-environment <rootDir>/testing/jsdom-environment.cjs */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"

import { AGENT_SESSIONS_KEY, newSession, type AgentSessions } from "@ext/src/lib/agent/sessions"
import type { BrowserApi } from "@ext/src/lib/browser-api"

import { AgentControl } from "./agent-control"

function harness(sessions: AgentSessions, options: { retryFails?: boolean } = {}) {
  const listeners = new Set<(value: unknown) => void>()
  const activated: number[] = []
  const retried: string[] = []
  const onManage = jest.fn()
  const api = {
    message: (key: string, subs?: string[]) => (subs ? `${key}:${subs.join("/")}` : key),
    read: async () => null,
    onStorageChange: () => () => undefined,
    readSession: async (key: string) => (key === AGENT_SESSIONS_KEY ? sessions : null),
    onSessionChange: (key: string, listener: (value: unknown) => void) => {
      if (key !== AGENT_SESSIONS_KEY) return () => undefined
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    activateTab: async (tabId: number) => {
      activated.push(tabId)
    },
    retryHostStop: async (id: string) => {
      retried.push(id)
      if (options.retryFails) throw new Error("browser_permission_request_failed")
    },
  } as unknown as BrowserApi
  render(<AgentControl api={api} conversationTitles={{ s1: "Checkout bug" }} onManage={onManage} />)
  return {
    activated,
    retried,
    onManage,
    push: (next: AgentSessions) => act(() => listeners.forEach((listener) => listener(next))),
  }
}

const session = (id: string, change: Partial<ReturnType<typeof newSession>> = {}) => ({
  ...newSession(id, 1_000),
  ...change,
})

describe("AgentControl", () => {
  it("says nothing while no conversation holds a tab", async () => {
    const h = harness({ idle: session("idle") })
    await act(async () => undefined)
    expect(screen.queryByTestId("agent-control")).toBeNull()
    h.push({ s1: session("s1", { tabIds: [5], activeTabId: 5 }) })
    expect(await screen.findByTestId("agent-control")).toBeInTheDocument()
  })

  it("lists who acts, where, and what it was allowed for itself", async () => {
    const h = harness({
      s1: session("s1", {
        tabIds: [5, 6],
        activeTabId: 6,
        onceOrigins: ["https://shop.test", "https://pay.test:8443"],
        lastActivityAt: 2_000,
      }),
      abcdef123456: session("abcdef123456", { tabIds: [7], takeover: true }),
    })
    const first = await screen.findByTestId("agent-control-s1")
    expect(first).toHaveTextContent("Checkout bug")
    expect(first).toHaveTextContent("agentControlActing")
    expect(screen.getByTestId("agent-control-once-s1")).toHaveTextContent(
      "agentControlOnceSites:shop.test, pay.test:8443"
    )
    // One without a title in the recent list is named by its id.
    expect(screen.getByTestId("agent-control-abcdef123456")).toHaveTextContent(
      "agentControlConversation:abcdef12"
    )
    expect(screen.getByTestId("agent-control-abcdef123456")).toHaveTextContent("agentControlPaused")
    fireEvent.click(screen.getByTestId("agent-control-show-s1"))
    expect(h.activated).toEqual([6])
    fireEvent.click(screen.getByTestId("agent-control-manage"))
    expect(h.onManage).toHaveBeenCalled()
  })

  it("says when Cognia did not confirm a Stop, and asks it again", async () => {
    const h = harness({
      s1: session("s1", {
        tabIds: [5],
        takeover: true,
        hostStop: { outcome: "failed", at: 1_500 },
      }),
    })
    expect(await screen.findByTestId("agent-control-unconfirmed-s1")).toHaveTextContent(
      "agentControlStopUnconfirmed"
    )
    fireEvent.click(screen.getByTestId("agent-control-retry-s1"))
    await waitFor(() => expect(h.retried).toEqual(["s1"]))
    // The worker records Cognia's answer; the panel shows it from there.
    h.push({
      s1: session("s1", {
        tabIds: [5],
        takeover: true,
        hostStop: { outcome: "cancelled", at: 1_600 },
      }),
    })
    await waitFor(() => expect(screen.queryByTestId("agent-control-unconfirmed-s1")).toBeNull())
    expect(screen.getByTestId("agent-control-s1")).toHaveTextContent("agentControlStopConfirmed")
  })

  it("says so when the retry could not be sent", async () => {
    harness(
      {
        s1: session("s1", { tabIds: [5], takeover: true, hostStop: { outcome: "failed", at: 1 } }),
      },
      { retryFails: true }
    )
    fireEvent.click(await screen.findByTestId("agent-control-retry-s1"))
    expect(await screen.findByTestId("agent-control-error")).toHaveTextContent(
      "agentControlRetryFailed"
    )
    expect(screen.getByTestId("agent-control-retry-s1")).toBeEnabled()
  })
})
