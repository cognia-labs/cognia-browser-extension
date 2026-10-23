import type { PickedElement } from "../inspect/element-context"
import { NO_INSIGHTS } from "../inspect/insights"
import { measureBoxes, type Measurement } from "../inspect/measure"
import type { CapturedPage } from "../panel-state"
import { DRAFT_TTL_MS, isCapturedPage, isEmptyDraft, parseDraft, type PanelDraft } from "./drafts"

const PAGE: CapturedPage = {
  tabId: 1,
  title: "A",
  url: "https://a.test/",
  rawUrl: "https://a.test/?q",
  selection: { text: "s", truncated: false },
  readableText: null,
  capturedAt: 5,
  strippedQuery: true,
}

function draft(overrides: Partial<PanelDraft> = {}): PanelDraft {
  return {
    v: 1,
    captured: PAGE,
    extraPages: [],
    scope: "auto",
    instruction: "sum",
    workspaceId: "w",
    targetId: null,
    targetParams: {},
    includeFullUrl: false,
    droppedAttachments: 0,
    picks: [],
    measurements: [],
    textChanges: null,
    devReport: null,
    insights: NO_INSIGHTS,
    savedAt: 1_000,
    ...overrides,
  }
}

const PICK: PickedElement = {
  elementId: "e1",
  selector: "#save",
  tag: "button",
  label: "button#save",
  role: "button",
  name: "Save",
  text: "Save",
  textEditable: true,
  attributes: { id: "save" },
  box: { x: 1, y: 2, width: 30, height: 10 },
  viewport: { width: 800, height: 600, dpr: 2, scrollX: 0, scrollY: 0 },
  styles: { color: "rgb(0, 0, 0)" },
  outline: "button#save",
  sourceHints: [],
  tabId: 1,
  pageUrl: "https://a.test/?q",
  pickedAt: 3,
  note: "bigger",
  edits: { styles: { "font-size": "20px" } },
  screenshotIds: ["shot-1"],
}

describe("parseDraft — picks", () => {
  it("keeps the person's picks and report, without the screenshots the draft cannot hold", () => {
    const report = {
      tabId: 1,
      capturedAt: 4,
      counts: { errors: 1, warnings: 0, failedRequests: 2, steps: 0 },
      text: "## Console and network",
    }
    const restored = parseDraft(
      JSON.parse(JSON.stringify(draft({ picks: [PICK], devReport: report }))),
      2_000
    )
    expect(restored?.picks).toEqual([{ ...PICK, screenshotIds: [] }])
    const withMarkup = parseDraft(draft({ picks: [{ ...PICK, html: "<b>x</b>" }] }), 2_000)
    expect(withMarkup?.picks[0]?.html).toBe("<b>x</b>")
    const badMarkup = parseDraft(
      draft({ picks: [{ ...PICK, html: 7 } as unknown as PickedElement] }),
      2_000
    )
    expect(badMarkup?.picks[0]).not.toHaveProperty("html")
    const contrast = {
      ratio: 2.32,
      foreground: "#aaaaaa",
      background: "#ffffff",
      large: false,
      aa: false,
      aaa: false,
      suggestion: "#767676",
    }
    expect(
      parseDraft(draft({ picks: [{ ...PICK, contrast }] }), 2_000)?.picks[0]?.contrast
    ).toEqual(contrast)
    const badContrast = parseDraft(
      draft({
        picks: [{ ...PICK, contrast: { ...contrast, ratio: "low" } } as unknown as PickedElement],
      }),
      2_000
    )
    expect(badContrast?.picks[0]).not.toHaveProperty("contrast")
    expect(restored?.devReport).toEqual(report)
  })

  it("drops picks of another tab, malformed ones, and edits that are not CSS values", () => {
    const restored = parseDraft(
      draft({
        picks: [
          { ...PICK, tabId: 2 },
          { ...PICK, elementId: 7 } as unknown as PickedElement,
          {
            ...PICK,
            elementId: "e2",
            edits: { styles: { color: "red;} body{display:none", onclick: "x", gap: "4px" } },
          },
        ],
      }),
      2_000
    )
    expect(restored?.picks.map((pick) => [pick.elementId, pick.edits])).toEqual([
      ["e2", { styles: { gap: "4px" } }],
    ])
  })
})

