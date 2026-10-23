/**
 * A picked element's markup, cleaned for an agent to read (html.to.design's
 * "copy as HTML", React Grab's snippet).
 *
 * The outline says what the subtree is; the markup says how it is written —
 * the classes, attributes and nesting a search of the source will match.
 * It follows the capture's privacy rules: no form values, no handlers, no
 * scripts, nothing the page hid, and editable regions as empty shells. It is
 * cut by depth, breadth and length so one pick never crowds out the request.
 */
import { bareUrl, hidesFromView } from "./element-context"

const OMITTED_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "LINK", "META"])
/** Rendered as a tag with nothing inside: what is in them is the person's or opaque. */
const SHELL_TAGS = new Set([
  "TEXTAREA",
  "SELECT",
  "IFRAME",
  "FRAME",
  "OBJECT",
  "EMBED",
  "CANVAS",
  "AUDIO",
  "VIDEO",
  "SVG",
  "MATH",
])
const VOID_TAGS = new Set([
  "AREA",
  "BASE",
  "BR",
  "COL",
  "EMBED",
  "HR",
  "IMG",
  "INPUT",
  "SOURCE",
  "TRACK",
  "WBR",
])
const DROPPED_ATTRIBUTES = new Set(["srcset", "srcdoc", "nonce", "integrity", "ping", "sizes"])
/** Inputs whose `value` is their label, not something typed. */
const LABEL_VALUE_TYPES = new Set(["button", "submit", "reset"])

export const MARKUP_LIMITS = {
  depth: 5,
  children: 10,
  nodes: 60,
  attributes: 12,
  attribute: 80,
  text: 80,
  total: 2_500,
} as const

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, "&quot;")
}

function attributesOf(element: Element): string {
  const tag = element.tagName.toUpperCase()
  const parts: string[] = []
  for (const attribute of element.attributes) {
    if (parts.length >= MARKUP_LIMITS.attributes) {
      parts.push("…")
      break
    }
    const name = attribute.name.toLowerCase()
    if (name.startsWith("on") || DROPPED_ATTRIBUTES.has(name)) continue
    if (name === "value") {
      const type = (element.getAttribute("type") ?? "").toLowerCase()
      if (!(tag === "INPUT" && LABEL_VALUE_TYPES.has(type)) && tag !== "BUTTON") continue
    }
    let value = attribute.value
    if (name === "href" || name === "src" || name === "action" || name === "poster")
      value = bareUrl(value, element.ownerDocument.baseURI)
    value = clip(collapse(value), MARKUP_LIMITS.attribute)
    // As written: SVG's `viewBox` is not `viewbox`.
    const written = attribute.name
    parts.push(value === "" ? written : `${written}="${escapeAttribute(value)}"`)
  }
  return parts.length > 0 ? ` ${parts.join(" ")}` : ""
}

/** The element's markup, indented, cleaned and cut; "" for a non-element. */
export function elementMarkup(root: Element): string {
  let nodes = 0
  const lines: string[] = []

  const render = (element: Element, depth: number) => {
    const indent = "  ".repeat(depth)
    const tag = element.tagName.toLowerCase()
    const upper = element.tagName.toUpperCase()
    const open = `<${tag}${attributesOf(element)}>`
    nodes++
    if (VOID_TAGS.has(upper)) {
      lines.push(`${indent}${open}`)
      return
    }
    const close = `</${tag}>`
    const editable = element.getAttribute("contenteditable")
    const shell =
      SHELL_TAGS.has(upper) ||
      element.getAttribute("aria-hidden") === "true" ||
      (editable !== null && editable.toLowerCase() !== "false") ||
      (element as HTMLElement).isContentEditable === true
    if (shell) {
      const inside = element.childNodes.length > 0 ? "…" : ""
      lines.push(`${indent}${open}${inside}${close}`)
      return
    }
    const children = [...element.childNodes].filter((child) => {
      if (child.nodeType === 3) return collapse(child.nodeValue ?? "") !== ""
      if (child.nodeType !== 1) return false
      const node = child as Element
      return !OMITTED_TAGS.has(node.tagName.toUpperCase()) && !hidesFromView(node)
    })
    if (children.length === 0) {
      lines.push(`${indent}${open}${close}`)
      return
    }
    const only = children[0]!
    if (children.length === 1 && only.nodeType === 3) {
      lines.push(
        `${indent}${open}${escapeText(clip(collapse(only.nodeValue ?? ""), MARKUP_LIMITS.text))}${close}`
      )
      return
    }
    if (depth >= MARKUP_LIMITS.depth) {
      lines.push(`${indent}${open}…${close}`)
      return
    }
    lines.push(`${indent}${open}`)
    let shown = 0
    for (const child of children) {
      if (shown >= MARKUP_LIMITS.children || nodes >= MARKUP_LIMITS.nodes) break
      shown++
      if (child.nodeType === 3)
        lines.push(
          `${indent}  ${escapeText(clip(collapse(child.nodeValue ?? ""), MARKUP_LIMITS.text))}`
        )
      else render(child as Element, depth + 1)
    }
    if (shown < children.length) lines.push(`${indent}  <!-- ${children.length - shown} more -->`)
    lines.push(`${indent}${close}`)
  }

  render(root, 0)
  const markup = lines.join("\n")
  if (markup.length <= MARKUP_LIMITS.total) return markup
  const cut = markup.slice(0, MARKUP_LIMITS.total)
  return `${cut.slice(0, cut.lastIndexOf("\n"))}\n<!-- … cut -->`
}

/**
 * The element as a snippet to paste: its markup and, under it, the CSS the
 * page computed for it — with the person's previewed edits in place.
 */
export function codeSnippet(element: {
  selector: string
  html?: string
  styles: Record<string, string>
  edits: { styles: Record<string, string> }
}): string {
  const styles = { ...element.styles, ...element.edits.styles }
  const css = [
    `${element.selector} {`,
    ...Object.entries(styles).map(([property, value]) => `  ${property}: ${value};`),
    "}",
  ].join("\n")
  return element.html ? `${element.html}\n\n<style>\n${css}\n</style>` : css
}
