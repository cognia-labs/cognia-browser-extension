/**
 * What the element picker learns about one element (Design Mode, React Grab).
 *
 * The person points at a thing on the page; the agent needs to find that same
 * thing in the source. Neither a screenshot nor the page text says which
 * component rendered it, so the pick carries what does: a selector that
 * matches exactly one element, its role and accessible name, the computed
 * values a designer reads off it (box, spacing, type, colour), its parent's
 * layout, a short outline of what is inside it and every source hint the page
 * exposes — dev-tool `data-*` attributes here, framework internals from the
 * page's own world in `framework-source.ts`.
 *
 * Everything here is the page's claim and is reviewed in the panel before it
 * is sent. Like the capture, it never includes what a person typed: form
 * values, `contenteditable` text and password fields stay out by the same
 * visibility rules as the capture ({@link isShown}).
 */

import type { TextContrast } from "./a11y-audit"

export interface ElementBox {
  x: number
  y: number
  width: number
  height: number
}

export interface PageViewport {
  width: number
  height: number
  dpr: number
  scrollX: number
  scrollY: number
}

/** A place in the page's source, as the page's own tooling reported it. */
export interface SourceLocation {
  file: string
  line?: number
  column?: number
  /** Read off a stack or a zero-based counter: the file is sure, the line close. */
  approximate?: true
}

/** One component on the way from the element up to the root. */
export interface ComponentFrame {
  name: string
  source?: SourceLocation
}

export type InspectFramework = "react" | "vue" | "svelte" | "angular"

/** What the page's framework says rendered the element, read in its own world. */
export interface FrameworkInfo {
  framework: InspectFramework
  /** Nearest first. */
  components: ComponentFrame[]
  /** Where the element itself was written, when the framework records it. */
  source?: SourceLocation
  /**
   * The nearest component's props (React DevTools), as cut-down JSON: values
   * shortened, functions and elements named, anything that looks like a
   * secret by its key redacted.
   */
  props?: { component: string; json: string }
  /**
   * The same component's state, cut down the same way: React's state hooks
   * in call order or a class's `state`, Vue's `data` and `setup()` state.
   */
  state?: { component: string; json: string }
}

/** What the page answers for a pick, before the panel adds the person's part. */
export interface ElementDescription {
  /** The picker's handle for the element in this document. */
  elementId: string
  selector: string
  tag: string
  /** `button.primary`, `#save`: what to call it in one line. */
  label: string
  role?: string
  name?: string
  /** Visible text, collapsed and cut. Never a form value. */
  text: string
  /** A leaf with visible text, whose copy a text edit may replace. */
  textEditable: boolean
  attributes: Record<string, string>
  /** Viewport CSS pixels, at the moment of the pick. */
  box: ElementBox
  viewport: PageViewport
  /** Computed values worth reading, defaults left out. */
  styles: Record<string, string>
  parent?: { label: string; styles: Record<string, string> }
  /** An indented sketch of the element's subtree, tags and classes only. */
  outline: string
  /** The element's markup, cleaned of values, handlers and scripts, and cut (`element-markup.ts`). */
  html?: string
  /** How its text stands out from its background, for an element with text. */
  contrast?: TextContrast
  /** Dev-tool attributes on the element or an ancestor. */
  sourceHints: SourceLocation[]
  framework?: FrameworkInfo
}

/** Style changes and a text replacement, previewed live on the page. */
export interface ElementEdits {
  styles: Record<string, string>
  text?: string
}

/** A picked element as the panel holds it. */
export interface PickedElement extends ElementDescription {
  tabId: number
  /** The tab's address when it was picked; a later navigation orphans the pick. */
  pageUrl: string
  pickedAt: number
  /** What the person wants changed, in their words. */
  note: string
  edits: ElementEdits
  /** Screenshot attachments of it, oldest first: as picked, then with edits. */
  screenshotIds: string[]
}

/** The computed properties a pick reports. */
export const DESCRIBED_STYLES = [
  "display",
  "position",
  "box-sizing",
  "width",
  "height",
  "margin",
  "padding",
  "gap",
  "flex-direction",
  "flex-wrap",
  "justify-content",
  "align-items",
  "grid-template-columns",
  "color",
  "background-color",
  "background-image",
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "letter-spacing",
  "text-align",
  "text-transform",
  "border",
  "border-radius",
  "box-shadow",
  "opacity",
  "overflow",
  "z-index",
] as const

