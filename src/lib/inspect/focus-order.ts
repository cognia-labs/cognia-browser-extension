/**
 * How the page reads to someone using the keyboard (axe, Accessibility
 * Insights' tab stops): the order Tab moves through it, and where that order
 * goes wrong.
 *
 * The order is the browser's sequential navigation order — positive
 * `tabindex` first, ascending, then everything else focusable in document
 * order — over what the browser would actually stop on. The findings:
 * a positive `tabindex` that reorders the page; a stop nobody can see; focus
 * jumping back up the page; and something that looks clickable (a pointer
 * cursor of its own) but that Tab never reaches.
 *
 * Every stop and finding names the element it is, held by the picker like a
 * pick, so the order can be drawn on the page and a finding picked.
 */
import { createVisibility, elementLabel, uniqueSelector } from "./element-context"

export const FOCUS_RULES = [
  "positive-tabindex",
  "hidden-focusable",
  "order-jump",
  "unreachable-control",
] as const

export type FocusRule = (typeof FOCUS_RULES)[number]

export interface FocusIssue {
  rule: FocusRule
  elementId?: string
  selector?: string
  label?: string
  detail?: string
}

/** One Tab stop, in document CSS pixels. */
export interface FocusStop {
  elementId: string
  x: number
  y: number
  width: number
  height: number
}

export interface FocusCheck {
  tabId: number
  ranAt: number
  /** How many stops Tab goes through. */
  stops: number
  issues: FocusIssue[]
  truncated: boolean
}

export const MAX_STOPS = 300
const MAX_PER_RULE = 10
/** How far above the previous stop the next must start to count as a jump back up. */
const JUMP_PX = 40

const FOCUSABLE =
  "a[href], area[href], button, input, select, textarea, iframe, summary, [tabindex], [contenteditable]:not([contenteditable='false']), audio[controls], video[controls]"

function tabIndexOf(element: Element): number {
  const raw = element.getAttribute("tabindex")
  if (raw === null) return 0
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) ? value : 0
}

function isDisabled(element: Element): boolean {
  return (
    "disabled" in element &&
    (element as HTMLButtonElement).disabled === true &&
    /^(BUTTON|INPUT|SELECT|TEXTAREA)$/.test(element.tagName)
  )
}

