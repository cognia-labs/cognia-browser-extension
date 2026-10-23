/** @jest-environment <rootDir>/testing/jsdom-environment.cjs */
import {
  bareUrl,
  computedStyles,
  describeElement,
  elementLabel,
  elementOutline,
  parseLocation,
  sourceHintsFor,
  uniqueSelector,
  visibleText,
} from "./element-context"

function mount(html: string) {
  document.body.innerHTML = html
}

const $ = (selector: string) => {
  const element = document.querySelector(selector)
  if (!element) throw new Error(`fixture has no ${selector}`)
  return element
}

afterEach(() => {
  document.body.innerHTML = ""
})

describe("uniqueSelector", () => {
  it("prefers an id, then a test id", () => {
    mount(`<button id="save">Save</button><button data-testid="cancel">Cancel</button>`)
    expect(uniqueSelector($("#save"))).toBe("#save")
    expect(uniqueSelector($("[data-testid=cancel]"))).toBe('button[data-testid="cancel"]')
  })

  it("walks up with classes and nth-of-type only where siblings tie, and matches exactly one", () => {
    mount(`
      <main id="app">
        <ul class="list"><li class="item">a</li><li class="item">b</li></ul>
        <ul class="list"><li class="item">c</li></ul>
      </main>`)
    const target = document.querySelectorAll("li")[1]!
    const selector = uniqueSelector(target)
    expect(document.querySelectorAll(selector)).toHaveLength(1)
    expect(document.querySelector(selector)).toBe(target)
    expect(selector).toBe("li.item:nth-of-type(2)")
  })

  it("anchors on an ancestor's id when the path alone is not unique", () => {
    mount(`
      <div id="one"><p><span>a</span></p></div>
      <div id="two"><p><span>b</span></p></div>`)
    expect(uniqueSelector(document.querySelectorAll("span")[1]!)).toBe("#two > p > span")
  })

  it("leaves hashed class names out of the path", () => {
    mount(`<div class="css-1x2y3z card"><span class="title">t</span></div>`)
    expect(uniqueSelector($("span"))).not.toContain("css-1x2y3z")
    expect(elementLabel($("div"))).toBe("div.card")
  })
})

describe("visibleText", () => {
  it("reads what a person sees, and nothing they typed or the page hid", () => {
    mount(`
      <form id="f">
        <p>Visible copy</p>
        <input value="secret-input" />
        <textarea>secret-draft</textarea>
        <span hidden>hidden-attr</span>
        <span aria-hidden="true">hidden-aria</span>
        <span style="display:none">hidden-display</span>
        <div contenteditable="true">secret-editable</div>
      </form>`)
    const text = visibleText($("#f"))
    expect(text).toBe("Visible copy")
  })
})

describe("describeElement", () => {
  it("reports identity, semantics, box and styles, never a form value or handler", () => {
    mount(`
      <main style="display:flex;gap:16px">
        <a id="docs" href="https://docs.test/guide?token=abc#part" onclick="steal()" class="link primary" aria-label="Read the guide">Guide</a>
        <input id="email" value="me@example.com" placeholder="Email" />
        <label for="email">Your email</label>
      </main>`)
    const link = describeElement($("#docs"), "e1")
    expect(link).toMatchObject({
      elementId: "e1",
      selector: "#docs",
      tag: "a",
      label: "a#docs",
      role: "link",
      name: "Read the guide",
      text: "Guide",
      textEditable: true,
    })
    expect(link.attributes.href).toBe("https://docs.test/guide")
    expect(link.attributes).not.toHaveProperty("onclick")
    expect(link.parent?.label).toBe("main")
    expect(link.parent?.styles.display).toBe("flex")

    const input = describeElement($("#email"), "e2")
    expect(input.role).toBe("textbox")
    expect(input.name).toBe("Your email")
    expect(JSON.stringify(input)).not.toContain("me@example.com")
    expect(input.textEditable).toBe(false)
  })

  it("leaves defaults out of the computed styles but keeps what designers read", () => {
    mount(`<p id="p" style="color: rgb(1, 2, 3); font-size: 18px">x</p>`)
    const styles = computedStyles($("#p"))
    expect(styles.color).toBe("rgb(1, 2, 3)")
    expect(styles["font-size"]).toBe("18px")
    expect(styles).not.toHaveProperty("z-index")
  })
})

describe("elementOutline", () => {
  it("sketches tags and text to a fixed depth", () => {
    mount(
      `<section id="s"><h2 class="title">Plans</h2><div><div><div><div>deep</div></div></div></div></section>`
    )
    const outline = elementOutline($("#s"))
    expect(outline.split("\n")[0]).toBe("section#s")
    expect(outline).toContain('  h2.title "Plans"')
    expect(outline).toContain("…")
    expect(outline).not.toContain("deep")
  })
})

describe("source hints", () => {
  it("reads build-time inspector attributes on the element or an ancestor", () => {
    mount(`
      <div data-inspector-relative-path="src/Card.tsx" data-inspector-line="8" data-inspector-column="3">
        <button data-insp-path="src/Button.tsx:12:5:button">Go</button>
      </div>`)
    expect(sourceHintsFor($("button"))).toEqual([
      { file: "src/Button.tsx", line: 12, column: 5 },
      { file: "src/Card.tsx", line: 8, column: 3 },
    ])
  })

  it("parses a location with or without a position", () => {
    expect(parseLocation("src/App.vue:3:5")).toEqual({ file: "src/App.vue", line: 3, column: 5 })
    expect(parseLocation("src/App.vue")).toEqual({ file: "src/App.vue" })
    expect(parseLocation("not a path")).toBeNull()
  })
})

describe("bareUrl", () => {
  it("strips credentials, query and fragment, and resolves against the page", () => {
    expect(bareUrl("/a/b?x=1#y", "https://site.test/c")).toBe("https://site.test/a/b")
    expect(bareUrl("https://u:p@site.test/z", "https://site.test/")).toBe("https://site.test/z")
    expect(bareUrl("data:image/png;base64,AAAA", "https://site.test/")).toBe("data:…")
  })
})
