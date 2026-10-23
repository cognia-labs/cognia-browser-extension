/**
 * How far the build is from its design mock, measured (PerfectPixel): the
 * visible page, captured with the overlay hidden, against the mock where the
 * overlay puts it — pixel by pixel, at CSS size.
 *
 * What comes out is what an agent can act on: the share of compared pixels
 * that differ, the regions where they cluster in page coordinates, and an
 * image that shows them — the page faded to grey with every differing pixel
 * red and each region boxed.
 */

export interface DiffBox {
  x: number
  y: number
  width: number
  height: number
}

export interface DesignDiff {
  tabId: number
  ranAt: number
  /** The mock's file name, as the person chose it. */
  mock: string
  /** The part of the page compared, in document CSS pixels. */
  area: DiffBox
  compared: number
  mismatched: number
  /** Where the differences cluster, largest first, in document CSS pixels. */
  regions: DiffBox[]
}

/** How different two channels may be and still count as the same, out of 255. */
export const DIFF_THRESHOLD = 32
/** Regions are found on a grid of cells this many CSS pixels wide. */
export const DIFF_CELL = 16
export const MAX_REGIONS = 8
/** A cell counts toward a region when this share of its pixels differ. */
const CELL_FILL = 0.08

/**
 * Where mock and viewport overlap, in viewport CSS pixels, and the matching
 * rectangle of the mock image in its own pixels. `null` when the mock is
 * scrolled out of view.
 */
export function overlapOf(
  overlay: { x: number; y: number; scale: number; width: number; height: number },
  view: { scrollX: number; scrollY: number; width: number; height: number }
): { view: DiffBox; mock: DiffBox } | null {
  const left = overlay.x - view.scrollX
  const top = overlay.y - view.scrollY
  const shownWidth = overlay.width * overlay.scale
  const shownHeight = overlay.height * overlay.scale
  const x = Math.max(0, Math.round(left))
  const y = Math.max(0, Math.round(top))
  const right = Math.min(view.width, Math.round(left + shownWidth))
  const bottom = Math.min(view.height, Math.round(top + shownHeight))
  if (right - x < 1 || bottom - y < 1) return null
  return {
    view: { x, y, width: right - x, height: bottom - y },
    mock: {
      x: (x - left) / overlay.scale,
      y: (y - top) / overlay.scale,
      width: (right - x) / overlay.scale,
      height: (bottom - y) / overlay.scale,
    },
  }
}

/**
 * Compare two RGBA buffers of the same size. A mock pixel that is mostly
 * transparent compares as nothing: the design does not say what goes there.
 */
export function diffPixels(
  page: Uint8ClampedArray,
  mock: Uint8ClampedArray,
  width: number,
  height: number,
  threshold = DIFF_THRESHOLD
): { mask: Uint8Array; compared: number; mismatched: number } {
  const mask = new Uint8Array(width * height)
  let compared = 0
  let mismatched = 0
  for (let index = 0; index < width * height; index++) {
    const offset = index * 4
    if ((mock[offset + 3] ?? 0) < 128) continue
    compared++
    if (
      Math.abs(page[offset]! - mock[offset]!) > threshold ||
      Math.abs(page[offset + 1]! - mock[offset + 1]!) > threshold ||
      Math.abs(page[offset + 2]! - mock[offset + 2]!) > threshold
    ) {
      mask[index] = 1
      mismatched++
    }
  }
  return { mask, compared, mismatched }
}

/**
 * The boxes the differences cluster in: cells with enough differing pixels,
 * joined with their neighbours (diagonals too), largest first.
 */
