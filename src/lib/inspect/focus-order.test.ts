/** @jest-environment <rootDir>/testing/jsdom-environment.cjs */
import { checkFocusOrder, focusMarkdown, parseFocus } from "./focus-order"

function box(id: string, left: number, top: number, width = 80, height = 20) {
  document.getElementById(id)!.getBoundingClientRect = () =>
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

function run() {
  const tracked: Element[] = []
  const result = checkFocusOrder(document, (element) => {
    const known = tracked.indexOf(element)
    if (known >= 0) return `id-${known}`
    tracked.push(element)
    return `id-${tracked.length - 1}`
  })
  return { ...result, tracked }
}

afterEach(() => {
  document.body.innerHTML = ""
})

describe("checkFocusOrder", () => {
  it("orders the stops as Tab does: positive tabindex first, then the document", () => {
    document.body.innerHTML = `
      <a id="skip" href="#main">Skip</a>
      <button id="one">One</button>
      <input id="hidden-input" type="hidden" />
      <button id="disabled" disabled>Off</button>
      <div id="minus" tabindex="-1">Not in order</div>
      <a id="nolink">No href</a>
      <input id="two" />
      <span id="first" tabindex="2">Jumps the queue</span>
      <div inert><button id="inert">Inert</button></div>`
    box("skip", -9999, 0, 1, 1)
    box("one", 0, 40)
    box("two", 0, 80)
    box("first", 0, 120)
    const { check, order, tracked } = run()
    expect(order.map((stop) => tracked[Number(stop.elementId.slice(3))]!.id)).toEqual([
      "first",
      "skip",
      "one",
      "two",
    ])
    expect(check.stops).toBe(4)
    // The skip link is off screen on purpose; the positive tabindex is reported.
    expect(check.issues).toEqual([
      expect.objectContaining({
        rule: "positive-tabindex",
        selector: "#first",
        detail: 'tabindex="2"',
      }),
      // After the tabindex=2 stop at 120, focus goes back to the top.
      expect.objectContaining({ rule: "order-jump", selector: "#one" }),
    ])
    expect(order[0]).toEqual({ elementId: expect.any(String), x: 0, y: 120, width: 80, height: 20 })
  })

  it("finds stops nobody can see, and focus going back up the page", () => {
    document.body.innerHTML = `
      <button id="top">Top</button>
      <button id="ghost" style="opacity: 0">Ghost</button>
      <div aria-hidden="true"><a id="muted" href="/x">Muted</a></div>
      <button id="lower">Lower</button>
      <button id="upper">Upper</button>`
    box("top", 0, 0)
    box("ghost", 0, 30)
    box("muted", 0, 60)
    box("lower", 0, 400)
    box("upper", 0, 100)
    expect(run().check.issues.map((issue) => [issue.rule, issue.selector, issue.detail])).toEqual([
      ["hidden-focusable", "#ghost", "opacity 0"],
      ["hidden-focusable", "#muted", 'inside aria-hidden="true"'],
      ["order-jump", "#upper", "stop 5 is 300px above stop 4"],
    ])
  })

  it("finds what looks clickable but the keyboard never reaches", () => {
    document.body.innerHTML = `
      <div id="card" style="cursor: pointer"><span id="inside" style="cursor: pointer">Open</span></div>
      <a id="ok" href="/ok" style="cursor: pointer"><span id="in-link" style="cursor: pointer">Fine</span></a>
      <div id="role" role="tab" style="cursor: pointer">Tab</div>
      <label id="label" style="cursor: pointer">Label</label>
      <div id="decor" role="presentation" style="cursor: pointer">Decor</div>`
    for (const id of ["card", "inside", "ok", "in-link", "role", "label", "decor"])
      box(id, 0, 0, 100, 30)
    expect(run().check.issues.map((issue) => [issue.rule, issue.selector, issue.detail])).toEqual([
      ["unreachable-control", "#card", undefined],
      ["unreachable-control", "#role", 'role="tab"'],
    ])
  })
})

describe("focusMarkdown and parseFocus", () => {
  const check = {
    stops: 12,
    issues: [{ rule: "positive-tabindex" as const, selector: "#first", detail: 'tabindex="2"' }],
    truncated: false,
  }

  it("says how many stops there are and what goes wrong", () => {
    const text = focusMarkdown(check)
    expect(text).toContain("## Keyboard focus check (1 findings)")
    expect(text).toContain("Tab moves through 12 stops on this page.")
    expect(text).toContain(
      '- Positive tabindex takes the element out of the page\'s reading order — `#first` (tabindex="2")'
    )
    expect(focusMarkdown({ ...check, issues: [] })).toContain("No keyboard problems found.")
  })

  it("round-trips through a draft and drops what it cannot show", () => {
    expect(parseFocus(JSON.parse(JSON.stringify(check)))).toEqual(check)
    expect(parseFocus({ ...check, issues: [{ rule: "made-up" }] })?.issues).toEqual([])
    expect(parseFocus({ issues: [] })).toBeNull()
  })
})
