/** @jest-environment <rootDir>/testing/jsdom-environment.cjs */
import { fireEvent, render, screen } from "@testing-library/react"

import type { BrowserApi } from "@ext/src/lib/browser-api"
import { MAX_SHAPES, type Shape } from "@ext/src/lib/panel/annotations"

import { ImageAnnotator } from "./image-annotator"

const api = {
  message: (key: string, subs?: string[]) => (subs ? `${key}:${subs.join("/")}` : key),
} as unknown as BrowserApi

function setup(initial: Shape[] = [], saving = false) {
  const onConfirm = jest.fn()
  const onCancel = jest.fn()
  render(
    <ImageAnnotator
      api={api}
      src="data:image/png;base64,AA=="
      initial={initial}
      saving={saving}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )
  const surface = screen.getByTestId("annotate-surface")
  surface.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0 }) as DOMRect
  return { surface, onConfirm, onCancel }
}

function drag(surface: HTMLElement, points: [number, number][]) {
  const [first, ...rest] = points
  fireEvent.pointerDown(surface, { clientX: first![0], clientY: first![1], pointerId: 1 })
  for (const [x, y] of rest)
    fireEvent.pointerMove(surface, { clientX: x, clientY: y, pointerId: 1 })
  fireEvent.pointerUp(surface, { pointerId: 1 })
}

describe("ImageAnnotator", () => {
  it("draws a box by default, in the colour chosen, relative to the image", () => {
    const { surface, onConfirm } = setup()
    fireEvent.click(screen.getByTestId("annotate-color-3"))
    drag(surface, [
      [20, 10],
      [120, 60],
    ])
    expect(screen.getByTestId("annotate-shape-0").tagName.toLowerCase()).toBe("rect")
    fireEvent.click(screen.getByTestId("annotate-confirm"))
    expect(onConfirm).toHaveBeenCalledWith([
      { kind: "box", color: "#3b82f6", from: { x: 0.1, y: 0.1 }, to: { x: 0.6, y: 0.6 } },
    ])
  })

  it("keeps freehand strokes and arrows, and drops a click that drew nothing", () => {
    const { surface, onConfirm } = setup()
    drag(surface, [[50, 50]])
    expect(screen.queryByTestId("annotate-shape-0")).toBeNull()
    fireEvent.click(screen.getByTestId("annotate-tool-pen"))
    drag(surface, [
      [0, 0],
      [10, 10],
      [20, 5],
    ])
    fireEvent.click(screen.getByTestId("annotate-tool-arrow"))
    drag(surface, [
      [0, 0],
      [100, 50],
    ])
    expect(screen.getByTestId("annotate-tool-arrow")).toHaveAttribute("aria-pressed", "true")
    fireEvent.click(screen.getByTestId("annotate-confirm"))
    const [shapes] = onConfirm.mock.calls[0] as [Shape[]]
    expect(shapes.map((shape) => shape.kind)).toEqual(["pen", "arrow"])
    expect(shapes[0]).toMatchObject({
      points: [
        { x: 0, y: 0 },
        { x: 0.05, y: 0.1 },
        { x: 0.1, y: 0.05 },
      ],
    })
  })

  it("numbers markers, takes a note for each, and renumbers when one is removed", () => {
    const { surface, onConfirm } = setup()
    fireEvent.click(screen.getByTestId("annotate-tool-marker"))
    drag(surface, [[20, 20]])
    drag(surface, [[40, 40]])
    drag(surface, [[60, 60]])
    fireEvent.change(screen.getByTestId("annotate-note-3"), { target: { value: "third" } })
    fireEvent.click(screen.getByTestId("annotate-remove-2"))
    expect(screen.queryByTestId("annotate-note-3")).toBeNull()
    expect(screen.getByTestId("annotate-note-2")).toHaveValue("third")
    fireEvent.click(screen.getByTestId("annotate-confirm"))
    const [shapes] = onConfirm.mock.calls[0] as [Shape[]]
    expect(shapes.map((shape) => (shape.kind === "marker" ? [shape.n, shape.note] : null))).toEqual(
      [
        [1, ""],
        [2, "third"],
      ]
    )
  })

  it("starts from earlier marks, undoes the last, clears, and cancels", () => {
    const earlier: Shape[] = [
      { kind: "arrow", color: "#ef4444", from: { x: 0, y: 0 }, to: { x: 1, y: 1 } },
      { kind: "marker", color: "#ef4444", at: { x: 0.5, y: 0.5 }, n: 1, note: "keep" },
    ]
    const { onCancel } = setup(earlier)
    expect(screen.getByTestId("annotate-shape-1")).toHaveTextContent("1")
    fireEvent.click(screen.getByTestId("annotate-undo"))
    expect(screen.queryByTestId("annotate-shape-1")).toBeNull()
    expect(screen.queryByTestId("annotate-notes")).toBeNull()
    fireEvent.click(screen.getByTestId("annotate-clear"))
    expect(screen.getByTestId("annotate-undo")).toBeDisabled()
    fireEvent.click(screen.getByTestId("annotate-cancel"))
    expect(onCancel).toHaveBeenCalled()
  })

  it("stops taking marks at the limit, and while saving", () => {
    const full = Array.from({ length: MAX_SHAPES }, (): Shape => ({
      kind: "box",
      color: "#ef4444",
      from: { x: 0, y: 0 },
      to: { x: 1, y: 1 },
    }))
    const { surface } = setup(full)
    expect(screen.getByTestId("annotate-full")).toBeInTheDocument()
    drag(surface, [
      [0, 0],
      [100, 100],
    ])
    expect(screen.queryByTestId(`annotate-shape-${MAX_SHAPES}`)).toBeNull()
  })

  it("says it is saving, and will not save twice", () => {
    setup([], true)
    expect(screen.getByTestId("annotate-confirm")).toBeDisabled()
    expect(screen.getByTestId("annotate-confirm")).toHaveTextContent("annotateSaving")
  })
})
