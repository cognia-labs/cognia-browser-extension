/** @jest-environment <rootDir>/testing/jsdom-environment.cjs */
import {
  buildDevReport,
  mainDevRecording,
  mainDevSnapshot,
  reportUrl,
  type DevSnapshot,
} from "./dev-report"

const ENVIRONMENT: DevSnapshot["environment"] = {
  userAgent: "Chrome/130",
  language: "en-GB",
  viewport: { width: 1280, height: 800, dpr: 2 },
  readyState: "complete",
}

function snapshot(overrides: Partial<DevSnapshot> = {}): DevSnapshot {
  return {
    recording: true,
    console: [
      { level: "log", text: "booted", ts: 1_000 },
      { level: "warn", text: "deprecated prop", ts: 2_000 },
      { level: "error", text: "TypeError: cannot read 'id'", ts: 3_000 },
    ],
    network: [
      {
        url: "https://api.test/items?token=abc",
        method: "GET",
        status: 200,
        ok: true,
        durationMs: 4,
        ts: 2_500,
      },
      {
        url: "https://api.test/save?token=abc",
        method: "POST",
        status: 500,
        ok: false,
        durationMs: 9,
        ts: 3_000,
      },
    ],
    resources: [
      { url: "https://cdn.test/logo.png?v=1", status: 404, initiator: "img", durationMs: 3 },
    ],
    environment: ENVIRONMENT,
    ...overrides,
  }
}

describe("buildDevReport", () => {
  it("reports failures first, without query strings, and counts them", () => {
    const report = buildDevReport(snapshot(), {
      tabId: 4,
      now: 5_000,
      includeFullUrl: false,
      recordingSince: 500,
    })
    expect(report.tabId).toBe(4)
    expect(report.counts).toEqual({ errors: 1, warnings: 1, failedRequests: 2, steps: 0 })
    expect(report.text).toContain("## Console and network")
    expect(report.text).toContain("[error] TypeError: cannot read 'id'")
    expect(report.text).toContain("[warn] deprecated prop")
    expect(report.text).not.toContain("booted")
    expect(report.text).toContain("- `POST https://api.test/save` → 500 · 9 ms")
    expect(report.text).toContain("- `GET https://cdn.test/logo.png` → 404")
    expect(report.text).not.toContain("token=abc")
    expect(report.text).not.toContain("/items")
    expect(report.text).toContain("- Viewport: 1280×800 @2x, en-GB")
    expect(report.text).toContain("Recorded from 00:00:00.500 to 00:00:05.000")
  })

  it("starts a restarted recording over, and says when nothing was recorded", () => {
    const restarted = buildDevReport(snapshot(), {
      tabId: 4,
      now: 5_000,
      includeFullUrl: false,
      recordingSince: 2_800,
    })
    expect(restarted.counts).toEqual({ errors: 1, warnings: 0, failedRequests: 2, steps: 0 })

    const unrecorded = buildDevReport(snapshot({ recording: false, console: [], network: [] }), {
      tabId: 4,
      now: 5_000,
      includeFullUrl: false,
      recordingSince: 1_000,
    })
    expect(unrecorded.text).toContain("Console not recorded")
    expect(unrecorded.counts.failedRequests).toBe(1)
  })

  it("tells the steps first, timed from the first, and only those since recording began", () => {
    const report = buildDevReport(
      snapshot({
        steps: [
          { ts: 400, kind: "click", selector: "#old", detail: "Before" },
          { ts: 1_000, kind: "click", selector: "#save", label: "button#save", detail: "Save" },
          { ts: 1_500, kind: "input", selector: "#email", detail: "Email" },
          { ts: 2_250, kind: "key", selector: "#email", detail: "Enter" },
          { ts: 2_300, kind: "navigate", detail: "/done" },
        ],
      }),
      { tabId: 4, now: 5_000, includeFullUrl: false, recordingSince: 500 }
    )
    expect(report.counts.steps).toBe(4)
    expect(report.text).toContain(
      [
        "### Steps to reproduce (4)",
        "",
        '1. +0.0s Clicked `#save` "Save"',
        '2. +0.5s Entered text in `#email` "Email"',
        "3. +1.3s Pressed Enter in `#email`",
        "4. +1.3s Navigated to /done",
      ].join("\n")
    )
    expect(report.text).not.toContain("#old")
    expect(report.text.indexOf("Steps to reproduce")).toBeLessThan(
      report.text.indexOf("Console errors")
    )
    // Without a recording there are no steps to tell.
    const unrecorded = buildDevReport(
      snapshot({ steps: [{ ts: 1_000, kind: "scroll", detail: "1px" }] }),
      {
        tabId: 4,
        now: 5_000,
        includeFullUrl: false,
        recordingSince: null,
      }
    )
    expect(unrecorded.text).not.toContain("Steps to reproduce")
  })

  it("keeps the full address only when the person asked for it", () => {
    expect(reportUrl("https://u:p@api.test/a?x=1", false)).toBe("https://api.test/a")
    expect(reportUrl("https://u:p@api.test/a?x=1", true)).toBe("https://api.test/a?x=1")
  })
})

describe("main-world reads", () => {
  afterEach(() => {
    delete (window as unknown as { __cogniaPageHooks?: unknown }).__cogniaPageHooks
    delete (window as unknown as { __cogniaSteps?: unknown }).__cogniaSteps
  })

  it("says it is not recording when no hooks are installed", () => {
    expect(mainDevRecording()).toBe(false)
    expect(mainDevSnapshot()).toMatchObject({ recording: false, console: [], network: [] })
  })

  it("reads the hooks without draining them, with relative addresses made absolute", () => {
    const console = [{ level: "error", text: "boom", ts: 1 }]
    const network = [{ url: "/api/x", method: "GET", status: 502, ok: false, durationMs: 1, ts: 1 }]
    ;(window as unknown as { __cogniaPageHooks: unknown }).__cogniaPageHooks = {
      peekConsole: () => console,
      peekNetwork: () => network,
    }
    const read = mainDevSnapshot()
    expect(mainDevRecording()).toBe(true)
    expect(read.recording).toBe(true)
    expect(read.console).toEqual(console)
    expect(read.network[0]?.url).toBe(new URL("/api/x", location.href).href)
    expect(read.environment.viewport.width).toBe(window.innerWidth)
    expect(read.steps).toEqual([])
    ;(window as unknown as { __cogniaSteps: unknown }).__cogniaSteps = {
      peek: () => [{ ts: 1, kind: "click", selector: "#a" }],
    }
    expect(mainDevSnapshot().steps).toEqual([{ ts: 1, kind: "click", selector: "#a" }])
  })
})
