/** @jest-environment <rootDir>/testing/jsdom-environment.cjs */
import { pageDesignOverlay, type DesignOverlayState } from "./design-overlay"

const STATE: DesignOverlayState = {
  image: "data:image/png;base64,iVBORw0KGgo=",
  opacity: 0.4,
  x: 12.4,
  y: -3,
  scale: 0.5,
  difference: true,
  visible: true,
}

const host = () => document.getElementById("__cognia-design-overlay")

afterEach(() => {
  host()?.remove()
})

describe("pageDesignOverlay", () => {
  it("lays the mock over the page, out of the page's reach and clicks", () => {
    expect(pageDesignOverlay(STATE)).toBe(true)
    const node = host()!
    expect(node.getAttribute("data-cognia-chrome")).toBe("1")
    // Closed: the page's scripts cannot reach in.
    expect(node.shadowRoot).toBeNull()
    expect(node.style.pointerEvents).toBe("none")
    expect(node.style.opacity).toBe("0.4")
    expect(node.style.transform).toBe("translate(12px,-3px)")
    expect(node.style.mixBlendMode).toBe("difference")
  })

  it("updates in place without the image, and hides and removes on request", () => {
    pageDesignOverlay(STATE)
    expect(pageDesignOverlay({ ...STATE, image: null, opacity: 1, visible: false })).toBe(true)
    expect(document.querySelectorAll("#__cognia-design-overlay")).toHaveLength(1)
    expect(host()!.style.display).toBe("none")
    expect(pageDesignOverlay(null)).toBe(true)
    expect(host()).toBeNull()
  })

  it("cannot start without an image", () => {
    expect(pageDesignOverlay({ ...STATE, image: null })).toBe(false)
    expect(host()).toBeNull()
  })
})
