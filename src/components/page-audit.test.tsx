/** @jest-environment <rootDir>/testing/jsdom-environment.cjs */
import { fireEvent, render, screen } from "@testing-library/react"

import type { BrowserApi } from "@ext/src/lib/browser-api"
import { NO_INSIGHTS, type PageInsights } from "@ext/src/lib/inspect/insights"

import { PageAudit } from "./page-audit"

const api = {
  message: (key: string, subs?: string[]) => (subs ? `${key}:${subs.join("/")}` : key),
} as unknown as BrowserApi

const ISSUES = Array.from({ length: 14 }, (_, index) => ({
  rule: "color-contrast" as const,
  impact: index === 0 ? ("critical" as const) : ("minor" as const),
  elementId: `e${index}`,
  label: `p.n${index}`,
  detail: "2.00:1, needs 4.5:1",
}))

const INSIGHTS: PageInsights = {
  audit: { tabId: 1, ranAt: 1, include: true, issues: ISSUES, checked: 50, truncated: false },
  tokens: {
    tabId: 1,
    ranAt: 1,
    include: false,
    colors: [{ hex: "#2563eb", count: 3, uses: ["background"] }],
    fonts: [],
    type: [
      { family: "Inter", size: "14px", weight: "400", lineHeight: "20px", count: 2, sample: "Hi" },
    ],
    spacing: [{ value: "8px", count: 3 }],
    radii: [{ value: "6px", count: 1 }],
    shadows: [],
    variables: [{ name: "--brand", value: "#2563eb" }],
    breakpoints: ["768px"],
    scanned: 50,
  },
  stack: {
    tabId: 1,
    ranAt: 1,
    include: true,
    entries: [{ name: "React", category: "framework", version: "19.1.0" }],
    development: true,
  },
  perf: {
    tabId: 1,
    ranAt: 5,
    include: true,
    navigation: {
      type: "navigate",
      ttfb: 320,
      fcp: 900,
      domContentLoaded: 1_200,
      load: 2_100,
      transferBytes: 12_000,
    },
    lcp: { ms: 4_600, element: "img.hero" },
    cls: 0.02,
    interaction: null,
    longTasks: { count: 1, blockingMs: 30 },
    scripts: [{ source: "https://example.com/js/app.js", invoker: "click", ms: 260 }],
    resources: {
      count: 42,
      bytes: 2_500_000,
      byType: [],
      largest: [],
      slowest: [],
      renderBlocking: ["https://example.com/app.css"],
      thirdParty: [],
    },
    images: {
      oversized: [{ element: "img.hero", natural: "4000×3000", shown: "400×300" }],
      unsized: 0,
    },
    dom: { elements: 1_234, depth: 17 },
  },
  seo: {
    tabId: 1,
    ranAt: 5,
    include: true,
    url: "https://example.com/pricing",
    title: "Pricing",
    description: null,
    canonical: null,
    robots: null,
    lang: "en",
    viewport: "width=device-width",
    social: [
      { property: "og:title", content: "Pricing — Example" },
      { property: "og:image", content: "https://example.com/og.png" },
    ],
    structuredData: ["Product"],
    alternates: [],
    headings: [
      { level: 1, text: "Pricing" },
      { level: 2, text: "Pro" },
    ],
    counts: {
      h1: 1,
      images: 2,
      imagesWithoutAlt: 0,
      links: 9,
      internalLinks: 7,
      nofollowLinks: 0,
      linksWithoutText: 0,
      words: 420,
    },
    issues: [
      { rule: "description-missing", severity: "warning" },
      { rule: "title-length", severity: "warning", detail: "7 characters, aim for 15–60" },
    ],
  },
  layout: {
    tabId: 1,
    ranAt: 5,
    include: true,
    viewport: { width: 390, height: 844 },
    pageWidth: 600,
    issues: [
      {
        rule: "horizontal-overflow",
        elementId: "w1",
        selector: "#wide",
        label: "div#wide",
        detail: "extends 210px past the 390px viewport",
      },
      { rule: "small-text", selector: "#tiny", detail: "10px" },
    ],
    checked: 40,
    truncated: false,
  },
  focus: {
    tabId: 1,
    ranAt: 5,
    include: true,
    stops: 12,
    issues: [
      {
        rule: "unreachable-control",
        elementId: "f1",
        selector: "#card",
        label: "div#card",
      },
    ],
    truncated: false,
  },
}

