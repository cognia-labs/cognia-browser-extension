/** @jest-environment <rootDir>/testing/jsdom-environment.cjs */
import { fireEvent, render, screen } from "@testing-library/react"

import type { BrowserApi } from "@ext/src/lib/browser-api"
import type { PickedElement } from "@ext/src/lib/inspect/element-context"

import { PickComparisonCard } from "./pick-comparison"

const api = { message: (key: string) => key } as unknown as BrowserApi

const pick = (selector: string, styles: Record<string, string>) =>
  ({ label: selector, selector, styles, edits: { styles: {} } }) as unknown as PickedElement

describe("PickComparisonCard", () => {
  it("shows nothing for a single pick", () => {
    const { container } = render(
      <PickComparisonCard
        api={api}
        picks={[pick("#a", {})]}
        included={false}
        onInclude={jest.fn()}
      />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it("tables the styles that differ, marks the odd ones out, and offers to send it", () => {
    const onInclude = jest.fn()
    render(
      <PickComparisonCard
        api={api}
        picks={[
          pick("#a", { "font-size": "14px", color: "red" }),
          pick("#b", { "font-size": "16px", color: "red" }),
        ]}
        included={false}
        onInclude={onInclude}
      />
    )
    expect(screen.getByTestId("pick-compare-count")).toHaveTextContent("compareDifferences")
    const row = screen.getByTestId("pick-compare-row-0")
    expect(row).toHaveTextContent("font-size")
    expect(row).toHaveTextContent("14px")
    expect(screen.getByText("16px").className).toContain("bg-warning/15")
    expect(screen.getByText("14px").className).not.toContain("bg-warning/15")
    expect(screen.queryByTestId("pick-compare-row-1")).toBeNull()
    fireEvent.click(screen.getByTestId("pick-compare-include"))
    expect(onInclude).toHaveBeenCalledWith(true)
  })

  it("says so when the picks match", () => {
    render(
      <PickComparisonCard
        api={api}
        picks={[pick("#a", { color: "red" }), pick("#b", { color: "red" })]}
        included
        onInclude={jest.fn()}
      />
    )
    expect(screen.getByTestId("pick-compare-count")).toHaveTextContent("compareSame")
    expect(screen.getByText("compareAllSame")).toBeInTheDocument()
  })
})
