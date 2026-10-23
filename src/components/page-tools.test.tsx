/** @jest-environment <rootDir>/testing/jsdom-environment.cjs */
import { fireEvent, render, screen } from "@testing-library/react"

import type { BrowserApi } from "@ext/src/lib/browser-api"

import { PageTools, type OverlaySettings } from "./page-tools"

const api = {
  message: (key: string, subs?: string[]) => (subs ? `${key}:${subs.join("/")}` : key),
} as unknown as BrowserApi

const OVERLAY: OverlaySettings = {
  name: "home@2x.png",
  opacity: 0.5,
  x: 0,
  y: 0,
  scale: 0.5,
  difference: false,
  visible: true,
}

function setup(overrides: Partial<Parameters<typeof PageTools>[0]> = {}) {
  const props = {
    api,
    recordingSince: null,
    report: null,
    overlay: null,
    busy: null,
    onRecord: jest.fn(),
    onAttachReport: jest.fn(),
    onReportChange: jest.fn(),
    onRemoveReport: jest.fn(),
    onOverlayFile: jest.fn(),
    onOverlayChange: jest.fn(),
    onOverlayRemove: jest.fn(),
    onViewport: jest.fn(),
    ...overrides,
  }
  render(<PageTools {...props} />)
  return props
}

describe("PageTools", () => {
  it("compares the page with the mock, and shows how far apart they are", () => {
    const onCompare = jest.fn()
    const onRemoveDiff = jest.fn()
    setup({
      overlay: OVERLAY,
      onCompare,
      onRemoveDiff,
      designDiff: {
        mock: "home@2x.png",
        area: { x: 0, y: 0, width: 390, height: 700 },
        compared: 1000,
        mismatched: 125,
        regions: [{ x: 16, y: 300, width: 96, height: 32 }],
      },
    })
    fireEvent.click(screen.getByTestId("overlay-compare"))
    expect(onCompare).toHaveBeenCalled()
    expect(screen.getByTestId("design-diff-share")).toHaveTextContent("13%")
    expect(screen.getByTestId("design-diff")).toHaveTextContent("compareSummary:1/390×700")
    expect(screen.getByTestId("design-diff-region-0")).toHaveTextContent("96×32 @ 16,300")
    fireEvent.click(screen.getByTestId("design-diff-remove"))
    expect(onRemoveDiff).toHaveBeenCalled()
  })

  it("offers no comparison without a mock on the page", () => {
    setup({ onCompare: jest.fn() })
    fireEvent.click(screen.getByTestId("page-tools-toggle"))
    expect(screen.queryByTestId("overlay-compare")).toBeNull()
  })

  it("shows the tools it is given after its own, and opens for them while they are active", () => {
    setup({ childrenActive: true, children: <p data-testid="more-tools">more</p> })
    expect(screen.getByTestId("more-tools")).toBeVisible()
  })

  it("stays folded until opened, and opens by itself while something is under way", () => {
    setup()
    expect(screen.queryByTestId("dev-record")).toBeNull()
    fireEvent.click(screen.getByTestId("page-tools-toggle"))
    expect(screen.getByTestId("dev-record")).toBeVisible()
  })

  it("records, attaches and lets the person trim the report", () => {
    const props = setup({
      recordingSince: 0,
      report: {
        tabId: 1,
        capturedAt: 1,
        counts: { errors: 2, warnings: 0, failedRequests: 1, steps: 3 },
        text: "## Console and network",
      },
    })
    expect(screen.getByTestId("dev-recording")).toBeInTheDocument()
    expect(screen.getByTestId("dev-record")).toHaveTextContent("devRecordRestart")
    expect(screen.getByText("devReportErrors:2")).toBeInTheDocument()
    expect(screen.getByTestId("dev-report-steps")).toHaveTextContent("devReportSteps:3")
    expect(screen.getByText("devReportFailedRequests:1")).toBeInTheDocument()
    fireEvent.click(screen.getByTestId("dev-record"))
    fireEvent.click(screen.getByTestId("dev-attach"))
    fireEvent.change(screen.getByTestId("dev-report-text"), { target: { value: "trimmed" } })
    fireEvent.click(screen.getByTestId("dev-report-remove"))
    expect(props.onRecord).toHaveBeenCalled()
    expect(props.onAttachReport).toHaveBeenCalled()
    expect(props.onReportChange).toHaveBeenCalledWith("trimmed")
    expect(props.onRemoveReport).toHaveBeenCalled()
  })

  it("takes a design file and adjusts the overlay", () => {
    const props = setup({ overlay: OVERLAY })
    const file = new File([new Uint8Array([1])], "mock.png", { type: "image/png" })
    fireEvent.change(screen.getByTestId("overlay-file"), { target: { files: [file] } })
    expect(props.onOverlayFile).toHaveBeenCalledWith(file)
    fireEvent.change(screen.getByTestId("overlay-x"), { target: { value: "-12" } })
    expect(props.onOverlayChange).toHaveBeenLastCalledWith({ ...OVERLAY, x: -12 })
    fireEvent.click(screen.getByTestId("overlay-difference"))
    expect(props.onOverlayChange).toHaveBeenLastCalledWith({ ...OVERLAY, difference: true })
    fireEvent.click(screen.getByTestId("overlay-visible"))
    expect(props.onOverlayChange).toHaveBeenLastCalledWith({ ...OVERLAY, visible: false })
    expect(screen.getByText("overlayOpacity:50")).toBeInTheDocument()
    fireEvent.click(screen.getByTestId("overlay-remove"))
    expect(props.onOverlayRemove).toHaveBeenCalled()
  })

  it("opens the page at each screen size, and waits while a tool works", () => {
    const props = setup({ recordingSince: 0 })
    fireEvent.click(screen.getByTestId("viewport-mobile"))
    expect(props.onViewport).toHaveBeenCalledWith("mobile")
    expect(screen.getByTestId("viewport-desktop")).toHaveTextContent("viewportDesktop 1440×900")
  })

  it("disables the tools while one is working", () => {
    setup({ recordingSince: 0, busy: "report" })
    expect(screen.getByTestId("dev-attach")).toHaveTextContent("attachWorking")
    expect(screen.getByTestId("viewport-tablet")).toBeDisabled()
  })
})
