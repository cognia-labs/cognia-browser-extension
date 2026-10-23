/** @jest-environment <rootDir>/testing/jsdom-environment.cjs */
import { fireEvent, render, screen } from "@testing-library/react"

import type { BrowserApi } from "@ext/src/lib/browser-api"
import { measureBoxes, type Measurement } from "@ext/src/lib/inspect/measure"

import { Measurements } from "./measurements"

const api = {
  message: (key: string, subs?: string[]) => (subs ? `${key}:${subs.join("/")}` : key),
} as unknown as BrowserApi

const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height })

function measurement(
  id: string,
  from: ReturnType<typeof box>,
  to: ReturnType<typeof box>
): Measurement {
  return {
    id,
    tabId: 1,
    pageUrl: "https://example.com/",
    measuredAt: 1,
    from: { elementId: `${id}-a`, selector: "#a", label: "div#a", box: from },
    to: { elementId: `${id}-b`, selector: "#b", label: "p.b", box: to },
    measure: measureBoxes(from, to),
    note: "",
  }
}

function setup(props: Partial<Parameters<typeof Measurements>[0]> = {}) {
  const handlers = { onNote: jest.fn(), onShow: jest.fn(), onRemove: jest.fn() }
  render(
    <Measurements
      api={api}
      measurements={[
        measurement("m1", box(0, 0, 100, 40), box(112, 0, 50, 40)),
        measurement("m2", box(0, 0, 300, 200), box(24, 16, 100, 40)),
        measurement("m3", box(0, 0, 100, 100), box(50, 50, 100, 100)),
      ]}
      detached={["m3"]}
      busy={null}
      {...handlers}
      {...props}
    />
  )
  return handlers
}

describe("Measurements", () => {
  it("shows nothing until something is measured", () => {
    const { container } = render(
      <Measurements
        api={api}
        measurements={[]}
        detached={[]}
        busy={null}
        onNote={jest.fn()}
        onShow={jest.fn()}
        onRemove={jest.fn()}
      />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it("leads with the numbers: gaps, insets, and overlap", () => {
    setup()
    expect(screen.getByText("measureTitle:3")).toBeInTheDocument()
    expect(screen.getByTestId("measure-0")).toHaveTextContent("div#a → p.b")
    expect(screen.getByTestId("measure-distances-0")).toHaveTextContent("measureApart↔ 12px")
    expect(screen.getByTestId("measure-distances-1")).toHaveTextContent(
      "measureInside↑ 16px→ 176px↓ 144px← 24px"
    )
    expect(screen.getByTestId("measure-distances-2")).toHaveTextContent("measureOverlap")
    expect(screen.getByTestId("measure-detached-2")).toBeInTheDocument()
    expect(screen.queryByTestId("measure-near-0")).toBeNull()
  })

  it("takes a note, shows a measurement again, and removes it", () => {
    const handlers = setup()
    fireEvent.change(screen.getByTestId("measure-note-1"), { target: { value: "16px all round" } })
    expect(handlers.onNote).toHaveBeenCalledWith("m2", "16px all round")
    fireEvent.click(screen.getByTestId("measure-show-0"))
    expect(handlers.onShow).toHaveBeenCalledWith("m1")
    fireEvent.click(screen.getByTestId("measure-remove-2"))
    expect(handlers.onRemove).toHaveBeenCalledWith("m3")
  })

  it("flags edges a few pixels apart, and holds Show while one is being shown", () => {
    setup({
      measurements: [measurement("m1", box(0, 0, 100, 40), box(3, 60, 100, 40))],
      detached: [],
      busy: "m1",
    })
    expect(screen.getByTestId("measure-near-0")).toBeInTheDocument()
    expect(screen.getByTestId("measure-show-0")).toBeDisabled()
    expect(screen.getByTestId("measure-show-0")).toHaveTextContent("attachWorking")
  })
})