describe("parseDraft — measurements", () => {
  const from = {
    elementId: "a",
    selector: "#a",
    label: "div#a",
    box: { x: 0, y: 0, width: 10, height: 10 },
  }
  const to = {
    elementId: "b",
    selector: "#b",
    label: "div#b",
    box: { x: 0, y: 26, width: 10, height: 10 },
  }
  const MEASUREMENT: Measurement = {
    id: "m1",
    tabId: 1,
    pageUrl: "https://a.test/?q",
    measuredAt: 3,
    from,
    to,
    measure: measureBoxes(from.box, to.box),
    note: "16px",
  }

  it("keeps the captured page's measurements with their notes, and drops the rest", () => {
    const restored = parseDraft(
      JSON.parse(
        JSON.stringify(
          draft({
            measurements: [
              MEASUREMENT,
              { ...MEASUREMENT, id: "m2", tabId: 2 },
              { ...MEASUREMENT, id: "m3", from: { ...from, box: null } } as unknown as Measurement,
            ],
          })
        )
      ),
      2_000
    )
    expect(restored?.measurements).toEqual([MEASUREMENT])
    expect(
      parseDraft(draft({ captured: null, measurements: [MEASUREMENT] }), 2_000)?.measurements
    ).toEqual([])
  })
})

describe("parseDraft — text changes", () => {
  it("keeps the captured page's text changes, and drops another tab's", () => {
    const changes = [{ selector: "#t", label: "h1#t", before: "a", after: "b" }]
    expect(parseDraft(draft({ textChanges: { tabId: 1, changes } }), 2_000)?.textChanges).toEqual({
      tabId: 1,
      changes,
    })
    expect(parseDraft(draft({ textChanges: { tabId: 2, changes } }), 2_000)?.textChanges).toBeNull()
    expect(
      parseDraft(draft({ textChanges: { tabId: 1, changes: [{ label: 3 }] as never } }), 2_000)
        ?.textChanges
    ).toBeNull()
  })
})

describe("parseDraft", () => {
  it("round-trips a draft", () => {
    expect(parseDraft(JSON.parse(JSON.stringify(draft())), 2_000)).toEqual(draft())
  })

  it("drops stale, future, malformed and foreign values", () => {
    expect(parseDraft(draft(), 1_000 + DRAFT_TTL_MS + 1)).toBeNull()
    expect(parseDraft(draft({ savedAt: 10_000_000 }), 1_000)).toBeNull()
    expect(parseDraft({ ...draft(), v: 2 }, 2_000)).toBeNull()
    expect(parseDraft({ ...draft(), captured: { tabId: "x" } }, 2_000)).toBeNull()
    expect(parseDraft("draft", 2_000)).toBeNull()
  })

  it("repairs the parts it can", () => {
    const parsed = parseDraft(
      {
        ...draft(),
        scope: "everything",
        extraPages: [PAGE, { nope: true }],
        targetParams: { a: "1", b: 2 },
        droppedAttachments: -3,
        instruction: 7,
      },
      2_000
    )
    expect(parsed).toMatchObject({
      scope: "auto",
      extraPages: [PAGE],
      targetParams: { a: "1" },
      droppedAttachments: 0,
      instruction: "",
    })
  })
})

describe("helpers", () => {
  it("recognizes pages and empty drafts", () => {
    expect(isCapturedPage(PAGE)).toBe(true)
    expect(isCapturedPage({ ...PAGE, article: { text: 1 } })).toBe(false)
    expect(isEmptyDraft({ captured: null, extraPages: [], instruction: "  " })).toBe(true)
    expect(isEmptyDraft({ captured: null, extraPages: [], instruction: "x" })).toBe(false)
  })
})