export function mismatchRegions(
  mask: Uint8Array,
  width: number,
  height: number,
  cell = DIFF_CELL
): DiffBox[] {
  const columns = Math.ceil(width / cell)
  const rows = Math.ceil(height / cell)
  const hot = new Uint8Array(columns * rows)
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      let count = 0
      let total = 0
      for (let y = row * cell; y < Math.min(height, (row + 1) * cell); y++) {
        for (let x = column * cell; x < Math.min(width, (column + 1) * cell); x++) {
          total++
          count += mask[y * width + x]!
        }
      }
      if (total > 0 && count / total >= CELL_FILL) hot[row * columns + column] = 1
    }
  }
  const seen = new Uint8Array(columns * rows)
  const boxes: (DiffBox & { cells: number })[] = []
  for (let start = 0; start < hot.length; start++) {
    if (!hot[start] || seen[start]) continue
    let minColumn = columns
    let minRow = rows
    let maxColumn = -1
    let maxRow = -1
    let cells = 0
    const stack = [start]
    seen[start] = 1
    while (stack.length > 0) {
      const at = stack.pop()!
      const row = Math.floor(at / columns)
      const column = at % columns
      cells++
      minColumn = Math.min(minColumn, column)
      maxColumn = Math.max(maxColumn, column)
      minRow = Math.min(minRow, row)
      maxRow = Math.max(maxRow, row)
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const r = row + dy
          const c = column + dx
          if (r < 0 || c < 0 || r >= rows || c >= columns) continue
          const next = r * columns + c
          if (hot[next] && !seen[next]) {
            seen[next] = 1
            stack.push(next)
          }
        }
      }
    }
    const x = minColumn * cell
    const y = minRow * cell
    boxes.push({
      x,
      y,
      width: Math.min(width, (maxColumn + 1) * cell) - x,
      height: Math.min(height, (maxRow + 1) * cell) - y,
      cells,
    })
  }
  return boxes
    .sort((a, b) => b.width * b.height - a.width * a.height || b.cells - a.cells)
    .slice(0, MAX_REGIONS)
    .map(({ cells: _cells, ...box }) => box)
}

/** The page faded to grey, every differing pixel red. Written in place. */
export function paintDiff(page: Uint8ClampedArray, mask: Uint8Array): Uint8ClampedArray {
  for (let index = 0; index < mask.length; index++) {
    const offset = index * 4
    if (mask[index]) {
      page[offset] = 239
      page[offset + 1] = 68
      page[offset + 2] = 68
    } else {
      const grey = Math.round(
        0.3 * page[offset]! + 0.59 * page[offset + 1]! + 0.11 * page[offset + 2]!
      )
      const faded = Math.round(grey * 0.35 + 255 * 0.65)
      page[offset] = faded
      page[offset + 1] = faded
      page[offset + 2] = faded
    }
    page[offset + 3] = 255
  }
  return page
}

export function mismatchPercent(diff: Pick<DesignDiff, "compared" | "mismatched">): string {
  if (diff.compared === 0) return "0%"
  const share = (diff.mismatched / diff.compared) * 100
  return `${share < 10 ? share.toFixed(1) : Math.round(share)}%`
}

function box(value: DiffBox): string {
  return `${value.width}×${value.height} at (${value.x}, ${value.y})`
}

