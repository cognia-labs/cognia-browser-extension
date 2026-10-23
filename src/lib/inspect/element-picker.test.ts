/** @jest-environment <rootDir>/testing/jsdom-environment.cjs */
import { PROBE_ATTRIBUTE } from "./framework-source"
import { fontSummary, installElementPicker, type ElementPicker } from "./element-picker"

type PickerWindow = Window & typeof globalThis

function freshPicker(trusted: (event: Event) => boolean = () => true): ElementPicker {
  delete (window as { __cogniaPicker?: unknown }).__cogniaPicker
  return installElementPicker(window as PickerWindow, { trusted })
}

const overlay = () => document.getElementById("__cognia-element-picker")

beforeEach(() => {
  document.body.innerHTML = `
    <main>
      <button id="save" style="color: red">Save</button>
      <div id="card"><h2>Title</h2></div>
    </main>`
})

afterEach(() => {
  jest.useRealTimers()
})

function click(target: Element) {
  target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
}

describe("fontSummary", () => {
  it("names the first family the stylesheet asks for, with size, line height and weight", () => {
    expect(
      fontSummary({
        fontFamily: '"Inter Variable", Inter, sans-serif',
        fontSize: "14px",
        lineHeight: "20px",
        fontWeight: "600",
      })
    ).toBe("Inter Variable 14px/20px 600")
    expect(
      fontSummary({ fontFamily: "", fontSize: "16px", lineHeight: "normal", fontWeight: "400" })
    ).toBe("")
  })
})

