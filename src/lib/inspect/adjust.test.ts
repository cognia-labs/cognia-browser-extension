import {
  adjustChanges,
  adjustStatus,
  nudge,
  resize,
  resizeZone,
  sidesShorthand,
  type AdjustState,
} from "./adjust"

const START: AdjustState = { width: 120, height: 36, margin: [0, 0, 0, 0], padding: [8, 16, 8, 16] }

describe("adjusting a pick", () => {
  it("grabs the right edge, the bottom edge or the corner, a few pixels either side", () => {
    const rect = { left: 10, top: 10, right: 130, bottom: 46 }
    expect(resizeZone(rect, 132, 30)).toBe("x")
    expect(resizeZone(rect, 60, 44)).toBe("y")
    expect(resizeZone(rect, 128, 48)).toBe("xy")
    expect(resizeZone(rect, 60, 30)).toBeNull()
    expect(resizeZone(rect, 300, 30)).toBeNull()
  })

  it("resizes from where the drag started, never below a pixel", () => {
    expect(resize(START, "x", 40.4, 99)).toEqual({ width: 160, height: 36 })
    expect(resize(START, "y", 99, -10)).toEqual({ width: 120, height: 26 })
    expect(resize(START, "xy", -500, 4)).toEqual({ width: 1, height: 40 })
  })

  it("grows the side an arrow points at, by ten with Shift, and shrinks it with Alt", () => {
    const grown = nudge(START, "ArrowUp", { spacing: "margin", shrink: false, big: true })
    expect(grown.margin).toEqual([10, 0, 0, 0])
    const padded = nudge(START, "ArrowLeft", { spacing: "padding", shrink: true, big: false })
    expect(padded.padding).toEqual([8, 16, 8, 15])
    expect(
      nudge(START, "ArrowDown", { spacing: "margin", shrink: true, big: true }).margin
    ).toEqual([0, 0, 0, 0])
    expect(nudge(START, "Tab", { spacing: "margin", shrink: false, big: false })).toBe(START)
  })

  it("writes four sides as briefly as CSS allows", () => {
    expect(sidesShorthand([8, 8, 8, 8])).toBe("8px")
    expect(sidesShorthand([8, 16, 8, 16])).toBe("8px 16px")
    expect(sidesShorthand([4, 16, 8, 16])).toBe("4px 16px 8px")
    expect(sidesShorthand([1, 2, 3, 4])).toBe("1px 2px 3px 4px")
  })

  it("answers only what changed, as style edits", () => {
    expect(adjustChanges(START, START)).toEqual({})
    expect(adjustChanges(START, { ...START, width: 150, padding: [12, 16, 8, 16] })).toEqual({
      width: "150px",
      padding: "12px 16px 8px",
    })
  })

  it("says the size and the spacing being nudged", () => {
    expect(adjustStatus(START, "padding", { margin: "Margin", padding: "Padding" })).toBe(
      "120×36  ·  Padding 8 16 8 16"
    )
  })
})
