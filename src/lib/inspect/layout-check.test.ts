/** @jest-environment <rootDir>/testing/jsdom-environment.cjs */
import { checkLayout, layoutMarkdown, parseLayout } from "./layout-check"

function box(element: Element, left: number, top: number, width: number, height: number) {
  element.getBoundingClientRect = () =>
    ({
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      x: left,
      y: top,
    }) as DOMRect
}

function sized(
  element: Element,
  sizes: Partial<Record<"scrollWidth" | "clientWidth" | "scrollHeight" | "clientHeight", number>>
) {
  for (const [key, value] of Object.entries(sizes))
    Object.defineProperty(element, key, { value, configurable: true })
}

function run() {
  const tracked: Element[] = []
  const result = checkLayout(document, (element) => {
    tracked.push(element)
    return `id-${tracked.length}`
  })
  return { ...result, tracked }
}

afterEach(() => {
  document.body.innerHTML = ""
  for (const element of [document.documentElement, document.body])
    for (const key of ["scrollWidth", "clientWidth"])
      delete (element as unknown as Record<string, unknown>)[key]
})

describe("checkLayout", () => {
  it("finds the outermost element pushing the page wider than the window", () => {
    document.body.innerHTML = `
      <main id="main">
        <div id="wide" style="width: 600px"><span id="inner">wide</span></div>
        <div id="scroller" style="overflow-x: auto"><table id="table"><tr><td>t</td></tr></table></div>
        <div id="fixed" style="position: fixed">f</div>
      </main>`
    sized(document.documentElement, { scrollWidth: 600, clientWidth: 390 })
    box(document.getElementById("main")!, 0, 0, 390, 400)
    box(document.getElementById("wide")!, 0, 0, 600, 40)
    box(document.getElementById("inner")!, 0, 0, 600, 20)
    box(document.getElementById("scroller")!, 0, 50, 390, 40)
    box(document.getElementById("table")!, 0, 50, 900, 40)
    box(document.getElementById("fixed")!, 300, 0, 200, 40)
    const result = run()
    expect(result.pageWidth).toBe(600)
    expect(result.viewport.width).toBe(390)
    expect(result.issues).toEqual([
      {
        rule: "horizontal-overflow",
        elementId: expect.stringMatching(/^id-/),
        selector: "#wide",
        label: "div#wide",
        detail: "extends 210px past the 390px viewport",
      },
    ])
  })

  it("finds clipped text, but not an ellipsis someone chose", () => {
    document.body.innerHTML = `
      <p id="cut" style="overflow: hidden; width: 100px">A long label that does not fit</p>
      <p id="ellipsis" style="overflow: hidden; text-overflow: ellipsis">A long label that does not fit</p>`
    for (const id of ["cut", "ellipsis"]) {
      const element = document.getElementById(id)!
      box(element, 0, 0, 100, 20)
      sized(element, { scrollWidth: 240, clientWidth: 100, scrollHeight: 20, clientHeight: 20 })
    }
    expect(run().issues).toEqual([
      expect.objectContaining({
        rule: "clipped-text",
        selector: "#cut",
        detail: "140px of text cut off at the right",
      }),
    ])
  })

  it("finds stretched images and small text, in rule order", () => {
    document.body.innerHTML = `
      <p id="tiny" style="font-size: 10px">Fine print</p>
      <img id="stretched" src="a.png" />
      <img id="covered" src="b.png" style="object-fit: cover" />`
    box(document.getElementById("tiny")!, 0, 0, 100, 12)
    for (const id of ["stretched", "covered"]) {
      const image = document.getElementById(id)!
      Object.defineProperty(image, "naturalWidth", { value: 400 })
      Object.defineProperty(image, "naturalHeight", { value: 300 })
      box(image, 0, 20, 400, 100)
    }
    expect(run().issues.map((issue) => [issue.rule, issue.selector, issue.detail])).toEqual([
      ["distorted-image", "#stretched", "400×300 shown at 400×100"],
      ["small-text", "#tiny", "10px"],
    ])
  })
})

describe("layoutMarkdown and parseLayout", () => {
  const check = {
    viewport: { width: 390, height: 844 },
    pageWidth: 600,
    issues: [
      {
        rule: "horizontal-overflow" as const,
        selector: "#wide",
        detail: "extends 210px past the 390px viewport",
      },
    ],
    checked: 12,
    truncated: true,
  }

  it("says the window, whether the page scrolls sideways, and each finding", () => {
    const text = layoutMarkdown(check)
    expect(text).toContain("## Layout check (1 findings)")
    expect(text).toContain("At a 390×844 viewport; the page is 600px wide, so it scrolls sideways.")
    expect(text).toContain(
      "- Wider than the viewport, so the page scrolls sideways — `#wide` (extends 210px past the 390px viewport)"
    )
    expect(text).toContain("- … more of the same kinds were left out")
    expect(layoutMarkdown({ ...check, pageWidth: 390, issues: [], truncated: false })).toContain(
      "No layout problems found."
    )
  })

  it("round-trips through a draft and drops what it cannot show", () => {
    expect(parseLayout(JSON.parse(JSON.stringify(check)))).toEqual(check)
    expect(parseLayout({ ...check, issues: [{ rule: "made-up" }] })?.issues).toEqual([])
    expect(parseLayout(null)).toBeNull()
  })
})
