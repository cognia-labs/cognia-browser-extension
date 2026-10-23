/** @jest-environment <rootDir>/testing/jsdom-environment.cjs */
import { checkSeo, parseSeo, seoMarkdown } from "./seo-check"

function page(head: string, body: string, lang = "en") {
  document.documentElement.setAttribute("lang", lang)
  document.head.innerHTML = head
  document.body.innerHTML = body
}

afterEach(() => {
  document.head.innerHTML = ""
  document.body.innerHTML = ""
  document.documentElement.removeAttribute("lang")
})

const GOOD_HEAD = `
  <title>Pricing plans for teams of every size — Example</title>
  <meta name="description" content="Compare the Free, Pro and Enterprise plans, with every feature, limit and price side by side for your team." />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="canonical" href="/pricing?utm_source=x" />
  <link rel="alternate" hreflang="de" href="/de/pricing" />
  <meta property="og:title" content="Pricing — Example" />
  <meta property="og:description" content="Plans for every team" />
  <meta property="og:image" content="https://example.test/og.png?v=2" />
  <meta property="og:site_name" content="Example" />
  <meta name="twitter:card" content="summary_large_image" />
  <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization"},{"@type":["Product","Offer"]}]}</script>`

describe("checkSeo", () => {
  it("reads the head, the outline and the content, and finds nothing wrong with a careful page", () => {
    page(
      GOOD_HEAD,
      `<h1>Pricing</h1><h2>Pro</h2><p>Everything a team needs.</p>
       <a href="/signup">Sign up</a><a href="https://other.test/" rel="nofollow">Partner</a>
       <img src="a.png" alt="Plan chart" />`
    )
    const report = checkSeo(document)
    expect(report.issues).toEqual([])
    expect(report.title).toBe("Pricing plans for teams of every size — Example")
    expect(report.canonical).toBe("http://localhost/pricing")
    expect(report.lang).toBe("en")
    expect(report.structuredData).toEqual(["Organization", "Product", "Offer"])
    expect(report.alternates).toEqual([{ lang: "de", href: "http://localhost/de/pricing" }])
    expect(report.social).toContainEqual({
      property: "og:image",
      content: "https://example.test/og.png",
    })
    expect(report.headings).toEqual([
      { level: 1, text: "Pricing" },
      { level: 2, text: "Pro" },
    ])
    expect(report.counts).toMatchObject({
      h1: 1,
      links: 2,
      internalLinks: 1,
      nofollowLinks: 1,
      images: 1,
    })
    expect(report.counts.words).toBeGreaterThan(5)
  })

  it("finds the common mistakes, worst first", () => {
    page(
      `<title>Hi</title>
       <meta name="robots" content="noindex, nofollow" />
       <link rel="canonical" href="/a" /><link rel="canonical" href="/b" />
       <meta property="og:image" content="/og.png" />
       <script type="application/ld+json">{not json</script>`,
      `<h2>No h1 here</h2><img src="x.png" /><a href="/x"><span></span></a>`,
      ""
    )
    const report = checkSeo(document)
    expect(report.issues.map((issue) => [issue.severity, issue.rule])).toEqual([
      ["error", "canonical-multiple"],
      ["error", "structured-data-invalid"],
      ["warning", "title-length"],
      ["warning", "description-missing"],
      ["warning", "noindex"],
      ["warning", "viewport-missing"],
      ["warning", "og-image-relative"],
      ["warning", "h1-count"],
      ["warning", "image-alt"],
      ["warning", "link-text"],
      ["info", "og-missing"],
      ["info", "twitter-missing"],
    ])
    expect(report.issues.find((issue) => issue.rule === "title-length")?.detail).toBe(
      "2 characters, aim for 15–60"
    )
  })

  it("says when there is no title, description or structured data at all", () => {
    page("", "<h1>One</h1><h1>Two</h1>")
    const rules = checkSeo(document).issues.map((issue) => issue.rule)
    expect(rules).toEqual(
      expect.arrayContaining([
        "title-missing",
        "canonical-missing",
        "structured-data-missing",
        "h1-count",
      ])
    )
  })
})

describe("seoMarkdown and parseSeo", () => {
  it("writes the summary, findings, tags and outline, and round-trips through a draft", () => {
    page(
      GOOD_HEAD.replace(/<title>.*<\/title>/, "<title>Short</title>"),
      "<h1>Pricing</h1><h3>Deep</h3>"
    )
    const report = checkSeo(document)
    const text = seoMarkdown(report)
    expect(text).toContain("## SEO and link previews")
    expect(text).toContain('- Title: "Short" (5)')
    expect(text).toContain("- Canonical: `http://localhost/pricing`")
    expect(text).toContain(
      "- [warning] The title is likely to be cut or too thin in results (5 characters, aim for 15–60)"
    )
    expect(text).toContain("- `og:site_name`: Example")
    expect(text).toContain("h1 Pricing\n    h3 Deep")
    expect(parseSeo(JSON.parse(JSON.stringify(report)))).toEqual(report)
    expect(
      parseSeo({ counts: {}, issues: [{ rule: "made-up", severity: "error" }] })?.issues
    ).toEqual([])
    expect(parseSeo(null)).toBeNull()
  })
})
