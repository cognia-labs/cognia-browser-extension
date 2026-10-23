import {
  composite,
  contrastRatio,
  createColorReader,
  fromHsl,
  luminance,
  parseColor,
  suggestContrast,
  toHex,
  toHsl,
  toHslString,
  toRgbString,
} from "./page-colors"

describe("contrast suggestions", () => {
  it("goes between RGB and HSL and back", () => {
    for (const hex of ["#2563eb", "#aaaaaa", "#ff0000", "#00ff88", "#123456"]) {
      const rgba = parseColor(hex)!
      const [hue, saturation, light] = toHsl(rgba)
      expect(toHex(fromHsl(hue, saturation, light))).toBe(hex)
    }
  })

  it("finds the nearest passing colour of the same hue, darker on light and lighter on dark", () => {
    const white = parseColor("#ffffff")!
    const grey = parseColor("#aaaaaa")!
    const darker = suggestContrast(grey, white, 4.5)!
    expect(contrastRatio(darker, white)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(darker, white)).toBeLessThan(4.8)
    expect(toHsl(darker)[1]).toBe(0)
    const navy = parseColor("#1e293b")!
    const blue = parseColor("#334155")!
    const lighter = suggestContrast(blue, navy, 4.5)!
    expect(luminance(lighter)).toBeGreaterThan(luminance(blue))
    expect(contrastRatio(lighter, navy)).toBeGreaterThanOrEqual(4.5)
    // Mid grey on mid grey cannot reach AAA for large text by lightness alone… but 21:1 is never reachable.
    expect(suggestContrast(grey, white, 22)).toBeNull()
  })
})

describe("page colours", () => {
  it("parses rgb(), rgba(), modern space syntax and hex", () => {
    expect(parseColor("rgb(37, 99, 235)")).toEqual([37, 99, 235, 1])
    expect(parseColor("rgba(0, 0, 0, 0.5)")).toEqual([0, 0, 0, 0.5])
    expect(parseColor("rgb(37 99 235 / 50%)")).toEqual([37, 99, 235, 0.5])
    expect(parseColor("#FfF")).toEqual([255, 255, 255, 1])
    expect(parseColor("#00000080")).toEqual([0, 0, 0, 128 / 255])
    expect(parseColor("transparent")).toEqual([0, 0, 0, 0])
    expect(parseColor("oklch(0.6 0.2 250)")).toBeNull()
  })

  it("reads what it can without a canvas, and caches", () => {
    const read = createColorReader()
    expect(read("rgb(1, 2, 3)")).toEqual([1, 2, 3, 1])
    expect(read("oklch(0.6 0.2 250)")).toBeNull()
  })

  it("composites translucent layers and measures WCAG contrast", () => {
    expect(composite([0, 0, 0, 0.5], [255, 255, 255, 1])).toEqual([127.5, 127.5, 127.5, 1])
    expect(luminance([255, 255, 255, 1])).toBeCloseTo(1)
    expect(contrastRatio([0, 0, 0, 1], [255, 255, 255, 1])).toBeCloseTo(21)
    expect(contrastRatio([170, 170, 170, 1], [255, 255, 255, 1])).toBeCloseTo(2.32, 2)
  })

  it("writes hex, rgb and hsl", () => {
    expect(toHex([37, 99, 235, 1])).toBe("#2563eb")
    expect(toHex([0, 0, 0, 0.5])).toBe("#00000080")
    expect(toRgbString([37, 99, 235, 1])).toBe("rgb(37 99 235)")
    expect(toRgbString([37, 99, 235, 0.25])).toBe("rgb(37 99 235 / 0.25)")
    expect(toHslString([37, 99, 235, 1])).toBe("hsl(221 83% 53%)")
    expect(toHslString([128, 128, 128, 1])).toBe("hsl(0 0% 50%)")
  })
})
