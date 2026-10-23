/** @jest-environment <rootDir>/testing/jsdom-environment.cjs */
import {
  isToolbarMessage,
  pageToolbar,
  pageToolbarHidden,
  TOOLBAR_HOST_ID,
  type ToolbarState,
} from "./page-toolbar"

const STATE: ToolbarState = {
  labels: {
    title: "Tools",
    pick: "Pick",
    measure: "Measure",
    adjust: "Adjust",
    text: "Text",
    shot: "Shot",
    close: "Close",
    collapse: "Collapse",
    expand: "Expand",
    drag: "Drag",
    minimap: "Minimap",
    minimapHide: "Hide minimap",
  },
  active: "pick",
  disabled: ["adjust"],
  counts: { pick: 2, measure: 0 },
  zoom: 1,
  marks: [],
  snap: false,
}

type Host = HTMLElement & { __cogniaToolbar?: { root: ShadowRoot } }
const host = () => document.getElementById(TOOLBAR_HOST_ID) as Host | null
const root = () => host()!.__cogniaToolbar!.root
const buttons = () => [...root().querySelectorAll<HTMLButtonElement>(".bar button")]
const bar = () => root().querySelector(".bar") as HTMLElement
const pointer = (target: EventTarget, type: string, clientX: number, clientY: number) =>
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY }))
const press = (name: string) =>
  (root().querySelector(`.bar [data-name=${name}]`) as HTMLButtonElement).click()
/** A page taller than the window, as jsdom lays out nothing. */
function tallPage(height: number) {
  Object.defineProperty(document.documentElement, "scrollHeight", {
    configurable: true,
    get: () => height,
  })
}

let sendMessage: jest.Mock
/** Every 2D context drawn into, recording its calls: jsdom has no canvas. */
let contexts: Record<string, jest.Mock>[]
beforeEach(() => {
  sendMessage = jest.fn(async () => undefined)
  ;(globalThis as unknown as { chrome: unknown }).chrome = { runtime: { sendMessage } }
  contexts = []
  jest.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => {
    const calls: Record<string, jest.Mock> = {}
    contexts.push(calls)
    return new Proxy(
      {},
      {
        get: (_target, key: string) => (calls[key] ??= jest.fn()),
        set: () => true,
      }
    ) as never
  })
})

afterEach(() => {
  pageToolbar(null)
  tallPage(0)
  delete (globalThis as { __cogniaPicker?: unknown }).__cogniaPicker
  jest.restoreAllMocks()
})

