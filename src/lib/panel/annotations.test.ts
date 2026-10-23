/** @jest-environment node */
import {
  annotationsMarkdown,
  arrowHead,
  drawShapes,
  isMeaningful,
  nextMarker,
  renderAnnotated,
  renumber,
  strokeWidth,
  thinStroke,
  type AnnotationContext,
  type Shape,
} from "./annotations"

const RED = "#ef4444" as const

const marker = (n: number, note = ""): Shape => ({
  kind: "marker",
  color: RED,
  at: { x: 0.5, y: 0.5 },
  n,
  note,
})

function recorder() {
  const calls: string[] = []
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (target, key: string) =>
      key in target ? target[key] : (...args: unknown[]) => calls.push(`${key}(${args.join(",")})`),
    set: (target, key: string, value) => {
      target[key] = value
      calls.push(`${key}=${value}`)
      return true
    },
  })
  return { ctx: ctx as unknown as AnnotationContext & Record<string, unknown>, calls }
}

describe("markers", () => {
  it("numbers the next marker after the highest, and renumbers after one is taken away", () => {
    expect(nextMarker([])).toBe(1)
    expect(nextMarker([marker(1), marker(4)])).toBe(5)
    const box: Shape = { kind: "box", color: RED, from: { x: 0, y: 0 }, to: { x: 1, y: 1 } }
    expect(renumber([marker(2, "a"), box, marker(5, "b")])).toEqual([
      marker(1, "a"),
      box,
      marker(2, "b"),
    ])
  })
})

describe("shapes", () => {
  const size = { width: 1000, height: 500 }

  it("keeps a drag that drew something, not a stray click", () => {
    expect(
      isMeaningful(
        { kind: "box", color: RED, from: { x: 0, y: 0 }, to: { x: 0.002, y: 0.5 } },
        size
      )
    ).toBe(false)
    expect(
      isMeaningful(
        { kind: "box", color: RED, from: { x: 0, y: 0 }, to: { x: 0.01, y: 0.01 } },
        size
      )
    ).toBe(true)
    expect(
      isMeaningful(
        { kind: "arrow", color: RED, from: { x: 0, y: 0 }, to: { x: 0.005, y: 0 } },
        size
      )
    ).toBe(false)
    expect(isMeaningful({ kind: "pen", color: RED, points: [{ x: 0, y: 0 }] }, size)).toBe(false)
    expect(isMeaningful(marker(1), size)).toBe(true)
  })

  it("thins a long stroke evenly, keeping both ends", () => {
    const points = Array.from({ length: 1000 }, (_, index) => ({ x: index / 999, y: 0 }))
    const thin = thinStroke(points)
    expect(thin).toHaveLength(400)
    expect(thin[0]).toEqual(points[0])
    expect(thin.at(-1)).toEqual(points.at(-1))
    expect(thinStroke(points.slice(0, 3))).toEqual(points.slice(0, 3))
  })

  it("draws thicker on a larger image, and points an arrow's head back along it", () => {
    expect(strokeWidth({ width: 400, height: 300 })).toBe(2)
    expect(strokeWidth({ width: 2560, height: 1440 })).toBe(6)
    const [left, right] = arrowHead({ x: 0, y: 0 }, { x: 100, y: 0 }, 10)
    expect(left.x).toBeLessThan(100)
    expect(right.x).toBeLessThan(100)
    expect(left.y).toBeCloseTo(-right.y)
  })
})

describe("drawShapes", () => {
  it("draws each kind at the image's own size", () => {
    const { ctx, calls } = recorder()
    drawShapes(
      ctx,
      [
        { kind: "box", color: RED, from: { x: 0.5, y: 0.5 }, to: { x: 0.1, y: 0.2 } },
        {
          kind: "pen",
          color: "#3b82f6",
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
          ],
        },
        marker(3),
      ],
      200,
      100
    )
    expect(calls).toContain("strokeRect(20,20,80,30)")
    expect(calls).toContain("strokeStyle=#3b82f6")
    expect(calls).toContain("lineTo(200,100)")
    expect(calls).toContain("arc(100,50,11,0,6.283185307179586)")
    expect(calls.some((call) => call.startsWith("fillText(3,100,"))).toBe(true)
  })
})

describe("renderAnnotated", () => {
  it("draws the shot, then the marks, onto a canvas of its size", async () => {
    const { ctx, calls } = recorder()
    const close = jest.fn()
    const surface = jest.fn(() => ({
      getContext: () => ctx,
      convertToBlob: async () => new Blob([new Uint8Array([1, 2, 3])]),
    }))
    const base64 = await renderAnnotated(
      { decode: async () => ({ width: 40, height: 20, close }), surface: surface as never },
      "data:image/png;base64,AAAA",
      [marker(1)]
    )
    expect(base64).toBe("AQID")
    expect(surface).toHaveBeenCalledWith(40, 20)
    expect(calls[0]).toBe("drawImage([object Object],0,0,40,20,0,0,40,20)")
    expect(close).toHaveBeenCalled()
    expect(calls.some((call) => call.startsWith("fillText(1,"))).toBe(true)
  })
})

describe("annotationsMarkdown", () => {
  it("lists what was drawn on each marked shot, and every marker's note", () => {
    const text = annotationsMarkdown([
      { name: "plain.png", shapes: [] },
      {
        name: "shot.png",
        shapes: [
          { kind: "box", color: RED, from: { x: 0, y: 0 }, to: { x: 1, y: 1 } },
          { kind: "box", color: RED, from: { x: 0, y: 0 }, to: { x: 1, y: 1 } },
          { kind: "arrow", color: RED, from: { x: 0, y: 0 }, to: { x: 1, y: 1 } },
          marker(1, "  Too tight "),
          marker(2),
        ],
      },
    ])
    expect(text).toContain("## Screenshot annotations")
    expect(text).toContain("- `shot.png`: 2 boxes, 1 arrow, 2 numbered markers")
    expect(text).toContain("  1. Too tight\n  2. (no note)")
    expect(text).not.toContain("plain.png")
    expect(annotationsMarkdown([{ name: "plain.png", shapes: [] }])).toBe("")
  })
})
