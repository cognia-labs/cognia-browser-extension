/** @jest-environment <rootDir>/testing/jsdom-environment.cjs */
import {
  formatBytes,
  formatVital,
  mainPagePerformance,
  parsePerformance,
  performanceMarkdown,
  rate,
  vitals,
  type PagePerformance,
} from "./page-performance"

const SAMPLE: Omit<PagePerformance, "tabId" | "ranAt"> = {
  navigation: {
    type: "navigate",
    ttfb: 320,
    fcp: 900,
    domContentLoaded: 1_200,
    load: 2_100,
    transferBytes: 12_000,
  },
  lcp: { ms: 3_100, element: "img.hero" },
  cls: 0.31,
  interaction: { ms: 180, event: "click", target: "button#save" },
  longTasks: { count: 4, blockingMs: 420 },
  scripts: [{ source: "https://example.com/app.js", invoker: "click", ms: 260 }],
  resources: {
    count: 42,
    bytes: 2_500_000,
    byType: [{ type: "script", count: 12, bytes: 1_800_000 }],
    largest: [{ url: "https://example.com/hero.png", type: "img", bytes: 900_000 }],
    slowest: [{ url: "https://api.example.com/feed", type: "fetch", ms: 1_400 }],
    renderBlocking: ["https://example.com/app.css"],
    thirdParty: [{ host: "cdn.analytics.test", count: 3, bytes: 50_000 }],
  },
  images: {
    oversized: [{ element: "img.hero", natural: "4000×3000", shown: "400×300" }],
    unsized: 2,
  },
  dom: { elements: 1_234, depth: 17, heapMb: 32.5 },
}

describe("ratings", () => {
  it("rates by Web Vitals thresholds, edges included as the better side", () => {
    expect(rate("lcp", 2_500)).toBe("good")
    expect(rate("lcp", 2_501)).toBe("needs-improvement")
    expect(rate("lcp", 4_001)).toBe("poor")
    expect(rate("cls", 0.1)).toBe("good")
    expect(rate("inp", 600)).toBe("poor")
  })

  it("lists only what was measured, in order of importance", () => {
    expect(vitals(SAMPLE).map((vital) => [vital.name, vital.rating])).toEqual([
      ["lcp", "needs-improvement"],
      ["cls", "poor"],
      ["inp", "good"],
      ["fcp", "good"],
      ["ttfb", "good"],
      ["tbt", "needs-improvement"],
    ])
    expect(
      vitals({ ...SAMPLE, lcp: null, cls: null, interaction: null }).map((vital) => vital.name)
    ).toEqual(["fcp", "ttfb", "tbt"])
  })

  it("formats times, shifts and sizes for reading", () => {
    expect(formatVital("lcp", 3_100)).toBe("3.10 s")
    expect(formatVital("ttfb", 320)).toBe("320 ms")
    expect(formatVital("cls", 0.31)).toBe("0.310")
    expect(formatBytes(512)).toBe("512 B")
    expect(formatBytes(2_048)).toBe("2.0 KB")
    expect(formatBytes(2_500_000)).toBe("2.38 MB")
  })
})

describe("performanceMarkdown", () => {
  it("leads with the vitals and says what is behind them", () => {
    const text = performanceMarkdown(SAMPLE)
    expect(text).toContain("## Performance (this visit)")
    expect(text).toContain("- Largest contentful paint: 3.10 s (needs-improvement) — `img.hero`")
    expect(text).toContain("- Cumulative layout shift: 0.310 (poor)")
    expect(text).toContain("- Slowest interaction (≈ INP): 180 ms (good) — click on `button#save`")
    expect(text).toContain(
      "- Main thread blocked (TBT, from long tasks): 420 ms (needs-improvement) — 4 long tasks"
    )
    expect(text).toContain("- Navigation (navigate): DOMContentLoaded 1.20 s, load 2.10 s")
    expect(text).toContain("- Resources: 42, 2.38 MB transferred (script 1.72 MB)")
    expect(text).toContain("- `https://example.com/app.js` (click): 260 ms")
    expect(text).toContain("- `https://example.com/app.css`")
    expect(text).toContain("- `img.hero` is served at 4000×3000 but shown at 400×300")
    expect(text).toContain("- 2 images have no width and height")
    expect(text).toContain("- cdn.analytics.test: 3 requests, 48.8 KB")
  })
})

describe("parsePerformance", () => {
  it("restores a stored read, and drops what is malformed", () => {
    expect(parsePerformance(JSON.parse(JSON.stringify(SAMPLE)))).toEqual(SAMPLE)
    const broken = parsePerformance({
      ...SAMPLE,
      lcp: { ms: "fast" },
      scripts: [{ source: 1 }],
      images: { oversized: [{ element: "img" }], unsized: "2" },
    })
    expect(broken?.lcp).toBeNull()
    expect(broken?.scripts).toEqual([])
    expect(broken?.images).toEqual({ oversized: [], unsized: 0 })
    expect(parsePerformance({ navigation: {} })).toBeNull()
  })
})

