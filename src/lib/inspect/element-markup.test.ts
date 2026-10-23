/** @jest-environment <rootDir>/testing/jsdom-environment.cjs */
import { MARKUP_LIMITS, codeSnippet, elementMarkup } from "./element-markup"

function build(html: string): Element {
  document.body.innerHTML = html
  return document.body.firstElementChild!
}

describe("elementMarkup", () => {
  it("writes the element as indented markup, short text inline", () => {
    const card = build(`
      <div class="card" data-testid="plan">
        <h2 class="title">Pro   plan</h2>
        <p>Everything in <strong>Free</strong>, and more.</p>
        <button type="submit" class="btn primary">Upgrade</button>
      </div>`)
    expect(elementMarkup(card)).toBe(
      [
        '<div class="card" data-testid="plan">',
        '  <h2 class="title">Pro plan</h2>',
        "  <p>",
        "    Everything in",
        "    <strong>Free</strong>",
        "    , and more.",
        "  </p>",
        '  <button type="submit" class="btn primary">Upgrade</button>',
        "</div>",
      ].join("\n")
    )
  })

  it("leaves out values, handlers, scripts, what the page hid, and what a person edits", () => {
    const form = build(`
      <form onsubmit="steal()" action="/save?token=x">
        <input name="email" value="ann@x.test" onclick="x()" />
        <input type="hidden" name="csrf" value="SECRET" />
        <input type="submit" value="Save" />
        <textarea name="bio">my bio</textarea>
        <select name="plan"><option selected>Pro</option></select>
        <div contenteditable="true">draft text</div>
        <p hidden>secret note</p>
        <span style="display:none">gone</span>
        <script>var key = "abc"</script>
        <svg aria-hidden="true" viewBox="0 0 10 10"><path d="M0 0L10 10"/></svg>
      </form>`)
    const markup = elementMarkup(form)
    expect(markup).not.toMatch(
      /ann@x|SECRET|my bio|draft text|secret note|gone|steal|key = |onclick|M0 0|token/
    )
    expect(markup).toContain('<form action="http://localhost/save">')
    expect(markup).toContain('<input name="email">')
    expect(markup).toContain('<input type="submit" value="Save">')
    expect(markup).toContain('<textarea name="bio">…</textarea>')
    expect(markup).toContain('<div contenteditable="true">…</div>')
    expect(markup).toContain('<svg aria-hidden="true" viewBox="0 0 10 10">…</svg>')
  })

  it("cuts deep, wide and long markup, and says so", () => {
    const list = build(
      `<ul>${Array.from({ length: 14 }, (_, i) => `<li>Item ${i}</li>`).join("")}</ul>`
    )
    const markup = elementMarkup(list)
    expect(markup).toContain("<li>Item 9</li>")
    expect(markup).not.toContain("Item 10")
    expect(markup).toContain("<!-- 4 more -->")

    let nested = "<b>deep</b>"
    for (let level = 0; level < 8; level++) nested = `<div><i>x</i>${nested}</div>`
    expect(elementMarkup(build(nested))).toContain("<div>…</div>")

    const section = `<section>${'<p class="${"c".repeat(70)}">${"t".repeat(70)}</p>'.repeat(5)}</section>`
    const long = build(`<div>${section.repeat(10)}</div>`)
    const cut = elementMarkup(long)
    expect(cut.length).toBeLessThanOrEqual(MARKUP_LIMITS.total + 20)
    expect(cut.endsWith("<!-- … cut -->")).toBe(true)
  })

  it("escapes text and attribute values", () => {
    expect(elementMarkup(build(`<p title='a "b" <c>'>1 &lt; 2</p>`))).toBe(
      '<p title="a &quot;b&quot; &lt;c&gt;">1 &lt; 2</p>'
    )
  })
})

describe("codeSnippet", () => {
  it("puts the computed CSS, with the previewed edits, under the markup", () => {
    const snippet = codeSnippet({
      selector: "#save",
      html: '<button id="save">Save</button>',
      styles: { "font-size": "14px", color: "rgb(0, 0, 0)" },
      edits: { styles: { "font-size": "16px" } },
    })
    expect(snippet).toBe(
      [
        '<button id="save">Save</button>',
        "",
        "<style>",
        "#save {",
        "  font-size: 16px;",
        "  color: rgb(0, 0, 0);",
        "}",
        "</style>",
      ].join("\n")
    )
    expect(codeSnippet({ selector: "p", styles: {}, edits: { styles: {} } })).toBe("p {\n}")
  })
})
