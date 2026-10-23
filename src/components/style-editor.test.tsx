/** @jest-environment <rootDir>/testing/jsdom-environment.cjs */
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

import type { BrowserApi } from "@ext/src/lib/browser-api"

import { StyleEditor } from "./style-editor"

const api = {
  message: (key: string, subs?: string[]) => (subs ? `${key}:${subs.join("/")}` : key),
} as unknown as BrowserApi

const COMPUTED = { padding: "8px", color: "rgb(37, 99, 235)", "font-size": "14px" }

function setup(edits: Record<string, string> = {}) {
  const onChange = jest.fn()
  render(
    <StyleEditor api={api} idPrefix="p0" computed={COMPUTED} edits={edits} onChange={onChange} />
  )
  return onChange
}

describe("StyleEditor — eyedropper", () => {
  it("samples a colour from the screen into a colour field, and ignores a cancel", async () => {
    const onChange = jest.fn()
    const onEyedrop = jest.fn().mockResolvedValueOnce("#ff0000").mockResolvedValueOnce(null)
    render(
      <StyleEditor
        api={api}
        idPrefix="p1"
        computed={COMPUTED}
        edits={{}}
        onChange={onChange}
        onEyedrop={onEyedrop}
      />
    )
    expect(screen.queryByTestId("style-eyedrop-padding")).toBeNull()
    fireEvent.click(screen.getByTestId("style-eyedrop-color"))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ color: "#ff0000" }))
    fireEvent.click(screen.getByTestId("style-eyedrop-color"))
    await waitFor(() => expect(onEyedrop).toHaveBeenCalledTimes(2))
    expect(onChange).toHaveBeenCalledTimes(1)
  })
})

describe("StyleEditor", () => {
  it("starts each field at what the page computed, grouped and named in CSS", () => {
    setup()
    expect(screen.getByTestId("style-padding")).toHaveValue("8px")
    expect(screen.getByLabelText("padding")).toHaveValue("8px")
    expect(screen.getByText("styleGroupSpacing")).toBeInTheDocument()
    expect(screen.getByTestId("style-color-color")).toHaveValue("#2563eb")
    expect(screen.queryByTestId("style-reset-p0")).toBeNull()
  })

  it("reports an edit, and drops one put back to the page's value", () => {
    const onChange = setup({ "font-size": "18px" })
    fireEvent.change(screen.getByTestId("style-padding"), { target: { value: "12px 16px" } })
    expect(onChange).toHaveBeenLastCalledWith({ "font-size": "18px", padding: "12px 16px" })
    fireEvent.change(screen.getByTestId("style-font-size"), { target: { value: "14px" } })
    expect(onChange).toHaveBeenLastCalledWith({})
  })

  it("edits a colour from its well, marks a value that cannot be CSS, and resets", () => {
    const onChange = setup({ gap: "4px; color: red" })
    fireEvent.input(screen.getByTestId("style-color-background-color"), {
      target: { value: "#ff0000" },
    })
    expect(onChange).toHaveBeenLastCalledWith({
      gap: "4px; color: red",
      "background-color": "#ff0000",
    })
    expect(screen.getByTestId("style-gap")).toHaveAttribute("aria-invalid", "true")
    fireEvent.click(screen.getByTestId("style-reset-p0"))
    expect(onChange).toHaveBeenLastCalledWith({})
  })
})
