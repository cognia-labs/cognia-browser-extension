/** @jest-environment <rootDir>/testing/jsdom-environment.cjs */
import { auditDocument, auditMarkdown, textContrast, type A11yIssue } from "./a11y-audit"
import { createColorReader } from "./page-colors"

function audit(html: string, { lang = "en", title = "Page" } = {}) {
  document.documentElement.setAttribute("lang", lang)
  document.title = title
  document.body.innerHTML = html
  const tracked: Element[] = []
  const result = auditDocument(document, (element) => {
    tracked.push(element)
    return `id-${tracked.length}`
  })
  return { ...result, tracked }
}

const rules = (issues: A11yIssue[]) => issues.map((issue) => issue.rule)

afterEach(() => {
  document.body.innerHTML = ""
})

describe("auditDocument", () => {
  it("finds nothing on a page that names and labels everything", () => {
    const result = audit(`
      <main>
        <h1>Shop</h1>
        <h2>Basket</h2>
        <img src="a.png" alt="A chair" />
        <img src="line.png" alt="" />
        <button>Pay</button>
        <button aria-label="Close"><svg></svg></button>
        <a href="/help"><img src="i.png" alt="Help" /></a>
        <label>Email <input type="email" /></label>
        <label for="code">Code</label><input id="code" />
      </main>`)
    expect(result.issues).toEqual([])
    expect(result.checked).toBeGreaterThan(5)
  })

  it("reports missing names, labels, language and title, worst first, with handles", () => {
    const result = audit(
      `
      <img src="/img/hero.png" />
      <button><svg></svg></button>
      <a href="/x"></a>
      <input placeholder="Search" />
      <iframe src="about:blank"></iframe>`,
      { lang: "", title: "" }
    )
    expect(rules(result.issues)).toEqual([
      "image-alt",
      "button-name",
      "label",
      "html-lang",
      "document-title",
      "link-name",
      "frame-title",
    ])
    const image = result.issues[0]!
    expect(image).toMatchObject({
      impact: "critical",
      elementId: "id-1",
      label: "img",
      detail: "hero.png",
    })
    expect(result.issues.find((issue) => issue.rule === "label")?.detail).toBe("placeholder only")
    expect(result.issues.find((issue) => issue.rule === "html-lang")?.elementId).toBeUndefined()
  })

  it("measures contrast against what is really behind the text", () => {
    const result = audit(`
      <div style="background-color: #ffffff">
        <p id="faint" style="color: #aaaaaa">Faint</p>
        <p style="color: #222222">Fine</p>
        <p style="color: #949494; font-size: 24px">Large enough</p>
        <div style="background-color: rgba(0, 0, 0, 0.5)"><span style="color: #555555">Grey on dim</span></div>
      </div>`)
    const contrast = result.issues.filter((issue) => issue.rule === "color-contrast")
    expect(contrast.map((issue) => issue.label)).toEqual(["p#faint", "span"])
    expect(contrast[0]?.detail).toBe("2.32:1, needs 4.5:1 (#aaaaaa on #ffffff)")
  })

  it("reads one element's contrast, with AA, AAA and the nearest colour that passes", () => {
    document.body.innerHTML = `
      <div style="background-color: #ffffff">
        <p id="faint" style="color: #aaaaaa">Faint</p>
        <p id="ok" style="color: #666666">Passes AA only</p>
        <h1 id="big" style="color: #767676; font-size: 32px">Large</h1>
      </div>`
    const read = (id: string) =>
      textContrast(document.getElementById(id)!, window, createColorReader())
    expect(read("faint")).toEqual({
      ratio: 2.32,
      foreground: "#aaaaaa",
      background: "#ffffff",
      large: false,
      aa: false,
      aaa: false,
      suggestion: expect.stringMatching(/^#[0-9a-f]{6}$/),
    })
    expect(read("ok")).toMatchObject({ aa: true, aaa: false })
    expect(read("ok")).not.toHaveProperty("suggestion")
    expect(read("big")).toMatchObject({ large: true, aa: true, aaa: true })
  })

  it("flags skipped heading levels, empty headings, duplicates, small targets and hidden focus", () => {
    const result = audit(`
      <h1>Title</h1>
      <h3 id="dup">Skipped</h3>
      <h4 id="dup"></h4>
      <div aria-hidden="true"><button>Ghost</button></div>
      <div tabindex="3">Jump</div>`)
    expect(rules(result.issues).sort()).toEqual(
      ["aria-hidden-focus", "duplicate-id", "empty-heading", "heading-order", "tabindex"].sort()
    )
    expect(result.issues.find((issue) => issue.rule === "heading-order")?.detail).toBe("h1 → h3")
  })

  it("leaves hidden content and the extension's own overlay out", () => {
    const result = audit(`
      <div style="display:none"><img src="x.png" /></div>
      <div data-cognia-chrome="1"><button></button></div>`)
    expect(result.issues).toEqual([])
  })
})

describe("auditMarkdown", () => {
  it("lists findings with their selectors, or says there were none", () => {
    expect(
      auditMarkdown({
        issues: [
          { rule: "image-alt", impact: "critical", selector: "img.hero", detail: "hero.png" },
        ],
        checked: 3,
        truncated: true,
      })
    ).toBe(
      [
        "## Accessibility check (1 findings)",
        "",
        "A first pass with WCAG 2.2 AA thresholds; selectors match the live page.",
        "",
        "- [critical] Image has no text alternative — `img.hero` (hero.png)",
        "- … more findings of the same kinds were left out",
      ].join("\n")
    )
    expect(auditMarkdown({ issues: [], checked: 9, truncated: false })).toContain(
      "No findings in 9 elements"
    )
  })
})
