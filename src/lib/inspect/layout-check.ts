/**
 * Layout bugs a glance misses (the overflow detectors, Pesticide): what makes
 * the page scroll sideways, text cut off by its box, images stretched out of
 * shape, and text too small to read.
 *
 * Each finding names the element it found, held by the picker like a pick,
 * so it can be shown on the page and turned into a pick with one click. The
 * checks read the layout as the browser computed it at this viewport size:
 * a page fine on a laptop and broken on a phone is broken where it is run.
 */
import { createVisibility, elementLabel, hidesFromView, uniqueSelector } from "./element-context"

export const LAYOUT_RULES = [
  "horizontal-overflow",
  "clipped-text",
  "distorted-image",
  "small-text",
] as const

export type LayoutRule = (typeof LAYOUT_RULES)[number]

export interface LayoutIssue {
  rule: LayoutRule
  elementId?: string
  selector?: string
  label?: string
  detail?: string
}

export interface LayoutCheck {
  tabId: number
  ranAt: number
  viewport: { width: number; height: number }
  /** How wide the page is, against the viewport: wider means it scrolls sideways. */
  pageWidth: number
  issues: LayoutIssue[]
  checked: number
  truncated: boolean
}

const MAX_PER_RULE = 10
const MAX_SCANNED = 4_000
/** Smaller than this is hard to read on any screen. */
export const SMALL_TEXT_PX = 12
/** Stretched by more than this is visibly out of shape. */
const DISTORTION = 0.05

function px(value: string): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function round(value: number): number {
  return Math.round(value)
}

export function checkLayout(
  doc: Document,
  track: (element: Element) => string
): Omit<LayoutCheck, "tabId" | "ranAt"> {
  const view = doc.defaultView
  const root = doc.documentElement
  const viewport = {
    width: root.clientWidth || view?.innerWidth || 0,
    height: view?.innerHeight ?? 0,
  }
  const pageWidth = Math.max(root.scrollWidth, doc.body?.scrollWidth ?? 0)
  const issues: LayoutIssue[] = []
  const counts = new Map<LayoutRule, number>()
  let truncated = false
  const report = (rule: LayoutRule, element: Element, detail: string) => {
    const count = counts.get(rule) ?? 0
    if (count >= MAX_PER_RULE) {
      truncated = true
      return
    }
    counts.set(rule, count + 1)
    issues.push({
      rule,
      elementId: track(element),
      selector: uniqueSelector(element),
      label: elementLabel(element),
      detail,
    })
  }
  if (!view || typeof view.getComputedStyle !== "function")
    return { viewport, pageWidth, issues, checked: 0, truncated }

  const visible = createVisibility(hidesFromView)
  const styles = new Map<Element, CSSStyleDeclaration>()
  const styleOf = (element: Element) => {
    let style = styles.get(element)
    if (!style) {
      style = view.getComputedStyle(element)
      styles.set(element, style)
    }
    return style
  }
  /** Whether an ancestor clips sideways, so this element cannot widen the page. */
  const clippedByAncestor = (element: Element) => {
    for (
      let node = element.parentElement;
      node && node !== doc.body && node !== root;
      node = node.parentElement
    ) {
      const overflow = styleOf(node).overflowX
      if (overflow && overflow !== "visible") return true
    }
    return false
  }
  const ownText = (element: Element) =>
    [...element.childNodes].some(
      (child) => child.nodeType === 3 && (child.nodeValue ?? "").trim() !== ""
    )

  const overflowing = pageWidth > viewport.width + 1
  const overflowCulprits: Element[] = []
  let checked = 0
  for (const element of doc.body ? doc.body.querySelectorAll("*") : []) {
    if (checked >= MAX_SCANNED) {
      truncated = true
      break
    }
    if (element.closest("[data-cognia-chrome]") || !visible(element)) continue
    checked++
    const rect = element.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) continue
    const style = styleOf(element)

    if (
      overflowing &&
      rect.right > viewport.width + 1 &&
      style.position !== "fixed" &&
      !clippedByAncestor(element)
    )
      overflowCulprits.push(element)

    if (ownText(element)) {
      const clipsX = style.overflowX !== "visible" && element.scrollWidth > element.clientWidth + 1
      const clipsY =
        style.overflowY !== "visible" && element.scrollHeight > element.clientHeight + 1
      // An ellipsis or a line clamp is a decision, not a bug.
      const intended =
        style.textOverflow === "ellipsis" ||
        (style.getPropertyValue("-webkit-line-clamp") || "none") !== "none"
      if ((clipsX || clipsY) && !intended && element.clientWidth > 0)
        report(
          "clipped-text",
          element,
          clipsX
            ? `${round(element.scrollWidth - element.clientWidth)}px of text cut off at the right`
            : `${round(element.scrollHeight - element.clientHeight)}px of text cut off at the bottom`
        )
      const size = px(style.fontSize)
      if (size > 0 && size < SMALL_TEXT_PX) report("small-text", element, `${size}px`)
    }

    if (element.tagName === "IMG") {
      const image = element as HTMLImageElement
      const fit = style.objectFit || "fill"
      if (image.naturalWidth > 0 && image.naturalHeight > 0 && rect.height > 0 && fit === "fill") {
        const natural = image.naturalWidth / image.naturalHeight
        const shown = rect.width / rect.height
        if (Math.abs(shown / natural - 1) > DISTORTION)
          report(
            "distorted-image",
            element,
            `${image.naturalWidth}×${image.naturalHeight} shown at ${round(rect.width)}×${round(rect.height)}`
          )
      }
    }
  }
  // The outermost elements past the edge: their children overflow with them.
  for (const element of overflowCulprits) {
    if (overflowCulprits.some((other) => other !== element && other.contains(element))) continue
    const rect = element.getBoundingClientRect()
    report(
      "horizontal-overflow",
      element,
      `extends ${round(rect.right - viewport.width)}px past the ${viewport.width}px viewport`
    )
  }

  const order = new Map(LAYOUT_RULES.map((rule, index) => [rule, index]))
  issues.sort((a, b) => (order.get(a.rule) ?? 0) - (order.get(b.rule) ?? 0))
  return { viewport, pageWidth, issues, checked, truncated }
}

