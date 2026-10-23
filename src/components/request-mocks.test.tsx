/** @jest-environment <rootDir>/testing/jsdom-environment.cjs */
import { act, fireEvent, render, screen } from "@testing-library/react"

import type { BrowserApi } from "@ext/src/lib/browser-api"
import { MAX_MOCKS, type MockHits, type RequestMock } from "@ext/src/lib/inspect/request-mocks"

import { RequestMocks } from "./request-mocks"

const api = {
  message: (key: string, subs?: string[]) => (subs ? `${key}:${subs.join("/")}` : key),
} as unknown as BrowserApi

const RULE: RequestMock = {
  id: "r1",
  match: "/api/orders*",
  method: "GET",
  action: "respond",
  status: 503,
  body: "",
  headers: "",
  target: "",
  delayMs: 0,
  times: 0,
  chance: 100,
  enabled: true,
}

function hits(overrides: Partial<MockHits> = {}): MockHits {
  return { installed: true, kept: false, hits: {}, log: [], ...overrides }
}

function setup(
  rules: RequestMock[] = [],
  mockHits: MockHits | null = null,
  { busy = false, canKeep = true } = {}
) {
  const props = {
    api,
    rules,
    hits: mockHits,
    busy,
    canKeep,
    onAdd: jest.fn(),
    onRemove: jest.fn(),
    onToggle: jest.fn(),
    onClear: jest.fn(),
    onRefresh: jest.fn(),
    onPoll: jest.fn(),
    onKeep: jest.fn(),
  }
  render(<RequestMocks {...props} />)
  return props
}

async function choose(trigger: string, option: string) {
  fireEvent.click(screen.getByTestId(trigger))
  fireEvent.click(await screen.findByRole("option", { name: option }))
}

