/**
 * A first accessibility pass over the page (axe DevTools).
 *
 * Not a conformance audit — a page that passes may still fail people — but
 * the checks a reviewer runs first, done where the layout exists: missing
 * names on images, buttons, links and fields; text whose contrast against
 * what is really behind it falls under WCAG AA; headings that skip a level;
 * duplicate ids; focusable things hidden from assistive technology; targets
 * under WCAG 2.2's 24 px; and a page with no language or title.
 *
 * Runs in the picker's bundle, so every finding is a handle the panel can
 * show on the page or turn into a pick, and so it reads visibility and names
 * by the same rules as a pick does.
 */
import {
  accessibleName,
  createVisibility,
  elementLabel,
  hidesFromView,
  uniqueSelector,
} from "./element-context"
import {
  composite,
  contrastRatio,
  createColorReader,
  suggestContrast,
  toHex,
  type Rgba,
} from "./page-colors"

export type A11yImpact = "critical" | "serious" | "moderate" | "minor"

export const A11Y_RULES = [
  "image-alt",
  "button-name",
  "link-name",
  "label",
  "color-contrast",
  "html-lang",
  "document-title",
  "heading-order",
  "empty-heading",
  "duplicate-id",
  "target-size",
  "aria-hidden-focus",
  "frame-title",
  "tabindex",
] as const

export type A11yRule = (typeof A11Y_RULES)[number]

export interface A11yIssue {
  rule: A11yRule
  impact: A11yImpact
  /** The element, as the picker holds it; absent for a page-level finding. */
  elementId?: string
  selector?: string
  label?: string
  /** Numbers and names that make the finding concrete: `2.3:1, needs 4.5:1`. */
  detail?: string
}

export interface A11yAudit {
  tabId: number
  ranAt: number
  issues: A11yIssue[]
  /** Elements looked at. */
  checked: number
  /** Some rule found more than it reports. */
  truncated: boolean
}

/** What each rule asks for, as the agent reads it. */
export const A11Y_RULE_TEXT: Record<A11yRule, string> = {
  "image-alt": "Image has no text alternative",
  "button-name": "Button has no accessible name",
  "link-name": "Link has no accessible name",
  label: "Form field has no label",
  "color-contrast": "Text contrast is below WCAG AA",
  "html-lang": "Page has no language",
  "document-title": "Page has no title",
  "heading-order": "Heading level skips a level",
  "empty-heading": "Heading is empty",
  "duplicate-id": "Id is used more than once",
  "target-size": "Target is smaller than 24×24 px",
  "aria-hidden-focus": "Focusable element is hidden from assistive technology",
  "frame-title": "Frame has no title",
  tabindex: "Positive tabindex changes the focus order",
}

const IMPACT_ORDER: Record<A11yImpact, number> = { critical: 0, serious: 1, moderate: 2, minor: 3 }

const MAX_PER_RULE = 15
const MAX_SCANNED = 4_000
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'

/** Whether an element has a name from its content or attributes, images and icons included. */
function hasName(element: Element): boolean {
  if (accessibleName(element)) return true
  const title = element.getAttribute("title")
  if (title?.trim()) return true
  for (const image of element.querySelectorAll("img[alt], [role=img][aria-label]")) {
    if ((image.getAttribute("alt") ?? image.getAttribute("aria-label") ?? "").trim()) return true
  }
  for (const label of element.querySelectorAll("[aria-label]")) {
    if (label.getAttribute("aria-label")?.trim()) return true
  }
  for (const title of element.querySelectorAll("svg title")) {
    if (title.textContent?.trim()) return true
  }
  return Boolean(element.textContent?.trim())
}

/**
 * Run the checks on a document. `track` turns an element into the handle the
 * panel will later ask about.
 */
