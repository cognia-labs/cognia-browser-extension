/** @jest-environment <rootDir>/testing/jsdom-environment.cjs */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"

import type { BrowserApi } from "@ext/src/lib/browser-api"
import type { RecordingCommand } from "@ext/src/lib/recordings/controller"
import { ACTIVE_RECORDINGS_KEY, RECORDINGS_KEY } from "@ext/src/lib/recordings/model"

import { AGENT_SESSIONS_KEY } from "@ext/src/lib/agent/sessions"
import { Recordings, testFileName } from "./recordings"

if (!Blob.prototype.text)
  Blob.prototype.text = function (this: Blob) {
    return new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.readAsText(this)
    })
  }

const RECORDING = {
  id: "rec-1",
  title: "Checkout",
  url: "https://shop.test/cart",
  startedAt: 1_000,
  stoppedAt: 2_000,
  byAgent: false,
  shared: true,
  sharedAt: 2_500,
  steps: [
    { action: "navigate", url: "https://shop.test/cart", at: 1_000 },
    {
      action: "click",
      target: { locators: ['getByRole("button", { name: "Pay", exact: true })'] },
      at: 1_500,
    },
  ],
}

function harness(
  options: {
    recordings?: unknown
    active?: unknown
    granted?: boolean
    tabUrl?: string
    sessions?: unknown
    titles?: Record<string, string>
  } = {}
) {
  const sessionListeners = new Map<string, (value: unknown) => void>()
  const commands: RecordingCommand[] = []
  const requested: unknown[] = []
  const api = {
    message: (key: string, subs?: string[]) => (subs ? `${key}:${subs.join("/")}` : key),
    read: async (key: string) => (key === RECORDINGS_KEY ? (options.recordings ?? null) : null),
    readSession: async (key: string) =>
      key === ACTIVE_RECORDINGS_KEY
        ? (options.active ?? null)
        : key === AGENT_SESSIONS_KEY
          ? (options.sessions ?? null)
          : null,
    onStorageChange: () => () => undefined,
    onSessionChange: (key: string, listener: (value: unknown) => void) => {
      sessionListeners.set(key, listener)
      return () => sessionListeners.delete(key)
    },
    requestPermissions: async (request: unknown) => {
      requested.push(request)
      return options.granted ?? true
    },
    recordingCommand: async (command: RecordingCommand) => {
      commands.push(command)
      return true
    },
  } as unknown as BrowserApi
  render(
    <Recordings
      api={api}
      currentTab={{ id: 5, url: options.tabUrl ?? "https://shop.test/cart?x=1" }}
      conversationTitles={options.titles ?? {}}
      now={() => 3_000}
    />
  )
  const toggle = screen.getByRole("button", { name: "recordingsTitle" })
  if (toggle.getAttribute("aria-expanded") === "false") fireEvent.click(toggle)
  return {
    commands,
    requested,
    pushActive: (value: unknown) => act(() => sessionListeners.get(ACTIVE_RECORDINGS_KEY)?.(value)),
  }
}

