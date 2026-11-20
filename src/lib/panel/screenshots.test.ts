/** @jest-environment node */
import { MAX_CANVAS_SIDE } from "../agent/image-ops"
import {
  CAPTURE_SPACING_MS,
  captureFullPage,
  captureVisible,
  elementCrop,
  fileNameFromUrl,
  freshSegmentRows,
  regionInImagePixels,
  screenshotAttachment,
  sniffMediaType,
  stopsShort,
} from "./screenshots"

function fakeApi(
  metrics = {
    scrollHeight: 2_500,
    viewportHeight: 1_000,
    viewportWidth: 500,
    scrollY: 40,
    dpr: 2,
  }
) {
  let clock = 0
  const calls: string[] = []
  const captures: number[] = []
  const api = {
    activateTab: async (id: number) => {
      calls.push(`activate:${id}`)
    },
    captureVisible: async (windowId: number) => {
      captures.push(clock)
      calls.push(`capture:${windowId}`)
      return "data:image/png;base64,AAAA"
    },
    scrollMetrics: async () => metrics,
    scrollTo: async (_tab: number, y: number) => {
      calls.push(`scroll:${y}`)
      return Math.min(y, metrics.scrollHeight - metrics.viewportHeight)
    },
    cropImage: async () => "",
    stitchImages: async (shots: string[], width: number, heights: number[]) =>
      `${shots.length}:${width}:${heights.join("+")}`,
  }
  const sleep = async (ms: number) => {
    clock += ms
  }
  return { api, calls, captures, sleep }
}

const TAB = { id: 7, url: "https://a.test/", title: "A", windowId: 3 }

describe("captureVisible", () => {
  it("brings the tab to front and captures its window", async () => {
    const { api, calls, sleep } = fakeApi()
    await expect(captureVisible(api, TAB, sleep)).resolves.toBe("data:image/png;base64,AAAA")
    expect(calls).toEqual(["activate:7", "capture:3"])
    await expect(captureVisible(api, { ...TAB, windowId: undefined }, sleep)).rejects.toThrow(
      "window"
    )
  })

  it("takes the floating toolbar out of the shot, and puts it back even when the shot fails", async () => {
    const { api, calls, sleep } = fakeApi()
    const hidePageChrome = jest.fn(async (tabId: number, hidden: boolean) => {
      calls.push(`chrome:${tabId}:${hidden}`)
    })
    await captureVisible({ ...api, hidePageChrome }, TAB, sleep)
    expect(calls).toEqual(["activate:7", "chrome:7:true", "capture:3", "chrome:7:false"])
    calls.length = 0
    const failing = {
      ...api,
      hidePageChrome,
      captureVisible: async () => {
        throw new Error("denied")
      },
    }
    await expect(captureVisible(failing, TAB, sleep)).rejects.toThrow("denied")
    expect(calls.at(-1)).toBe("chrome:7:false")
    // A page it cannot reach is captured as it is.
    const unreachable = jest.fn(async () => {
      throw new Error("no access")
    })
    await expect(captureVisible({ ...api, hidePageChrome: unreachable }, TAB, sleep)).resolves.toBe(
      "data:image/png;base64,AAAA"
    )
  })
})

describe("captureFullPage", () => {
  it("stitches spaced captures, keeping only new rows of the last, and restores the scroll", async () => {
    const { api, calls, captures, sleep } = fakeApi()
    const result = await captureFullPage(api, TAB, sleep)
    expect(result).toEqual({
      base64: "3:1000:2000+2000+1000",
      width: 1_000,
      height: 5_000,
      truncated: false,
    })
    expect(captures[2]! - captures[1]!).toBeGreaterThanOrEqual(CAPTURE_SPACING_MS)
    expect(calls.at(-1)).toBe("scroll:40")
  })

  it("keeps the floating toolbar out of every segment", async () => {
    const { api, calls, sleep } = fakeApi()
    const hidePageChrome = async (_tabId: number, hidden: boolean) => {
      calls.push(`chrome:${hidden}`)
    }
    await captureFullPage({ ...api, hidePageChrome }, TAB, sleep)
    const shown = calls.filter((call) => call.startsWith("chrome:") || call.startsWith("capture:"))
    expect(shown).toEqual(["chrome:true", "capture:3", "capture:3", "capture:3", "chrome:false"])
  })

  it("says when the page was cut", async () => {
    const { api, sleep } = fakeApi({
      scrollHeight: 50_000,
      viewportHeight: 1_000,
      viewportWidth: 500,
      scrollY: 0,
      dpr: 1,
    })
    const result = await captureFullPage(api, TAB, sleep)
    expect(result.truncated).toBe(true)
    expect(result.height).toBeLessThanOrEqual(MAX_CANVAS_SIDE)
  })

  /** A 1,000 px page in a 400 px viewport whose scroll answers lag behind (smooth scrolling). */
  function laggingApi(landed: number[], failAt?: number) {
    const { api, calls, sleep } = fakeApi({
      scrollHeight: 1_000,
      viewportHeight: 400,
      viewportWidth: 300,
      scrollY: 120,
      scrollX: 300,
      dpr: 1,
    } as never)
    const scrolls: [number, number | undefined][] = []
    let shots = 0
    return {
      sleep,
      calls,
      scrolls,
      api: {
        ...api,
        scrollTo: async (_tab: number, y: number, x?: number) => {
          scrolls.push([y, x])
          return landed.shift() ?? y
        },
        captureVisible: async (windowId: number) => {
          if (++shots === failAt) throw new Error("capture refused")
          return api.captureVisible(windowId)
        },
      },
    }
  }

  it("stitches from where each segment landed, and says when the page fell short", async () => {
    const { api, sleep, scrolls } = laggingApi([0, 0, 400])
    const result = await captureFullPage(api, TAB, sleep)
    // The repeat at 0 adds nothing; the 400 adds 400 new rows. 800 of 1,000 px is cut.
    expect(result).toMatchObject({ base64: "3:300:400+0+400", height: 800, truncated: true })
    // Segments keep the page where it is sideways; the restore puts both axes back.
    expect(scrolls).toEqual([
      [0, undefined],
      [400, undefined],
      [800, undefined],
      [120, 300],
    ])
  })

  it("is whole, not cut, when every segment landed where asked", async () => {
    const { api, sleep } = laggingApi([0, 400, 600])
    const result = await captureFullPage(api, TAB, sleep)
    expect(result).toMatchObject({ base64: "3:300:400+400+200", height: 1_000, truncated: false })
  })

  it("puts the scroll back, on both axes, when a segment fails", async () => {
    const { api, sleep, scrolls } = laggingApi([0, 400, 600], 2)
    await expect(captureFullPage(api, TAB, sleep)).rejects.toThrow("capture refused")
    expect(scrolls.at(-1)).toEqual([120, 300])
  })
})