export const LAYOUT_RULE_TEXT: Record<LayoutRule, string> = {
  "horizontal-overflow": "Wider than the viewport, so the page scrolls sideways",
  "clipped-text": "Text cut off by its box",
  "distorted-image": "Image stretched out of its proportions",
  "small-text": `Text smaller than ${SMALL_TEXT_PX}px`,
}

export function layoutMarkdown(check: Omit<LayoutCheck, "tabId" | "ranAt">): string {
  const lines = [
    `## Layout check (${check.issues.length} findings)`,
    "",
    `At a ${check.viewport.width}×${check.viewport.height} viewport; the page is ${check.pageWidth}px wide${
      check.pageWidth > check.viewport.width + 1 ? ", so it scrolls sideways" : ""
    }. Selectors match the live page.`,
  ]
  if (check.issues.length === 0) lines.push("", "No layout problems found.")
  else lines.push("")
  for (const issue of check.issues) {
    const where = issue.selector ? ` — \`${issue.selector}\`` : ""
    lines.push(
      `- ${LAYOUT_RULE_TEXT[issue.rule]}${where}${issue.detail ? ` (${issue.detail})` : ""}`
    )
  }
  if (check.truncated) lines.push("- … more of the same kinds were left out")
  return lines.join("\n")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** A stored layout check this build can show, from an unsent draft. */
export function parseLayout(value: unknown): Omit<LayoutCheck, "tabId" | "ranAt"> | null {
  if (!isRecord(value) || !isRecord(value.viewport)) return null
  const viewport = value.viewport
  return {
    viewport: {
      width: typeof viewport.width === "number" ? viewport.width : 0,
      height: typeof viewport.height === "number" ? viewport.height : 0,
    },
    pageWidth: typeof value.pageWidth === "number" ? value.pageWidth : 0,
    issues: Array.isArray(value.issues)
      ? value.issues.filter(
          (item): item is LayoutIssue =>
            isRecord(item) &&
            (LAYOUT_RULES as readonly unknown[]).includes(item.rule) &&
            ["elementId", "selector", "label", "detail"].every(
              (key) => item[key] === undefined || typeof item[key] === "string"
            )
        )
      : [],
    checked: typeof value.checked === "number" ? value.checked : 0,
    truncated: value.truncated === true,
  }
}