export function designDiffMarkdown(diff: Omit<DesignDiff, "tabId" | "ranAt">): string {
  const lines = [
    "## Design comparison",
    "",
    `The page as it renders, against the design mock \`${diff.mock}\` where the person laid it over the page; compared at CSS size. ${mismatchPercent(diff)} of ${diff.compared} compared pixels differ, over the page's ${box(diff.area)}.`,
  ]
  if (diff.regions.length === 0) lines.push("", "No region differs noticeably.")
  else {
    lines.push(
      "",
      "Where the differences cluster, largest first (document CSS pixels, from the page's top-left):",
      ""
    )
    diff.regions.forEach((region, index) => lines.push(`${index + 1}. ${box(region)}`))
  }
  return lines.join("\n")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isBox(value: unknown): value is DiffBox {
  return (
    isRecord(value) && ["x", "y", "width", "height"].every((key) => typeof value[key] === "number")
  )
}

/** A stored comparison this build can show, from an unsent draft. */
export function parseDesignDiff(value: unknown): DesignDiff | null {
  if (
    !isRecord(value) ||
    typeof value.tabId !== "number" ||
    typeof value.ranAt !== "number" ||
    typeof value.mock !== "string" ||
    typeof value.compared !== "number" ||
    typeof value.mismatched !== "number" ||
    !isBox(value.area) ||
    !Array.isArray(value.regions)
  )
    return null
  return {
    tabId: value.tabId,
    ranAt: value.ranAt,
    mock: value.mock.slice(0, 200),
    area: value.area,
    compared: value.compared,
    mismatched: value.mismatched,
    regions: value.regions.filter(isBox).slice(0, MAX_REGIONS),
  }
}

/** A canvas that can be read and written pixel by pixel: the panel's OffscreenCanvas. */
export interface PixelCanvas {
  width: number
  height: number
  getContext(type: "2d"): {
    drawImage(image: unknown, ...args: number[]): void
    getImageData(x: number, y: number, width: number, height: number): { data: Uint8ClampedArray }
    putImageData(data: unknown, x: number, y: number): void
    createImageData(width: number, height: number): { data: Uint8ClampedArray }
    strokeRect(x: number, y: number, width: number, height: number): void
    strokeStyle: string
    lineWidth: number
  } | null
  convertToBlob(options: { type: string }): Promise<Blob>
}

export interface DiffDeps {
  decode: (dataUrl: string) => Promise<{ width: number; height: number; close?(): void }>
  canvas: (width: number, height: number) => PixelCanvas
  toDataUrl: (blob: Blob) => Promise<string>
}

/**
 * Compare a visible-area capture with the mock. `capture` is in device
 * pixels; everything is brought to CSS size first, so a 2x screen and a 2x
 * export line up with their 1x selves.
 */
export async function compareWithMock(
  deps: DiffDeps,
  {
    capture,
    mock,
    overlay,
    view,
  }: {
    capture: string
    mock: string
    overlay: { x: number; y: number; scale: number }
    view: { scrollX: number; scrollY: number; width: number; height: number }
  }
): Promise<{ image: string; result: Omit<DesignDiff, "tabId" | "ranAt" | "mock"> } | null> {
  const page = await deps.decode(capture)
  const design = await deps.decode(mock)
  try {
    const overlap = overlapOf({ ...overlay, width: design.width, height: design.height }, view)
    if (!overlap) return null
    const { width, height } = overlap.view
    const dpr = page.width / view.width || 1
    const pageCanvas = deps.canvas(width, height)
    const mockCanvas = deps.canvas(width, height)
    const pageContext = pageCanvas.getContext("2d")
    const mockContext = mockCanvas.getContext("2d")
    if (!pageContext || !mockContext) throw new Error("no 2d canvas context")
    pageContext.drawImage(
      page,
      overlap.view.x * dpr,
      overlap.view.y * dpr,
      width * dpr,
      height * dpr,
      0,
      0,
      width,
      height
    )
    mockContext.drawImage(
      design,
      overlap.mock.x,
      overlap.mock.y,
      overlap.mock.width,
      overlap.mock.height,
      0,
      0,
      width,
      height
    )
    const pagePixels = pageContext.getImageData(0, 0, width, height)
    const mockPixels = mockContext.getImageData(0, 0, width, height)
    const { mask, compared, mismatched } = diffPixels(
      pagePixels.data,
      mockPixels.data,
      width,
      height
    )
    const regions = mismatchRegions(mask, width, height)
    paintDiff(pagePixels.data, mask)
    pageContext.putImageData(pagePixels, 0, 0)
    pageContext.strokeStyle = "#b91c1c"
    pageContext.lineWidth = 2
    for (const region of regions)
      pageContext.strokeRect(region.x + 1, region.y + 1, region.width - 2, region.height - 2)
    const image = await deps.toDataUrl(await pageCanvas.convertToBlob({ type: "image/png" }))
    const offset = (region: DiffBox): DiffBox => ({
      ...region,
      x: Math.round(region.x + overlap.view.x + view.scrollX),
      y: Math.round(region.y + overlap.view.y + view.scrollY),
    })
    return {
      image,
      result: {
        area: offset({ x: 0, y: 0, width, height }),
        compared,
        mismatched,
        regions: regions.map(offset),
      },
    }
  } finally {
    page.close?.()
    design.close?.()
  }
}