export function checkFocusOrder(
  doc: Document,
  track: (element: Element) => string
): { check: Omit<FocusCheck, "tabId" | "ranAt">; order: FocusStop[] } {
  const view = doc.defaultView
  const issues: FocusIssue[] = []
  const counts = new Map<FocusRule, number>()
  let truncated = false
  const report = (rule: FocusRule, element: Element, detail?: string) => {
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
      ...(detail ? { detail } : {}),
    })
  }
  if (!view || !doc.body) return { check: { stops: 0, issues, truncated }, order: [] }

  const styles = new Map<Element, CSSStyleDeclaration>()
  const styleOf = (element: Element) => {
    let style = styles.get(element)
    if (!style) {
      style = view.getComputedStyle(element)
      styles.set(element, style)
    }
    return style
  }
  // What Tab skips: `hidden` and `display: none` anywhere up the tree, or
  // `visibility: hidden` (inherited, so read on the element). Not opacity —
  // a transparent button still takes focus, which is the problem.
  const displayed = createVisibility(
    (element) => element.hasAttribute("hidden") || styleOf(element).display === "none"
  )
  const rendered = (element: Element) =>
    displayed(element) && styleOf(element).visibility !== "hidden"
  const transparent = (element: Element) => {
    for (let node: Element | null = element; node && node !== doc.body; node = node.parentElement)
      if (Number.parseFloat(styleOf(node).opacity) === 0) return true
    return false
  }
  const page = (element: Element) => {
    const rect = element.getBoundingClientRect()
    return {
      x: Math.round(rect.left + view.scrollX),
      y: Math.round(rect.top + view.scrollY),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    }
  }

  // What the browser stops on: focusable, not disabled, not inert, rendered,
  // not taken out of the order by a negative tabindex.
  const candidates = [...doc.body.querySelectorAll(FOCUSABLE)].filter((element) => {
    if (element.closest("[data-cognia-chrome]") || element.closest("[inert]")) return false
    if (element.tagName === "INPUT" && (element as HTMLInputElement).type === "hidden") return false
    if (
      element.tagName === "A" &&
      !element.hasAttribute("href") &&
      !element.hasAttribute("tabindex")
    )
      return false
    if (isDisabled(element) || tabIndexOf(element) < 0) return false
    return rendered(element)
  })
  const ordered = candidates
    .map((element, index) => ({ element, index, tab: tabIndexOf(element) }))
    .sort((a, b) => {
      if (a.tab > 0 && b.tab > 0) return a.tab - b.tab || a.index - b.index
      if (a.tab > 0) return -1
      if (b.tab > 0) return 1
      return a.index - b.index
    })
  if (ordered.length > MAX_STOPS) truncated = true
  const stops = ordered.slice(0, MAX_STOPS)

  const order: FocusStop[] = []
  let previous: { x: number; y: number; width: number; height: number } | null = null
  stops.forEach(({ element, tab }, position) => {
    const box = page(element)
    order.push({ elementId: track(element), ...box })
    if (tab > 0) report("positive-tabindex", element, `tabindex="${tab}"`)
    const tiny = box.width < 2 && box.height < 2
    const offPage = box.x + box.width <= 0 || box.y + box.height <= 0
    const invisible = transparent(element)
    const unannounced = element.closest('[aria-hidden="true"]') !== null
    // A skip link sits off screen until it takes focus; that is its design.
    const skipLink =
      position < 3 &&
      element.tagName === "A" &&
      (element.getAttribute("href") ?? "").startsWith("#")
    if ((tiny || offPage || invisible) && !skipLink)
      report("hidden-focusable", element, tiny ? "no size" : offPage ? "off the page" : "opacity 0")
    else if (unannounced) report("hidden-focusable", element, 'inside aria-hidden="true"')
    if (!tiny && !offPage && !invisible) {
      if (previous && box.y + box.height <= previous.y - JUMP_PX)
        report(
          "order-jump",
          element,
          `stop ${position + 1} is ${previous.y - box.y}px above stop ${position}`
        )
      previous = box
    }
  })

  // A pointer cursor set on the element itself (not inherited), with no way
  // for the keyboard to get there: probably a click handler on a div.
  const reachable = new Set(candidates)
  for (const element of doc.body.querySelectorAll("*")) {
    if (counts.get("unreachable-control") === MAX_PER_RULE) {
      truncated = true
      break
    }
    if (element.closest("[data-cognia-chrome]") || reachable.has(element)) continue
    if (/^(LABEL|OPTION|HTML|BODY)$/i.test(element.tagName)) continue
    const style = styleOf(element)
    if (style.cursor !== "pointer") continue
    const parent = element.parentElement
    if (parent && styleOf(parent).cursor === "pointer") continue
    if (element.closest(FOCUSABLE) || element.querySelector(FOCUSABLE)) continue
    if (element.closest("label")) continue
    const box = page(element)
    if (box.width < 4 || box.height < 4 || !rendered(element)) continue
    const role = element.getAttribute("role")
    if (role === "presentation" || role === "none") continue
    report("unreachable-control", element, role ? `role="${role}"` : undefined)
  }

  const rank = new Map(FOCUS_RULES.map((rule, index) => [rule, index]))
  issues.sort((a, b) => (rank.get(a.rule) ?? 0) - (rank.get(b.rule) ?? 0))
  return { check: { stops: order.length, issues, truncated }, order }
}

export const FOCUS_RULE_TEXT: Record<FocusRule, string> = {
  "positive-tabindex": "Positive tabindex takes the element out of the page's reading order",
  "hidden-focusable": "Tab stops on something that cannot be seen",
  "order-jump": "Focus jumps back up the page",
  "unreachable-control": "Looks clickable but the keyboard cannot reach it",
}

export function focusMarkdown(check: Omit<FocusCheck, "tabId" | "ranAt">): string {
  const lines = [
    `## Keyboard focus check (${check.issues.length} findings)`,
    "",
    `Tab moves through ${check.stops} stops on this page. Selectors match the live page.`,
  ]
  if (check.issues.length === 0) lines.push("", "No keyboard problems found.")
  else lines.push("")
  for (const issue of check.issues) {
    const where = issue.selector ? ` — \`${issue.selector}\`` : ""
    lines.push(
      `- ${FOCUS_RULE_TEXT[issue.rule]}${where}${issue.detail ? ` (${issue.detail})` : ""}`
    )
  }
  if (check.truncated) lines.push("- … more of the same kinds were left out")
  return lines.join("\n")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** A stored focus check this build can show, from an unsent draft. */
export function parseFocus(value: unknown): Omit<FocusCheck, "tabId" | "ranAt"> | null {
  if (!isRecord(value) || typeof value.stops !== "number") return null
  return {
    stops: value.stops,
    issues: Array.isArray(value.issues)
      ? value.issues.filter(
          (item): item is FocusIssue =>
            isRecord(item) &&
            (FOCUS_RULES as readonly unknown[]).includes(item.rule) &&
            ["elementId", "selector", "label", "detail"].every(
              (key) => item[key] === undefined || typeof item[key] === "string"
            )
        )
      : [],
    truncated: value.truncated === true,
  }
}