describe("pageToolbar", () => {
  it("floats the tools in the extension's own chrome, with what each is doing", () => {
    expect(pageToolbar(STATE)).toBe(true)
    expect(host()?.getAttribute("data-cognia-chrome")).toBe("1")
    expect(host()?.getAttribute("contenteditable")).toBe("false")
    expect(buttons().map((button) => button.getAttribute("aria-label"))).toEqual([
      "Pick",
      "Measure",
      "Adjust",
      "Text",
      "Shot",
      "Minimap",
      "Collapse",
      "Close",
    ])
    const [pick, measure, adjust] = buttons()
    expect(pick!.getAttribute("aria-pressed")).toBe("true")
    expect(pick!.textContent).toContain("2")
    expect(measure!.getAttribute("aria-pressed")).toBe("false")
    expect(measure!.querySelector(".count")).toBeNull()
    expect(adjust!.disabled).toBe(true)
  })

  it("redraws in place, and goes away on request", () => {
    pageToolbar(STATE)
    pageToolbar({ ...STATE, active: null, disabled: [], counts: { pick: 0, measure: 3 } })
    expect(document.querySelectorAll(`#${TOOLBAR_HOST_ID}`)).toHaveLength(1)
    const [pick, measure, adjust] = buttons()
    expect(pick!.getAttribute("aria-pressed")).toBe("false")
    expect(measure!.textContent).toContain("3")
    expect(adjust!.disabled).toBe(false)
    pageToolbar(null)
    expect(host()).toBeNull()
  })

  it("answers only clicks the person made, never a page script's", () => {
    pageToolbar(STATE)
    buttons()[0]!.click()
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it("lies down along the top or bottom edge it is dragged to, and stands up away from it", () => {
    pageToolbar(STATE, { untrusted: true })
    expect(host()!.dataset.orientation).toBe("vertical")
    const grip = root().querySelector(".grip")!
    // jsdom's window is 1024×768.
    pointer(grip, "pointerdown", 21, 300)
    pointer(window, "pointermove", 200, 740)
    expect(host()!.dataset.orientation).toBe("horizontal")
    expect(bar().classList.contains("h")).toBe(true)
    expect(bar().classList.contains("bottom")).toBe(true)
    // Docked: held to the bottom edge, wherever the pointer is along it.
    expect(bar().style.top).toBe(`${768 - 42 - 12}px`)
    // The buttons are still all there, and keep answering.
    expect(buttons()).toHaveLength(8)
    pointer(window, "pointermove", 200, 680)
    expect(host()!.dataset.orientation).toBe("horizontal")
    pointer(window, "pointermove", 200, 400)
    expect(host()!.dataset.orientation).toBe("vertical")
    pointer(window, "pointermove", 300, 20)
    expect(bar().classList.contains("top")).toBe(true)
    expect(bar().style.top).toBe("12px")
    pointer(window, "pointerup", 300, 20)
    // A redraw from the panel keeps where the person put it.
    pageToolbar({ ...STATE, active: null })
    expect(host()!.dataset.orientation).toBe("horizontal")
    expect(bar().classList.contains("top")).toBe(true)
  })

  describe("snapping to the window's edges", () => {
    /**
     * Drag by the middle of the grip and let go at a point (jsdom's window is
     * 1024×768): 21 across and 13 down an upright bar, 13 and 21 a lying one.
     */
    function dragTo(x: number, y: number) {
      const lying = bar().classList.contains("h")
      const left = Number.parseFloat(bar().style.left)
      const top = Number.parseFloat(bar().style.top)
      pointer(
        root().querySelector(".grip")!,
        "pointerdown",
        left + (lying ? 13 : 21),
        top + (lying ? 21 : 13)
      )
      pointer(window, "pointermove", x, y)
      pointer(window, "pointerup", x, y)
    }

    it("stays where it is let go when snapping is off", () => {
      pageToolbar(STATE, { untrusted: true })
      dragTo(600, 250)
      expect(host()!.dataset.anchor).toBe("")
      expect(bar().style.left).toBe(`${600 - 21}px`)
    })

    it("glides upright to the nearer side, and to the middle when let go near it", () => {
      pageToolbar({ ...STATE, snap: true }, { untrusted: true })
      dragTo(700, 100)
      expect(host()!.dataset.anchor).toBe("end")
      // 42 wide (jsdom measures nothing), 12 from the right.
      expect(bar().style.left).toBe(`${1024 - 42 - 12}px`)
      expect(bar().classList.contains("snapping")).toBe(true)
      expect(bar().style.top).toBe(`${100 - 13}px`)
      // Let go with its middle near the window's: centred down the side.
      dragTo(300, 384 - 165 + 13)
      expect(host()!.dataset.anchor).toBe("start center")
      expect(bar().style.left).toBe("12px")
      expect(bar().style.top).toBe(`${(768 - 330) / 2}px`)
    })

    it("settles along the bottom to a side or the middle when near it, and is free between", () => {
      pageToolbar({ ...STATE, snap: true }, { untrusted: true })
      // The grip is 13px into a lying bar 330 wide: its middle is 165 - 13 to the right.
      dragTo(512 - 152 + 30, 740)
      expect(host()!.dataset.anchor).toBe("center")
      expect(bar().style.left).toBe(`${(1024 - 330) / 2}px`)
      dragTo(50, 740)
      expect(host()!.dataset.anchor).toBe("start")
      dragTo(250, 740)
      expect(host()!.dataset.anchor).toBe("")
    })

    it("stays on its side as the window changes, and snaps at once when turned on", () => {
      pageToolbar(STATE, { untrusted: true })
      dragTo(700, 100)
      expect(host()!.dataset.anchor).toBe("")
      pageToolbar({ ...STATE, snap: true }, { untrusted: true })
      expect(host()!.dataset.anchor).toBe("end")
      const width = window.innerWidth
      Object.defineProperty(window, "innerWidth", { configurable: true, value: 800 })
      window.dispatchEvent(new Event("resize"))
      expect(bar().style.left).toBe(`${800 - 42 - 12}px`)
      Object.defineProperty(window, "innerWidth", { configurable: true, value: width })
    })
  })

  it("ignores a drag the page scripted", () => {
    pageToolbar(STATE)
    pointer(root().querySelector(".grip")!, "pointerdown", 21, 300)
    pointer(window, "pointermove", 200, 740)
    expect(host()!.dataset.orientation).toBe("vertical")
  })

  it("keeps its size on screen when the page is zoomed", () => {
    pageToolbar({ ...STATE, zoom: 2 })
    expect(host()!.style.transform).toBe("translate(0px,0px) scale(0.5)")
    expect(host()!.style.width).toBe("2048px")
    pageToolbar(STATE)
    expect(host()!.style.transform).toBe("")
    expect(host()!.style.width).toBe("1024px")
  })

  it("shows a minimap once a page that does not fit is zoomed in, or when asked", () => {
    tallPage(4000)
    pageToolbar(STATE, { untrusted: true })
    expect(host()!.dataset.minimap).toBe("hidden")
    pageToolbar({ ...STATE, zoom: 1.5 }, { untrusted: true })
    expect(host()!.dataset.minimap).toBe("shown")
    expect(root().querySelector(".map")!.getAttribute("aria-label")).toBe("Minimap")
    expect(root().querySelector(".bar [data-name=minimap]")!.getAttribute("aria-pressed")).toBe(
      "true"
    )
    // Hidden by the person, it stays hidden through redraws.
    press("minimap")
    expect(host()!.dataset.minimap).toBe("hidden")
    pageToolbar({ ...STATE, zoom: 2 }, { untrusted: true })
    expect(host()!.dataset.minimap).toBe("hidden")
    // And shown at 100% too, when they ask.
    pageToolbar(STATE, { untrusted: true })
    press("minimap")
    expect(host()!.dataset.minimap).toBe("shown")
    ;(root().querySelector(".map button") as HTMLButtonElement).click()
    expect(host()!.dataset.minimap).toBe("hidden")
  })

  it("does not show the minimap on a zoomed page that all fits", () => {
    pageToolbar({ ...STATE, zoom: 2 })
    expect(host()!.dataset.minimap).toBe("hidden")
  })

  it("scrolls the page to where the minimap is clicked", () => {
    tallPage(4000)
    const scrollTo = jest.fn()
    window.scrollTo = scrollTo as never
    pageToolbar({ ...STATE, zoom: 2 }, { untrusted: true })
    // Drawn as it appears, without waiting for a frame a busy page may not paint.
    const canvas = root().querySelector(".map canvas") as HTMLCanvasElement
    // 148px wide for a 1024px page: the map is 148 × 578, shown 280 tall at most.
    expect(canvas.style.width).toBe("148px")
    canvas.getBoundingClientRect = () =>
      ({ left: 800, top: 40, width: 148, height: 280, right: 948, bottom: 320 }) as DOMRect
    pointer(canvas, "pointerdown", 874, 180)
    expect(scrollTo).toHaveBeenCalledTimes(1)
    const [{ left, top }] = scrollTo.mock.calls[0] as [{ left: number; top: number }]
    expect(left).toBe(0)
    // Halfway down the shown map is 140px of 578: about a quarter of the page,
    // put in the middle of the window.
    expect(top).toBeGreaterThan(500)
    expect(top).toBeLessThan(700)
    pointer(window, "pointerup", 874, 180)
  })

  it("draws the page's boxes and words, the picks, and the part in view", async () => {
    tallPage(4000)
    document.body.innerHTML = "<main><p>Hello</p></main>"
    const boxes = jest.fn(() => [{ x: 10, y: 1000, width: 200, height: 40 }])
    ;(globalThis as { __cogniaPicker?: unknown }).__cogniaPicker = { boxes }
    pageToolbar({ ...STATE, zoom: 2, marks: ["e1"] })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(boxes).toHaveBeenCalledWith(["e1"])
    // The wireframe, then the map copying it with the view boxed over.
    const [wireframe, map] = contexts
    expect(wireframe!.fillRect).toHaveBeenCalled()
    expect(map!.drawImage).toHaveBeenCalledTimes(1)
    expect(map!.fill).toHaveBeenCalledWith("evenodd")
    // The pick at y=1000 of 4000, on a 148/1024 scale.
    expect((map!.strokeRect!.mock.calls[0] as number[])[1]!).toBeCloseTo(1000 * (148 / 1024), 0)
    document.body.innerHTML = ""
  })

  it("steps out of the way for a screenshot", () => {
    expect(pageToolbarHidden(true)).toBe(false)
    pageToolbar(STATE)
    expect(pageToolbarHidden(true)).toBe(true)
    expect(host()!.style.display).toBe("none")
    // A redraw in the middle of a capture keeps it hidden.
    pageToolbar(STATE)
    expect(host()!.style.display).toBe("none")
    pageToolbarHidden(false)
    expect(host()!.style.display).toBe("block")
  })
})

describe("isToolbarMessage", () => {
  it("knows the toolbar's own messages and nothing else", () => {
    expect(isToolbarMessage({ kind: "cognia-toolbar", action: "pick" })).toBe(true)
    expect(isToolbarMessage({ kind: "cognia-toolbar", action: "close" })).toBe(true)
    expect(isToolbarMessage({ kind: "cognia-toolbar", action: "submit" })).toBe(false)
    expect(isToolbarMessage({ kind: "agent-control", action: "pick" })).toBe(false)
    expect(isToolbarMessage(null)).toBe(false)
  })
})
