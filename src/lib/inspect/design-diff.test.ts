import {
  compareWithMock,
  designDiffMarkdown,
  diffPixels,
  mismatchPercent,
  mismatchRegions,
  overlapOf,
  paintDiff,
  parseDesignDiff,
  type DiffDeps,
  type PixelCanvas,
} from "./design-diff"

type Raster = { width: number; height: number; data: Uint8ClampedArray }

function raster(width: number, height: number, fill: (x: number, y: number) => number[]): Raster {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) data.set(fill(x, y), (y * width + x) * 4)
  return { width, height, data }
}

/** A canvas that really draws, nearest-neighbour, so the comparison runs end to end. */
function fakeCanvas(width: number, height: number): PixelCanvas & { raster: Raster } {
  const target = raster(width, height, () => [0, 0, 0, 0])
  const context = {
    strokeStyle: "",
    lineWidth: 1,
    strokes: [] as number[][],
    drawImage(image: unknown, ...args: number[]) {
      const source = image as Raster
      const [sx, sy, sw, sh, dx, dy, dw, dh] = args as [
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
      ]
      for (let y = 0; y < dh; y++)
        for (let x = 0; x < dw; x++) {
          const fromX = Math.floor(sx + ((x + 0.5) * sw) / dw)
          const fromY = Math.floor(sy + ((y + 0.5) * sh) / dh)
          if (fromX >= source.width || fromY >= source.height) continue
          const from = (fromY * source.width + fromX) * 4
          target.data.set(source.data.subarray(from, from + 4), ((dy + y) * width + dx + x) * 4)
        }
    },
    getImageData: () => ({ data: new Uint8ClampedArray(target.data) }),
    putImageData: (data: { data: Uint8ClampedArray }) => target.data.set(data.data),
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    strokeRect(...rect: number[]) {
      context.strokes.push(rect)
    },
  }
  return {
    width,
    height,
    raster: target,
    getContext: () => context,
    // What was boxed, standing in for the PNG's bytes.
    convertToBlob: async () => ({ strokes: context.strokes }) as unknown as Blob,
  }
}

