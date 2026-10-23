import {
  alignmentNotes,
  measureBoxes,
  measureGuides,
  measurementsMarkdown,
  parseMeasurement,
  pixels,
  relationText,
  type Measurement,
} from "./measure"

const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height })

describe("measureBoxes", () => {
  it("measures the gap between boxes side by side, and says which side", () => {
    const measure = measureBoxes(box(0, 0, 100, 40), box(112, 0, 50, 40))
    expect(measure).toMatchObject({ relation: "apart", horizontal: { gap: 12, side: "right" } })
    expect(measure.vertical).toBeUndefined()
    expect(measureBoxes(box(112, 0, 50, 40), box(0, 0, 100, 40)).horizontal).toEqual({
      gap: 12,
      side: "left",
    })
  })

  it("measures both axes for a box off to the corner", () => {
    expect(measureBoxes(box(0, 0, 10, 10), box(20, 30, 10, 10))).toMatchObject({
      relation: "apart",
      horizontal: { gap: 10, side: "right" },
      vertical: { gap: 20, side: "below" },
    })
    expect(measureBoxes(box(0, 50, 10, 10), box(0, 0, 10, 40)).vertical).toEqual({
      gap: 10,
      side: "above",
    })
  })

  it("measures the insets of a box held in another, whichever was measured first", () => {
    const card = box(0, 0, 300, 200)
    const button = box(24, 16, 100, 40)
    expect(measureBoxes(card, button)).toMatchObject({
      relation: "inside",
      insets: { top: 16, right: 176, bottom: 144, left: 24 },
    })
    expect(measureBoxes(button, card)).toMatchObject({
      relation: "contains",
      insets: { top: 16, right: 176, bottom: 144, left: 24 },
    })
  })

  it("tells overlapping and identical boxes apart", () => {
    expect(measureBoxes(box(0, 0, 100, 100), box(50, 50, 100, 100)).relation).toBe("overlap")
    expect(measureBoxes(box(0, 0, 10, 10), box(0, 0, 10, 10)).relation).toBe("same")
  })

  it("keeps signed edge offsets, for alignment", () => {
    expect(measureBoxes(box(0, 0, 100, 40), box(2, 60, 100, 40)).offsets).toEqual({
      top: 60,
      right: 2,
      bottom: 60,
      left: 2,
      centerX: 2,
      centerY: 60,
    })
  })
})

describe("measureGuides", () => {
  it("draws a gap along the stretch both boxes share", () => {
    const from = box(0, 0, 100, 40)
    const to = box(112, 20, 50, 40)
    expect(measureGuides(from, to, measureBoxes(from, to))).toEqual([
      { x1: 100, y1: 30, x2: 112, y2: 30, label: "12px" },
    ])
  })

  it("draws the four insets of a held box, and skips the ones that are zero", () => {
    const outer = box(0, 0, 100, 100)
    const inner = box(0, 10, 50, 50)
    const guides = measureGuides(outer, inner, measureBoxes(outer, inner))
    expect(guides.map((guide) => guide.label)).toEqual(["10px", "50px", "40px"])
  })
})

describe("as text", () => {
  const measurement = (overrides: Partial<Measurement> = {}): Measurement => {
    const from = {
      elementId: "a",
      selector: "#save",
      label: "button#save",
      box: box(0, 0, 100, 40),
    }
    const to = { elementId: "b", selector: ".hint", label: "p.hint", box: box(2, 52.5, 100, 20) }
    return {
      id: "m1",
      tabId: 1,
      pageUrl: "https://example.com/",
      measuredAt: 1,
      from,
      to,
      measure: measureBoxes(from.box, to.box),
      note: "",
      ...overrides,
    }
  }

  it("writes pixels without a trailing .0", () => {
    expect(pixels(12)).toBe("12px")
    expect(pixels(12.04)).toBe("12px")
    expect(pixels(12.5)).toBe("12.5px")
  })

  it("says where the second box is, and the near misses", () => {
    const sample = measurement()
    expect(relationText(sample)).toBe("`p.hint` is 12.5px below `button#save`")
    expect(alignmentNotes(sample.measure)).toEqual([
      "Nearly aligned: left edges are 2px off; right edges are 2px off; horizontal centres are 2px off",
    ])
    const corner = measurement({ measure: measureBoxes(box(0, 0, 10, 10), box(20, 30, 10, 10)) })
    expect(relationText(corner)).toBe(
      "`p.hint` is 10px to the right of `button#save` and 20px below it"
    )
    const inside = measurement({ measure: measureBoxes(box(0, 0, 100, 100), box(8, 8, 84, 84)) })
    expect(relationText(inside)).toBe(
      "`p.hint` sits inside `button#save`: 8px top, 8px right, 8px bottom, 8px left"
    )
    expect(alignmentNotes(inside.measure)).toEqual([
      "Aligned: horizontal centres, vertical centres",
    ])
  })

  it("lists measurements with both boxes and the person's request", () => {
    const text = measurementsMarkdown([measurement({ note: "Make it 16px" })])
    expect(text).toContain("## Measurements (1)")
    expect(text).toContain("1. `p.hint` is 12.5px below `button#save`")
    expect(text).toContain("- From `#save` 100×40px at (0, 0); to `.hint` 100×20px at (2, 53)")
    expect(text).toContain("- **Requested:** Make it 16px")
    expect(measurementsMarkdown([])).toBe("")
  })

  it("restores a stored measurement and works its numbers out again", () => {
    const stored = JSON.parse(JSON.stringify({ ...measurement(), measure: { relation: "same" } }))
    expect(parseMeasurement(stored)?.measure.relation).toBe("apart")
    expect(parseMeasurement({ ...stored, from: { ...stored.from, box: { x: "0" } } })).toBeNull()
    expect(parseMeasurement(null)).toBeNull()
  })
})
