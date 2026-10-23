/** @jest-environment <rootDir>/testing/jsdom-environment.cjs */
import { fireEvent, render, screen } from "@testing-library/react"
import { RulerIcon } from "lucide-react"

import { ActivityStrip, PanelSection, ToolTile } from "./panel-section"

describe("PanelSection", () => {
  it("heads its part of the panel with a title at the level asked, and what it is for", () => {
    render(
      <PanelSection icon={RulerIcon} title="Capture" subtitle="From this page" level="h1">
        <p>body</p>
      </PanelSection>
    )
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Capture")
    expect(screen.getByText("From this page")).toBeInTheDocument()
    expect(screen.getByText("body")).toBeInTheDocument()
  })
})

describe("ToolTile", () => {
  it("is a button named by its label, saying whether its tool is running", () => {
    const onClick = jest.fn()
    const { rerender } = render(
      <ToolTile icon={RulerIcon} label="Measure" hint="Between two" onClick={onClick} testId="t" />
    )
    const tile = screen.getByRole("button", { name: "Measure" })
    expect(tile).toHaveAttribute("aria-pressed", "false")
    expect(tile).toHaveAttribute("title", "Between two")
    fireEvent.click(tile)
    expect(onClick).toHaveBeenCalledTimes(1)
    rerender(
      <ToolTile icon={RulerIcon} label="Measure" pressed disabled onClick={onClick} testId="t" />
    )
    expect(screen.getByTestId("t")).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByTestId("t")).toBeDisabled()
  })
})

describe("ActivityStrip", () => {
  it("holds what is running and its controls", () => {
    render(
      <ActivityStrip testId="strip">
        <p role="status">Picking</p>
      </ActivityStrip>
    )
    expect(screen.getByTestId("strip")).toContainElement(screen.getByRole("status"))
  })
})