export function auditDocument(
  doc: Document,
  track: (element: Element) => string
): Pick<A11yAudit, "issues" | "checked" | "truncated"> {
  const view = doc.defaultView
  const issues: A11yIssue[] = []
  const perRule = new Map<A11yRule, number>()
  let truncated = false
  const report = (rule: A11yRule, impact: A11yImpact, element?: Element, detail?: string) => {
    const count = perRule.get(rule) ?? 0
    if (count >= MAX_PER_RULE) {
      truncated = true
      return
    }
    perRule.set(rule, count + 1)
    issues.push({
      rule,
      impact,
      ...(element
        ? {
            elementId: track(element),
            selector: uniqueSelector(element),
            label: elementLabel(element),
          }
        : {}),
      ...(detail ? { detail } : {}),
    })
  }

  if (!doc.documentElement.getAttribute("lang")?.trim()) report("html-lang", "serious")
  if (!doc.title.trim()) report("document-title", "serious")

  const elements = [...(doc.body?.querySelectorAll("*") ?? [])].slice(0, MAX_SCANNED)
  const readColor = createColorReader()
  const ids = new Map<string, Element[]>()
  let previousHeading = 0
  // On screen, form fields and frames included; aria-hidden is a rule here,
  // not a reason to look away.
  const visible = createVisibility(hidesFromView)

  for (const element of elements) {
    if (element.closest("[data-cognia-chrome]")) continue
    const tag = element.tagName.toLowerCase()
    const role = element.getAttribute("role")
    if (element.id) ids.set(element.id, [...(ids.get(element.id) ?? []), element])

    if (element.getAttribute("aria-hidden") === "true") {
      // Only where it is on screen: a hidden branch cannot be tabbed into.
      const parent = element.parentElement
      const focusable = element.matches(FOCUSABLE) ? element : element.querySelector(FOCUSABLE)
      const displayed = view?.getComputedStyle(element).display !== "none"
      if (focusable && displayed && (!parent || visible(parent)))
        report("aria-hidden-focus", "serious", focusable)
      continue
    }
    if (!visible(element)) continue

    const tabindex = Number(element.getAttribute("tabindex"))
    if (Number.isFinite(tabindex) && tabindex > 0)
      report("tabindex", "moderate", element, `tabindex=${tabindex}`)

    if (tag === "img" && role !== "presentation" && role !== "none" && !element.hasAttribute("alt"))
      report(
        "image-alt",
        "critical",
        element,
        element.getAttribute("src")?.split("/").pop()?.slice(0, 60)
      )
    if (tag === "input" && element.getAttribute("type") === "image" && !hasName(element))
      report("image-alt", "critical", element)
    if (role === "img" && !accessibleName(element)) report("image-alt", "serious", element)

    if ((tag === "button" || role === "button") && !hasName(element))
      report("button-name", "critical", element)
    if (((tag === "a" && element.hasAttribute("href")) || role === "link") && !hasName(element))
      report("link-name", "serious", element)

    if (
      (tag === "input" &&
        !["hidden", "submit", "button", "reset", "image"].includes(
          (element.getAttribute("type") ?? "text").toLowerCase()
        )) ||
      tag === "select" ||
      tag === "textarea"
    ) {
      const id = element.getAttribute("id")
      const labelled =
        Boolean(element.getAttribute("aria-label")?.trim()) ||
        Boolean(element.getAttribute("aria-labelledby")?.trim()) ||
        Boolean(element.getAttribute("title")?.trim()) ||
        Boolean(element.closest("label")) ||
        Boolean(id && doc.querySelector(`label[for="${id.replace(/["\\]/g, "\\$&")}"]`))
      if (!labelled)
        report(
          "label",
          "critical",
          element,
          element.getAttribute("placeholder") ? "placeholder only" : undefined
        )
    }

    if (
      tag === "iframe" &&
      !element.getAttribute("title")?.trim() &&
      !element.getAttribute("aria-label")
    )
      report("frame-title", "serious", element)

    const level = /^h([1-6])$/.exec(tag)?.[1]
    if (level) {
      const current = Number(level)
      if (!hasName(element)) report("empty-heading", "minor", element)
      if (previousHeading > 0 && current > previousHeading + 1)
        report("heading-order", "moderate", element, `h${previousHeading} → h${current}`)
      previousHeading = current
    }

    if (element.matches(FOCUSABLE) && view) {
      const style = view.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      // Inline links in running text are WCAG's own exception.
      const inline = tag === "a" && style.display === "inline"
      if (!inline && rect.width > 0 && rect.height > 0 && (rect.width < 24 || rect.height < 24))
        report(
          "target-size",
          "moderate",
          element,
          `${Math.round(rect.width)}×${Math.round(rect.height)}`
        )
    }

    if (view) checkContrast(element, view, readColor, report)
  }

  for (const [id, holders] of ids) {
    if (holders.length > 1) report("duplicate-id", "minor", holders[1], `#${id} ×${holders.length}`)
  }

  issues.sort((a, b) => IMPACT_ORDER[a.impact] - IMPACT_ORDER[b.impact])
  return { issues, checked: elements.length, truncated }
}

