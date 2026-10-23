/** @jest-environment <rootDir>/testing/jsdom-environment.cjs */
import { fireEvent, render, screen } from "@testing-library/react"

import type { BrowserApi } from "@ext/src/lib/browser-api"

import { TextChanges } from "./text-changes"

const api = {
  message: (key: string, subs?: string[]) => (subs ? `${key}:${subs.join("/")}` : key),
} as unknown as BrowserApi

describe("TextChanges", () => {
  it("shows nothing without changes", () => {
    const { container } = render(<TextChanges api={api} changes={[]} onRemove={jest.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("shows each change as before and after, deletions and additions included", () => {
    const onRemove = jest.fn()
    render(
      <TextChanges
        api={api}
        changes={[
          { selector: "#title", label: "h1#title", before: "Old", after: "New" },
          { label: "p.note", before: "Gone", after: "" },
          { selector: "#added", label: "p#added", before: "", after: "Fresh" },
        ]}
        onRemove={onRemove}
      />
    )
    expect(screen.getByText("textChangesTitle:3")).toBeInTheDocument()
    expect(screen.getByText("Old")).toHaveClass("line-through")
    expect(screen.getByTestId("text-change-1")).toHaveTextContent("p.note · textChangeDeleted")
    expect(screen.getByTestId("text-change-1")).toHaveTextContent("textChangeRemoved")
    expect(screen.getByTestId("text-change-2")).toHaveTextContent("Fresh")
    fireEvent.click(screen.getByTestId("text-change-remove-2"))
    expect(onRemove).toHaveBeenCalledWith(2)
  })
})