/** The parent's layout, which decides where a child can actually move. */
export const PARENT_STYLES = [
  "display",
  "flex-direction",
  "flex-wrap",
  "justify-content",
  "align-items",
  "gap",
  "grid-template-columns",
  "padding",
] as const

/** Values that say "nothing set" and only add noise to what is sent. */
const DEFAULT_VALUES = new Set([
  "",
  "none",
  "normal",
  "auto",
  "0px",
  "rgba(0, 0, 0, 0)",
  "0px none rgb(0, 0, 0)",
  "visible",
  "static",
  "nowrap",
  "content-box",
])

/** Kept even at their default: their value is what a designer asks about. */
const ALWAYS_REPORTED = new Set(["display", "width", "height", "color", "font-size", "font-family"])

/** Attributes worth sending: identity and semantics, never values or handlers. */
const REPORTED_ATTRIBUTES = [
  "id",
  "class",
  "role",
  "type",
  "name",
  "href",
  "src",
  "alt",
  "title",
  "placeholder",
  "aria-label",
  "aria-describedby",
  "aria-expanded",
  "aria-selected",
  "aria-checked",
  "aria-disabled",
  "disabled",
  "for",
  "data-testid",
  "data-test",
  "data-cy",
  "data-qa",
  "data-state",
  "data-variant",
] as const

const TEST_ID_ATTRIBUTES = ["data-testid", "data-test", "data-cy", "data-qa"] as const

/** Text a single field may carry; the panel enforces the Host's total. */
const MAX_TEXT = 300
const MAX_ATTRIBUTE = 200
const MAX_OUTLINE_NODES = 40
const MAX_OUTLINE_DEPTH = 3

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

/**
 * The capture's visibility rules (`html-to-markdown.ts`), less one: a
 * button's label is what a person reads on it, and the agent needs it to find
 * the button. What a person typed — fields, options, editable regions — and
 * what the page hid stay out exactly as they do there.
 */
const SKIPPED_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEMPLATE",
  "IFRAME",
  "FRAME",
  "OBJECT",
  "EMBED",
  "CANVAS",
  "AUDIO",
  "VIDEO",
  "INPUT",
  "TEXTAREA",
  "SELECT",
  "OPTION",
  "DATALIST",
  "OUTPUT",
])

export function isShown(node: Node): boolean {
  for (
    let element = node.nodeType === 1 ? (node as Element) : node.parentElement;
    element;
    element = element.parentElement
  ) {
    if (hidesSubtree(element)) return false
  }
  return true
}

/**
 * {@link isShown} for a scan over many elements: each element is asked once,
 * where a page of a few thousand nodes would otherwise re-walk every chain.
 */
export function createVisibility(
  hides: (element: Element) => boolean = hidesSubtree
): (element: Element) => boolean {
  const known = new Map<Element, boolean>()
  const visible = (element: Element): boolean => {
    const cached = known.get(element)
    if (cached !== undefined) return cached
    const parent = element.parentElement
    const answer = !hides(element) && (parent ? visible(parent) : true)
    known.set(element, answer)
    return answer
  }
  return visible
}

/**
 * Whether this element keeps its text from a pick: it hides it, or the text
 * is something a person typed. Its ancestors are not asked.
 */
export function hidesSubtree(element: Element): boolean {
  const editable = element.getAttribute("contenteditable")
  if (
    SKIPPED_TAGS.has(element.tagName.toUpperCase()) ||
    element.getAttribute("aria-hidden") === "true" ||
    (editable !== null && editable.toLowerCase() !== "false") ||
    (element as HTMLElement).isContentEditable
  )
    return true
  return hidesFromView(element)
}

/**
 * Whether this element is off the screen by its own styles — what a check of
 * how the page looks needs, where form fields and frames count as much as
 * text. Its ancestors are not asked.
 */
export function hidesFromView(element: Element): boolean {
  if (element.hasAttribute("hidden")) return true
  const view = element.ownerDocument.defaultView
  if (typeof view?.getComputedStyle !== "function") return false
  const style = view.getComputedStyle(element)
  return style.display === "none" || style.visibility === "hidden" || style.opacity === "0"
}

