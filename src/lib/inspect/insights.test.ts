import {
  NO_INSIGHTS,
  insightSections,
  insightsForTab,
  parseInsights,
  type PageInsights,
} from "./insights"

const INSIGHTS: PageInsights = {
  audit: {
    tabId: 1,
    ranAt: 5,
    include: true,
    issues: [{ rule: "image-alt", impact: "critical", selector: "img" }],
    checked: 4,
    truncated: false,
  },
  tokens: {
    tabId: 1,
    ranAt: 5,
    include: false,
    colors: [{ hex: "#2563eb", count: 1, uses: ["text"] }],
    fonts: [],
    type: [],
    spacing: [],
    radii: [],
    shadows: [],
    variables: [],
    breakpoints: [],
    scanned: 4,
  },
  stack: {
    tabId: 2,
    ranAt: 5,
    include: true,
    entries: [
      { name: "React", category: "framework", version: "19.1.0", evidence: "React fiber" },
      { name: "Next.js", category: "meta-framework", detail: "App Router" },
    ],
    development: true,
    facts: {
      scripts: 9,
      moduleScripts: 2,
      inlineScripts: 3,
      stylesheets: 2,
      jsKb: 412,
      cssKb: null,
      protocol: "h2",
      serviceWorker: false,
      manifest: true,
      importMap: false,
      customElements: ["my-card"],
      thirdParty: [{ host: "www.googletagmanager.com", count: 2 }],
    },
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
    issues: [{ rule: "horizontal-overflow", selector: "#wide", detail: "extends 210px" }],
    checked: 40,
    truncated: false,
  },
  focus: {
    tabId: 1,
    ranAt: 5,
    include: true,
    stops: 12,
    issues: [{ rule: "positive-tabindex", selector: "#first", detail: 'tabindex="2"' }],
    truncated: false,
  },
}

describe("page insights", () => {
  it("keeps only the checks of one tab", () => {
    expect(insightsForTab(INSIGHTS, 1)).toEqual({ ...INSIGHTS, stack: null })
  })

  it("sends what is included: the stack as context, the rest as reports", () => {
    expect(insightSections(INSIGHTS, 1)).toEqual({
      context: [],
      reports: [
        expect.stringContaining("## Accessibility check (1 findings)"),
        expect.stringContaining("## Keyboard focus check (1 findings)"),
        expect.stringContaining("## Layout check (1 findings)"),
        expect.stringContaining("## Performance (this visit)"),
        expect.stringContaining("## SEO and link previews"),
      ],
    })
    expect(insightSections(INSIGHTS, 2).context).toEqual([expect.stringContaining("## Tech stack")])
  })

  it("round-trips through a draft and drops what it cannot show", () => {
    expect(parseInsights(JSON.parse(JSON.stringify(INSIGHTS)))).toEqual(INSIGHTS)
    expect(parseInsights(null)).toBe(NO_INSIGHTS)
    const damaged = parseInsights({
      audit: { tabId: 1, ranAt: 1, issues: [{ rule: "made-up", impact: "critical" }, 7] },
      tokens: { tabId: "x" },
      stack: {
        tabId: 3,
        ranAt: 1,
        entries: [
          { name: 1 },
          { name: "Made up", category: "galaxy" },
          { name: "Vue", category: "framework", version: 3 },
          { name: "Vue", category: "framework" },
        ],
        development: "yes",
        facts: { scripts: "many", thirdParty: [{ host: 7 }], serviceWorker: true },
      },
      perf: { tabId: 1, ranAt: 1, navigation: "fast" },
      seo: { tabId: 1, ranAt: 1, counts: "many" },
      layout: { tabId: 1, ranAt: 1, viewport: "phone" },
      focus: { tabId: 1, ranAt: 1, stops: "many" },
    })
    expect(damaged.layout).toBeNull()
    expect(damaged.focus).toBeNull()
    expect(damaged.perf).toBeNull()
    expect(damaged.seo).toBeNull()
    expect(damaged.audit).toEqual({
      tabId: 1,
      ranAt: 1,
      include: true,
      issues: [],
      checked: 0,
      truncated: false,
    })
    expect(damaged.tokens).toBeNull()
    expect(damaged.stack).toEqual({
      tabId: 3,
      ranAt: 1,
      include: true,
      entries: [{ name: "Vue", category: "framework" }],
      development: null,
      facts: {
        scripts: 0,
        moduleScripts: 0,
        inlineScripts: 0,
        stylesheets: 0,
        jsKb: null,
        cssKb: null,
        protocol: null,
        serviceWorker: true,
        manifest: false,
        importMap: false,
        customElements: [],
        thirdParty: [],
      },
    })
  })
})
