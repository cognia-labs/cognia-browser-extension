/** @jest-environment <rootDir>/testing/jsdom-environment.cjs */
import { useState } from "react"
import { fireEvent, render, screen } from "@testing-library/react"

import type { BrowserApi } from "@ext/src/lib/browser-api"
import type { PanelView } from "@ext/src/lib/panel/panel-view"

import { PanelShell, type PanelShellProps } from "./panel-shell"

const api = { message: (key: string) => key } as unknown as BrowserApi

function Shell(props: Partial<PanelShellProps> & { initial?: PanelView }) {
  const [view, setView] = useState<PanelView>(props.initial ?? "send")
  return (
    <PanelShell
      api={api}
      view={view}
      onView={setView}
      density="compact"
      connection={<span>local</span>}
      panels={{
        send: <input aria-label="Draft" />,
        inspect: <p>inspect body</p>,
        tools: <p>tools body</p>,
        settings: <p>settings body</p>,
      }}
      {...props}
    />
  )
}

describe("PanelShell", () => {
  it("shows one tab's view at a time and keeps the others' state while hidden", () => {
    render(<Shell />)
    const draft = screen.getByRole("textbox", { name: "Draft" })
    fireEvent.change(draft, { target: { value: "half written" } })
    expect(screen.getByRole("tab", { name: "tabSend" })).toHaveAttribute("aria-selected", "true")
    expect(screen.getByText("tools body")).not.toBeVisible()

    fireEvent.click(screen.getByRole("tab", { name: "tabTools" }))
    expect(screen.getByText("tools body")).toBeVisible()
    expect(draft).not.toBeVisible()
    fireEvent.click(screen.getByRole("tab", { name: "tabSend" }))
    expect(screen.getByRole("textbox", { name: "Draft" })).toHaveValue("half written")
  })

  it("moves between tabs with the arrow keys", () => {
    render(<Shell />)
    const send = screen.getByRole("tab", { name: "tabSend" })
    fireEvent.keyDown(send, { key: "ArrowLeft" })
    const tools = screen.getByRole("tab", { name: "tabTools" })
    expect(tools).toHaveAttribute("aria-selected", "true")
    expect(tools).toHaveFocus()
    fireEvent.keyDown(tools, { key: "ArrowRight" })
    expect(screen.getByRole("tab", { name: "tabSend" })).toHaveAttribute("aria-selected", "true")
    fireEvent.keyDown(screen.getByRole("tab", { name: "tabSend" }), { key: "End" })
    expect(screen.getByRole("tab", { name: "tabTools" })).toHaveAttribute("aria-selected", "true")
  })

  it("opens settings from the gear and returns to Send from it", () => {
    render(<Shell />)
    const gear = screen.getByRole("button", { name: "settingsTitle" })
    fireEvent.click(gear)
    expect(gear).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByText("settings body")).toBeVisible()
    for (const tab of screen.getAllByRole("tab")) {
      expect(tab).toHaveAttribute("aria-selected", "false")
    }
    fireEvent.click(gear)
    expect(screen.getByText("settings body")).not.toBeVisible()
    expect(screen.getByRole("tab", { name: "tabSend" })).toHaveAttribute("aria-selected", "true")
  })

  it("pins the composer under Send only, without unmounting it elsewhere", () => {
    render(<Shell composer={<textarea aria-label="Instruction" />} />)
    const instruction = screen.getByRole("textbox", { name: "Instruction" })
    fireEvent.change(instruction, { target: { value: "Fix it" } })
    fireEvent.click(screen.getByRole("tab", { name: "tabInspect" }))
    expect(screen.getByTestId("composer")).not.toBeVisible()
    fireEvent.click(screen.getByRole("tab", { name: "tabSend" }))
    expect(screen.getByRole("textbox", { name: "Instruction" })).toHaveValue("Fix it")
  })

  it("marks tabs with work under way, and shows running activity above every view", () => {
    render(
      <Shell
        activity={{ inspect: 3, tools: true }}
        status={<p role="status">Picking an element</p>}
        initial="tools"
      />
    )
    expect(screen.getByTestId("tab-inspect-count")).toHaveTextContent("3")
    expect(screen.getByRole("img", { name: "tabActive" })).toBeInTheDocument()
    expect(screen.queryByTestId("tab-send-active")).toBeNull()
    expect(screen.getByRole("status")).toHaveTextContent("Picking an element")
  })

  it("carries the chosen density for the stylesheet", () => {
    render(<Shell density="comfortable" />)
    expect(screen.getByTestId("panel-shell")).toHaveAttribute("data-panel-density", "comfortable")
  })
})