/** `CSS.escape` where it exists; a conservative fallback where it does not (jsdom). */
export function escapeIdentifier(value: string): string {
  const css = (globalThis as { CSS?: { escape?: (input: string) => string } }).CSS
  if (typeof css?.escape === "function") return css.escape(value)
  return value.replace(/^(\d)/, "\\3$1 ").replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`)
}

/** A class name that reads like one a person wrote, rather than a hash. */
function isStableClass(name: string): boolean {
  if (!/^[a-zA-Z_][\w-]*$/.test(name) || name.length > 32) return false
  // css-modules, styled-components and emotion suffixes.
  if (/(?:^|[-_])[a-zA-Z0-9]{5,}$/.test(name) && /\d/.test(name)) return false
  return !/^(?:css|sc|jsx|emotion|svelte)-/.test(name)
}

function stableClasses(element: Element): string[] {
  return [...element.classList].filter(isStableClass).slice(0, 2)
}

/** `button.primary`, `#save`, `input[type=email]`. */
export function elementLabel(element: Element): string {
  const tag = element.tagName.toLowerCase()
  if (element.id && /^[a-zA-Z][\w-]*$/.test(element.id)) return `${tag}#${element.id}`
  const classes = stableClasses(element)
  if (classes.length > 0) return `${tag}.${classes.join(".")}`
  const type = element.getAttribute("type")
  return type ? `${tag}[type=${type}]` : tag
}

function matchesOnce(doc: Document, selector: string, element: Element): boolean {
  try {
    const found = doc.querySelectorAll(selector)
    return found.length === 1 && found[0] === element
  } catch {
    return false
  }
}

/**
 * A CSS selector that matches this element and no other, as short as the page
 * allows: an id, a test id, then a path of tags and stable classes with
 * `:nth-of-type` only where siblings would otherwise tie.
 */
export function uniqueSelector(element: Element): string {
  const doc = element.ownerDocument
  if (element.id && matchesOnce(doc, `#${escapeIdentifier(element.id)}`, element)) {
    return `#${escapeIdentifier(element.id)}`
  }
  for (const attribute of TEST_ID_ATTRIBUTES) {
    const value = element.getAttribute(attribute)
    if (!value) continue
    const selector = `${element.tagName.toLowerCase()}[${attribute}="${value.replace(/["\\]/g, "\\$&")}"]`
    if (matchesOnce(doc, selector, element)) return selector
  }
  const path: string[] = []
  let node: Element | null = element
  while (node && node !== doc.documentElement) {
    if (node !== element && node.id && matchesOnce(doc, `#${escapeIdentifier(node.id)}`, node)) {
      path.unshift(`#${escapeIdentifier(node.id)}`)
      break
    }
    const tag = node.tagName.toLowerCase()
    let part =
      tag +
      stableClasses(node)
        .map((name) => `.${escapeIdentifier(name)}`)
        .join("")
    const parent: Element | null = node.parentElement
    if (parent) {
      const sameTag = [...parent.children].filter((child) => child.tagName === node!.tagName)
      if (sameTag.length > 1) part += `:nth-of-type(${sameTag.indexOf(node) + 1})`
    }
    path.unshift(part)
    const candidate = path.join(" > ")
    if (matchesOnce(doc, candidate, element)) return candidate
    node = parent
  }
  return path.join(" > ")
}

const IMPLICIT_ROLES: Record<string, string> = {
  button: "button",
  nav: "navigation",
  main: "main",
  header: "banner",
  footer: "contentinfo",
  aside: "complementary",
  form: "form",
  ul: "list",
  ol: "list",
  li: "listitem",
  table: "table",
  img: "img",
  select: "combobox",
  textarea: "textbox",
  dialog: "dialog",
  h1: "heading",
  h2: "heading",
  h3: "heading",
  h4: "heading",
  h5: "heading",
  h6: "heading",
}

function roleOf(element: Element): string | undefined {
  const explicit = element.getAttribute("role")
  if (explicit) return explicit
  const tag = element.tagName.toLowerCase()
  if (tag === "a") return element.hasAttribute("href") ? "link" : undefined
  if (tag === "input") {
    const type = (element.getAttribute("type") ?? "text").toLowerCase()
    if (type === "checkbox" || type === "radio") return type
    if (type === "submit" || type === "button" || type === "reset") return "button"
    return type === "hidden" ? undefined : "textbox"
  }
  return IMPLICIT_ROLES[tag]
}

/**
 * The visible text in an element, by the capture's visibility rules: nothing
 * hidden, nothing a person typed, nothing from a form control.
 */
export function visibleText(element: Element, max = MAX_TEXT): string {
  const doc = element.ownerDocument
  if (!isShown(element)) return ""
  const parts: string[] = []
  let length = 0
  const walker = doc.createTreeWalker(element, 4 /* NodeFilter.SHOW_TEXT */)
  for (let node = walker.nextNode(); node && length < max; node = walker.nextNode()) {
    const value = node.nodeValue ?? ""
    if (!value.trim() || !isShown(node)) continue
    parts.push(value)
    length += value.length
  }
  return clip(collapse(parts.join(" ")), max)
}

export function accessibleName(element: Element): string | undefined {
  const label = element.getAttribute("aria-label")
  if (label?.trim()) return clip(collapse(label), MAX_TEXT)
  const labelledBy = element.getAttribute("aria-labelledby")
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => element.ownerDocument.getElementById(id))
      .filter((node): node is HTMLElement => node !== null)
      .map((node) => visibleText(node))
      .join(" ")
    if (text.trim()) return clip(collapse(text), MAX_TEXT)
  }
  const alt = element.getAttribute("alt") ?? element.getAttribute("title")
  if (alt?.trim()) return clip(collapse(alt), MAX_TEXT)
  const tag = element.tagName.toLowerCase()
  if (tag === "input" || tag === "textarea" || tag === "select") {
    const id = element.getAttribute("id")
    const labelFor = id
      ? element.ownerDocument.querySelector(`label[for="${id.replace(/["\\]/g, "\\$&")}"]`)
      : element.closest("label")
    const text = labelFor ? visibleText(labelFor) : ""
    if (text) return text
    const placeholder = element.getAttribute("placeholder")
    return placeholder ? clip(collapse(placeholder), MAX_TEXT) : undefined
  }
  if (["button", "a", "summary", "h1", "h2", "h3", "h4", "h5", "h6", "label"].includes(tag)) {
    const text = visibleText(element, 120)
    return text || undefined
  }
  return undefined
}

