/**
 * The element picker, as it runs in a tab's isolated world.
 *
 * Injected per use as `/element-picker.js` — like the capture, no static
 * content script ever runs — and kept for the life of the document, because
 * the picks it hands out are handles to its own elements: the panel later asks
 * it to preview an edit, put an element back the way it was, or find it again
 * for a screenshot.
 *
 * Picking is the person's act in the page. Only trusted pointer and key events
 * move or confirm the highlight, the page sees none of the clicks it takes
 * (they are cancelled in the capture phase), and the overlay lives in a closed
 * shadow root marked `data-cognia-chrome` so neither the page's styles nor the
 * agent's snapshot can reach it. A pick that nobody completes ends by itself.
 */
import {
  describeElement,
  elementLabel,
  uniqueSelector,
  type ElementBox,
  type ElementDescription,
  type ElementEdits,
} from "./element-context"
import { auditDocument, textContrast, type A11yAudit } from "./a11y-audit"
import { collectDesignTokens, type DesignTokens } from "./design-tokens"
import { checkSeo, type SeoReport } from "./seo-check"
import { checkLayout, type LayoutCheck } from "./layout-check"
import { startTextEditing, type TextChange, type TextEditSession } from "./text-edits"
import { PROBE_ATTRIBUTE } from "./framework-source"
import { measureBoxes, measureGuides, type MeasuredElement, type MeasureResult } from "./measure"
import { POINTING_ATTRIBUTE } from "./interaction-recorder"
import { alikeElements, elementsInBox } from "./multi-select"
import { checkFocusOrder, type FocusCheck } from "./focus-order"
import {
  adjustChanges,
  adjustStatus,
  isNudgeKey,
  nudge,
  resize,
  resizeZone,
  type AdjustSpacing,
  type AdjustState,
  type ResizeZone,
  type Sides,
} from "./adjust"
import { elementMarkup } from "./element-markup"
import { createColorReader } from "./page-colors"
import { sanitizeEdits } from "./style-edits"

export interface PickOptions {
  /** The hint shown at the top of the page, already translated. */
  hint: string
  timeoutMs: number
}

/**
 * A picked element, stamped for the main-world read; `more` when the person
 * held Shift, asking to keep picking.
 */
export type PickResult = (ElementDescription & { probeToken: string; more?: boolean }) | null

export interface PickManyOptions {
  /** The hint shown at the top of the page, already translated. */
  hint: string
  /** Shown once something is chosen; `{n}` is replaced by how many. */
  selectedHint: string
  /** The button that adds what is chosen. */
  doneLabel: string
  timeoutMs: number
  /** How many may be chosen: the room left in the panel's list. */
  max: number
}

export interface MeasureOptions {
  /** Shown until the first element is chosen, already translated. */
  hint: string
  /** Shown once it is, while the person points at the second. */
  anchorHint: string
  timeoutMs: number
  /** Measure from an element this picker holds, as Shift-click asks to keep doing. */
  anchorId?: string
}

export interface AdjustOptions {
  elementId: string
  /** How to adjust, shown at the top of the page, already translated. */
  hint: string
  /** What to call margin and padding in the status line. */
  labels: Record<AdjustSpacing, string>
  timeoutMs: number
}

/** The style edits an adjustment made; `null` when cancelled or the element left. */
export type AdjustResult = Record<string, string> | null

export interface ElementPicker {
  /** Wait for the person to pick an element; `null` when they cancel or time out. */
  pick(options: PickOptions): Promise<PickResult>
  /**
   * Let the person choose one element or several: a click takes one;
   * Shift-, ⌘- or Ctrl-click adds or removes, Alt-click takes every one
   * alike, and a box dragged over the page takes what is inside it — then
   * Enter, the Done button or a plain click adds them. In the order chosen;
   * `null` when they cancel. Running out of time keeps what was chosen.
   */
  pickMany(options: PickManyOptions): Promise<NonNullable<PickResult>[] | null>
  /** End a pick in progress, as if Escape were pressed. */
  cancel(): boolean
  /** Preview edits on a picked element, replacing any previewed before. */
  apply(elementId: string, edits: ElementEdits): boolean
  /** Put a picked element back the way the page had it. */
  revert(elementId: string): boolean
  /** Scroll a picked element into view, flashing it unless it is about to be shot. */
  locate(elementId: string, flash?: boolean): (ElementBox & { dpr: number }) | null
  /** Where held elements are now, in document CSS pixels; the ones that left are skipped. */
  boxes(elementIds: string[]): ElementBox[]
  /** Stamp a picked element for the main-world framework read. */
  probe(elementId: string): string | null
  /** Revert and forget picks; all of them when no ids are given. */
  release(elementIds?: string[]): void
  /** Describe an element this picker already holds (an audit finding), stamped like a pick. */
  describe(elementId: string): PickResult
  /** Run the accessibility checks; findings are held like picks. */
  audit(): Pick<A11yAudit, "issues" | "checked" | "truncated">
  /** Count the design tokens the page uses. */
  tokens(): Omit<DesignTokens, "tabId" | "ranAt">
  /** Read how the page presents itself to search engines and link previews. */
  seo(): Omit<SeoReport, "tabId" | "ranAt">
  /** Look for layout bugs at this viewport; findings are held like picks. */
  layout(): Omit<LayoutCheck, "tabId" | "ranAt">
  /** Check the keyboard's Tab order, and number its stops on the page. */
  focusOrder(): Omit<FocusCheck, "tabId" | "ranAt">
  /** Number the last Tab order checked on the page again, or take the numbers away. */
  showFocusOrder(show: boolean): boolean
  /** Make the page's words editable in place, with `hint` shown at the top; false when already editing. */
  editText(hint: string): boolean
  /** Whether the page's words are being edited. */
  isEditingText(): boolean
  /** Leave text editing, keeping the edits or unwinding them; what changed, when kept. */
  stopEditingText(keep: boolean): TextChange[]
  /**
   * Let the person measure between two elements: the first click anchors,
   * the pointer shows distances, the second click answers. `null` when they
   * cancel or time out.
   */
  measure(options: MeasureOptions): Promise<MeasureResult>
  /**
   * Show a measurement again, measured as the page lays it out now — after a
   * previewed edit, the numbers are the edit's. `null` when either element left.
   */
  showMeasurement(fromId: string, toId: string): MeasureResult
  /**
   * Let the person resize a held element by its edges and nudge its spacing
   * with the arrow keys, live. Enter (or {@link ElementPicker.finishAdjust})
   * answers what changed; Escape, `cancel` or a newer pass puts the element
   * back as it was and answers `null`. Running out of time keeps the work.
   */
  adjust(options: AdjustOptions): Promise<AdjustResult>
  /** Finish an adjustment in progress, keeping what it changed. */
  finishAdjust(): boolean
}

declare global {
  var __cogniaPicker: ElementPicker | undefined
}

interface Held {
  element: Element
  /** The inline style the page had, before any preview. */
  style: string | null
  /** The text the page had, when the element is a leaf a text edit may replace. */
  text: string | null
  applied: boolean
}