describe("Recordings", () => {
  it("asks for this site in the click, then starts recording the tab", async () => {
    const h = harness()
    fireEvent.click(screen.getByTestId("recordings-start"))
    await waitFor(() => expect(h.commands).toEqual([{ op: "start", tabId: 5 }]))
    expect(h.requested).toEqual([{ origins: ["https://shop.test/*"] }])
    h.pushActive({ 5: "rec-1" })
    fireEvent.click(await screen.findByTestId("recordings-stop"))
    await waitFor(() => expect(h.commands.at(-1)).toEqual({ op: "stop", recordingId: "rec-1" }))
  })

  it("says why it did not start without the site", async () => {
    const h = harness({ granted: false })
    fireEvent.click(screen.getByTestId("recordings-start"))
    expect(await screen.findByTestId("recordings-notice")).toHaveTextContent("recordingsNeedSite")
    expect(h.commands).toEqual([])
  })

  it("cannot record a page that is not on the web", () => {
    harness({ tabUrl: "chrome://settings" })
    expect(screen.getByTestId("recordings-start")).toBeDisabled()
  })

  it("lists recordings, shares, removes and downloads the generated test", async () => {
    const h = harness({ recordings: [RECORDING] })
    expect(await screen.findByTestId("recordings-item")).toHaveTextContent("recordingsSteps:2")
    expect(screen.getByTestId("recordings-shared")).toHaveValue("all")
    fireEvent.change(screen.getByTestId("recordings-shared"), { target: { value: "private" } })
    await waitFor(() =>
      expect(h.commands).toEqual([{ op: "share", recordingId: "rec-1", shared: false }])
    )
    const created: Blob[] = []
    URL.createObjectURL = jest.fn((blob: Blob) => {
      created.push(blob)
      return "blob:test"
    })
    URL.revokeObjectURL = jest.fn()
    const click = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
    fireEvent.click(screen.getByTestId("recordings-download"))
    expect(click).toHaveBeenCalled()
    expect(await created[0]!.text()).toContain(
      'await page.getByRole("button", { name: "Pay", exact: true }).click()'
    )
    click.mockRestore()
    fireEvent.click(screen.getByTestId("recordings-remove"))
    await waitFor(() => expect(h.commands.at(-1)).toEqual({ op: "remove", recordingId: "rec-1" }))
  })

  it("is shared only once it has stopped", async () => {
    const h = harness({
      recordings: [{ ...RECORDING, shared: false, sharedAt: undefined, stoppedAt: undefined }],
      active: { 5: "rec-1" },
    })
    const choice = await screen.findByTestId("recordings-shared")
    expect(choice).toBeDisabled()
    expect(choice).toHaveValue("private")
    expect(screen.getByTestId("recordings-item")).toHaveTextContent("recordingsShareAfterStop")
    h.pushActive({})
    await waitFor(() => expect(screen.getByTestId("recordings-shared")).toBeEnabled())
    fireEvent.change(screen.getByTestId("recordings-shared"), { target: { value: "all" } })
    await waitFor(() =>
      expect(h.commands).toEqual([{ op: "share", recordingId: "rec-1", shared: true }])
    )
  })

  it("shows a recording kept by an earlier build as private", async () => {
    harness({ recordings: [{ ...RECORDING, sharedAt: undefined }] })
    expect(await screen.findByTestId("recordings-shared")).toHaveValue("private")
  })

  it("shares with one conversation, named as the recent list names it", async () => {
    const h = harness({
      recordings: [
        { ...RECORDING, shared: false, sharedAt: undefined },
        {
          ...RECORDING,
          id: "rec-2",
          byAgent: true,
          sessionId: "agent-session-1",
          sharedAt: undefined,
        },
      ],
      sessions: { "agent-session-1": { id: "agent-session-1", tabIds: [7] } },
      titles: { "chat-9": "Checkout bug" },
    })
    const [mine, agents] = await screen.findAllByTestId("recordings-shared")
    // The agent's own recording is its conversation's, and says which.
    expect(agents).toHaveValue("session:agent-session-1")
    expect(agents).toHaveTextContent("recordingsShareConversation:agent-s")
    expect(mine).toHaveTextContent("Checkout bug")
    fireEvent.change(mine!, { target: { value: "session:chat-9" } })
    await waitFor(() =>
      expect(h.commands).toEqual([
        { op: "share", recordingId: "rec-1", shared: true, sessions: ["chat-9"] },
      ])
    )
  })

  it("lists the steps for review, a secret by where the test reads it", async () => {
    harness({
      recordings: [
        {
          ...RECORDING,
          steps: [
            ...RECORDING.steps,
            {
              action: "fill",
              target: {
                locators: ['getByLabel("Password")'],
                role: "textbox",
                name: "Password",
              },
              secret: true,
              value: "hunter2",
              at: 1_600,
            },
            {
              action: "fill",
              target: { locators: ['getByLabel("Email")'], name: "Email" },
              value: "me@shop.test",
              at: 1_650,
            },
            {
              action: "assert",
              assertion: { kind: "url", expected: "https://shop.test/done" },
              at: 1_700,
            },
          ],
        },
      ],
    })
    expect(screen.queryByTestId("recordings-steps")).toBeNull()
    fireEvent.click(await screen.findByTestId("recordings-review"))
    const steps = screen.getAllByTestId("recordings-step")
    expect(steps.map((step) => step.textContent)).toEqual([
      "1.recordingsStepNavigatehttps://shop.test/cart",
      '2.recordingsStepClickgetByRole("button", { name: "Pay", exact: true })',
      "3.recordingsStepFillPasswordrecordingsStepSecret:E2E_PASSWORD",
      "4.recordingsStepFillEmail“me@shop.test”",
      "5.recordingsStepUrlhttps://shop.test/done",
    ])
    expect(screen.getByTestId("recordings-steps")).not.toHaveTextContent("hunter2")
    fireEvent.click(screen.getByTestId("recordings-review"))
    expect(screen.queryByTestId("recordings-steps")).toBeNull()
  })

  it("names the test file after the recording", () => {
    expect(testFileName({ title: "Sign in — fast!" })).toBe("sign-in-fast.spec.ts")
    expect(testFileName({ title: "" })).toBe("recorded-flow.spec.ts")
  })
})