/** An address with its query, fragment and credentials gone, as the capture sends one. */
export function bareUrl(value: string, base: string): string {
  try {
    const url = new URL(value, base)
    if (url.protocol === "data:") return "data:…"
    url.username = ""
    url.password = ""
    url.search = ""
    url.hash = ""
    return url.toString()
  } catch {
    return clip(value, MAX_ATTRIBUTE)
  }
}

function reportedAttributes(element: Element): Record<string, string> {
  const attributes: Record<string, string> = {}
  for (const name of REPORTED_ATTRIBUTES) {
    const value = element.getAttribute(name)
    if (value === null) continue
    attributes[name] =
      name === "href" || name === "src"
        ? bareUrl(value, element.ownerDocument.baseURI)
        : clip(collapse(value), MAX_ATTRIBUTE)
  }
  return attributes
}

/** The named computed values, the defaults that say nothing left out. */
export function computedStyles(
  element: Element,
  properties: readonly string[] = DESCRIBED_STYLES
): Record<string, string> {
  const view = element.ownerDocument.defaultView
  if (!view || typeof view.getComputedStyle !== "function") return {}
  const style = view.getComputedStyle(element)
  const styles: Record<string, string> = {}
  for (const property of properties) {
    const value = collapse(style.getPropertyValue(property))
    if (!value) continue
    if (DEFAULT_VALUES.has(value) && !ALWAYS_REPORTED.has(property)) continue
    styles[property] = clip(value, MAX_ATTRIBUTE)
  }
  return styles
}

/**
 * An indented sketch of the subtree — tags, stable classes, a little text —
 * so the agent can tell a card from its title without the page's markup.
 */
