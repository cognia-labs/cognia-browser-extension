/** @jest-environment <rootDir>/testing/jsdom-environment.cjs */
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

import type { BrowserApi } from "@ext/src/lib/browser-api"
import type { PickedElement } from "@ext/src/lib/inspect/element-context"

import { PickedElements } from "./picked-elements"

const api = {
  message: (key: string, subs?: string[]) => (subs ? `${key}:${subs.join("/")}` : key),
  openUrl: async () => undefined,
} as unknown as BrowserApi

const PICK: PickedElement = {
  elementId: "e1",
  selector: "main > button.primary",
  tag: "button",
  label: "button.primary",
  role: "button",
  name: "Save changes",
  text: "Save changes",
  textEditable: true,
  attributes: {},
  box: { x: 0, y: 0, width: 120, height: 36 },
  viewport: { width: 1280, height: 800, dpr: 1, scrollX: 0, scrollY: 0 },
  styles: { padding: "8px" },
  outline: "button.primary",
  sourceHints: [],
  framework: {
    framework: "react",
    components: [{ name: "SaveButton" }, { name: "SettingsForm" }],
    source: { file: "/src/SaveButton.tsx", line: 12, column: 5, approximate: true },
  },
  tabId: 1,
  pageUrl: "https://a.test/",
  pickedAt: 1,
  note: "",
  edits: { styles: {} },
  screenshotIds: [],
}

function setup(overrides: Partial<Parameters<typeof PickedElements>[0]> = {}) {
  const props = {
    api,
    elements: [PICK],
    detached: [],
    busy: null,
    canShoot: true,
    preview: "## Picked elements (1)",
    onChange: jest.fn(),
    onRemove: jest.fn(),
    onLocate: jest.fn(),
    onShoot: jest.fn(),
    ...overrides,
  }
  render(<PickedElements {...props} />)
  return props
}

