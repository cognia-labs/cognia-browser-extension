/**
 * Choosing several elements at once (VisBug, Figma): everything worth
 * picking inside a box dragged over the page, and every element that looks
 * like one already chosen.
 *
 * "Worth picking" is what a person points at — a control, a heading, a
 * paragraph, an image, a run of words — not the wrappers around them, and
 * never the inside of something already chosen: a box over a button takes
 * the button, not its label and icon besides.
 */
import type { ElementBox } from "./element-context"

const MEANINGFUL = [
  "a[href]",
  "button",
  "input:not([type=hidden])",
  "select",
  "textarea",
  "label",
  "summary",
  "[role=button]",
  "[role=link]",
  "[role=tab]",
  "[role=checkbox]",
  "[role=switch]",
  "[role=menuitem]",
  "img",
  "svg",
  "video",
  "canvas",
  "picture",
  "iframe",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "li",
  "td",
  "th",
  "blockquote",
  "pre",
  "figcaption",
].join(",")

/** How far past the box an element may reach and still count as inside it. */
const SLACK = 2

/** A control, a heading, a paragraph, an image, or anything with words of its own. */
export function isMeaningful(element: Element): boolean {
  if (element.matches(MEANINGFUL)) return true
  for (const child of element.childNodes)
    if (child.nodeType === 3 && (child.textContent ?? "").trim()) return true
  return false
}

function visibleBox(element: Element): DOMRect | null {
  const rect = element.getBoundingClientRect()
  return rect.width >= 2 && rect.height >= 2 ? rect : null
}

/**
 * Everything worth picking that lies wholly inside `box` (viewport CSS
 * pixels), outermost first in document order; `accept` leaves out what may
 * not be picked, such as the extension's own chrome.
 */
export function elementsInBox(
  doc: Document,
  box: ElementBox,
  accept: (element: Element) => boolean,
  limit = Infinity
): Element[] {
  if (!doc.body || box.width < 1 || box.height < 1) return []
  const right = box.x + box.width
  const bottom = box.y + box.height
  const inside: Element[] = []
  for (const element of doc.body.querySelectorAll("*")) {
    if (inside.length >= limit) break
    // Inside something already taken: that is what was meant.
    if (inside.some((outer) => outer.contains(element))) continue
    // Parts of a drawing are the drawing.
    if (element instanceof SVGElement && element.tagName.toLowerCase() !== "svg") continue
    if (!accept(element) || !isMeaningful(element)) continue
    const rect = visibleBox(element)
    if (!rect) continue
    if (
      rect.left >= box.x - SLACK &&
      rect.top >= box.y - SLACK &&
      rect.right <= right + SLACK &&
      rect.bottom <= bottom + SLACK
    )
      inside.push(element)
  }
  return inside
}

function classSet(element: Element): string {
  return [...element.classList].sort().join(" ")
}

/**
 * The elements that look like `element` — the same tag and the same classes,
 * in any order — itself included, in document order. An element with no
 * class matches others of its tag with none, under the same kind of parent.
 */
export function alikeElements(
  doc: Document,
  element: Element,
  accept: (element: Element) => boolean,
  limit = Infinity
): Element[] {
  const classes = classSet(element)
  const parentTag = element.parentElement?.tagName
  const alike: Element[] = []
  for (const candidate of doc.querySelectorAll(element.tagName)) {
    if (alike.length >= limit) break
    if (candidate !== element) {
      if (classSet(candidate) !== classes) continue
      if (!classes && candidate.parentElement?.tagName !== parentTag) continue
      if (!accept(candidate) || !visibleBox(candidate)) continue
    }
    alike.push(candidate)
  }
  return alike
}