export function elementOutline(element: Element): string {
  const lines: string[] = []
  let count = 0
  const visit = (node: Element, depth: number) => {
    if (count >= MAX_OUTLINE_NODES || !isShown(node)) return
    count++
    const own = [...node.childNodes]
      .filter((child) => child.nodeType === 3)
      .map((child) => child.nodeValue ?? "")
      .join(" ")
    const text = collapse(own)
    lines.push(`${"  ".repeat(depth)}${elementLabel(node)}${text ? ` "${clip(text, 60)}"` : ""}`)
    if (depth >= MAX_OUTLINE_DEPTH) {
      if (node.children.length > 0) lines.push(`${"  ".repeat(depth + 1)}…`)
      return
    }
    for (const child of node.children) visit(child, depth + 1)
  }
  visit(element, 0)
  if (count >= MAX_OUTLINE_NODES) lines.push("…")
  return lines.join("\n")
}

/**
 * Source hints from build-time tooling: `code-inspector-plugin`,
 * `vite-plugin-vue-inspector`, `react-dev-inspector` and similar stamp the
 * element (or its nearest component root) with where it was written.
 */
export function sourceHintsFor(element: Element): SourceLocation[] {
  const hints: SourceLocation[] = []
  const seen = new Set<string>()
  const push = (location: SourceLocation | null) => {
    if (!location || !location.file) return
    const key = `${location.file}:${location.line ?? ""}:${location.column ?? ""}`
    if (seen.has(key)) return
    seen.add(key)
    hints.push(location)
  }
  for (let node: Element | null = element; node && hints.length < 3; node = node.parentElement) {
    // `src/App.tsx:12:5:div` and `src/App.vue:3:5`.
    for (const name of ["data-insp-path", "data-v-inspector", "data-source-loc", "data-loc"]) {
      const value = node.getAttribute(name)
      if (value) push(parseLocation(value))
    }
    const file =
      node.getAttribute("data-inspector-relative-path") ?? node.getAttribute("data-source-file")
    if (file) {
      const line = Number(
        node.getAttribute("data-inspector-line") ?? node.getAttribute("data-source-line")
      )
      const column = Number(node.getAttribute("data-inspector-column"))
      push({
        file,
        ...(Number.isFinite(line) && line > 0 ? { line } : {}),
        ...(Number.isFinite(column) && column > 0 ? { column } : {}),
      })
    }
  }
  return hints
}

/** `path/to/file.tsx:12:5` (and an optional trailing `:tag`) as a location. */
export function parseLocation(value: string): SourceLocation | null {
  const match = value.trim().match(/^(.+?\.[a-zA-Z0-9]+)(?::(\d+))?(?::(\d+))?(?::[^:]*)?$/)
  if (!match?.[1]) return null
  const line = match[2] ? Number(match[2]) : undefined
  const column = match[3] ? Number(match[3]) : undefined
  return {
    file: clip(match[1], MAX_ATTRIBUTE),
    ...(line ? { line } : {}),
    ...(column ? { column } : {}),
  }
}

/** Everything the page can say about an element, without its framework's internals. */
export function describeElement(element: Element, elementId: string): ElementDescription {
  const doc = element.ownerDocument
  const view = doc.defaultView
  const rect = element.getBoundingClientRect()
  const parent = element.parentElement
  const role = roleOf(element)
  const name = accessibleName(element)
  const text = visibleText(element)
  return {
    elementId,
    selector: uniqueSelector(element),
    tag: element.tagName.toLowerCase(),
    label: elementLabel(element),
    ...(role ? { role } : {}),
    ...(name ? { name } : {}),
    text,
    textEditable: element.children.length === 0 && text.length > 0,
    attributes: reportedAttributes(element),
    box: {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
    viewport: {
      width: view?.innerWidth ?? 0,
      height: view?.innerHeight ?? 0,
      dpr: view?.devicePixelRatio || 1,
      scrollX: Math.round(view?.scrollX ?? 0),
      scrollY: Math.round(view?.scrollY ?? 0),
    },
    styles: computedStyles(element),
    ...(parent && parent !== doc.documentElement
      ? {
          parent: {
            label: elementLabel(parent),
            styles: computedStyles(parent, PARENT_STYLES),
          },
        }
      : {}),
    outline: elementOutline(element),
    sourceHints: sourceHintsFor(element),
  }
}

/** A pick nobody completes ends by itself, and puts the page back. */
export const PICK_TIMEOUT_MS = 120_000