describe("RequestMocks", () => {
  it("adds a rule that fails matching requests, once it matches something", () => {
    const props = setup()
    expect(screen.getByTestId("mock-add")).toBeDisabled()
    expect(screen.queryByTestId("mock-status")).toBeNull()
    fireEvent.change(screen.getByTestId("mock-match"), { target: { value: "/api/cart" } })
    fireEvent.click(screen.getByTestId("mock-add"))
    expect(props.onAdd).toHaveBeenCalledWith({
      id: expect.any(String),
      match: "/api/cart",
      method: "",
      action: "fail",
      status: 0,
      body: "",
      headers: "",
      target: "",
      delayMs: 0,
      times: 0,
      chance: 100,
      enabled: true,
    })
    expect(screen.getByTestId("mock-match")).toHaveValue("")
  })

  it("answers with a status, body and headers, for one method, after a delay", async () => {
    const props = setup()
    fireEvent.change(screen.getByTestId("mock-match"), { target: { value: "/api/orders" } })
    await choose("mock-method", "POST")
    await choose("mock-action", "mockActionRespond")
    fireEvent.change(screen.getByTestId("mock-status"), { target: { value: "422" } })
    fireEvent.change(screen.getByTestId("mock-body"), { target: { value: '{"error":"x"}' } })
    fireEvent.change(screen.getByTestId("mock-delay"), { target: { value: "500" } })
    fireEvent.click(screen.getByTestId("mock-more"))
    fireEvent.change(screen.getByTestId("mock-headers"), { target: { value: "x-a: 1" } })
    fireEvent.change(screen.getByTestId("mock-times"), { target: { value: "2" } })
    fireEvent.change(screen.getByTestId("mock-chance"), { target: { value: "40" } })
    fireEvent.click(screen.getByTestId("mock-add"))
    expect(props.onAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        action: "respond",
        status: 422,
        body: '{"error":"x"}',
        headers: "x-a: 1",
        delayMs: 500,
        times: 2,
        chance: 40,
      })
    )
    // Not a status a response can have.
    fireEvent.change(screen.getByTestId("mock-match"), { target: { value: "/api/orders" } })
    fireEvent.change(screen.getByTestId("mock-status"), { target: { value: "42" } })
    expect(screen.getByTestId("mock-add")).toBeDisabled()
  })

  it("changes the real answer, keeping its status unless one is given", async () => {
    const props = setup()
    fireEvent.change(screen.getByTestId("mock-match"), { target: { value: "/api/me" } })
    await choose("mock-action", "mockActionModify")
    expect(screen.getByTestId("mock-status")).toHaveValue(null)
    expect(screen.getByText("mockBodyMerge")).toBeInTheDocument()
    // Nothing to change yet.
    expect(screen.getByTestId("mock-add")).toBeDisabled()
    fireEvent.change(screen.getByTestId("mock-body"), { target: { value: '{"plan":"pro"}' } })
    fireEvent.click(screen.getByTestId("mock-add"))
    expect(props.onAdd).toHaveBeenCalledWith(
      expect.objectContaining({ action: "modify", status: 0, body: '{"plan":"pro"}' })
    )
  })

  it("sends matching requests to another address", async () => {
    const props = setup()
    fireEvent.change(screen.getByTestId("mock-match"), { target: { value: "/api/*" } })
    await choose("mock-action", "mockActionRedirect")
    expect(screen.queryByTestId("mock-body")).toBeNull()
    expect(screen.getByTestId("mock-add")).toBeDisabled()
    fireEvent.change(screen.getByTestId("mock-target"), {
      target: { value: "http://localhost:3000/api/orders" },
    })
    fireEvent.click(screen.getByTestId("mock-add"))
    expect(props.onAdd).toHaveBeenCalledWith(
      expect.objectContaining({ action: "redirect", target: "http://localhost:3000/api/orders" })
    )
  })

  it("fills the form from a preset, matching everything when nothing was typed", () => {
    const props = setup()
    fireEvent.click(screen.getByTestId("mock-preset-empty"))
    expect(screen.getByTestId("mock-match")).toHaveValue("*")
    expect(screen.getByTestId("mock-status")).toHaveValue(200)
    expect(screen.getByTestId("mock-body")).toHaveValue("[]")
    // `*` alone matches nothing in particular: a part of the URL is still needed.
    expect(screen.getByTestId("mock-add")).toBeDisabled()
    fireEvent.change(screen.getByTestId("mock-match"), { target: { value: "/api/list" } })
    fireEvent.click(screen.getByTestId("mock-preset-flaky"))
    expect(screen.getByTestId("mock-match")).toHaveValue("/api/list")
    fireEvent.click(screen.getByTestId("mock-add"))
    expect(props.onAdd).toHaveBeenCalledWith(
      expect.objectContaining({ match: "/api/list", action: "fail", chance: 50 })
    )
  })

  it("warns about a regular expression that does not compile", () => {
    setup()
    expect(screen.getByText("mockMatchHint")).toBeInTheDocument()
    fireEvent.change(screen.getByTestId("mock-match"), { target: { value: "/orders(/" } })
    expect(screen.getByTestId("mock-match")).toHaveAttribute("aria-invalid", "true")
    expect(screen.getByText("mockBadMatch")).toBeInTheDocument()
    expect(screen.getByTestId("mock-add")).toBeDisabled()
  })

  it("lists the rules with how often each matched, to pause, remove, refresh or clear", () => {
    const props = setup(
      [RULE, { ...RULE, id: "r2", enabled: false, times: 3, chance: 25 }],
      hits({
        hits: { r1: { count: 3, lastUrl: "https://a.test/api/orders?page=2" } },
      })
    )
    expect(screen.getByTestId("mock-rule-0")).toHaveTextContent("GET /api/orders*")
    expect(screen.getByTestId("mock-rule-0")).toHaveTextContent("mockRuleRespond:503")
    expect(screen.getByTestId("mock-rule-1")).toHaveTextContent("mockRuleTimes:3")
    expect(screen.getByTestId("mock-rule-1")).toHaveTextContent("mockRuleChance:25")
    expect(screen.getByTestId("mock-hits-0")).toHaveTextContent("mockHits:3")
    expect(screen.getByTestId("mock-hits-0")).toHaveAttribute(
      "title",
      "https://a.test/api/orders?page=2"
    )
    expect(screen.getByTestId("mock-toggle-0")).toHaveAccessibleName("mockPause")
    expect(screen.getByTestId("mock-toggle-1")).toHaveAccessibleName("mockResume")
    fireEvent.click(screen.getByTestId("mock-toggle-0"))
    fireEvent.click(screen.getByTestId("mock-toggle-1"))
    fireEvent.click(screen.getByTestId("mock-remove-0"))
    fireEvent.click(screen.getByTestId("mock-refresh"))
    fireEvent.click(screen.getByTestId("mock-clear"))
    expect(props.onToggle.mock.calls).toEqual([
      ["r1", false],
      ["r2", true],
    ])
    expect(props.onRemove).toHaveBeenCalledWith("r1")
    expect(props.onRefresh).toHaveBeenCalled()
    expect(props.onClear).toHaveBeenCalled()
    expect(screen.queryByTestId("mock-lost")).toBeNull()
  })

  it("keeps the rules across reloads when asked, on a web page", () => {
    const props = setup([RULE], hits({ kept: true }))
    expect(screen.getByTestId("mock-keep")).toBeChecked()
    fireEvent.click(screen.getByTestId("mock-keep"))
    expect(props.onKeep).toHaveBeenCalledWith(false)
  })

  it("offers no keeping where the page cannot have it", () => {
    setup([RULE], hits(), { canKeep: false })
    expect(screen.queryByTestId("mock-keep")).toBeNull()
  })

  it("lists the requests caught, newest first, and reads more while open", () => {
    jest.useFakeTimers()
    try {
      const props = setup(
        [RULE],
        hits({
          log: [
            { rule: "r1", method: "GET", url: "https://a.test/api/orders", at: 0, outcome: "503" },
            {
              rule: "r1",
              method: "POST",
              url: "https://a.test/api/orders?page=2",
              at: 1_000,
              outcome: "network error",
            },
          ],
        })
      )
      expect(screen.getByTestId("mock-log-toggle")).toHaveTextContent("mockLog:2")
      expect(screen.queryByTestId("mock-log")).toBeNull()
      fireEvent.click(screen.getByTestId("mock-log-toggle"))
      expect(screen.getByTestId("mock-log-0")).toHaveTextContent(
        "POST/api/orders?page=2network error"
      )
      expect(screen.getByTestId("mock-log-1")).toHaveTextContent("GET/api/orders503")
      expect(props.onPoll).not.toHaveBeenCalled()
      act(() => jest.advanceTimersByTime(4_100))
      expect(props.onPoll).toHaveBeenCalledTimes(2)
      fireEvent.click(screen.getByTestId("mock-log-toggle"))
      act(() => jest.advanceTimersByTime(4_100))
      expect(props.onPoll).toHaveBeenCalledTimes(2)
    } finally {
      jest.useRealTimers()
    }
  })

  it("says when nothing was caught yet", () => {
    setup([RULE], hits())
    fireEvent.click(screen.getByTestId("mock-log-toggle"))
    expect(screen.getByText("mockLogEmpty")).toBeInTheDocument()
  })

  it("says when a reload took the rules away, and offers to apply them again", () => {
    setup([RULE], hits({ installed: false }))
    expect(screen.getByTestId("mock-lost")).toHaveTextContent("mockLost")
    expect(screen.getByTestId("mock-refresh")).toHaveTextContent("mockReapply")
  })

  it("takes no more rules than the page can hold", () => {
    setup(
      Array.from({ length: MAX_MOCKS }, (_, index) => ({ ...RULE, id: `r${index}` })),
      null
    )
    fireEvent.change(screen.getByTestId("mock-match"), { target: { value: "/x" } })
    expect(screen.getByTestId("mock-add")).toBeDisabled()
    expect(screen.getByTestId("mock-add")).toHaveTextContent("mockFull")
  })
})