describe("design comparison", () => {
  it("finds where the mock and the viewport overlap, in both their pixels", () => {
    // A 2x export at (10, 100) on a page scrolled to 50.
    expect(
      overlapOf(
        { x: 10, y: 100, scale: 0.5, width: 400, height: 2000 },
        { scrollX: 0, scrollY: 50, width: 300, height: 600 }
      )
    ).toEqual({
      view: { x: 10, y: 50, width: 200, height: 550 },
      mock: { x: 0, y: 0, width: 400, height: 1100 },
    })
    // Scrolled past the mock's top: only its lower part is compared.
    expect(
      overlapOf(
        { x: 0, y: 0, scale: 1, width: 100, height: 300 },
        { scrollX: 0, scrollY: 200, width: 100, height: 500 }
      )
    ).toEqual({
      view: { x: 0, y: 0, width: 100, height: 100 },
      mock: { x: 0, y: 200, width: 100, height: 100 },
    })
    expect(
      overlapOf(
        { x: 0, y: 0, scale: 1, width: 100, height: 100 },
        { scrollX: 0, scrollY: 400, width: 100, height: 300 }
      )
    ).toBeNull()
  })

  it("counts differing pixels beyond a tolerance, and leaves out what the mock does not draw", () => {
    const page = new Uint8ClampedArray([10, 10, 10, 255, 200, 0, 0, 255, 0, 0, 0, 255])
    const mock = new Uint8ClampedArray([30, 10, 10, 255, 0, 0, 0, 255, 255, 255, 255, 0])
    const { mask, compared, mismatched } = diffPixels(page, mock, 3, 1)
    expect([...mask]).toEqual([0, 1, 0])
    expect({ compared, mismatched }).toEqual({ compared: 2, mismatched: 1 })
  })

  it("joins differing cells into regions, largest first", () => {
    const width = 64
    const height = 64
    const mask = new Uint8Array(width * height)
    const fill = (x0: number, y0: number, w: number, h: number) => {
      for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) mask[y * width + x] = 1
    }
    fill(0, 0, 20, 10) // two cells, side by side
    fill(48, 48, 16, 16) // one cell
    expect(mismatchRegions(mask, width, height)).toEqual([
      { x: 0, y: 0, width: 32, height: 16 },
      { x: 48, y: 48, width: 16, height: 16 },
    ])
    expect(mismatchRegions(new Uint8Array(width * height), width, height)).toEqual([])
  })

  it("fades the page to grey and marks what differs in red", () => {
    const page = new Uint8ClampedArray([0, 0, 0, 255, 100, 100, 100, 255])
    expect([...paintDiff(page, new Uint8Array([1, 0]))]).toEqual([
      239, 68, 68, 255, 201, 201, 201, 255,
    ])
  })

  it("says the share and the regions, in page coordinates", () => {
    const diff = {
      mock: "home@2x.png",
      area: { x: 0, y: 120, width: 390, height: 700 },
      compared: 273_000,
      mismatched: 4_095,
      regions: [{ x: 16, y: 300, width: 96, height: 32 }],
    }
    expect(mismatchPercent(diff)).toBe("1.5%")
    expect(mismatchPercent({ compared: 10, mismatched: 4 })).toBe("40%")
    expect(mismatchPercent({ compared: 0, mismatched: 0 })).toBe("0%")
    const text = designDiffMarkdown(diff)
    expect(text).toContain("## Design comparison")
    expect(text).toContain("`home@2x.png`")
    expect(text).toContain(
      "1.5% of 273000 compared pixels differ, over the page's 390×700 at (0, 120)."
    )
    expect(text).toContain("1. 96×32 at (16, 300)")
    expect(designDiffMarkdown({ ...diff, regions: [] })).toContain("No region differs noticeably.")
    expect(parseDesignDiff(JSON.parse(JSON.stringify({ ...diff, tabId: 1, ranAt: 2 })))).toEqual({
      ...diff,
      tabId: 1,
      ranAt: 2,
    })
    expect(parseDesignDiff({ ...diff, tabId: "1" })).toBeNull()
  })

  it("compares a 2x capture with a 1x mock at CSS size, and answers page coordinates", async () => {
    // The page: white, with a red square at CSS (8, 8)–(24, 24); captured at 2x.
    const capture = raster(80, 80, (x, y) =>
      x >= 16 && x < 48 && y >= 16 && y < 48 ? [255, 0, 0, 255] : [255, 255, 255, 255]
    )
    // The mock: all white, laid at the page's origin.
    const mock = raster(40, 40, () => [255, 255, 255, 255])
    const images: Record<string, Raster> = { capture, mock }
    const canvases: ReturnType<typeof fakeCanvas>[] = []
    const deps: DiffDeps = {
      decode: async (url) => images[url]!,
      canvas: (width, height) => {
        const canvas = fakeCanvas(width, height)
        canvases.push(canvas)
        return canvas
      },
      toDataUrl: async (blob) =>
        `data:image/png;base64,${JSON.stringify((blob as unknown as { strokes: number[][] }).strokes)}`,
    }
    const compared = await compareWithMock(deps, {
      capture: "capture",
      mock: "mock",
      overlay: { x: 0, y: 0, scale: 1 },
      view: { scrollX: 0, scrollY: 100, width: 40, height: 40 },
    })
    expect(compared).toBeNull()
    const result = await compareWithMock(deps, {
      capture: "capture",
      mock: "mock",
      overlay: { x: 0, y: 100, scale: 1 },
      view: { scrollX: 0, scrollY: 100, width: 40, height: 40 },
    })
    expect(result?.result).toEqual({
      area: { x: 0, y: 100, width: 40, height: 40 },
      compared: 1600,
      mismatched: 256,
      regions: [{ x: 0, y: 100, width: 32, height: 32 }],
    })
    // The image shows the difference: red where the square is, grey elsewhere.
    const shown = canvases.at(-2)!.raster.data
    expect([...shown.subarray((10 * 40 + 10) * 4, (10 * 40 + 10) * 4 + 4)]).toEqual([
      239, 68, 68, 255,
    ])
    expect([...shown.subarray(0, 4)]).toEqual([255, 255, 255, 255])
    expect(result?.image).toBe("data:image/png;base64,[[1,1,30,30]]")
  })
})