describe("segment arithmetic", () => {
  it("counts only rows below the previous segment's bottom, in device pixels", () => {
    expect(freshSegmentRows([0, 1_000, 1_500], 1_000, 2)).toEqual([2_000, 2_000, 1_000])
    // A segment that went backwards or nowhere adds nothing, and none adds more than a viewport.
    expect(freshSegmentRows([0, 0, 2_000, 1_500], 1_000, 1)).toEqual([1_000, 0, 1_000, 0])
    expect(freshSegmentRows([], 1_000, 1)).toEqual([])
  })

  it("knows when the last segment stopped short of the bottom", () => {
    const metrics = { scrollHeight: 1_000, viewportHeight: 400 }
    expect(stopsShort([0, 400, 600], metrics)).toBe(false)
    expect(stopsShort([0, 400, 599.5], metrics)).toBe(false)
    expect(stopsShort([0, 0, 400], metrics)).toBe(true)
  })
})

describe("elementCrop", () => {
  it("frames a picked element with a margin, in device pixels, never off the top-left", () => {
    expect(elementCrop({ x: 100, y: 50, width: 40, height: 20 }, 2)).toEqual({
      x: 184,
      y: 84,
      width: 112,
      height: 72,
    })
    expect(elementCrop({ x: 2, y: 0, width: 10, height: 10 }, 1)).toEqual({
      x: 0,
      y: 0,
      width: 20,
      height: 18,
    })
  })
})

describe("helpers", () => {
  it("maps a dragged rectangle into image pixels, in any drag direction", () => {
    expect(
      regionInImagePixels(
        { x: 100, y: 50, width: -50, height: -25 },
        { width: 200, height: 100 },
        { width: 800, height: 400 }
      )
    ).toEqual({
      x: 200,
      y: 100,
      width: 200,
      height: 100,
    })
    expect(
      regionInImagePixels(
        { x: 190, y: 90, width: 100, height: 100 },
        { width: 200, height: 100 },
        { width: 200, height: 100 }
      )
    ).toEqual({
      x: 190,
      y: 90,
      width: 10,
      height: 10,
    })
  })

  it("builds a screenshot attachment", () => {
    const attachment = screenshotAttachment("a1", "AQID", Date.UTC(2026, 9, 16, 12, 0, 0), "region")
    expect(attachment).toMatchObject({
      id: "a1",
      name: "screenshot-region-2026-10-16T12-00-00.png",
      mediaType: "image/png",
      kind: "screenshot",
      previewUrl: "data:image/png;base64,AQID",
    })
    expect([...attachment.bytes]).toEqual([1, 2, 3])
  })

  it("names files from their URL", () => {
    expect(fileNameFromUrl("https://a.test/docs/My%20Paper.pdf?x=1", "doc.pdf")).toBe(
      "My Paper.pdf"
    )
    expect(fileNameFromUrl("https://a.test/", "doc.pdf")).toBe("doc.pdf")
    expect(fileNameFromUrl("nope", "doc.pdf")).toBe("doc.pdf")
  })

  it("sniffs common file types", () => {
    expect(
      sniffMediaType(new Uint8Array([0x25, 0x50, 0x44, 0x46]), "application/octet-stream")
    ).toBe("application/pdf")
    expect(sniffMediaType(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), "")).toBe("image/png")
    expect(sniffMediaType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), "")).toBe("image/jpeg")
    expect(
      sniffMediaType(
        new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]),
        ""
      )
    ).toBe("image/webp")
    expect(sniffMediaType(new Uint8Array([1, 2, 3]), "text/html")).toBe("text/html")
  })
})