/** The colour behind an element: every translucent layer down to white, or null under an image. */
/** What the element's text sits on: its own and its ancestors' backgrounds, composited; null under an image. */
export function backgroundOf(
  element: Element,
  view: Window,
  readColor: (css: string) => Rgba | null
): Rgba | null {
  const layers: Rgba[] = []
  for (let node: Element | null = element; node; node = node.parentElement) {
    const style = view.getComputedStyle(node)
    if (style.backgroundImage && style.backgroundImage !== "none") return null
    // An unreadable or unset background paints nothing.
    const color = style.backgroundColor ? readColor(style.backgroundColor) : null
    if (!color || color[3] === 0) continue
    layers.push(color)
    if (color[3] >= 1) break
  }
  return layers.reduceRight<Rgba>((under, layer) => composite(layer, under), [255, 255, 255, 1])
}

/** How an element's text stands out from what it sits on, by WCAG 2. */
export interface TextContrast {
  /** Rounded to two places, as the checkers show it. */
  ratio: number
  foreground: string
  background: string
  /** Large text (24px, or 18.66px bold) needs less: 3:1 for AA, 4.5:1 for AAA. */
  large: boolean
  aa: boolean
  aaa: boolean
  /** The nearest colour that passes AA, when this one does not. */
  suggestion?: string
}

/** The element's text against its background; null when either cannot be read. */
export function textContrast(
  element: Element,
  view: Window,
  readColor: (css: string) => Rgba | null
): TextContrast | null {
  const style = view.getComputedStyle(element)
  const foreground = readColor(style.color)
  const background = backgroundOf(element, view, readColor)
  if (!foreground || !background) return null
  const text = composite(foreground, background)
  const ratio = contrastRatio(text, background)
  const size = Number.parseFloat(style.fontSize) || 16
  const weight = Number.parseInt(style.fontWeight, 10) || 400
  const large = size >= 24 || (size >= 18.66 && weight >= 700)
  const [aaNeeded, aaaNeeded] = large ? [3, 4.5] : [4.5, 7]
  const aa = ratio + 0.005 >= aaNeeded
  const suggestion = aa ? null : suggestContrast(text, background, aaNeeded)
  return {
    ratio: Math.round(ratio * 100) / 100,
    foreground: toHex(text),
    background: toHex(background),
    large,
    aa,
    aaa: ratio + 0.005 >= aaaNeeded,
    ...(suggestion ? { suggestion: toHex(suggestion) } : {}),
  }
}

function checkContrast(
  element: Element,
  view: Window,
  readColor: (css: string) => Rgba | null,
  report: (rule: A11yRule, impact: A11yImpact, element?: Element, detail?: string) => void
) {
  const ownText = [...element.childNodes].some(
    (child) => child.nodeType === 3 && (child.nodeValue ?? "").trim().length > 0
  )
  if (!ownText) return
  const contrast = textContrast(element, view, readColor)
  if (!contrast || contrast.aa) return
  report(
    "color-contrast",
    "serious",
    element,
    `${contrast.ratio.toFixed(2)}:1, needs ${contrast.large ? 3 : 4.5}:1 (${contrast.foreground} on ${contrast.background})`
  )
}

/** The findings as Markdown for the agent, worst first. */
export function auditMarkdown(audit: Pick<A11yAudit, "issues" | "checked" | "truncated">): string {
  const lines = [`## Accessibility check (${audit.issues.length} findings)`, ""]
  if (audit.issues.length === 0) {
    lines.push(
      `No findings in ${audit.checked} elements. This is a first pass, not a conformance audit.`
    )
    return lines.join("\n")
  }
  lines.push("A first pass with WCAG 2.2 AA thresholds; selectors match the live page.", "")
  for (const issue of audit.issues) {
    const where = issue.selector ? ` — \`${issue.selector}\`` : ""
    const detail = issue.detail ? ` (${issue.detail})` : ""
    lines.push(`- [${issue.impact}] ${A11Y_RULE_TEXT[issue.rule]}${where}${detail}`)
  }
  if (audit.truncated) lines.push("- … more findings of the same kinds were left out")
  return lines.join("\n")
}