describe("PickedElements", () => {
  it("folds picks chosen together, with what each holds at a glance", () => {
    const second = { ...PICK, elementId: "e2", label: "a.link", note: "Bigger" }
    const props = setup({ elements: [PICK, second] })
    // Folded: the header and its summary, not the editor.
    expect(screen.queryByTestId("pick-note-0")).toBeNull()
    expect(screen.getByTestId("pick-0")).toHaveTextContent("1. button.primary")
    expect(screen.getByTestId("pick-summary-0")).toHaveTextContent("SaveButton")
    expect(screen.getByTestId("pick-summary-1")).toHaveTextContent("inspectNoted")
    // The size rides with the summary, leaving the header its width.
    expect(screen.getByTestId("pick-summary-0")).toContainElement(screen.getByTestId("pick-size-0"))
    fireEvent.click(screen.getByTestId("pick-quick-remove-1"))
    expect(props.onRemove).toHaveBeenCalledWith("e2")
    fireEvent.click(screen.getByTestId("pick-quick-locate-0"))
    expect(props.onLocate).toHaveBeenCalledWith("e1")
    // Opened by its header.
    fireEvent.click(screen.getByTestId("pick-toggle-0"))
    expect(screen.getByTestId("pick-note-0")).toBeInTheDocument()
    expect(screen.queryByTestId("pick-summary-0")).toBeNull()
    // And all at once.
    fireEvent.click(screen.getByTestId("picks-expand-all"))
    expect(screen.getByTestId("pick-note-1")).toBeInTheDocument()
    expect(screen.getByTestId("picks-expand-all")).toHaveTextContent("inspectCollapseAll")
    fireEvent.click(screen.getByTestId("picks-expand-all"))
    expect(screen.queryByTestId("pick-note-0")).toBeNull()
  })

  it("keeps a long text to one line in the header, whitespace and all", () => {
    const text = `Pricing plans\n   This grey text is too light to read. ${"More words. ".repeat(40)}`
    setup({
      elements: [
        { ...PICK, name: undefined, text },
        { ...PICK, elementId: "e2" },
      ],
    })
    const excerpt = screen.getByTestId("pick-excerpt-0")
    expect(excerpt).toHaveClass("truncate")
    expect(excerpt).not.toHaveClass("line-clamp-1")
    expect(excerpt.textContent).toMatch(/^Pricing plans This grey text/)
    expect(excerpt.textContent).not.toContain("\n")
    expect(excerpt).toHaveAttribute("title", expect.stringMatching(/^.{300}$/s))
  })

  it("opens a pick added on its own, leaving the others as they were", () => {
    const props = {
      api,
      detached: [],
      busy: null,
      canShoot: true,
      preview: "",
      onChange: jest.fn(),
      onRemove: jest.fn(),
      onLocate: jest.fn(),
      onShoot: jest.fn(),
    }
    const { rerender } = render(<PickedElements {...props} elements={[PICK]} />)
    expect(screen.getByTestId("pick-note-0")).toBeInTheDocument()
    fireEvent.click(screen.getByTestId("pick-toggle-0"))
    rerender(
      <PickedElements {...props} elements={[PICK, { ...PICK, elementId: "e2", label: "p" }]} />
    )
    expect(screen.queryByTestId("pick-note-0")).toBeNull()
    expect(screen.getByTestId("pick-note-1")).toBeInTheDocument()
  })

  it("renders nothing with nothing picked", () => {
    setup({ elements: [] })
    expect(screen.queryByTestId("picked-elements")).toBeNull()
  })

  it("leads with the component chain and where it was written", () => {
    setup()
    expect(screen.getByText("inspectPickedTitle:1")).toBeInTheDocument()
    expect(screen.getByTestId("pick-components-0")).toHaveTextContent("SaveButton ← SettingsForm")
    expect(screen.getByTestId("pick-source-0")).toHaveTextContent("/src/SaveButton.tsx:12:5")
    expect(screen.getByTestId("pick-source-0")).toHaveTextContent("inspectApproximate")
    expect(screen.getByText("main > button.primary")).toBeInTheDocument()
  })

  it("says when the page exposes no source, and when the element is gone", () => {
    const { framework: _framework, ...bare } = PICK
    setup({ elements: [bare], detached: ["e1"] })
    expect(screen.getByTestId("pick-no-source-0")).toBeInTheDocument()
    expect(screen.getByTestId("pick-detached-0")).toBeInTheDocument()
    expect(screen.getByTestId("pick-locate-0")).toBeDisabled()
  })

  it("reports the note, a text change and style edits as the person's request", () => {
    const props = setup()
    fireEvent.change(screen.getByTestId("pick-note-0"), { target: { value: "Bigger" } })
    expect(props.onChange).toHaveBeenLastCalledWith("e1", { note: "Bigger", edits: { styles: {} } })
    fireEvent.change(screen.getByTestId("pick-text-0"), { target: { value: "Save" } })
    expect(props.onChange).toHaveBeenLastCalledWith("e1", {
      note: "",
      edits: { styles: {}, text: "Save" },
    })
    fireEvent.click(screen.getByTestId("pick-styles-toggle-0"))
    fireEvent.change(screen.getByTestId("style-padding"), { target: { value: "12px" } })
    expect(props.onChange).toHaveBeenLastCalledWith("e1", {
      note: "",
      edits: { styles: { padding: "12px" } },
    })
  })

  it("undoes edits, locates, shoots and removes", () => {
    const props = setup({ elements: [{ ...PICK, edits: { styles: { padding: "12px" } } }] })
    expect(screen.getByText("inspectEdited")).toBeInTheDocument()
    fireEvent.click(screen.getByTestId("pick-revert-0"))
    expect(props.onChange).toHaveBeenLastCalledWith("e1", { note: "", edits: { styles: {} } })
    fireEvent.click(screen.getByTestId("pick-locate-0"))
    fireEvent.click(screen.getByTestId("pick-shoot-0"))
    fireEvent.click(screen.getByTestId("pick-remove-0"))
    expect(props.onLocate).toHaveBeenCalledWith("e1")
    expect(props.onShoot).toHaveBeenCalledWith("e1")
    expect(props.onRemove).toHaveBeenCalledWith("e1")
  })

  it("copies the element as markup and CSS", async () => {
    const writeText = jest.fn(async () => undefined)
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
    setup({ elements: [{ ...PICK, html: "<button>Save</button>" }] })
    fireEvent.click(screen.getByTestId("pick-copy-code-0"))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect((writeText.mock.calls[0] as unknown as [string])[0]).toMatch(
      /^<button>Save<\/button>\n\n<style>\nmain > button\.primary \{/
    )
  })

  it("rates a text pick's contrast and offers the nearest colour that passes", () => {
    const props = setup({
      elements: [
        {
          ...PICK,
          edits: { styles: { padding: "4px" } },
          contrast: {
            ratio: 2.32,
            foreground: "#aaaaaa",
            background: "#ffffff",
            large: false,
            aa: false,
            aaa: false,
            suggestion: "#767676",
          },
        },
      ],
    })
    expect(screen.getByTestId("pick-contrast-0")).toHaveTextContent("2.32:1")
    expect(screen.getByTestId("pick-contrast-0")).toHaveTextContent("AA ✗")
    fireEvent.click(screen.getByTestId("pick-contrast-fix-0"))
    expect(props.onChange).toHaveBeenCalledWith("e1", {
      note: "",
      edits: { styles: { padding: "4px", color: "#767676" } },
    })
  })

  it("shows the component's state on request, and adjusts a pick on the page", () => {
    const onAdjust = jest.fn()
    setup({
      onAdjust,
      elements: [
        {
          ...PICK,
          framework: { ...PICK.framework!, state: { component: "SaveButton", json: "[2]" } },
        },
      ],
    })
    fireEvent.click(screen.getByTestId("pick-state-toggle-0"))
    expect(screen.getByTestId("pick-state-0")).toHaveTextContent("[2]")
    expect(screen.getByTestId("pick-state-toggle-0")).toHaveTextContent("inspectState:SaveButton")
    fireEvent.click(screen.getByTestId("pick-adjust-0"))
    expect(onAdjust).toHaveBeenCalledWith("e1")
  })

  it("offers no adjusting while the pick is busy", () => {
    setup({ onAdjust: jest.fn(), busy: { elementId: "e1", action: "adjust" } })
    expect(screen.getByTestId("pick-adjust-0")).toBeDisabled()
    expect(screen.getByTestId("pick-adjust-0")).toHaveTextContent("adjustWorking")
  })

  it("offers no adjusting without a handler", () => {
    setup()
    expect(screen.queryByTestId("pick-adjust-0")).toBeNull()
  })

  it("rates a passing pick without a fix to offer", () => {
    setup({
      elements: [
        {
          ...PICK,
          contrast: {
            ratio: 12.6,
            foreground: "#222222",
            background: "#ffffff",
            large: false,
            aa: true,
            aaa: true,
          },
        },
      ],
    })
    expect(screen.getByTestId("pick-contrast-0")).toHaveTextContent("AAA ✓")
    expect(screen.queryByTestId("pick-contrast-fix-0")).toBeNull()
  })

  it("shows the nearest component's props on request", () => {
    setup({
      elements: [
        {
          ...PICK,
          framework: {
            ...PICK.framework!,
            props: { component: "SaveButton", json: '{ "variant": "primary" }' },
          },
        },
      ],
    })
    fireEvent.click(screen.getByTestId("pick-props-toggle-0"))
    expect(screen.getByTestId("pick-props-0")).toHaveTextContent('"variant": "primary"')
  })

  it("offers no screenshot when no more can be attached, and shows what is sent on request", () => {
    setup({ canShoot: false })
    expect(screen.getByTestId("pick-shoot-0")).toBeDisabled()
    fireEvent.click(screen.getByTestId("inspect-preview-toggle"))
    expect(screen.getByTestId("inspect-preview")).toHaveTextContent("Picked elements (1)")
  })
})
