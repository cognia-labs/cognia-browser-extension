/** @jest-environment <rootDir>/testing/jsdom-environment.cjs */
import { alikeElements, elementsInBox, isMeaningful } from "./multi-select"

/** Lay elements out by hand: jsdom lays out nothing. */
function layOut(boxes: Record<string, [number, number, number, number]>) {
  for (const [selector, [x, y, width, height]] of Object.entries(boxes))
    for (const element of document.querySelectorAll(selector))
      element.getBoundingClientRect = () =>
        ({ left: x, top: y, width, height, right: x + width, bottom: y + height }) as DOMRect
}

const everything = () => true

beforeEach(() => {
  document.body.innerHTML = `
    <div id="card">
      <h2 id="title">Pro</h2>
      <button id="buy" class="btn primary"><span id="label">Buy</span></button>
      <button id="later" class="primary btn">Later</button>
      <button id="plain">Plain</button>
      <div id="wrap"><img id="pic" /></div>
    </div>
    <button id="far" class="btn primary">Far</button>`
  layOut({
    "*": [0, 0, 0, 0],
    "#card": [0, 0, 400, 300],
    "#title": [10, 10, 100, 30],
    "#buy": [10, 50, 80, 30],
    "#label": [20, 55, 30, 20],
    "#later": [100, 50, 80, 30],
    "#plain": [200, 50, 80, 30],
    "#wrap": [10, 100, 100, 100],
    "#pic": [10, 100, 100, 100],
    "#far": [10, 900, 80, 30],
  })
})

describe("isMeaningful", () => {
  it("takes controls, headings, images and words, not bare wrappers", () => {
    expect(isMeaningful(document.getElementById("buy")!)).toBe(true)
    expect(isMeaningful(document.getElementById("title")!)).toBe(true)
    expect(isMeaningful(document.getElementById("pic")!)).toBe(true)
    expect(isMeaningful(document.getElementById("label")!)).toBe(true)
    expect(isMeaningful(document.getElementById("wrap")!)).toBe(false)
  })
})

describe("elementsInBox", () => {
  it("takes what lies wholly inside, outermost only, in document order", () => {
    const inside = elementsInBox(document, { x: 0, y: 0, width: 190, height: 90 }, everything)
    // The button, not the label inside it; not the one only half in the box.
    expect(inside.map((element) => element.id)).toEqual(["title", "buy", "later"])
  })

  it("leaves out what may not be picked, and stops at the room left", () => {
    const inside = elementsInBox(
      document,
      { x: 0, y: 0, width: 400, height: 300 },
      (element) => element.id !== "title",
      2
    )
    expect(inside.map((element) => element.id)).toEqual(["buy", "later"])
  })

  it("takes nothing for a box with no size", () => {
    expect(elementsInBox(document, { x: 5, y: 5, width: 0, height: 10 }, everything)).toEqual([])
  })
})

describe("alikeElements", () => {
  it("finds the same tag with the same classes, in any order, anywhere on the page", () => {
    const alike = alikeElements(document, document.getElementById("buy")!, everything)
    expect(alike.map((element) => element.id)).toEqual(["buy", "later", "far"])
  })

  it("matches classless elements under the same kind of parent", () => {
    const alike = alikeElements(document, document.getElementById("plain")!, everything)
    expect(alike.map((element) => element.id)).toEqual(["plain"])
  })
})
