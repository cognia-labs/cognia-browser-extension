import { act, renderHook, waitFor } from "@testing-library/react"

import { SESSION_KEYS } from "../browser-api"
import { parsePanelView, usePanelView } from "./panel-view"

function sessionApi(stored: unknown) {
  const writes: unknown[] = []
  let answer: (value: unknown) => void = () => undefined
  const pending = new Promise<unknown>((resolve) => {
    answer = resolve
  })
  return {
    writes,
    answer: () => answer(stored),
    api: {
      readSession: jest.fn(() => pending) as never,
      writeSession: jest.fn(async (key: string, value: unknown) => {
        writes.push([key, value])
      }),
    },
  }
}

describe("parsePanelView", () => {
  it("accepts the tabs and settings, and falls back to send", () => {
    expect(parsePanelView("inspect")).toBe("inspect")
    expect(parsePanelView("tools")).toBe("tools")
    expect(parsePanelView("settings")).toBe("settings")
    expect(parsePanelView("recent")).toBe("send")
    expect(parsePanelView(null)).toBe("send")
  })
})

describe("usePanelView", () => {
  it("restores the stored view", async () => {
    const { api, answer } = sessionApi("tools")
    const { result } = renderHook(() => usePanelView(api))
    expect(result.current[0]).toBe("send")
    answer()
    await waitFor(() => expect(result.current[0]).toBe("tools"))
  })

  it("shows a choice at once, remembers it, and ignores a slower stored answer", async () => {
    const { api, answer, writes } = sessionApi("tools")
    const { result } = renderHook(() => usePanelView(api))
    act(() => result.current[1]("settings"))
    expect(result.current[0]).toBe("settings")
    answer()
    await act(async () => undefined)
    expect(result.current[0]).toBe("settings")
    expect(writes).toEqual([[SESSION_KEYS.panelView, "settings"]])
  })
})