describe("installElementPicker", () => {
  it("installs once per document", () => {
    const picker = freshPicker()
    expect(installElementPicker(window as PickerWindow)).toBe(picker)
  })

  it("answers the clicked element, stamped for the main-world read, and the page never sees the click", async () => {
    const picker = freshPicker()
    const save = document.getElementById("save")!
    const pageClick = jest.fn()
    save.addEventListener("click", pageClick)
    const picked = picker.pick({ hint: "Pick", timeoutMs: 10_000 })
    expect(overlay()?.getAttribute("data-cognia-chrome")).toBe("1")
    click(save)
    const result = await picked
    expect(pageClick).not.toHaveBeenCalled()
    expect(overlay()).toBeNull()
    expect(result).toMatchObject({ selector: "#save", tag: "button", name: "Save" })
    expect(result?.html).toBe('<button id="save" style="color: red">Save</button>')
    expect(save.getAttribute(PROBE_ATTRIBUTE)).toBe(result?.probeToken)
  })

  it("confirms a pick on the page before the overlay goes, unless motion is reduced", async () => {
    const reduce = { matches: false }
    window.matchMedia = jest.fn(() => reduce) as never
    try {
      const picker = freshPicker()
      const picked = picker.pick({ hint: "Pick", timeoutMs: 10_000 })
      const host = overlay()!
      click(document.getElementById("save")!)
      // Still on the page for its confirmation, but no longer pointing.
      expect(overlay()).toBe(host)
      expect(host.hasAttribute("data-cognia-pointing")).toBe(false)
      const result = await picked
      // Answered only once the highlight is off the page.
      expect(overlay()).toBeNull()
      expect(result).toMatchObject({ selector: "#save" })
      // Asked for less motion: gone at once.
      reduce.matches = true
      const again = picker.pick({ hint: "Pick", timeoutMs: 10_000 })
      click(document.getElementById("save")!)
      expect(overlay()).toBeNull()
      await again
    } finally {
      delete (window as { matchMedia?: unknown }).matchMedia
    }
  })

  describe("choosing several", () => {
    const OPTIONS = {
      hint: "Pick",
      selectedHint: "{n} chosen",
      doneLabel: "Done",
      timeoutMs: 10_000,
      max: 10,
    }
    function press(target: EventTarget, init: MouseEventInit) {
      target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...init }))
    }
    function key(name: string) {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }))
    }

    it("takes one on a plain click, as picking always has", async () => {
      const picker = freshPicker()
      const chosen = picker.pickMany(OPTIONS)
      click(document.getElementById("save")!)
      expect((await chosen)?.map((pick) => pick.selector)).toEqual(["#save"])
      expect(overlay()).toBeNull()
    })

    it("adds and removes with Shift, ⌘ or Ctrl, and adds them all on Enter", async () => {
      const picker = freshPicker()
      const chosen = picker.pickMany(OPTIONS)
      const save = document.getElementById("save")!
      const card = document.getElementById("card")!
      press(save, { shiftKey: true })
      press(card, { metaKey: true })
      press(save, { ctrlKey: true })
      press(save, { shiftKey: true })
      // Still choosing: nothing answered yet.
      expect(overlay()).not.toBeNull()
      key("Enter")
      expect((await chosen)?.map((pick) => pick.selector)).toEqual(["#card", "#save"])
    })

    it("takes what a box dragged over the page holds, and the click that ends it picks nothing", async () => {
      const picker = freshPicker()
      const layout: Record<string, [number, number, number, number]> = {
        save: [10, 10, 60, 20],
        card: [10, 40, 200, 100],
      }
      for (const element of document.querySelectorAll("*")) {
        const [x, y, width, height] = layout[element.id] ?? [0, 0, 0, 0]
        element.getBoundingClientRect = () =>
          ({ left: x, top: y, width, height, right: x + width, bottom: y + height }) as DOMRect
      }
      const chosen = picker.pickMany(OPTIONS)
      const pointer = (type: string, x: number, y: number) =>
        window.dispatchEvent(
          new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            button: 0,
          })
        )
      pointer("pointerdown", 0, 0)
      pointer("pointermove", 100, 40)
      pointer("pointerup", 100, 40)
      click(document.body)
      expect(overlay()).not.toBeNull()
      key("Enter")
      // The button; the card only half inside, and its heading has no size.
      expect((await chosen)?.map((pick) => pick.selector)).toEqual(["#save"])
    })

    it("takes every element alike on Alt-click, and Backspace takes back the last", async () => {
      document.body.insertAdjacentHTML(
        "beforeend",
        '<button class="chip a">One</button><button class="a chip">Two</button>'
      )
      for (const chip of document.querySelectorAll(".chip"))
        chip.getBoundingClientRect = () => ({ width: 40, height: 20 }) as DOMRect
      const picker = freshPicker()
      const chosen = picker.pickMany(OPTIONS)
      press(document.querySelector(".chip")!, { altKey: true })
      key("Backspace")
      key("Enter")
      expect((await chosen)?.map((pick) => pick.text)).toEqual(["One"])
    })

    it("stops at the room left, and answers nothing on Escape", async () => {
      const picker = freshPicker()
      const full = picker.pickMany({ ...OPTIONS, max: 1 })
      press(document.getElementById("save")!, { shiftKey: true })
      press(document.getElementById("card")!, { shiftKey: true })
      key("Enter")
      expect((await full)?.map((pick) => pick.selector)).toEqual(["#save"])
      const cancelled = picker.pickMany(OPTIONS)
      press(document.getElementById("save")!, { shiftKey: true })
      key("Escape")
      expect(await cancelled).toBeNull()
    })
  })

  it("ignores events that are not the person's", async () => {
    const picker = freshPicker(() => false)
    const picked = picker.pick({ hint: "Pick", timeoutMs: 10_000 })
    click(document.getElementById("save")!)
    expect(overlay()).not.toBeNull()
    picker.cancel()
    await expect(picked).resolves.toBeNull()
  })

  it("moves to the parent with ↑ and picks with Enter; Escape cancels", async () => {
    const picker = freshPicker()
    const picked = picker.pick({ hint: "Pick", timeoutMs: 10_000 })
    document
      .querySelector("h2")!
      .dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 1, clientY: 1 }))
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", cancelable: true }))
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", cancelable: true }))
    await expect(picked).resolves.toMatchObject({ selector: "#card" })

    const cancelled = picker.pick({ hint: "Pick", timeoutMs: 10_000 })
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }))
    await expect(cancelled).resolves.toBeNull()
  })

  it("ends a pick nobody completes", async () => {
    jest.useFakeTimers()
    const picker = freshPicker()
    const picked = picker.pick({ hint: "Pick", timeoutMs: 1_000 })
    jest.advanceTimersByTime(1_000)
    jest.runAllTimers()
    await expect(picked).resolves.toBeNull()
    expect(overlay()).toBeNull()
  })

  it("previews edits, puts the page back exactly, and refuses unsafe values", async () => {
    const picker = freshPicker()
    const save = document.getElementById("save")!
    const picked = picker.pick({ hint: "Pick", timeoutMs: 10_000 })
    click(save)
    const id = (await picked)!.elementId
    expect(
      picker.apply(id, {
        styles: { "font-size": "20px", color: "blue;} body{display:none" },
        text: "Save now",
      })
    ).toBe(true)
    expect(save.style.getPropertyValue("font-size")).toBe("20px")
    expect(save.style.getPropertyPriority("font-size")).toBe("important")
    // The unsafe value was never applied; the page's own colour stands.
    expect(save.style.color).toBe("red")
    expect(save.textContent).toBe("Save now")
    expect(picker.revert(id)).toBe(true)
    expect(save.getAttribute("style")).toBe("color: red")
    expect(save.textContent).toBe("Save")
  })

  it("finds a pick again, stamps it on request, and forgets it on release", async () => {
    const picker = freshPicker()
    const card = document.getElementById("card")!
    card.scrollIntoView = jest.fn()
    const picked = picker.pick({ hint: "Pick", timeoutMs: 10_000 })
    click(card)
    const id = (await picked)!.elementId
    card.removeAttribute(PROBE_ATTRIBUTE)
    expect(picker.locate(id, false)).toMatchObject({ width: 0, height: 0, dpr: 1 })
    expect(card.scrollIntoView).toHaveBeenCalled()
    expect(overlay()).toBeNull()
    // Where it is on the whole page, for the minimap; unknown ids are skipped.
    card.getBoundingClientRect = () => ({ left: 5, top: 20, width: 30, height: 10 }) as DOMRect
    window.scrollY = 100
    expect(picker.boxes([id, "gone"])).toEqual([{ x: 5, y: 120, width: 30, height: 10 }])
    window.scrollY = 0
    const token = picker.probe(id)
    expect(card.getAttribute(PROBE_ATTRIBUTE)).toBe(token)
    picker.apply(id, { styles: { gap: "4px" } })
    picker.release([id])
    expect(card.hasAttribute("style")).toBe(false)
    expect(card.hasAttribute(PROBE_ATTRIBUTE)).toBe(false)
    expect(picker.locate(id)).toBeNull()
  })

  it("keeps picking on Shift-click, and says so", async () => {
    const picker = freshPicker()
    const picked = picker.pick({ hint: "Pick", timeoutMs: 10_000 })
    document
      .getElementById("save")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, shiftKey: true }))
    await expect(picked).resolves.toMatchObject({ selector: "#save", more: true })
    const plain = picker.pick({ hint: "Pick", timeoutMs: 10_000 })
    click(document.getElementById("card")!)
    expect((await plain)?.more).toBeUndefined()
  })

  it("audits the page and describes a finding like a pick", () => {
    document.documentElement.setAttribute("lang", "en")
    document.title = "T"
    document.body.innerHTML = `<img id="hero" src="hero.png" /><p style="color:#111">Text</p>`
    const picker = freshPicker()
    const audit = picker.audit()
    const finding = audit.issues.find((issue) => issue.rule === "image-alt")!
    expect(finding.selector).toBe("#hero")
    const described = picker.describe(finding.elementId!)
    expect(described).toMatchObject({ elementId: finding.elementId, selector: "#hero", tag: "img" })
    expect(document.getElementById("hero")!.getAttribute(PROBE_ATTRIBUTE)).toBe(
      described?.probeToken
    )
    expect(picker.describe("unknown")).toBeNull()
    expect(picker.tokens().colors.map((color) => color.hex)).toContain("#111111")
  })

  it("says how a text pick's colour reads against what is behind it", () => {
    document.body.innerHTML = `<div style="background: #ffffff"><p id="muted" style="color: #aaaaaa">Muted</p></div><div id="box"></div>`
    const picker = freshPicker()
    const finding = picker.audit().issues.find((issue) => issue.rule === "color-contrast")!
    const described = picker.describe(finding.elementId!)
    expect(described?.contrast).toMatchObject({
      foreground: "#aaaaaa",
      background: "#ffffff",
      aa: false,
      suggestion: expect.stringMatching(/^#[0-9a-f]{6}$/),
    })
    expect(described!.contrast!.ratio).toBeCloseTo(2.32, 2)
  })

  it("never picks the floating toolbar, and lets its clicks through", async () => {
    const picker = freshPicker()
    const toolbar = document.createElement("div")
    toolbar.id = "__cognia-toolbar"
    toolbar.setAttribute("data-cognia-chrome", "1")
    document.documentElement.appendChild(toolbar)
    const pressed = jest.fn()
    toolbar.addEventListener("click", pressed)
    const picked = picker.pick({ hint: "Pick", timeoutMs: 10_000 })
    click(toolbar)
    expect(pressed).toHaveBeenCalled()
    // Still picking: the toolbar was not the pick.
    click(document.getElementById("save")!)
    await expect(picked).resolves.toMatchObject({ selector: "#save" })
    toolbar.remove()
  })

  it("numbers the Tab stops on the page, and takes the numbers away on request", () => {
    document.body.innerHTML = `<button id="a">A</button><button id="b">B</button>`
    layOut(document.getElementById("a")!, 0, 0, 40, 20)
    layOut(document.getElementById("b")!, 0, 30, 40, 20)
    const picker = freshPicker()
    const numbers = () => document.getElementById("__cognia-focus-order")
    expect(picker.showFocusOrder(true)).toBe(false)
    expect(picker.focusOrder()).toEqual({ stops: 2, issues: [], truncated: false })
    expect(numbers()?.getAttribute("data-cognia-chrome")).toBe("1")
    expect(picker.showFocusOrder(false)).toBe(true)
    expect(numbers()).toBeNull()
    expect(picker.showFocusOrder(true)).toBe(true)
    expect(document.querySelectorAll("#__cognia-focus-order")).toHaveLength(1)
    picker.showFocusOrder(false)
  })

  it("checks the layout and describes a finding like a pick", () => {
    document.body.innerHTML = `<p id="tiny" style="font-size: 9px">Fine print</p>`
    layOut(document.getElementById("tiny")!, 0, 0, 100, 12)
    const picker = freshPicker()
    const check = picker.layout()
    expect(check.issues).toEqual([
      expect.objectContaining({ rule: "small-text", selector: "#tiny" }),
    ])
    expect(picker.describe(check.issues[0]!.elementId!)).toMatchObject({ selector: "#tiny" })
  })

  function layOut(element: Element, x: number, y: number, width: number, height: number) {
    element.getBoundingClientRect = () =>
      ({ left: x, top: y, width, height, right: x + width, bottom: y + height, x, y }) as DOMRect
  }

  it("measures from the first element clicked to the second, drawing the distance between", async () => {
    const picker = freshPicker()
    const save = document.getElementById("save")!
    const card = document.getElementById("card")!
    layOut(save, 0, 0, 100, 40)
    layOut(card, 0, 56, 300, 120)
    const pageClick = jest.fn()
    card.addEventListener("click", pageClick)
    const measured = picker.measure({ hint: "First", anchorHint: "Second", timeoutMs: 10_000 })
    click(save)
    // Anchored: still measuring, now pointing at the second element.
    expect(overlay()).not.toBeNull()
    card.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }))
    click(card)
    const result = await measured
    expect(pageClick).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      from: { selector: "#save", label: "button#save", box: { width: 100, height: 40 } },
      to: { selector: "#card", box: { y: 56 } },
      measure: { relation: "apart", vertical: { gap: 16, side: "below" } },
    })
    expect(result?.more).toBeUndefined()
    // The same handles as picks: a measured element can be shown again.
    expect(picker.showMeasurement(result!.from.elementId, result!.to.elementId)).toMatchObject({
      measure: { vertical: { gap: 16 } },
    })
    layOut(card, 0, 60, 300, 120)
    expect(
      picker.showMeasurement(result!.from.elementId, result!.to.elementId)?.measure.vertical?.gap
    ).toBe(20)
  })

  it("keeps measuring from the same anchor on Shift-click, and ignores the anchor itself", async () => {
    const picker = freshPicker()
    const save = document.getElementById("save")!
    const card = document.getElementById("card")!
    const heading = card.querySelector("h2")!
    layOut(save, 0, 0, 100, 40)
    layOut(card, 0, 50, 300, 120)
    layOut(heading, 10, 60, 200, 30)
    const first = picker.measure({ hint: "First", anchorHint: "Second", timeoutMs: 10_000 })
    click(save)
    click(save)
    expect(overlay()).not.toBeNull()
    card.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, shiftKey: true }))
    const result = await first
    expect(result?.more).toBe(true)
    const next = picker.measure({
      hint: "First",
      anchorHint: "Second",
      timeoutMs: 10_000,
      anchorId: result!.from.elementId,
    })
    click(heading)
    await expect(next).resolves.toMatchObject({
      from: { selector: "#save" },
      to: { label: "h2" },
      measure: { vertical: { gap: 20 } },
    })
  })

  it("cancels a measurement with Escape, and forgets nothing it was not given", async () => {
    const picker = freshPicker()
    const measured = picker.measure({ hint: "First", anchorHint: "Second", timeoutMs: 10_000 })
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }))
    await expect(measured).resolves.toBeNull()
    expect(picker.showMeasurement("nope", "nada")).toBeNull()
  })

  it("edits the page's words in place, once at a time, and reads back what changed", () => {
    const picker = freshPicker()
    expect(picker.editText("Edit")).toBe(true)
    expect(picker.editText("Edit")).toBe(false)
    expect(picker.isEditingText()).toBe(true)
    expect(document.designMode).toBe("on")
    const editingHost = () =>
      document.querySelector('#__cognia-element-picker[contenteditable="false"]')
    expect(editingHost()).not.toBeNull()
    document.querySelector("h2")!.textContent = "Heading"
    expect(picker.stopEditingText(true)).toEqual([
      { selector: "h2", label: "h2", before: "Title", after: "Heading" },
    ])
    expect(document.designMode).toBe("off")
    expect(editingHost()).toBeNull()
    expect(picker.stopEditingText(true)).toEqual([])
  })

  describe("adjusting a pick on the page", () => {
    const key = (name: string, init: KeyboardEventInit = {}) =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: name, cancelable: true, ...init }))
    const ORIGINAL = "color: red; width: 100px; height: 40px; margin: 0px; padding: 4px"

    async function held() {
      const picker = freshPicker()
      const save = document.getElementById("save")!
      save.setAttribute("style", ORIGINAL)
      const picked = picker.pick({ hint: "Pick", timeoutMs: 10_000 })
      click(save)
      const id = (await picked)!.elementId
      layOut(save, 0, 0, 100, 40)
      const adjust = () =>
        picker.adjust({
          elementId: id,
          hint: "Adjust",
          labels: { margin: "M", padding: "P" },
          timeoutMs: 10_000,
        })
      return { picker, save, id, adjust }
    }

    it("resizes by the edge and nudges spacing live, and answers what changed", async () => {
      const { picker, save, id, adjust } = await held()
      const pageDown = jest.fn()
      save.addEventListener("pointerdown", pageDown)
      const pointing = () =>
        document.querySelector("#__cognia-element-picker[data-cognia-pointing]")
      const adjusting = adjust()
      expect(pointing()).not.toBeNull()
      const pointer = (type: string, x: number, y: number) =>
        save.dispatchEvent(
          new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y })
        )
      pointer("pointerdown", 100, 20)
      pointer("pointermove", 130, 25)
      pointer("pointerup", 130, 25)
      expect(pageDown).not.toHaveBeenCalled()
      expect(save.style.getPropertyValue("width")).toBe("130px")
      key("ArrowRight", { shiftKey: true })
      expect(save.style.getPropertyValue("margin-right")).toBe("10px")
      key("p")
      key("ArrowUp")
      key("Enter")
      await expect(adjusting).resolves.toEqual({
        width: "130px",
        margin: "0px 10px 0px 0px",
        padding: "5px 4px 4px",
      })
      expect(pointing()).toBeNull()
      // Left showing until the panel previews it; reverting puts the page back.
      expect(save.style.getPropertyValue("width")).toBe("130px")
      picker.revert(id)
      expect(save.getAttribute("style")).toBe(ORIGINAL)
    })

    it("puts the element back on Escape", async () => {
      const { save, adjust } = await held()
      const adjusting = adjust()
      key("ArrowDown")
      key("Escape")
      await expect(adjusting).resolves.toBeNull()
      expect(save.getAttribute("style")).toBe(ORIGINAL)
    })

    it("keeps the work when the panel says done, and refuses an element it does not hold", async () => {
      const { picker, adjust } = await held()
      expect(picker.finishAdjust()).toBe(false)
      const adjusting = adjust()
      key("ArrowDown", { altKey: true })
      key("ArrowDown")
      expect(picker.finishAdjust()).toBe(true)
      await expect(adjusting).resolves.toEqual({ margin: "0px 0px 1px" })
      await expect(
        picker.adjust({
          elementId: "nope",
          hint: "",
          labels: { margin: "", padding: "" },
          timeoutMs: 1,
        })
      ).resolves.toBeNull()
    })
  })

  it("says so when a picked element has left the page", async () => {
    const picker = freshPicker()
    const save = document.getElementById("save")!
    const picked = picker.pick({ hint: "Pick", timeoutMs: 10_000 })
    click(save)
    const id = (await picked)!.elementId
    save.remove()
    expect(picker.apply(id, { styles: { gap: "4px" } })).toBe(false)
    expect(picker.locate(id)).toBeNull()
  })
})
