/**
 * The companion's tools, floating on the page itself (VisBug, UiToolbar):
 * pick, measure, adjust, edit text and screenshot without going back to the
 * side panel for each.
 *
 * It is a remote control, nothing more. A button sends the panel the name of
 * the tool — never page content — and the panel runs the tool exactly as its
 * own button would, so every rule the panel keeps (which tab, what is
 * captured, what the person reviews before sending) still holds. The panel
 * draws it, keeps it current and takes it away when it closes; without the
 * panel there is nothing to act on, so there is no toolbar either.
 *
 * It lives in a closed shadow root marked `data-cognia-chrome`, which the
 * picker, the checks and the bug recorder all leave out, answers only
 * trusted clicks, and is hidden for the moment of every screenshot.
 */

export const TOOLBAR_TOOLS = ["pick", "measure", "adjust", "text", "shot"] as const
export type ToolbarTool = (typeof TOOLBAR_TOOLS)[number]
export type ToolbarAction = ToolbarTool | "close"

export type ToolbarLabel =
  ToolbarAction | "title" | "collapse" | "expand" | "drag" | "minimap" | "minimapHide"

/** What the panel shows on the toolbar; redrawn whenever it changes. */
export interface ToolbarState {
  /** Tooltips and the title, already translated. */
  labels: Record<ToolbarLabel, string>
  /** The tool running now, shown pressed. */
  active: ToolbarTool | null
  /** Tools with nothing to act on, such as adjust before any pick. */
  disabled: ToolbarTool[]
  /** How many of each are in the panel. */
  counts: { pick: number; measure: number }
  /**
   * The tab's browser zoom, 1 at 100%. The toolbar keeps its size on screen
   * whatever the zoom, and the minimap shows itself once the page is zoomed in.
   */
  zoom: number
  /** The picks on this tab, marked on the minimap. */
  marks: string[]
  /**
   * Snap to the window's edges when let go (opt-in): upright, to the nearer
   * side; lying along the top or bottom, to a side or the middle when near it.
   */
  snap: boolean
}

/** What a button sends: the tool, and nothing about the page. */
export interface ToolbarMessage {
  kind: "cognia-toolbar"
  action: ToolbarAction
}

export function isToolbarMessage(value: unknown): value is ToolbarMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "cognia-toolbar" &&
    (["close", ...TOOLBAR_TOOLS] as unknown[]).includes((value as { action?: unknown }).action)
  )
}

export const TOOLBAR_HOST_ID = "__cognia-toolbar"

/**
 * Show or update the toolbar, or take it away (`null`). Isolated world;
 * serialized by `chrome.scripting`, so every helper lives inside the body.
 *
 * The bar stands upright by the side of the page and lies down when it is
 * dragged to the top or bottom edge, docking there. Zoomed in — the
 * browser's zoom or a pinch — it keeps its size on screen and a minimap
 * shows where the visible part is on the whole page (VS Code, Figma): a
 * wireframe of the page's boxes, words and images, the picks marked, and a
 * click or drag on it scrolls there. It can be shown or hidden at any zoom.
 * With snapping on, it glides to the edge it is let go near and stays
 * attached to it as the window and the zoom change.
 *
 * `seam.untrusted` lets a test's synthetic events through. Only the caller
 * can pass it; a page script cannot call into the isolated world.
 */