const HOST_ID = "__cognia-element-picker"
const FOCUS_HOST_ID = "__cognia-focus-order"
const OVERLAY_CSS =
  ":host{all:initial}.layer{position:fixed;inset:0;pointer-events:none;z-index:2147483647}" +
  ".margin,.box,.padding{position:fixed;box-sizing:border-box;pointer-events:none}" +
  ".margin{background:rgba(246,178,107,.28)}.box{outline:2px solid #2563eb;background:rgba(37,99,235,.08)}" +
  ".padding{background:rgba(147,196,125,.30)}" +
  ".tag{position:fixed;padding:2px 6px;border-radius:4px;background:#1e3a8a;color:#fff;" +
  "font:500 11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap;max-width:60vw;" +
  "overflow:hidden;text-overflow:ellipsis}" +
  ".hint{position:fixed;top:12px;left:50%;transform:translateX(-50%);padding:6px 12px;border-radius:999px;" +
  "background:#111827;color:#fff;font:500 12px/1.4 system-ui,-apple-system,sans-serif;" +
  "box-shadow:0 6px 24px rgba(0,0,0,.25);max-width:90vw;text-align:center}" +
  ".flash .box{outline-color:#16a34a;background:rgba(22,163,74,.12)}" +
  ".box.anchor{outline:2px dashed #dc2626;background:rgba(220,38,38,.06)}" +
  ".guide{position:fixed;background:#dc2626}" +
  ".len{position:fixed;transform:translate(-50%,-50%);padding:1px 4px;border-radius:3px;" +
  "background:#dc2626;color:#fff;font:600 10px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap}" +
  ".num{position:fixed;transform:translate(-50%,-50%);padding:0 3px;border-radius:3px;color:#fff;" +
  "font:600 9px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap}" +
  ".num.m{background:#c2410c}.num.p{background:#15803d}" +
  ".handle{position:fixed;width:9px;height:9px;transform:translate(-50%,-50%);box-sizing:border-box;" +
  "background:#fff;border:2px solid #2563eb;border-radius:2px}" +
  // Motion: the highlight glides from element to element while pointing,
  // the tag and hint ease in, and a pick confirms with a green pulse before
  // the overlay goes. None of it for someone who asked for less motion.
  ".box{box-shadow:0 0 0 4px rgba(37,99,235,.12);animation:cg-in .16s ease-out}" +
  ".glide .margin,.glide .box,.glide .padding,.glide .tag,.glide .num{transition:" +
  "left .14s cubic-bezier(.2,.8,.2,1),top .14s cubic-bezier(.2,.8,.2,1)," +
  "width .14s cubic-bezier(.2,.8,.2,1),height .14s cubic-bezier(.2,.8,.2,1)}" +
  ".tag{border-radius:6px;background:#1d4ed8;box-shadow:0 4px 14px rgba(29,78,216,.35);animation:cg-tag .16s ease-out}" +
  ".hint{animation:cg-hint .22s cubic-bezier(.2,.8,.2,1)}" +
  ".picked .margin,.picked .padding,.picked .num{opacity:0;transition:opacity .12s}" +
  ".picked .box{outline-color:#16a34a;background:rgba(22,163,74,.14);animation:cg-pulse .3s ease-out forwards}" +
  ".picked .tag{background:#15803d}" +
  "@keyframes cg-in{from{opacity:0;transform:scale(.97)}}" +
  "@keyframes cg-tag{from{opacity:0;transform:translateY(3px)}}" +
  "@keyframes cg-hint{from{opacity:0;transform:translate(-50%,-8px)}}" +
  "@keyframes cg-pulse{from{box-shadow:0 0 0 0 rgba(22,163,74,.55)}to{box-shadow:0 0 0 14px rgba(22,163,74,0)}}" +
  "@keyframes cg-pop{from{opacity:0;transform:translate(-40%,-50%) scale(.4)}}" +
  // Choosing several: each chosen element outlined and numbered, the box
  // being dragged, and what it would take, dashed.
  ".sel-layer{position:fixed;inset:0;pointer-events:none}" +
  ".sel{position:fixed;box-sizing:border-box;border:2px solid #7c3aed;border-radius:4px;" +
  "background:rgba(124,58,237,.08);animation:cg-in .16s ease-out}" +
  ".selnum{position:fixed;min-width:18px;height:18px;padding:0 5px;box-sizing:border-box;border-radius:9px;" +
  "background:#7c3aed;color:#fff;font:700 10px/18px ui-monospace,SFMono-Regular,Menlo,monospace;text-align:center;" +
  "transform:translate(-40%,-50%);box-shadow:0 2px 6px rgba(76,29,149,.4);animation:cg-pop .22s cubic-bezier(.2,.8,.2,1.3)}" +
  ".marquee{position:fixed;box-sizing:border-box;border:1.5px dashed #7c3aed;border-radius:3px;background:rgba(124,58,237,.07)}" +
  ".cand{position:fixed;box-sizing:border-box;border:1.5px dashed rgba(124,58,237,.85);border-radius:3px;background:rgba(124,58,237,.05)}" +
  ".hint .done{pointer-events:auto;margin-left:10px;padding:2px 10px;border:0;border-radius:999px;background:#7c3aed;" +
  "color:#fff;font:600 12px/1.5 system-ui,-apple-system,sans-serif;cursor:pointer}" +
  ".hint .done:hover{background:#6d28d9}" +
  ".picked~.sel-layer .sel{border-color:#16a34a;background:rgba(22,163,74,.12)}" +
  ".picked~.sel-layer .selnum{background:#15803d}" +
  "@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}"

/** How long a pick's confirmation shows before the overlay goes. */
const CONFIRM_MS = 220

/**
 * The font an element is set in, the way WhatFont says it: the first family
 * the stylesheet names, size over line height, and weight.
 */