function setup(overrides: Partial<Parameters<typeof PageAudit>[0]> = {}) {
  const handlers = {
    onRun: jest.fn(),
    onInclude: jest.fn(),
    onShowIssue: jest.fn(),
    onPickIssue: jest.fn(),
    onShowLayoutIssue: jest.fn(),
    onPickLayoutIssue: jest.fn(),
    onToggleFocusNumbers: jest.fn(),
    onShowFocusIssue: jest.fn(),
    onPickFocusIssue: jest.fn(),
    onEyedropper: jest.fn(),
  }
  render(
    <PageAudit
      api={api}
      insights={INSIGHTS}
      busy={null}
      issueBusy={null}
      pickedIds={["e1"]}
      canPick
      pickedColors={[]}
      canEyedrop
      {...handlers}
      {...overrides}
    />
  )
  return handlers
}

describe("PageAudit", () => {
  it("stays folded with nothing run, and runs each check", () => {
    const props = setup({ insights: NO_INSIGHTS })
    expect(screen.queryByTestId("insight-run-audit")).toBeNull()
    fireEvent.click(screen.getByTestId("page-audit-toggle"))
    fireEvent.click(screen.getByTestId("insight-run-audit"))
    fireEvent.click(screen.getByTestId("insight-run-tokens"))
    fireEvent.click(screen.getByTestId("insight-run-stack"))
    fireEvent.click(screen.getByTestId("insight-run-perf"))
    fireEvent.click(screen.getByTestId("insight-run-seo"))
    fireEvent.click(screen.getByTestId("insight-run-layout"))
    fireEvent.click(screen.getByTestId("insight-run-focus"))
    expect(props.onRun.mock.calls).toEqual([
      ["audit"],
      ["tokens"],
      ["stack"],
      ["perf"],
      ["seo"],
      ["layout"],
      ["focus"],
    ])
  })

  it("lists findings by impact, a page at a time, to show or pick", () => {
    const props = setup()
    expect(screen.getByText("accessImpactCritical 1")).toBeInTheDocument()
    expect(screen.getByText("accessImpactMinor 13")).toBeInTheDocument()
    expect(screen.queryByTestId("a11y-issue-12")).toBeNull()
    fireEvent.click(screen.getByTestId("a11y-show-all"))
    expect(screen.getByTestId("a11y-issue-13")).toBeInTheDocument()
    expect(screen.getByTestId("a11y-issue-0")).toHaveTextContent("accessRuleContrast")
    fireEvent.click(screen.getByTestId("a11y-show-0"))
    fireEvent.click(screen.getByTestId("a11y-pick-0"))
    expect(props.onShowIssue).toHaveBeenCalledWith(ISSUES[0])
    expect(props.onPickIssue).toHaveBeenCalledWith(ISSUES[0])
    // Already a pick: not offered twice.
    expect(screen.getByTestId("a11y-pick-1")).toBeDisabled()
    expect(screen.getByTestId("a11y-pick-1")).toHaveTextContent("accessPicked")
  })

  it("lets each result be sent or not", () => {
    const props = setup()
    expect(screen.getByTestId("insight-include-audit")).toBeChecked()
    expect(screen.getByTestId("insight-include-tokens")).not.toBeChecked()
    fireEvent.click(screen.getByTestId("insight-include-tokens"))
    expect(props.onInclude).toHaveBeenCalledWith("tokens", true)
  })

  it("rates each vital measured, says what is behind them, and shows the report sent", () => {
    const props = setup()
    expect(screen.getByTestId("perf-vital-lcp")).toHaveTextContent("4.60 s")
    expect(screen.getByTestId("perf-vital-lcp")).toHaveTextContent("perfPoor")
    expect(screen.getByTestId("perf-vital-cls")).toHaveTextContent("perfGood")
    expect(screen.queryByTestId("perf-vital-inp")).toBeNull()
    expect(screen.getByTestId("perf-summary")).toHaveTextContent("perfSummary:42/2.38 MB/1234")
    expect(screen.getByTestId("perf-findings")).toHaveTextContent("perfOversized:1")
    expect(screen.getByTestId("perf-findings")).toHaveTextContent("perfBlocking:1")
    expect(screen.getByTestId("perf-findings")).toHaveTextContent("perfSlowScript:app.js/260")
    fireEvent.click(screen.getByTestId("perf-details-toggle"))
    expect(screen.getByTestId("perf-details")).toHaveTextContent("Performance (this visit)")
    fireEvent.click(screen.getByTestId("insight-include-perf"))
    expect(props.onInclude).toHaveBeenCalledWith("perf", false)
  })

  it("shows SEO findings, the shared-link card and the heading outline", () => {
    const props = setup()
    expect(screen.getByTestId("seo-issue-0")).toHaveTextContent("seoSeverityWarning")
    expect(screen.getByTestId("seo-issue-0")).toHaveTextContent("seoRuleDescriptionMissing")
    expect(screen.getByTestId("seo-issue-1")).toHaveTextContent("7 characters, aim for 15–60")
    expect(screen.getByTestId("seo-card-title")).toHaveTextContent("Pricing — Example")
    expect(screen.getByTestId("seo-card-image")).toHaveAttribute(
      "src",
      "https://example.com/og.png"
    )
    expect(screen.getByTestId("seo-card")).toHaveTextContent("example.com")
    expect(screen.getByTestId("seo-summary")).toHaveTextContent("seoSummary:420/9/Product")
    fireEvent.click(screen.getByTestId("seo-outline-toggle"))
    expect(screen.getByTestId("seo-outline")).toHaveTextContent("h1 Pricing")
    fireEvent.click(screen.getByTestId("insight-include-seo"))
    expect(props.onInclude).toHaveBeenCalledWith("seo", false)
  })

  it("shows layout findings at this viewport, to show or pick", () => {
    const props = setup({ pickedIds: [] })
    expect(screen.getByTestId("layout-summary")).toHaveTextContent("layoutScrolls:600/390")
    expect(screen.getByTestId("layout-issue-0")).toHaveTextContent("layoutRuleOverflow")
    expect(screen.getByTestId("layout-issue-0")).toHaveTextContent(
      "div#wide · extends 210px past the 390px viewport"
    )
    fireEvent.click(screen.getByTestId("layout-show-0"))
    fireEvent.click(screen.getByTestId("layout-pick-0"))
    expect(props.onShowLayoutIssue).toHaveBeenCalledWith(INSIGHTS.layout!.issues[0])
    expect(props.onPickLayoutIssue).toHaveBeenCalledWith(INSIGHTS.layout!.issues[0])
    // Not held by the picker: nothing to show on the page.
    expect(screen.getByTestId("layout-issue-1")).toHaveTextContent("layoutRuleSmallText")
    expect(screen.queryByTestId("layout-show-1")).toBeNull()
    fireEvent.click(screen.getByTestId("insight-include-layout"))
    expect(props.onInclude).toHaveBeenCalledWith("layout", false)
  })

  it("shows the Tab stops and what the keyboard cannot do, to show, pick or number", () => {
    const props = setup({ pickedIds: [], focusNumbers: true })
    expect(screen.getByTestId("focus-summary")).toHaveTextContent("focusStops:12")
    expect(screen.getByTestId("focus-issue-0")).toHaveTextContent("focusRuleUnreachable")
    expect(screen.getByTestId("focus-issue-0")).toHaveTextContent("div#card")
    fireEvent.click(screen.getByTestId("focus-show-0"))
    fireEvent.click(screen.getByTestId("focus-pick-0"))
    expect(props.onShowFocusIssue).toHaveBeenCalledWith(INSIGHTS.focus!.issues[0])
    expect(props.onPickFocusIssue).toHaveBeenCalledWith(INSIGHTS.focus!.issues[0])
    expect(screen.getByTestId("focus-numbers")).toHaveTextContent("focusHideNumbers")
    fireEvent.click(screen.getByTestId("focus-numbers"))
    expect(props.onToggleFocusNumbers).toHaveBeenCalledWith(false)
    fireEvent.click(screen.getByTestId("insight-include-focus"))
    expect(props.onInclude).toHaveBeenCalledWith("focus", false)
  })

  it("says a page that fits, with nothing found", () => {
    setup({
      insights: {
        ...INSIGHTS,
        layout: { ...INSIGHTS.layout!, pageWidth: 390, issues: [] },
      },
    })
    expect(screen.getByTestId("layout-summary")).toHaveTextContent("layoutFits:390")
    expect(screen.getByTestId("layout-result")).toHaveTextContent("layoutClean:40")
  })

  it("shows tokens, the stack and picked colours in every format", () => {
    setup({ pickedColors: ["#2563eb"] })
    expect(screen.getByTestId("token-color-2563eb")).toHaveAttribute(
      "title",
      "#2563eb ×3 (background)"
    )
    expect(screen.getByText("Inter · 14px / 400 / 20px ×2")).toBeInTheDocument()
    expect(screen.getByText("768px")).toBeInTheDocument()
    expect(screen.getByTestId("stack-group-framework")).toHaveTextContent("React19.1.0")
    expect(screen.getByTestId("stack-build")).toHaveTextContent("stackDevelopment")
    expect(screen.getByTestId("eyedropper-colors")).toHaveTextContent("rgb(37 99 235)")
    expect(screen.getByTestId("eyedropper-colors")).toHaveTextContent("hsl(221 83% 53%)")
    fireEvent.click(screen.getByTestId("tokens-variables-toggle"))
    expect(screen.getByText("--brand: #2563eb;")).toBeInTheDocument()
  })

  it("offers the eyedropper only where the browser has one", () => {
    const props = setup()
    fireEvent.click(screen.getByTestId("eyedropper"))
    expect(props.onEyedropper).toHaveBeenCalled()
  })

  it("hides the eyedropper without browser support", () => {
    setup({ canEyedrop: false })
    expect(screen.queryByTestId("eyedropper")).toBeNull()
  })
})