describe("mainPagePerformance", () => {
  const original = {
    observer: (globalThis as { PerformanceObserver?: unknown }).PerformanceObserver,
    entries: performance.getEntriesByType,
  }
  afterEach(() => {
    ;(globalThis as { PerformanceObserver?: unknown }).PerformanceObserver = original.observer
    performance.getEntriesByType = original.entries
    document.body.innerHTML = ""
  })

  function timeline(byType: Record<string, unknown[]>, observed: Record<string, unknown[]>) {
    performance.getEntriesByType = ((type: string) => byType[type] ?? []) as never
    class FakeObserver {
      static supportedEntryTypes = Object.keys(observed)
      private type = ""
      observe({ type }: { type: string }) {
        if (!FakeObserver.supportedEntryTypes.includes(type)) throw new TypeError("unsupported")
        this.type = type
      }
      takeRecords() {
        return observed[this.type] ?? []
      }
      disconnect() {}
    }
    ;(globalThis as { PerformanceObserver?: unknown }).PerformanceObserver = FakeObserver
  }

  it("reads the visit's timeline: vitals, long frames, resources and images", () => {
    document.body.innerHTML = `<main><img id="hero" /></main>`
    const hero = document.getElementById("hero") as HTMLImageElement
    Object.defineProperty(hero, "complete", { value: true })
    Object.defineProperty(hero, "naturalWidth", { value: 4000 })
    Object.defineProperty(hero, "naturalHeight", { value: 3000 })
    hero.getBoundingClientRect = () => ({ width: 400, height: 300 }) as DOMRect
    timeline(
      {
        navigation: [
          {
            type: "reload",
            responseStart: 210.4,
            domContentLoadedEventEnd: 800,
            loadEventEnd: 0,
            transferSize: 9_000,
          },
        ],
        paint: [{ name: "first-contentful-paint", startTime: 640.2 }],
        resource: [
          {
            name: "https://cdn.other.test/lib.js?v=2",
            initiatorType: "script",
            transferSize: 50_000,
            encodedBodySize: 0,
            duration: 300,
            renderBlockingStatus: "blocking",
          },
          {
            name: `${location.origin}/hero.png`,
            initiatorType: "img",
            transferSize: 0,
            encodedBodySize: 700_000,
            duration: 90,
          },
        ],
      },
      {
        "largest-contentful-paint": [{ startTime: 1_000 }, { startTime: 2_600, element: hero }],
        "layout-shift": [
          { startTime: 100, value: 0.05, hadRecentInput: false },
          { startTime: 600, value: 0.04, hadRecentInput: false },
          { startTime: 700, value: 0.5, hadRecentInput: true },
          { startTime: 9_000, value: 0.02, hadRecentInput: false },
        ],
        event: [
          { name: "pointerdown", duration: 40, interactionId: 0 },
          { name: "click", duration: 240, interactionId: 7, target: hero },
        ],
        longtask: [{ duration: 120 }, { duration: 60 }],
        "long-animation-frame": [
          {
            scripts: [
              { sourceURL: "https://x.test/app.js?token=1", invoker: "click", duration: 80 },
            ],
          },
          {
            scripts: [
              { sourceURL: "https://x.test/app.js?token=2", invoker: "click", duration: 40 },
            ],
          },
          { scripts: [{ sourceURL: location.href, invoker: "load", duration: 30 }] },
        ],
      }
    )
    const read = mainPagePerformance()
    expect(read.navigation).toEqual({
      type: "reload",
      ttfb: 210,
      fcp: 640,
      domContentLoaded: 800,
      load: null,
      transferBytes: 9_000,
    })
    expect(read.lcp).toEqual({ ms: 2_600, element: "img#hero" })
    // The shift after input is the person's doing; the late one starts a new window.
    expect(read.cls).toBe(0.09)
    expect(read.interaction).toEqual({ ms: 240, event: "click", target: "img#hero" })
    expect(read.longTasks).toEqual({ count: 2, blockingMs: 80 })
    expect(read.scripts).toEqual([
      { source: "https://x.test/app.js", invoker: "click", ms: 120 },
      // A script written into the page is the page's, not a file to look for.
      { source: "(inline script)", invoker: "load", ms: 30 },
    ])
    expect(read.resources).toMatchObject({
      count: 2,
      bytes: 750_000,
      renderBlocking: ["https://cdn.other.test/lib.js"],
      thirdParty: [{ host: "cdn.other.test", count: 1, bytes: 50_000 }],
    })
    expect(read.resources.largest[0]).toEqual({
      url: `${location.origin}/hero.png`,
      type: "img",
      bytes: 700_000,
    })
    expect(read.images).toEqual({
      oversized: [{ element: "img#hero", natural: "4000×3000", shown: "400×300" }],
      unsized: 1,
    })
    expect(read.dom.elements).toBeGreaterThan(3)
  })

  it("says nothing it could not measure", () => {
    timeline({}, {})
    const read = mainPagePerformance()
    expect(read.lcp).toBeNull()
    expect(read.cls).toBeNull()
    expect(read.interaction).toBeNull()
    expect(read.navigation.ttfb).toBeNull()
  })
})