export function pageToolbar(state: ToolbarState | null, seam?: { untrusted?: boolean }): boolean {
  const HOST_ID = "__cognia-toolbar"
  /** How close to the top or bottom the pointer brings the bar to lie down. */
  const DOCK_IN = 64
  /** How far it must then go back to stand up again. */
  const DOCK_OUT = 110
  /** How close to the middle, or a side when lying down, it is let go to snap there. */
  const MAGNET = 64
  const MARGIN = 12
  const MAP_WIDTH = 148
  /** The tallest the minimap's canvas is drawn; taller pages are scaled down to it. */
  const MAP_LIMIT = 6000
  const MAX_ELEMENTS = 5000
  const MAX_TEXTS = 4000
  type Orientation = "vertical" | "horizontal"
  interface Base {
    canvas: HTMLCanvasElement
    scale: number
    width: number
    height: number
    docWidth: number
    docHeight: number
  }
  interface Own {
    root: ShadowRoot
    bar: HTMLElement
    map: HTMLElement
    collapsed: boolean
    position: { left: number; top: number } | null
    orientation: Orientation
    dock: "top" | "bottom" | null
    /** What it is snapped to across and, upright, down the window; null where it is free. */
    anchorX: "start" | "center" | "end" | null
    anchorY: "center" | null
    /** Whether snapping was on at the last draw, to snap once when it is turned on. */
    snapping: boolean
    /** The person's choice; `auto` shows the minimap only when zoomed in. */
    minimap: "auto" | "on" | "off"
    state: ToolbarState
    base: Base | null
    render: () => void
    snapNow: () => void
    cleanup: () => void
  }
  type Host = HTMLElement & { __cogniaToolbar?: Own }
  const existing = document.getElementById(HOST_ID) as Host | null
  if (!state) {
    existing?.__cogniaToolbar?.cleanup()
    existing?.remove()
    return true
  }
  const ICONS: Record<string, string> = {
    pick: '<path d="M5 3l14 7-6 2-2 6z"/>',
    measure: '<path d="M3 17L17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/>',
    adjust: '<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>',
    text: '<path d="M5 7V5h14v2M12 5v14M9 19h6"/>',
    shot: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    minimap:
      '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="8" y="8" width="8" height="6" rx="1"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    collapse: '<path d="M15 6l-6 6 6 6"/>',
    expand: '<path d="M4 7l4 4-4 4M10 17h10"/>',
    drag: '<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>',
  }
  const CSS =
    ":host{all:initial}" +
    ".bar{position:absolute;display:flex;flex-direction:column;align-items:center;gap:2px;padding:4px;" +
    "background:#111827;border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.28),0 0 0 1px rgba(255,255,255,.06);" +
    "font:500 11px/1 system-ui,-apple-system,sans-serif;color:#e5e7eb;user-select:none;pointer-events:auto}" +
    ".bar.h{flex-direction:row}" +
    "button{all:unset;box-sizing:border-box;position:relative;display:flex;align-items:center;justify-content:center;" +
    "width:34px;height:34px;border-radius:8px;color:#e5e7eb;cursor:pointer;transition:background .12s}" +
    "button:hover{background:rgba(255,255,255,.1)}button:focus-visible{outline:2px solid #60a5fa;outline-offset:1px}" +
    "button[aria-pressed=true]{background:#2563eb;color:#fff}" +
    "button:disabled{opacity:.35;cursor:default;background:none}" +
    "svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}" +
    ".grip{cursor:grab;height:18px;width:34px;display:flex;align-items:center;justify-content:center}" +
    ".grip svg{width:14px;height:14px;fill:currentColor;stroke:none;opacity:.6}" +
    ".grip:active{cursor:grabbing}.h .grip{width:18px;height:34px}.h .grip svg{transform:rotate(90deg)}" +
    ".sep{width:22px;height:1px;background:rgba(255,255,255,.12);margin:3px 0}" +
    ".h .sep{width:1px;height:22px;margin:0 3px}" +
    ".h.bottom [data-name=collapse] svg{transform:rotate(-90deg)}" +
    ".h.top [data-name=collapse] svg{transform:rotate(90deg)}" +
    ".count{position:absolute;top:2px;right:2px;min-width:14px;height:14px;padding:0 3px;box-sizing:border-box;" +
    "border-radius:7px;background:#f59e0b;color:#111827;font:700 9px/14px ui-monospace,monospace;text-align:center}" +
    ".tip{position:absolute;left:calc(100% + 8px);top:50%;transform:translateY(-50%);padding:4px 8px;border-radius:6px;" +
    "background:#111827;color:#fff;white-space:nowrap;font:500 11px/1.3 system-ui,sans-serif;pointer-events:none;" +
    "opacity:0;transition:opacity .12s;box-shadow:0 4px 14px rgba(0,0,0,.25)}" +
    "button:hover .tip,button:focus-visible .tip{opacity:1}" +
    ".bar.snapping{transition:left .22s cubic-bezier(.2,.8,.2,1),top .22s cubic-bezier(.2,.8,.2,1)}" +
    ".right .tip{left:auto;right:calc(100% + 8px)}" +
    ".h .tip,.h.right .tip{left:50%;right:auto;top:auto;bottom:calc(100% + 8px);transform:translateX(-50%)}" +
    ".h.top .tip{bottom:auto;top:calc(100% + 8px)}" +
    ".map{position:absolute;top:12px;right:12px;display:none;flex-direction:column;gap:4px;padding:6px;" +
    "background:#111827;border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.28),0 0 0 1px rgba(255,255,255,.06);" +
    "font:500 11px/1 system-ui,-apple-system,sans-serif;color:#e5e7eb;user-select:none;pointer-events:auto}" +
    ".map.shown{display:flex}" +
    ".map header{display:flex;align-items:center;gap:6px;height:20px;padding-left:2px}" +
    ".map header b{font-weight:600;flex:1}.map header span{color:#9ca3af;font:600 10px/1 ui-monospace,monospace}" +
    ".map button{width:20px;height:20px;border-radius:5px}.map button svg{width:12px;height:12px}" +
    ".map canvas{display:block;border-radius:4px;background:#fff;cursor:pointer;touch-action:none}"

  const trusted = (event: Event) => event.isTrusted || seam?.untrusted === true
  const view = () => {
    const visual = window.visualViewport
    return {
      left: visual ? visual.pageLeft : window.scrollX,
      top: visual ? visual.pageTop : window.scrollY,
      width: visual ? visual.width : window.innerWidth,
      height: visual ? visual.height : window.innerHeight,
      offsetLeft: visual ? visual.offsetLeft : 0,
      offsetTop: visual ? visual.offsetTop : 0,
      scale: visual ? visual.scale : 1,
    }
  }
  /** Screen pixels per CSS pixel the zooms add, undone so the chrome keeps its size. */
  const factor = (own: Own) => {
    const zoom = Number.isFinite(own.state.zoom) && own.state.zoom > 0 ? own.state.zoom : 1
    return zoom * (view().scale || 1)
  }

  let host = existing
  if (!host) {
    const created = document.createElement("div") as Host
    host = created
    created.id = HOST_ID
    created.setAttribute("data-cognia-chrome", "1")
    // Not part of the page while its words are being edited.
    created.setAttribute("contenteditable", "false")
    const root = created.attachShadow({ mode: "closed" })
    const style = document.createElement("style")
    style.textContent = CSS
    const bar = document.createElement("div")
    bar.className = "bar"
    bar.setAttribute("role", "toolbar")
    const map = document.createElement("div")
    map.className = "map"
    root.append(style, map, bar)
    document.documentElement.appendChild(created)

    const own: Own = {
      root,
      bar,
      map,
      collapsed: false,
      position: null,
      orientation: "vertical",
      dock: null,
      anchorX: null,
      anchorY: null,
      snapping: false,
      minimap: "auto",
      state,
      base: null,
      render: () => undefined,
      snapNow: () => undefined,
      cleanup: () => undefined,
    }
    created.__cogniaToolbar = own

    const send = (action: string) => {
      try {
        void chrome.runtime.sendMessage({ kind: "cognia-toolbar", action }).catch(() => undefined)
      } catch {
        // The extension reloaded under the page: nothing listens any more.
      }
    }
    const icon = (name: string) =>
      `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] ?? ""}</svg>`
    const button = (name: string, label: string, onPress: () => void, tip = true) => {
      const element = document.createElement("button")
      element.type = "button"
      element.dataset.name = name
      element.setAttribute("aria-label", label)
      element.innerHTML = icon(name)
      if (tip) {
        const text = document.createElement("span")
        text.className = "tip"
        text.textContent = label
        element.appendChild(text)
      } else element.title = label
      element.addEventListener("click", (event) => {
        // A page script cannot press the panel's buttons.
        if (!trusted(event)) return
        event.preventDefault()
        event.stopPropagation()
        onPress()
      })
      return element
    }

    // The space the chrome lays itself out in: the visible part of the page,
    // in the chrome's own pixels, which stay the screen's size at any zoom.
    const space = () => {
      const current = view()
      const scale = factor(own)
      return { width: current.width * scale, height: current.height * scale, scale, current }
    }
    const frame = () => {
      const { width, height, scale, current } = space()
      created.style.cssText =
        "all:initial;position:fixed;left:0;top:0;pointer-events:none;z-index:2147483647;display:block;" +
        `width:${width}px;height:${height}px;transform-origin:0 0;` +
        (scale === 1 && current.offsetLeft === 0 && current.offsetTop === 0
          ? ""
          : `transform:translate(${current.offsetLeft}px,${current.offsetTop}px) scale(${1 / scale});`) +
        (created.dataset.hidden === "1" ? "display:none;" : "")
      created.dataset.orientation = own.orientation
    }
    /** A pointer's place in the chrome's pixels. */
    const local = (event: { clientX: number; clientY: number }) => {
      const { scale, current } = space()
      return {
        x: (event.clientX - current.offsetLeft) * scale,
        y: (event.clientY - current.offsetTop) * scale,
      }
    }

    const place = () => {
      const { width: spaceWidth, height: spaceHeight } = space()
      const horizontal = own.orientation === "horizontal"
      // Turned before it is measured: the size is the new orientation's.
      own.bar.classList.toggle("h", horizontal)
      own.bar.classList.toggle("top", own.dock === "top")
      own.bar.classList.toggle("bottom", own.dock === "bottom")
      const width = own.bar.offsetWidth || (horizontal ? 330 : 42)
      const height = own.bar.offsetHeight || (horizontal ? 42 : 330)
      const position = own.position ?? {
        left: MARGIN,
        top: Math.max(MARGIN, Math.round((spaceHeight - height) / 2)),
      }
      const wantedLeft =
        own.anchorX === "start"
          ? MARGIN
          : own.anchorX === "end"
            ? spaceWidth - width - MARGIN
            : own.anchorX === "center"
              ? Math.round((spaceWidth - width) / 2)
              : position.left
      const left = Math.max(4, Math.min(spaceWidth - width - 4, wantedLeft))
      const top =
        own.dock === "bottom"
          ? spaceHeight - height - MARGIN
          : own.dock === "top"
            ? MARGIN
            : own.anchorY === "center"
              ? Math.max(4, Math.round((spaceHeight - height) / 2))
              : Math.max(4, Math.min(spaceHeight - height - 4, position.top))
      own.bar.style.left = `${Math.max(0, left)}px`
      own.bar.style.top = `${Math.max(0, top)}px`
      // Tooltips open toward the page, away from the edge it sits on.
      own.bar.classList.toggle("right", left > spaceWidth / 2)
      created.dataset.anchor = [own.anchorX, own.anchorY].filter(Boolean).join(" ")
    }

    /** Let go with snapping on: glide to the edge, or the middle, it is near. */
    const snap = () => {
      const { width: spaceWidth, height: spaceHeight } = space()
      const width = own.bar.offsetWidth || (own.orientation === "horizontal" ? 330 : 42)
      const height = own.bar.offsetHeight || (own.orientation === "horizontal" ? 42 : 330)
      const left = Number.parseFloat(own.bar.style.left) || 0
      const top = Number.parseFloat(own.bar.style.top) || 0
      own.position = { left, top }
      if (own.orientation === "vertical") {
        own.anchorX = left + width / 2 < spaceWidth / 2 ? "start" : "end"
        own.anchorY = Math.abs(top + height / 2 - spaceHeight / 2) < MAGNET ? "center" : null
      } else {
        own.anchorY = null
        own.anchorX =
          Math.abs(left + width / 2 - spaceWidth / 2) < MAGNET
            ? "center"
            : left < MARGIN + MAGNET
              ? "start"
              : spaceWidth - (left + width) < MARGIN + MAGNET
                ? "end"
                : null
      }
      own.bar.classList.add("snapping")
      place()
      window.setTimeout(() => own.bar.classList.remove("snapping"), 260)
    }

    // The minimap: a wireframe of the whole page, drawn once into a canvas of
    // its own and redrawn when the page changes; the visible part is boxed
    // over it as the page scrolls.
    const mapCanvas = document.createElement("canvas")
    const zoomText = document.createElement("span")
    const mapTitle = document.createElement("b")
    const mapHeader = document.createElement("header")
    const hideMap = button(
      "close",
      own.state.labels.minimapHide,
      () => {
        own.minimap = "off"
        own.render()
      },
      false
    )
    mapHeader.append(mapTitle, zoomText, hideMap)
    map.append(mapHeader, mapCanvas)
    map.setAttribute("role", "region")

    const page = () => {
      const doc = document.documentElement
      const body = document.body
      const { width, height } = view()
      return {
        width: Math.max(doc.scrollWidth, body?.scrollWidth ?? 0, Math.ceil(width)),
        height: Math.max(doc.scrollHeight, body?.scrollHeight ?? 0, Math.ceil(height)),
      }
    }
    const zoomed = () => factor(own) > 1.01
    // Screen pixels per pixel of the chrome, which the zooms leave at the
    // screen's own ratio: what the canvases are drawn at to stay sharp.
    const crisp = () => {
      const zoom = Number.isFinite(own.state.zoom) && own.state.zoom > 0 ? own.state.zoom : 1
      return Math.max(1, Math.min(3, (window.devicePixelRatio || 1) / zoom))
    }
    const mapShown = () => {
      if (own.collapsed || own.minimap === "off") return false
      if (own.minimap === "on") return true
      if (!zoomed()) return false
      // Zoomed in on a page that all fits: nothing to find the way around.
      const size = page()
      const current = view()
      return size.width > current.width + 1 || size.height > current.height + 1
    }
    const opaque = (color: string) =>
      color !== "" && color !== "transparent" && !/rgba\([^)]*,\s*0\)$/.test(color)

    const drawBase = (): Base | null => {
      const size = page()
      let scale = MAP_WIDTH / size.width
      if (size.height * scale > MAP_LIMIT) scale = MAP_LIMIT / size.height
      const width = Math.max(1, Math.round(size.width * scale))
      const height = Math.max(1, Math.round(size.height * scale))
      const dpr = crisp()
      const canvas = document.createElement("canvas")
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      const context = canvas.getContext("2d")
      const base = { canvas, scale, width, height, docWidth: size.width, docHeight: size.height }
      if (!context) return base
      context.scale(dpr * scale, dpr * scale)
      const pageStyle = getComputedStyle(document.body ?? document.documentElement)
      context.fillStyle = opaque(pageStyle.backgroundColor)
        ? pageStyle.backgroundColor
        : opaque(getComputedStyle(document.documentElement).backgroundColor)
          ? getComputedStyle(document.documentElement).backgroundColor
          : "#ffffff"
      context.fillRect(0, 0, size.width, size.height)
      const scrollX = window.scrollX
      const scrollY = window.scrollY
      const line = 1 / scale
      let texts = 0
      const elements = document.body ? document.body.querySelectorAll("*") : []
      for (let index = 0; index < Math.min(elements.length, MAX_ELEMENTS); index++) {
        const element = elements[index]!
        if (element.closest("[data-cognia-chrome]")) continue
        if (element instanceof SVGElement && element.tagName.toLowerCase() !== "svg") continue
        const rect = element.getBoundingClientRect()
        if (rect.width < 1 || rect.height < 1) continue
        const style = getComputedStyle(element)
        if (style.visibility === "hidden" || style.opacity === "0") continue
        const x = rect.left + scrollX
        const y = rect.top + scrollY
        if (/^(IMG|VIDEO|CANVAS|PICTURE|IFRAME|EMBED|OBJECT|svg)$/.test(element.tagName)) {
          context.fillStyle = "rgba(148,163,184,.55)"
          context.fillRect(x, y, rect.width, rect.height)
          continue
        }
        if (opaque(style.backgroundColor)) {
          context.fillStyle = style.backgroundColor
          context.fillRect(x, y, rect.width, rect.height)
        }
        if (style.backgroundImage !== "none") {
          context.fillStyle = "rgba(148,163,184,.4)"
          context.fillRect(x, y, rect.width, rect.height)
        }
        if (Number.parseFloat(style.borderTopWidth) > 0 && opaque(style.borderTopColor)) {
          context.strokeStyle = style.borderTopColor
          context.lineWidth = line
          context.strokeRect(x, y, rect.width, rect.height)
        }
        if (texts >= MAX_TEXTS) continue
        for (const child of element.childNodes) {
          if (child.nodeType !== Node.TEXT_NODE || !child.textContent?.trim()) continue
          texts++
          const range = document.createRange()
          range.selectNodeContents(child)
          context.fillStyle = style.color
          context.globalAlpha = 0.45
          for (const box of range.getClientRects()) {
            if (box.width < 1) continue
            // A line of words reads as a bar the height of its letters.
            context.fillRect(
              box.left + scrollX,
              box.top + scrollY + box.height * 0.25,
              box.width,
              Math.max(line, box.height * 0.5)
            )
          }
          context.globalAlpha = 1
        }
      }
      return base
    }

    let frameRequest = 0
    let baseTimer = 0
    /** Where on the page the canvas starts, while a drag holds it still. */
    let heldOffset: number | null = null
    const offsetOf = (base: Base, shown: number) => {
      if (heldOffset !== null) return heldOffset
      const current = view()
      if (base.height <= shown) return 0
      const travel = Math.max(1, base.docHeight - current.height)
      return Math.max(
        0,
        Math.min(base.height - shown, (base.height - shown) * (current.top / travel))
      )
    }
    const drawMap = () => {
      frameRequest = 0
      if (!map.classList.contains("shown")) return
      const size = page()
      if (!own.base || own.base.docWidth !== size.width || own.base.docHeight !== size.height)
        own.base = drawBase()
      const base = own.base
      if (!base) return
      const { height: spaceHeight, scale: zoom } = space()
      const shown = Math.max(40, Math.min(base.height, 280, spaceHeight * 0.45))
      const dpr = crisp()
      mapCanvas.width = Math.round(base.width * dpr)
      mapCanvas.height = Math.round(shown * dpr)
      mapCanvas.style.width = `${base.width}px`
      mapCanvas.style.height = `${shown}px`
      zoomText.textContent = zoom > 1.01 || zoom < 0.99 ? `${Math.round(zoom * 100)}%` : ""
      const context = mapCanvas.getContext("2d")
      if (!context) return
      const offset = offsetOf(base, shown)
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      context.clearRect(0, 0, base.width, shown)
      if (base.canvas.width > 0 && base.canvas.height > 0)
        context.drawImage(
          base.canvas,
          0,
          (offset * base.canvas.height) / base.height,
          base.canvas.width,
          (shown * base.canvas.height) / base.height,
          0,
          0,
          base.width,
          shown
        )
      // The picks, where they are now.
      const picker = (
        globalThis as {
          __cogniaPicker?: {
            boxes?: (ids: string[]) => { x: number; y: number; width: number; height: number }[]
          }
        }
      ).__cogniaPicker
      const marks = own.state.marks.length > 0 ? (picker?.boxes?.(own.state.marks) ?? []) : []
      context.strokeStyle = "#f59e0b"
      context.fillStyle = "rgba(245,158,11,.35)"
      context.lineWidth = 1.5
      for (const mark of marks) {
        const x = mark.x * base.scale
        const y = mark.y * base.scale - offset
        const width = Math.max(3, mark.width * base.scale)
        const height = Math.max(3, mark.height * base.scale)
        context.fillRect(x, y, width, height)
        context.strokeRect(x, y, width, height)
      }
      // The rest of the page dimmed; the visible part boxed.
      const current = view()
      const box = {
        x: current.left * base.scale,
        y: current.top * base.scale - offset,
        width: Math.max(4, current.width * base.scale),
        height: Math.max(4, current.height * base.scale),
      }
      context.fillStyle = "rgba(15,23,42,.28)"
      context.beginPath()
      context.rect(0, 0, base.width, shown)
      context.rect(box.x, box.y, box.width, box.height)
      context.fill("evenodd")
      context.strokeStyle = "#2563eb"
      context.lineWidth = 1.5
      context.strokeRect(box.x + 0.75, box.y + 0.75, box.width - 1.5, box.height - 1.5)
    }
    const requestFrame = () => {
      if (frameRequest || !map.classList.contains("shown")) return
      frameRequest =
        typeof window.requestAnimationFrame === "function"
          ? window.requestAnimationFrame(drawMap)
          : window.setTimeout(drawMap, 16)
    }
    /** The page changed under the map: drawn again once it settles. */
    const staleBase = () => {
      if (!map.classList.contains("shown")) return
      window.clearTimeout(baseTimer)
      baseTimer = window.setTimeout(() => {
        own.base = null
        requestFrame()
      }, 500)
    }
    const showMap = () => {
      const shown = mapShown()
      const was = map.classList.contains("shown")
      map.classList.toggle("shown", shown)
      mapTitle.textContent = own.state.labels.minimap
      map.setAttribute("aria-label", own.state.labels.minimap)
      hideMap.setAttribute("aria-label", own.state.labels.minimapHide)
      hideMap.title = own.state.labels.minimapHide
      created.dataset.minimap = shown ? "shown" : "hidden"
      // Drawn at once when it appears, never shown empty or at a canvas's
      // default size; after that, on the next frame.
      if (shown && !was) {
        own.base = null
        drawMap()
      } else if (shown) requestFrame()
    }
    const scrollFromMap = (event: PointerEvent) => {
      const base = own.base
      if (!base) return
      const rect = mapCanvas.getBoundingClientRect()
      const shownHeight = Number.parseFloat(mapCanvas.style.height) || 0
      if (rect.width <= 0 || rect.height <= 0) return
      const x = ((event.clientX - rect.left) / rect.width) * base.width
      const y = ((event.clientY - rect.top) / rect.height) * shownHeight
      const offset = offsetOf(base, shownHeight)
      const current = view()
      window.scrollTo({
        left: Math.max(0, x / base.scale - current.width / 2),
        top: Math.max(0, (y + offset) / base.scale - current.height / 2),
        behavior: "instant" as ScrollBehavior,
      })
    }
    mapCanvas.addEventListener("pointerdown", (event) => {
      if (!trusted(event)) return
      if (!own.base) drawMap()
      if (!own.base) return
      event.preventDefault()
      const shownHeight = Number.parseFloat(mapCanvas.style.height) || 0
      // The canvas holds still under the pointer while it drags.
      heldOffset = offsetOf(own.base, shownHeight)
      scrollFromMap(event)
      const move = (next: PointerEvent) => scrollFromMap(next)
      const up = () => {
        heldOffset = null
        window.removeEventListener("pointermove", move, true)
        window.removeEventListener("pointerup", up, true)
        requestFrame()
      }
      window.addEventListener("pointermove", move, true)
      window.addEventListener("pointerup", up, true)
    })

    const render = () => {
      const current = own.state
      frame()
      bar.replaceChildren()
      bar.setAttribute("aria-label", current.labels.title)
      const grip = document.createElement("div")
      grip.className = "grip"
      grip.innerHTML = icon("drag")
      grip.title = current.labels.drag
      grip.addEventListener("pointerdown", (event) => {
        if (!trusted(event)) return
        event.preventDefault()
        const start = local(event)
        // Free while it moves; snapped again, if asked, once let go.
        own.anchorX = null
        own.anchorY = null
        own.bar.classList.remove("snapping")
        let dx = start.x - (Number.parseFloat(bar.style.left) || 0)
        let dy = start.y - (Number.parseFloat(bar.style.top) || 0)
        const move = (next: PointerEvent) => {
          const at = local(next)
          const { height } = space()
          const nearEdge = Math.min(at.y, height - at.y)
          const lying = own.orientation === "horizontal" ? nearEdge < DOCK_OUT : nearEdge < DOCK_IN
          const orientation: Orientation = lying ? "horizontal" : "vertical"
          if (orientation !== own.orientation) {
            own.orientation = orientation
            // The grip stays under the pointer as the bar turns.
            dx = orientation === "horizontal" ? 13 : 21
            dy = orientation === "horizontal" ? 21 : 13
          }
          own.dock = lying ? (at.y > height / 2 ? "bottom" : "top") : null
          own.position = { left: at.x - dx, top: at.y - dy }
          if (bar.classList.contains("h") !== lying) render()
          else place()
        }
        const up = () => {
          window.removeEventListener("pointermove", move, true)
          window.removeEventListener("pointerup", up, true)
          if (own.state.snap) snap()
        }
        window.addEventListener("pointermove", move, true)
        window.addEventListener("pointerup", up, true)
      })
      bar.appendChild(grip)
      if (own.collapsed) {
        bar.appendChild(
          button("expand", current.labels.expand, () => {
            own.collapsed = false
            render()
          })
        )
        place()
        showMap()
        return
      }
      for (const tool of ["pick", "measure", "adjust", "text", "shot"] as const) {
        const element = button(tool, current.labels[tool], () => send(tool))
        element.setAttribute("aria-pressed", String(current.active === tool))
        element.disabled = current.disabled.includes(tool)
        const count = tool === "pick" || tool === "measure" ? current.counts[tool] : 0
        if (count > 0) {
          const badge = document.createElement("span")
          badge.className = "count"
          badge.textContent = String(count)
          element.appendChild(badge)
        }
        bar.appendChild(element)
      }
      const sep = document.createElement("div")
      sep.className = "sep"
      const mapToggle = button("minimap", current.labels.minimap, () => {
        own.minimap = mapShown() ? "off" : "on"
        render()
      })
      mapToggle.setAttribute("aria-pressed", String(mapShown()))
      bar.append(
        sep,
        mapToggle,
        button("collapse", current.labels.collapse, () => {
          own.collapsed = true
          render()
        }),
        button("close", current.labels.close, () => send("close"))
      )
      place()
      showMap()
    }
    own.render = render
    own.snapNow = snap

    // Kept on screen and to scale as the window, the zoom and the page change.
    const onResize = () => render()
    const onScroll = () => requestFrame()
    const onVisual = () => {
      frame()
      place()
      showMap()
      requestFrame()
    }
    window.addEventListener("resize", onResize)
    window.addEventListener("scroll", onScroll, { passive: true, capture: true })
    window.visualViewport?.addEventListener("resize", onVisual)
    window.visualViewport?.addEventListener("scroll", onVisual)
    const observer =
      typeof MutationObserver === "function"
        ? new MutationObserver((records) => {
            if (records.some((record) => record.target !== created)) staleBase()
          })
        : null
    observer?.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    })
    own.cleanup = () => {
      window.removeEventListener("resize", onResize)
      window.removeEventListener("scroll", onScroll, { capture: true })
      window.visualViewport?.removeEventListener("resize", onVisual)
      window.visualViewport?.removeEventListener("scroll", onVisual)
      observer?.disconnect()
      window.clearTimeout(baseTimer)
      if (frameRequest && typeof window.cancelAnimationFrame === "function")
        window.cancelAnimationFrame(frameRequest)
    }
  }
  const own = host.__cogniaToolbar
  if (!own) return false
  own.state = state
  own.render()
  // Turned on with the bar where it is: it snaps from there.
  if (state.snap && !own.snapping) own.snapNow()
  own.snapping = state.snap
  return true
}

/**
 * Hide the toolbar for the moment of a screenshot, and show it again; false
 * when there is none. Isolated world; serialized by `chrome.scripting`.
 */
export function pageToolbarHidden(hidden: boolean): boolean {
  const host = document.getElementById("__cognia-toolbar")
  if (!host) return false
  // Remembered, so a redraw in the middle of a full-page capture keeps it hidden.
  host.dataset.hidden = hidden ? "1" : ""
  host.style.display = hidden ? "none" : "block"
  return true
}
