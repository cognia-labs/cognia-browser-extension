import "@testing-library/jest-dom"
import { configure as configureTestingLibrary } from "@testing-library/dom"

configureTestingLibrary({ asyncUtilTimeout: 5000 })

if (typeof window !== "undefined") {
  // jsdom omits `window.matchMedia` — provide a default (non-matching) stub so
  // viewport hooks render their desktop branch unless a test overrides it.
  if (typeof window.matchMedia !== "function") {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: (query: string) =>
        ({
          matches: false,
          media: query,
          onchange: null,
          addListener: () => {},
          removeListener: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => false,
        }) as unknown as MediaQueryList,
    })
  }

  class MockResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  if (typeof globalThis.ResizeObserver === "undefined") {
    ;(globalThis as unknown as { ResizeObserver: typeof MockResizeObserver }).ResizeObserver =
      MockResizeObserver
  }
  if (typeof (window as unknown as { ResizeObserver?: unknown }).ResizeObserver === "undefined") {
    ;(window as unknown as { ResizeObserver: typeof MockResizeObserver }).ResizeObserver =
      MockResizeObserver
  }

  class MockIntersectionObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [] as unknown[]
    }
    root = null
    rootMargin = ""
    thresholds: number[] = []
  }

  if (typeof globalThis.IntersectionObserver === "undefined") {
    ;(
      globalThis as unknown as {
        IntersectionObserver: typeof MockIntersectionObserver
      }
    ).IntersectionObserver = MockIntersectionObserver
  }
  if (
    typeof (window as unknown as { IntersectionObserver?: unknown }).IntersectionObserver ===
    "undefined"
  ) {
    ;(
      window as unknown as {
        IntersectionObserver: typeof MockIntersectionObserver
      }
    ).IntersectionObserver = MockIntersectionObserver
  }

  // Radix primitives call methods that jsdom does not implement.
  if (typeof Element.prototype.hasPointerCapture !== "function") {
    Element.prototype.hasPointerCapture = function () {
      return false
    }
  }
  if (typeof Element.prototype.releasePointerCapture !== "function") {
    Element.prototype.releasePointerCapture = function () {}
  }
  if (typeof Element.prototype.setPointerCapture !== "function") {
    Element.prototype.setPointerCapture = function () {}
  }

  // jsdom ships no `PointerEvent`. Without it `fireEvent.pointerDown(el, {
  // clientX, button, pointerId })` falls back to a bare `Event` and SILENTLY
  // DROPS every init field — `clientX` reads `undefined`, so any drag/brush
  // handler computes NaN and the test fails for a reason that has nothing to do
  // with the component. Subclassing MouseEvent keeps the coordinate and button
  // fields and adds the pointer ones.
  if (typeof (window as unknown as { PointerEvent?: unknown }).PointerEvent !== "function") {
    class PointerEventPolyfill extends MouseEvent {
      readonly pointerId: number
      readonly pointerType: string
      readonly isPrimary: boolean
      readonly width: number
      readonly height: number
      readonly pressure: number

      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init)
        this.pointerId = init.pointerId ?? 0
        this.pointerType = init.pointerType ?? "mouse"
        this.isPrimary = init.isPrimary ?? true
        this.width = init.width ?? 1
        this.height = init.height ?? 1
        this.pressure = init.pressure ?? 0
      }
    }
    ;(window as unknown as { PointerEvent: unknown }).PointerEvent = PointerEventPolyfill
    ;(globalThis as unknown as { PointerEvent: unknown }).PointerEvent = PointerEventPolyfill
  }
  if (typeof Element.prototype.scrollIntoView !== "function") {
    Element.prototype.scrollIntoView = function () {}
  }

  if (typeof (window as { structuredClone?: unknown }).structuredClone !== "function") {
    ;(window as unknown as { structuredClone: typeof structuredClone }).structuredClone = (
      globalThis as { structuredClone: typeof structuredClone }
    ).structuredClone
  }
}
