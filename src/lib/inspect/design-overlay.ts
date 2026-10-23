/**
 * A design mock laid over the live page, for checking the build against it
 * (PerfectPixel).
 *
 * The image sits in the document's own coordinates, so it scrolls with the
 * page, never takes a click (`pointer-events: none`) and lives in a closed
 * shadow root marked `data-cognia-chrome`. "Difference" blends it with the
 * page so that what matches turns black and every misaligned pixel shows.
 * A visible-area screenshot taken while it is on the page carries it, which
 * is how a comparison reaches the agent.
 */

export interface DesignOverlayState {
  /**
   * The mock as a data URL, or `null` to keep the one already on the page —
   * an opacity drag must not ship megabytes into the tab on every step.
   */
  image: string | null
  /** 0–1. */
  opacity: number
  /** Offset from the document's top-left, CSS pixels. */
  x: number
  y: number
  /** CSS pixels per image pixel: 1 for a 1x export, 0.5 for a 2x one. */
  scale: number
  difference: boolean
  visible: boolean
}

export const DESIGN_OVERLAY_MAX_BYTES = 10 * 1024 * 1024

/** Show, update or remove the overlay. Isolated world; serialized by `chrome.scripting`. */
export function pageDesignOverlay(state: DesignOverlayState | null): boolean {
  const HOST_ID = "__cognia-design-overlay"
  type Host = HTMLElement & { __cogniaImage?: HTMLImageElement }
  const existing = document.getElementById(HOST_ID) as Host | null
  if (!state) {
    existing?.remove()
    return true
  }
  let host = existing
  if (!host) {
    if (!state.image) return false
    host = document.createElement("div") as Host
    host.id = HOST_ID
    host.setAttribute("data-cognia-chrome", "1")
    const root = host.attachShadow({ mode: "closed" })
    const image = document.createElement("img")
    image.alt = ""
    image.draggable = false
    image.style.cssText = "position:absolute;left:0;top:0;max-width:none;user-select:none;"
    root.appendChild(image)
    host.__cogniaImage = image
    document.documentElement.appendChild(host)
  }
  const image = host.__cogniaImage
  if (!image) return false
  const size = () => {
    if (image.naturalWidth > 0) image.style.width = `${image.naturalWidth * state.scale}px`
  }
  if (state.image) {
    image.onload = size
    image.src = state.image
  }
  size()
  const opacity = Math.min(1, Math.max(0, state.opacity))
  // `all: initial` first, so nothing the page styles on a bare div reaches it;
  // the blend is on the host, the one box that composites with the page.
  host.style.cssText =
    "all:initial;position:absolute;left:0;top:0;pointer-events:none;z-index:2147483646;" +
    `opacity:${opacity};transform:translate(${Math.round(state.x)}px,${Math.round(state.y)}px);` +
    `mix-blend-mode:${state.difference ? "difference" : "normal"};` +
    `display:${state.visible ? "block" : "none"};`
  return true
}

export interface PageView {
  scrollX: number
  scrollY: number
  /** The window's inner size, which is what a visible-area capture covers. */
  width: number
  height: number
}

/**
 * Where the page is scrolled and how big its window is, once two frames have
 * painted — so a capture taken next shows what was just changed, such as the
 * overlay hidden. Isolated world; serialized by `chrome.scripting`.
 */
export function pageViewAfterPaint(): Promise<PageView> {
  return new Promise((resolve) => {
    const answer = () =>
      resolve({
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        width: window.innerWidth,
        height: window.innerHeight,
      })
    // A tab in the background paints nothing; the fallback answers anyway.
    const fallback = setTimeout(answer, 250)
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        clearTimeout(fallback)
        answer()
      })
    )
  })
}

/** Exports come at these densities; the overlay shows them at CSS size. */
export const OVERLAY_SCALES = [1, 0.5, 1 / 3] as const

/** Sizes for a responsive check (Responsive Viewer), as viewport CSS pixels. */
export const VIEWPORT_PRESETS = [
  { id: "mobile", width: 390, height: 844 },
  { id: "tablet", width: 820, height: 1180 },
  { id: "laptop", width: 1280, height: 800 },
  { id: "desktop", width: 1440, height: 900 },
] as const

export type ViewportPresetId = (typeof VIEWPORT_PRESETS)[number]["id"]