export function fontSummary(style: {
  fontFamily: string
  fontSize: string
  lineHeight: string
  fontWeight: string
}): string {
  const family = (style.fontFamily.split(",")[0] ?? "").trim().replace(/^["']|["']$/g, "")
  if (!family) return ""
  return `${family} ${style.fontSize}/${style.lineHeight} ${style.fontWeight}`
}

function newId(): string {
  // `randomUUID` is secure-context only, and a dev server on a LAN address is
  // not one; the id only has to be unique within this document.
  const random = globalThis.crypto?.getRandomValues?.(new Uint32Array(2))
  return `e${Date.now().toString(36)}${random ? [...random].map((n) => n.toString(36)).join("") : Math.random().toString(36).slice(2)}`
}

function px(value: string): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export interface PickerOptions {
  /**
   * Whether an event is the person's. `isTrusted` in every real page; a test
   * seam only, because jsdom cannot dispatch a trusted event.
   */
  trusted?: (event: Event) => boolean
}

export function installElementPicker(
  win: Window & typeof globalThis,
  { trusted = (event) => event.isTrusted }: PickerOptions = {}
): ElementPicker {
  if (win.__cogniaPicker) return win.__cogniaPicker
  const doc = win.document
  const held = new Map<string, Held>()
  const ids = new WeakMap<Element, string>()
  let active: { finish: () => void; keep?: () => void } | null = null
  let editing: { session: TextEditSession; host: HTMLElement } | null = null
  let focusStops: string[] = []
  /** The stops the check found something wrong with, drawn red. */
  let focusFlagged: ReadonlySet<string> = new Set()
  let focusHost: HTMLElement | null = null
  const readColor = createColorReader()

  function overlay(): { host: HTMLElement; root: ShadowRoot; layer: HTMLElement } {
    const host = doc.createElement("div")
    host.id = HOST_ID
    host.setAttribute("data-cognia-chrome", "1")
    host.style.cssText =
      "all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;"
    const root = host.attachShadow({ mode: "closed" })
    const style = doc.createElement("style")
    style.textContent = OVERLAY_CSS
    const layer = doc.createElement("div")
    layer.className = "layer"
    root.append(style, layer)
    doc.documentElement.appendChild(host)
    return { host, root, layer }
  }

  /**
   * Draw the margin, border and padding boxes of `element` into `layer` —
   * replacing what it showed, unless `keep`. While measuring, the two
   * elements are outlines alone, so the distance lines stay readable: the
   * anchor dashed, the target with its size below it, clear of the gap.
   */
  function draw(
    layer: HTMLElement,
    element: Element | null,
    { keep = false, outline }: { keep?: boolean; outline?: "anchor" | "target" } = {}
  ) {
    // The layer's nodes are reused in order, so a highlight that moves to
    // another element glides there rather than being drawn anew.
    let cursor = keep ? layer.children.length : 0
    const slot = (className: string): HTMLElement => {
      const existing = layer.children[cursor] as HTMLElement | undefined
      cursor++
      if (existing?.className === className) return existing
      const node = doc.createElement("div")
      node.className = className
      if (existing) existing.replaceWith(node)
      else layer.appendChild(node)
      return node
    }
    const trim = () => {
      if (keep) return
      while (layer.children.length > cursor) layer.lastElementChild?.remove()
    }
    if (!element) {
      trim()
      return
    }
    const rect = element.getBoundingClientRect()
    const style = win.getComputedStyle(element)
    const box = (className: string, left: number, top: number, width: number, height: number) => {
      const node = slot(className)
      node.style.borderRadius = className === "box" ? style.borderRadius : ""
      node.style.left = `${left}px`
      node.style.top = `${top}px`
      node.style.width = `${Math.max(0, width)}px`
      node.style.height = `${Math.max(0, height)}px`
    }
    const margin = {
      top: px(style.marginTop),
      right: px(style.marginRight),
      bottom: px(style.marginBottom),
      left: px(style.marginLeft),
    }
    const border = {
      top: px(style.borderTopWidth),
      right: px(style.borderRightWidth),
      bottom: px(style.borderBottomWidth),
      left: px(style.borderLeftWidth),
    }
    const padding = {
      top: px(style.paddingTop),
      right: px(style.paddingRight),
      bottom: px(style.paddingBottom),
      left: px(style.paddingLeft),
    }
    const label = (top: number) => {
      const tag = slot("tag")
      const font = outline ? "" : fontSummary(style)
      tag.textContent = `${elementLabel(element)}  ${Math.round(rect.width)}×${Math.round(rect.height)}${font ? `  ·  ${font}` : ""}`
      tag.style.left = `${Math.max(4, Math.min(rect.left, win.innerWidth - 200))}px`
      tag.style.top = `${top}px`
    }
    if (outline) {
      box(outline === "anchor" ? "box anchor" : "box", rect.left, rect.top, rect.width, rect.height)
      if (outline === "target")
        label(rect.bottom + 26 <= win.innerHeight ? rect.bottom + 4 : Math.max(4, rect.top - 22))
      trim()
      return
    }
    box(
      "margin",
      rect.left - margin.left,
      rect.top - margin.top,
      rect.width + margin.left + margin.right,
      rect.height + margin.top + margin.bottom
    )
    box("box", rect.left, rect.top, rect.width, rect.height)
    const inner = {
      left: rect.left + border.left,
      top: rect.top + border.top,
      width: rect.width - border.left - border.right,
      height: rect.height - border.top - border.bottom,
    }
    // Padding as a frame around the content box: four strips, so the content
    // itself stays readable under the highlight.
    box("padding", inner.left, inner.top, inner.width, padding.top)
    box(
      "padding",
      inner.left,
      inner.top + inner.height - padding.bottom,
      inner.width,
      padding.bottom
    )
    box(
      "padding",
      inner.left,
      inner.top + padding.top,
      padding.left,
      inner.height - padding.top - padding.bottom
    )
    box(
      "padding",
      inner.left + inner.width - padding.right,
      inner.top + padding.top,
      padding.right,
      inner.height - padding.top - padding.bottom
    )
    // The numbers on the strips (VisBug): what each margin and padding is.
    const num = (kind: "m" | "p", x: number, y: number, value: number) => {
      if (value < 1) return
      const node = slot(`num ${kind}`)
      node.textContent = String(Math.round(value * 10) / 10)
      node.style.left = `${x}px`
      node.style.top = `${y}px`
    }
    const midX = rect.left + rect.width / 2
    const midY = rect.top + rect.height / 2
    num("m", midX, rect.top - margin.top / 2, margin.top)
    num("m", rect.right + margin.right / 2, midY, margin.right)
    num("m", midX, rect.bottom + margin.bottom / 2, margin.bottom)
    num("m", rect.left - margin.left / 2, midY, margin.left)
    num("p", midX, inner.top + padding.top / 2, padding.top)
    num("p", inner.left + inner.width - padding.right / 2, midY, padding.right)
    num("p", midX, inner.top + inner.height - padding.bottom / 2, padding.bottom)
    num("p", inner.left + padding.left / 2, midY, padding.left)
    const above = rect.top - margin.top - 22
    label(above > 4 ? above : Math.min(win.innerHeight - 24, rect.bottom + margin.bottom + 4))
    trim()
  }

  function boxOf(element: Element): ElementBox {
    const rect = element.getBoundingClientRect()
    const round = (value: number) => Math.round(value * 100) / 100
    return {
      x: round(rect.left),
      y: round(rect.top),
      width: round(rect.width),
      height: round(rect.height),
    }
  }

  function measured(element: Element): MeasuredElement {
    return {
      elementId: idFor(element),
      selector: uniqueSelector(element),
      label: elementLabel(element),
      box: boxOf(element),
    }
  }

  function measureBetween(from: Element, to: Element): NonNullable<MeasureResult> {
    const a = measured(from)
    const b = measured(to)
    return { from: a, to: b, measure: measureBoxes(a.box, b.box) }
  }

  /** The anchor, the element under the pointer, and the distances between them. */
  function drawMeasure(layer: HTMLElement, anchor: Element, target: Element | null) {
    draw(layer, anchor, { outline: "anchor" })
    if (!target || target === anchor) return
    draw(layer, target, { keep: true, outline: "target" })
    const from = boxOf(anchor)
    const to = boxOf(target)
    for (const guide of measureGuides(from, to, measureBoxes(from, to))) {
      const line = doc.createElement("div")
      line.className = "guide"
      const flat = guide.y1 === guide.y2
      line.style.left = `${Math.min(guide.x1, guide.x2) - (flat ? 0 : 0.5)}px`
      line.style.top = `${Math.min(guide.y1, guide.y2) - (flat ? 0.5 : 0)}px`
      line.style.width = `${flat ? Math.abs(guide.x2 - guide.x1) : 1}px`
      line.style.height = `${flat ? 1 : Math.abs(guide.y2 - guide.y1)}px`
      const label = doc.createElement("div")
      label.className = "len"
      label.textContent = guide.label
      label.style.left = `${(guide.x1 + guide.x2) / 2}px`
      label.style.top = `${(guide.y1 + guide.y2) / 2}px`
      layer.append(line, label)
    }
  }

  function idFor(element: Element): string {
    const known = ids.get(element)
    if (known && held.has(known)) return known
    const id = newId()
    ids.set(element, id)
    const leaf = element.children.length === 0
    held.set(id, {
      element,
      style: element.getAttribute("style"),
      text: leaf ? (element.textContent ?? "") : null,
      applied: false,
    })
    return id
  }

  /**
   * Whether an event is for the extension's other chrome on the page — the
   * floating toolbar — which a pass lets through, so its buttons still work.
   */
  function forOtherChrome(event: Event): boolean {
    const target = event.target
    if (!target || (target as Node).nodeType !== 1) return false
    const chrome = (target as Element).closest("[data-cognia-chrome]")
    return chrome !== null && chrome.id !== HOST_ID
  }

  function pickable(target: EventTarget | null): Element | null {
    if (!target || (target as Node).nodeType !== 1) return null
    const element = target as Element
    // The extension's own chrome — this overlay, the toolbar — is never picked.
    if (element.closest("[data-cognia-chrome]")) return null
    if (element === doc.documentElement) return doc.body
    return element
  }

  function revert(id: string): boolean {
    const entry = held.get(id)
    if (!entry || !entry.element.isConnected) return false
    if (!entry.applied) return true
    if (entry.style === null) entry.element.removeAttribute("style")
    else entry.element.setAttribute("style", entry.style)
    if (entry.text !== null) entry.element.textContent = entry.text
    entry.applied = false
    return true
  }

  /**
   * The Tab stops, numbered on the page and joined in order (Accessibility
   * Insights). In document coordinates, so it scrolls with the page; read
   * from where the elements are now.
   */
  /**
   * The Tab order drawn over the page, in document coordinates so it scrolls
   * with it: each stop framed and numbered, and a curved arrow from each to
   * the next, drawn in turn. A jump back up the page is red and dashed, and
   * a stop with a finding is red.
   */
  function drawFocusOrder(stopIds: readonly string[], flagged: ReadonlySet<string>) {
    focusHost?.remove()
    focusHost = null
    const stops = stopIds.flatMap((id) => {
      const element = held.get(id)?.element
      if (!element?.isConnected) return []
      const rect = element.getBoundingClientRect()
      return [
        {
          id,
          x: rect.left + win.scrollX,
          y: rect.top + win.scrollY,
          w: rect.width,
          h: rect.height,
        },
      ]
    })
    if (stops.length === 0) return
    const SVG = "http://www.w3.org/2000/svg"
    const RADIUS = 11
    const host = doc.createElement("div")
    host.id = FOCUS_HOST_ID
    host.setAttribute("data-cognia-chrome", "1")
    host.style.cssText =
      "all:initial;position:absolute;left:0;top:0;width:0;height:0;overflow:visible;pointer-events:none;z-index:2147483646;"
    const root = host.attachShadow({ mode: "closed" })
    const style = doc.createElement("style")
    style.textContent =
      ".halo{fill:none;stroke:rgba(255,255,255,.9);stroke-width:5;stroke-linecap:round}" +
      ".seg{fill:none;stroke:#7c3aed;stroke-width:1.75;stroke-linecap:round}" +
      ".seg.back{stroke:#dc2626;stroke-dasharray:5 4}" +
      ".draw{stroke-dasharray:1;stroke-dashoffset:1;animation:cg-draw .35s ease-out forwards}" +
      ".fade{animation:cg-fade .35s ease-out both}" +
      ".frame{fill:rgba(124,58,237,.05);stroke:#7c3aed;stroke-width:1.5}" +
      ".frame.bad{fill:rgba(220,38,38,.07);stroke:#dc2626}" +
      ".badge{transform-box:fill-box;transform-origin:center;animation:cg-pop .26s cubic-bezier(.2,.8,.2,1.3) both}" +
      ".badge circle{fill:#7c3aed;stroke:#fff;stroke-width:2;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))}" +
      ".badge.bad circle{fill:#dc2626}" +
      ".badge text{fill:#fff;font:700 10.5px ui-monospace,SFMono-Regular,Menlo,monospace;text-anchor:middle;dominant-baseline:central}" +
      "@keyframes cg-draw{to{stroke-dashoffset:0}}" +
      "@keyframes cg-fade{from{opacity:0}}" +
      "@keyframes cg-pop{from{opacity:0;transform:scale(0)}}" +
      "@media (prefers-reduced-motion:reduce){*{animation:none!important;stroke-dashoffset:0!important}}"
    const width = Math.max(
      doc.documentElement.scrollWidth,
      ...stops.map((stop) => stop.x + stop.w + 20)
    )
    const height = Math.max(
      doc.documentElement.scrollHeight,
      ...stops.map((stop) => stop.y + stop.h + 20)
    )
    const svg = doc.createElementNS(SVG, "svg")
    svg.setAttribute("width", String(width))
    svg.setAttribute("height", String(height))
    svg.setAttribute("style", "position:absolute;left:0;top:0;overflow:visible")
    const make = (name: string, attributes: Record<string, string | number>) => {
      const node = doc.createElementNS(SVG, name)
      for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value))
      return node
    }
    const defs = make("defs", {})
    for (const [id, color] of [
      ["cg-arrow", "#7c3aed"],
      ["cg-arrow-back", "#dc2626"],
    ] as const) {
      const marker = make("marker", {
        id,
        viewBox: "0 0 10 10",
        refX: 8,
        refY: 5,
        markerWidth: 9,
        markerHeight: 9,
        markerUnits: "userSpaceOnUse",
        orient: "auto",
      })
      marker.appendChild(make("path", { d: "M0,0 L10,5 L0,10 z", fill: color }))
      defs.appendChild(marker)
    }
    svg.appendChild(defs)
    // Each stop's number sits on its top-left corner, kept on the page.
    const badgeAt = (stop: (typeof stops)[number]) => ({
      x: Math.min(width - RADIUS - 2, Math.max(RADIUS + 2, stop.x)),
      y: Math.max(RADIUS + 2, stop.y),
    })
    const delay = (index: number) => `animation-delay:${Math.min(index * 45, 1500)}ms`
    const frames = make("g", {})
    const arrows = make("g", {})
    const badges = make("g", {})
    stops.forEach((stop, index) => {
      const bad = flagged.has(stop.id)
      frames.appendChild(
        make("rect", {
          class: bad ? "frame fade bad" : "frame fade",
          x: stop.x,
          y: stop.y,
          width: Math.max(1, stop.w),
          height: Math.max(1, stop.h),
          rx: 3,
          style: delay(index),
        })
      )
      const next = stops[index + 1]
      if (next) {
        const from = badgeAt(stop)
        const to = badgeAt(next)
        const dx = to.x - from.x
        const dy = to.y - from.y
        const distance = Math.hypot(dx, dy)
        if (distance > RADIUS * 2 + 4) {
          // Bowed to one side, so arrows between neighbours never overlap a row.
          const bow = Math.min(48, distance * 0.2)
          const control = {
            x: (from.x + to.x) / 2 - (dy / distance) * bow,
            y: (from.y + to.y) / 2 + (dx / distance) * bow,
          }
          const toward = (point: { x: number; y: number }, target: typeof control, by: number) => {
            const length = Math.hypot(target.x - point.x, target.y - point.y) || 1
            return {
              x: point.x + ((target.x - point.x) / length) * by,
              y: point.y + ((target.y - point.y) / length) * by,
            }
          }
          const start = toward(from, control, RADIUS + 1)
          const end = toward(to, control, RADIUS + 3)
          const d = `M${start.x},${start.y} Q${control.x},${control.y} ${end.x},${end.y}`
          const back = next.y + next.h <= stop.y - 40
          arrows.appendChild(
            make("path", {
              class: back ? "halo fade" : "halo draw",
              d,
              pathLength: 1,
              style: delay(index),
            })
          )
          arrows.appendChild(
            make("path", {
              class: back ? "seg back fade" : "seg draw",
              d,
              pathLength: 1,
              "marker-end": `url(#${back ? "cg-arrow-back" : "cg-arrow"})`,
              style: delay(index),
            })
          )
        }
      }
      const at = badgeAt(stop)
      const badge = make("g", { class: bad ? "badge bad" : "badge", style: delay(index) })
      badge.appendChild(make("circle", { cx: at.x, cy: at.y, r: RADIUS }))
      const label = make("text", { x: at.x, y: at.y })
      label.textContent = String(index + 1)
      badge.appendChild(label)
      badges.appendChild(badge)
    })
    svg.append(frames, arrows, badges)
    root.append(style, svg)
    doc.documentElement.appendChild(host)
    focusHost = host
  }

  /** Describe a held element and stamp it for the main-world read, which removes the stamp. */
  function describeHeld(elementId: string): PickResult {
    const entry = held.get(elementId)
    if (!entry || !entry.element.isConnected) return null
    const described = describeElement(entry.element, elementId)
    const contrast = described.text ? textContrast(entry.element, win, readColor) : null
    const description = {
      ...described,
      html: elementMarkup(entry.element),
      ...(contrast ? { contrast } : {}),
    }
    const probeToken = newId()
    entry.element.setAttribute(PROBE_ATTRIBUTE, probeToken)
    return { ...description, probeToken }
  }

  /**
   * One pass of pointing at the page: the highlight follows trusted pointer
   * and arrow keys, the page sees none of the clicks, and Escape, a timeout
   * or a newer pass ends it with `null`. `choose` answers what a click or
   * Enter on an element ends the pass with, or `undefined` to keep going.
   */
  function interact<T>({
    hint,
    timeoutMs,
    render,
    choose,
  }: {
    hint: string
    timeoutMs: number
    render: (layer: HTMLElement, current: Element | null) => void
    choose: (element: Element, shift: boolean, say: (text: string) => void) => T | undefined
  }): Promise<T | null> {
    active?.finish()
    return new Promise<T | null>((resolve) => {
      const { host, root, layer } = overlay()
      // Glides from element to element while the pointer moves.
      layer.classList.add("glide")
      // A bug recording leaves out the clicks the panel's pointing takes.
      host.setAttribute(POINTING_ATTRIBUTE, "1")
      const bar = doc.createElement("div")
      bar.className = "hint"
      bar.setAttribute("role", "status")
      bar.textContent = hint
      root.appendChild(bar)
      const say = (text: string) => {
        bar.textContent = text
      }
      let current: Element | null = null
      let done = false
      const show = (element: Element | null) => {
        current = element
        render(layer, element)
      }
      const swallow = (event: Event) => {
        if (!trusted(event) || forOtherChrome(event)) return
        event.preventDefault()
        event.stopImmediatePropagation()
      }
      const onMove = (event: Event) => {
        if (!trusted(event)) return
        const pointer = event as MouseEvent
        const under =
          typeof doc.elementFromPoint === "function"
            ? doc.elementFromPoint(pointer.clientX, pointer.clientY)
            : null
        const element = pickable(under ?? event.target)
        if (element && element !== current) show(element)
      }
      const decide = (element: Element, shift: boolean) => {
        const result = choose(element, shift, say)
        if (result === undefined) render(layer, current)
        else finish(result)
      }
      const onClick = (event: Event) => {
        if (!trusted(event) || forOtherChrome(event)) return
        swallow(event)
        const element = pickable(event.target) ?? current
        if (element) decide(element, (event as MouseEvent).shiftKey)
      }
      const onKey = (event: KeyboardEvent) => {
        if (!trusted(event)) return
        if (event.key === "Escape") {
          swallow(event)
          finish(null)
        } else if (event.key === "Enter" && current) {
          swallow(event)
          decide(current, event.shiftKey)
        } else if (event.key === "ArrowUp" && current?.parentElement) {
          swallow(event)
          if (current.parentElement !== doc.documentElement) show(current.parentElement)
        } else if (event.key === "ArrowDown" && current?.firstElementChild) {
          swallow(event)
          show(current.firstElementChild)
        }
      }
      // Scrolling moves the page under the highlight: it follows at once,
      // not a glide behind.
      let still = 0
      const onScroll = () => {
        layer.classList.remove("glide")
        render(layer, current)
        win.clearTimeout(still)
        still = win.setTimeout(() => layer.classList.add("glide"), 150)
      }
      const blocked = [
        "pointerdown",
        "pointerup",
        "mousedown",
        "mouseup",
        "dblclick",
        "contextmenu",
      ]
      const listen = (on: boolean) => {
        const method = on ? "addEventListener" : "removeEventListener"
        win[method]("mousemove", onMove, true)
        win[method]("pointermove", onMove, true)
        win[method]("click", onClick, true)
        win[method]("keydown", onKey as EventListener, true)
        win[method]("scroll", onScroll, true)
        win[method]("resize", onScroll, true)
        for (const type of blocked) win[method](type, swallow, true)
      }
      const timer = win.setTimeout(() => finish(null), timeoutMs)
      function finish(result: T | null) {
        if (done) return
        done = true
        win.clearTimeout(timer)
        win.clearTimeout(still)
        listen(false)
        host.removeAttribute(POINTING_ATTRIBUTE)
        if (active === handle) active = null
        leaveOverlay({ host, root, layer }, result !== null, () => resolve(result))
      }
      const handle = { finish: () => finish(null) }
      active = handle
      render(layer, null)
      listen(true)
    })
  }

  /**
   * Take a pointing overlay off the page, then answer — two frames after it
   * goes, so the highlight is off the screen before the panel takes the
   * element's screenshot. A pick confirms on the page first (the box turns
   * green and pulses) unless the person asked for less motion.
   */
  function leaveOverlay(
    { host, root, layer }: { host: HTMLElement; root: ShadowRoot; layer: HTMLElement },
    confirm: boolean,
    answer: () => void
  ) {
    const leave = () => {
      host.remove()
      if (typeof win.requestAnimationFrame === "function") {
        const fallback = win.setTimeout(answer, 100)
        win.requestAnimationFrame(() =>
          win.requestAnimationFrame(() => {
            win.clearTimeout(fallback)
            answer()
          })
        )
      } else answer()
    }
    const calm = win.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? true
    if (confirm && !calm) {
      layer.classList.remove("glide")
      layer.classList.add("picked")
      root.querySelector(".hint")?.remove()
      win.setTimeout(leave, CONFIRM_MS)
    } else leave()
  }

  function pickMany({
    hint,
    selectedHint,
    doneLabel,
    timeoutMs,
    max,
  }: PickManyOptions): Promise<NonNullable<PickResult>[] | null> {
    active?.finish()
    return new Promise((resolve) => {
      const { host, root, layer } = overlay()
      layer.classList.add("glide")
      host.setAttribute(POINTING_ATTRIBUTE, "1")
      const bar = doc.createElement("div")
      bar.className = "hint"
      bar.setAttribute("role", "status")
      const words = doc.createElement("span")
      const done = doc.createElement("button")
      done.type = "button"
      done.className = "done"
      done.textContent = doneLabel
      bar.append(words, done)
      const marks = doc.createElement("div")
      marks.className = "sel-layer"
      root.append(bar, marks)

      const selected: Element[] = []
      /** Each chosen element's outline and number, kept so they animate in once. */
      const drawn = new Map<Element, { frame: HTMLElement; number: HTMLElement }>()
      const candidates: HTMLElement[] = []
      let marquee: { x: number; y: number; width: number; height: number } | null = null
      let down: { x: number; y: number } | null = null
      let suppressClick = false
      let current: Element | null = null
      let finished = false
      let frame = 0
      const room = () => Math.max(0, max - selected.length)
      const accept = (element: Element) => pickable(element) === element

      const say = () => {
        words.textContent =
          selected.length > 0 ? selectedHint.replace("{n}", String(selected.length)) : hint
        done.style.display = selected.length > 0 ? "" : "none"
      }
      const place = (
        node: HTMLElement,
        rect: { left: number; top: number; width: number; height: number }
      ) => {
        node.style.left = `${rect.left}px`
        node.style.top = `${rect.top}px`
        node.style.width = `${Math.max(0, rect.width)}px`
        node.style.height = `${Math.max(0, rect.height)}px`
      }
      const paint = () => {
        frame = 0
        draw(layer, marquee ? null : current)
        for (const [element, nodes] of drawn)
          if (!selected.includes(element)) {
            nodes.frame.remove()
            nodes.number.remove()
            drawn.delete(element)
          }
        selected.forEach((element, index) => {
          let nodes = drawn.get(element)
          if (!nodes) {
            const frameNode = doc.createElement("div")
            frameNode.className = "sel"
            const numberNode = doc.createElement("div")
            numberNode.className = "selnum"
            marks.append(frameNode, numberNode)
            nodes = { frame: frameNode, number: numberNode }
            drawn.set(element, nodes)
          }
          const rect = element.getBoundingClientRect()
          place(nodes.frame, rect)
          nodes.number.textContent = String(index + 1)
          nodes.number.style.left = `${Math.max(10, rect.left)}px`
          nodes.number.style.top = `${Math.max(10, rect.top)}px`
        })
        // What the box being dragged would take.
        const inside = marquee ? elementsInBox(doc, marquee, accept, room()) : []
        const fresh = inside.filter((element) => !selected.includes(element))
        while (candidates.length > fresh.length) candidates.pop()?.remove()
        fresh.forEach((element, index) => {
          let node = candidates[index]
          if (!node) {
            node = doc.createElement("div")
            node.className = "cand"
            marks.appendChild(node)
            candidates.push(node)
          }
          place(node, element.getBoundingClientRect())
        })
        let box = marks.querySelector<HTMLElement>(".marquee")
        if (marquee) {
          if (!box) {
            box = doc.createElement("div")
            box.className = "marquee"
            marks.appendChild(box)
          }
          place(box, {
            left: marquee.x,
            top: marquee.y,
            width: marquee.width,
            height: marquee.height,
          })
        } else box?.remove()
        say()
      }
      const repaint = () => {
        if (frame) return
        frame =
          typeof win.requestAnimationFrame === "function"
            ? win.requestAnimationFrame(paint)
            : (paint(), 0)
      }
      const toggle = (elements: Element[], on?: boolean) => {
        for (const element of elements) {
          const at = selected.indexOf(element)
          if (at >= 0 && on !== true) selected.splice(at, 1)
          else if (at < 0 && on !== false && room() > 0) selected.push(element)
        }
        paint()
      }

      const swallow = (event: Event) => {
        if (!trusted(event) || forOtherChrome(event)) return
        event.preventDefault()
        event.stopImmediatePropagation()
      }
      const onDown = (event: Event) => {
        // The Done button, in this overlay, answers for itself.
        if (!trusted(event) || forOtherChrome(event) || event.target === host) return
        swallow(event)
        const pointer = event as MouseEvent
        if (pointer.button === 0) down = { x: pointer.clientX, y: pointer.clientY }
      }
      const onMove = (event: Event) => {
        if (!trusted(event)) return
        const pointer = event as MouseEvent
        if (down) {
          const width = pointer.clientX - down.x
          const height = pointer.clientY - down.y
          if (marquee || Math.hypot(width, height) > 6) {
            marquee = {
              x: Math.min(down.x, pointer.clientX),
              y: Math.min(down.y, pointer.clientY),
              width: Math.abs(width),
              height: Math.abs(height),
            }
            repaint()
            return
          }
        }
        const under =
          typeof doc.elementFromPoint === "function"
            ? doc.elementFromPoint(pointer.clientX, pointer.clientY)
            : null
        const element = pickable(under ?? event.target)
        if (element && element !== current) {
          current = element
          repaint()
        }
      }
      const onUp = (event: Event) => {
        if (!trusted(event) || forOtherChrome(event) || event.target === host) return
        swallow(event)
        if (marquee) {
          const box = marquee
          marquee = null
          // The click that ends a drag is not a pick.
          suppressClick = true
          toggle(elementsInBox(doc, box, accept, room()), true)
        }
        down = null
      }
      const onClick = (event: Event) => {
        if (!trusted(event) || forOtherChrome(event) || event.target === host) return
        swallow(event)
        if (suppressClick) {
          suppressClick = false
          return
        }
        const element = pickable(event.target) ?? current
        if (!element) return
        const mouse = event as MouseEvent
        if (mouse.altKey) {
          const alike = alikeElements(doc, element, accept, room() + selected.length)
          toggle(alike, !selected.includes(element))
        } else if (mouse.shiftKey || mouse.metaKey || mouse.ctrlKey) toggle([element])
        else {
          if (!selected.includes(element)) toggle([element], true)
          finish(selected)
        }
      }
      const onKey = (event: KeyboardEvent) => {
        if (!trusted(event)) return
        if (event.key === "Escape") {
          swallow(event)
          finish(null)
        } else if (event.key === "Enter") {
          swallow(event)
          if (selected.length === 0 && current) toggle([current], true)
          if (selected.length > 0) finish(selected)
        } else if (event.key === "Backspace" || event.key === "Delete") {
          swallow(event)
          selected.pop()
          paint()
        } else if (event.key === "ArrowUp" && current?.parentElement) {
          swallow(event)
          if (current.parentElement !== doc.documentElement) current = current.parentElement
          paint()
        } else if (event.key === "ArrowDown" && current?.firstElementChild) {
          swallow(event)
          current = current.firstElementChild
          paint()
        }
      }
      done.addEventListener("click", (event) => {
        if (!trusted(event)) return
        event.preventDefault()
        event.stopPropagation()
        if (selected.length > 0) finish(selected)
      })
      let still = 0
      const onScroll = () => {
        layer.classList.remove("glide")
        paint()
        win.clearTimeout(still)
        still = win.setTimeout(() => layer.classList.add("glide"), 150)
      }
      const blocked = ["mousedown", "mouseup", "dblclick", "contextmenu"]
      const listen = (on: boolean) => {
        const method = on ? "addEventListener" : "removeEventListener"
        win[method]("pointerdown", onDown, true)
        win[method]("pointerup", onUp, true)
        win[method]("mousemove", onMove, true)
        win[method]("pointermove", onMove, true)
        win[method]("click", onClick, true)
        win[method]("keydown", onKey as EventListener, true)
        win[method]("scroll", onScroll, true)
        win[method]("resize", onScroll, true)
        for (const type of blocked) win[method](type, swallow, true)
      }
      const timer = win.setTimeout(() => finish(selected.length > 0 ? selected : null), timeoutMs)
      function finish(chosen: Element[] | null) {
        if (finished) return
        finished = true
        win.clearTimeout(timer)
        win.clearTimeout(still)
        if (frame && typeof win.cancelAnimationFrame === "function") win.cancelAnimationFrame(frame)
        listen(false)
        host.removeAttribute(POINTING_ATTRIBUTE)
        if (active === handle) active = null
        const results = chosen
          ? chosen.flatMap((element) => {
              const described = describeHeld(idFor(element))
              return described ? [described] : []
            })
          : null
        const answer = results && results.length > 0 ? results : null
        if (answer) paint()
        leaveOverlay({ host, root, layer }, answer !== null, () => resolve(answer))
      }
      const handle = { finish: () => finish(null) }
      active = handle
      paint()
      listen(true)
    })
  }

  const picker: ElementPicker = {
    pickMany,

    pick({ hint, timeoutMs }) {
      return interact<NonNullable<PickResult>>({
        hint,
        timeoutMs,
        render: (layer, current) => draw(layer, current),
        choose: (element, more) => {
          const described = describeHeld(idFor(element))
          // An element that left the page under the click: keep pointing.
          return (described && more ? { ...described, more } : described) ?? undefined
        },
      })
    },

    measure({ hint, anchorHint, timeoutMs, anchorId }) {
      const preset = anchorId ? held.get(anchorId) : undefined
      let anchor: Element | null = preset?.element.isConnected ? preset.element : null
      return interact<NonNullable<MeasureResult>>({
        hint: anchor ? anchorHint : hint,
        timeoutMs,
        render: (layer, current) =>
          anchor ? drawMeasure(layer, anchor, current) : draw(layer, current),
        choose: (element, more, say) => {
          if (!anchor) {
            anchor = element
            say(anchorHint)
            return undefined
          }
          if (element === anchor) return undefined
          const result = measureBetween(anchor, element)
          return more ? { ...result, more } : result
        },
      })
    },

    adjust({ elementId, hint, labels, timeoutMs }) {
      const entry = held.get(elementId)
      if (!entry || !entry.element.isConnected) return Promise.resolve(null)
      active?.finish()
      const element = entry.element as HTMLElement
      element.scrollIntoView?.({ block: "center", inline: "center" })
      const before = element.getAttribute("style")
      const read = (): AdjustState => {
        const style = win.getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        const sides = (kind: "margin" | "padding"): Sides => [
          px(style.getPropertyValue(`${kind}-top`)),
          px(style.getPropertyValue(`${kind}-right`)),
          px(style.getPropertyValue(`${kind}-bottom`)),
          px(style.getPropertyValue(`${kind}-left`)),
        ]
        // The used width in the element's own box-sizing, so writing it
        // back changes nothing until the person drags.
        return {
          width: px(style.width) || rect.width,
          height: px(style.height) || rect.height,
          margin: sides("margin"),
          padding: sides("padding"),
        }
      }
      const start = read()
      let state = start
      let spacing: AdjustSpacing = "margin"
      let drag: { zone: ResizeZone; x: number; y: number; from: AdjustState } | null = null

      return new Promise<AdjustResult>((resolve) => {
        const { host, root, layer } = overlay()
        host.setAttribute(POINTING_ATTRIBUTE, "1")
        const bar = doc.createElement("div")
        bar.className = "hint"
        bar.setAttribute("role", "status")
        root.appendChild(bar)
        const render = () => {
          draw(layer, element)
          const rect = element.getBoundingClientRect()
          for (const [x, y] of [
            [rect.right, rect.top + rect.height / 2],
            [rect.left + rect.width / 2, rect.bottom],
            [rect.right, rect.bottom],
          ] as const) {
            const handle = doc.createElement("div")
            handle.className = "handle"
            handle.style.left = `${x}px`
            handle.style.top = `${y}px`
            layer.appendChild(handle)
          }
          bar.textContent = `${hint}  ·  ${adjustStatus(state, spacing, labels)}`
        }
        const show = (next: AdjustState) => {
          state = next
          const changes = adjustChanges(start, state)
          for (const property of ["width", "height", "margin", "padding"]) {
            const value = changes[property]
            if (value) element.style.setProperty(property, value, "important")
          }
          render()
        }
        const swallow = (event: Event) => {
          event.preventDefault()
          event.stopImmediatePropagation()
        }
        const onDown = (event: Event) => {
          if (!trusted(event) || forOtherChrome(event)) return
          swallow(event)
          const pointer = event as PointerEvent
          const zone = resizeZone(element.getBoundingClientRect(), pointer.clientX, pointer.clientY)
          drag = zone ? { zone, x: pointer.clientX, y: pointer.clientY, from: state } : null
        }
        const onMove = (event: Event) => {
          if (!trusted(event) || !drag) return
          swallow(event)
          const pointer = event as PointerEvent
          show({
            ...state,
            ...resize(drag.from, drag.zone, pointer.clientX - drag.x, pointer.clientY - drag.y),
          })
        }
        const onUp = (event: Event) => {
          if (!trusted(event)) return
          swallow(event)
          drag = null
        }
        const onKey = (event: KeyboardEvent) => {
          if (!trusted(event)) return
          if (event.key === "Escape") {
            swallow(event)
            finish(false)
          } else if (event.key === "Enter") {
            swallow(event)
            finish(true)
          } else if (event.key === "p" || event.key === "P") {
            swallow(event)
            spacing = spacing === "margin" ? "padding" : "margin"
            render()
          } else if (isNudgeKey(event.key)) {
            swallow(event)
            show(nudge(state, event.key, { spacing, shrink: event.altKey, big: event.shiftKey }))
          }
        }
        const onScroll = () => render()
        const listeners: [string, EventListener][] = [
          ["pointerdown", onDown],
          ["pointermove", onMove],
          ["pointerup", onUp],
          ["keydown", onKey as EventListener],
          ["scroll", onScroll],
          ["resize", onScroll],
          // The page sees none of the presses that drag its element.
          ...["mousedown", "mouseup", "click", "dblclick", "contextmenu"].map(
            (type): [string, EventListener] => [
              type,
              (event: Event) => {
                if (trusted(event) && !forOtherChrome(event)) swallow(event)
              },
            ]
          ),
        ]
        let done = false
        // Running out of time keeps what was done: nothing was wrong with it.
        const timer = win.setTimeout(() => finish(true), timeoutMs)
        function finish(keep: boolean) {
          if (done) return
          done = true
          win.clearTimeout(timer)
          for (const [type, listener] of listeners) win.removeEventListener(type, listener, true)
          host.remove()
          if (active === handle) active = null
          const changes = keep && element.isConnected ? adjustChanges(start, state) : null
          if (changes && Object.keys(changes).length > 0) {
            // Left showing; the panel previews it again with the pick's other
            // edits, and reverting puts back what the page had before any.
            entry!.applied = true
          } else if (before === null) element.removeAttribute("style")
          else element.setAttribute("style", before)
          resolve(changes)
        }
        const handle = { finish: () => finish(false), keep: () => finish(true) }
        active = handle
        render()
        for (const [type, listener] of listeners) win.addEventListener(type, listener, true)
      })
    },

    finishAdjust() {
      if (!active?.keep) return false
      active.keep()
      return true
    },

    showMeasurement(fromId, toId) {
      const from = held.get(fromId)?.element
      const to = held.get(toId)?.element
      if (!from?.isConnected || !to?.isConnected) return null
      from.scrollIntoView?.({ block: "center", inline: "center" })
      const { host, layer } = overlay()
      drawMeasure(layer, from, to)
      win.setTimeout(() => host.remove(), 2_000)
      return measureBetween(from, to)
    },

    cancel() {
      if (!active) return false
      active.finish()
      return true
    },

    apply(elementId, edits) {
      const entry = held.get(elementId)
      if (!entry || !entry.element.isConnected) return false
      revert(elementId)
      const clean = sanitizeEdits(edits)
      const target = entry.element as HTMLElement
      for (const [property, value] of Object.entries(clean.styles)) {
        target.style?.setProperty(property, value, "important")
      }
      if (clean.text !== undefined && entry.text !== null) target.textContent = clean.text
      entry.applied = Object.keys(clean.styles).length > 0 || clean.text !== undefined
      return true
    },

    revert,

    locate(elementId, flash = true) {
      const entry = held.get(elementId)
      if (!entry || !entry.element.isConnected) return null
      entry.element.scrollIntoView?.({ block: "center", inline: "center" })
      const rect = entry.element.getBoundingClientRect()
      if (flash) {
        const { host, layer } = overlay()
        layer.classList.add("flash")
        draw(layer, entry.element)
        win.setTimeout(() => host.remove(), 1_200)
      }
      return {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
        dpr: win.devicePixelRatio || 1,
      }
    },

    boxes(elementIds) {
      const boxes: ElementBox[] = []
      for (const id of elementIds.slice(0, 100)) {
        const entry = held.get(id)
        if (!entry || !entry.element.isConnected) continue
        const rect = entry.element.getBoundingClientRect()
        boxes.push({
          x: rect.left + win.scrollX,
          y: rect.top + win.scrollY,
          width: rect.width,
          height: rect.height,
        })
      }
      return boxes
    },

    probe(elementId) {
      const entry = held.get(elementId)
      if (!entry || !entry.element.isConnected) return null
      const token = newId()
      entry.element.setAttribute(PROBE_ATTRIBUTE, token)
      return token
    },

    describe: describeHeld,

    audit: () => auditDocument(doc, idFor),

    tokens: () => collectDesignTokens(doc),

    seo: () => checkSeo(doc),

    layout: () => checkLayout(doc, idFor),

    focusOrder() {
      const { check, order } = checkFocusOrder(doc, idFor)
      focusStops = order.map((stop) => stop.elementId)
      focusFlagged = new Set(
        check.issues.flatMap((issue) => (issue.elementId ? [issue.elementId] : []))
      )
      drawFocusOrder(focusStops, focusFlagged)
      return check
    },

    showFocusOrder(show) {
      if (!show) {
        focusHost?.remove()
        focusHost = null
        return true
      }
      if (focusStops.length === 0) return false
      drawFocusOrder(focusStops, focusFlagged)
      return focusHost !== null
    },

    editText(hint) {
      if (editing) return false
      active?.finish()
      const { host, root } = overlay()
      // The page becomes editable as a whole; the hint is not part of it.
      host.setAttribute("contenteditable", "false")
      const bar = doc.createElement("div")
      bar.className = "hint"
      bar.setAttribute("role", "status")
      bar.textContent = hint
      root.appendChild(bar)
      editing = { session: startTextEditing(doc), host }
      return true
    },

    isEditingText: () => editing !== null,

    stopEditingText(keep) {
      if (!editing) return []
      const { session, host } = editing
      editing = null
      host.remove()
      return session.stop(keep)
    },

    release(elementIds) {
      for (const id of elementIds ?? [...held.keys()]) {
        revert(id)
        const entry = held.get(id)
        entry?.element.removeAttribute(PROBE_ATTRIBUTE)
        held.delete(id)
      }
    },
  }
  win.__cogniaPicker = picker
  return picker
}
