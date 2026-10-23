/**
 * Visual edits a person tries on a picked element (VisBug, UiToolbar).
 *
 * The page is a sketchpad here, not the product: an edit is applied inline on
 * the live element so the person can see it, and what is sent is the edit as
 * a request — "this property, from this value to that one" — for the agent to
 * make in the source. Nothing an edit does on the page outlives the pick: the
 * panel reverts it when the element leaves the list.
 */
import type { ElementEdits } from "./element-context"

export type StyleGroup = "layout" | "spacing" | "type" | "appearance"

export interface EditableProperty {
  property: string
  group: StyleGroup
  /** Offered as a colour well beside the text box. */
  color?: true
}

/** What the style editor offers, in the order it shows them. */
export const EDITABLE_PROPERTIES: readonly EditableProperty[] = [
  { property: "display", group: "layout" },
  { property: "width", group: "layout" },
  { property: "height", group: "layout" },
  { property: "flex-direction", group: "layout" },
  { property: "justify-content", group: "layout" },
  { property: "align-items", group: "layout" },
  { property: "margin", group: "spacing" },
  { property: "padding", group: "spacing" },
  { property: "gap", group: "spacing" },
  { property: "font-size", group: "type" },
  { property: "font-weight", group: "type" },
  { property: "line-height", group: "type" },
  { property: "letter-spacing", group: "type" },
  { property: "text-align", group: "type" },
  { property: "color", group: "type", color: true },
  { property: "background-color", group: "appearance", color: true },
  { property: "border", group: "appearance" },
  { property: "border-radius", group: "appearance" },
  { property: "box-shadow", group: "appearance" },
  { property: "opacity", group: "appearance" },
]

export const STYLE_GROUPS: readonly StyleGroup[] = ["layout", "spacing", "type", "appearance"]

const EDITABLE = new Set(EDITABLE_PROPERTIES.map((entry) => entry.property))
const MAX_VALUE = 200
/** A text replacement is copy, not a document. */
export const MAX_TEXT_EDIT = 2_000

export function isEditableProperty(property: string): boolean {
  return EDITABLE.has(property)
}

/**
 * Whether a value could be a CSS value at all: nothing that ends the
 * declaration, opens a block or reaches for another document. The browser's
 * own parser decides the rest when the value is applied.
 */
export function isSafeStyleValue(value: string): boolean {
  if (value.length > MAX_VALUE) return false
  if (/[;{}<>\\]/.test(value)) return false
  return !/url\s*\(|expression\s*\(|@import|javascript:/i.test(value)
}

/** Only edits to offered properties, with values that are plausibly CSS. */
export function sanitizeEdits(edits: ElementEdits): ElementEdits {
  const styles: Record<string, string> = {}
  for (const [property, raw] of Object.entries(edits.styles)) {
    const value = raw.trim()
    if (isEditableProperty(property) && value && isSafeStyleValue(value)) styles[property] = value
  }
  return {
    styles,
    ...(edits.text !== undefined ? { text: edits.text.slice(0, MAX_TEXT_EDIT) } : {}),
  }
}

/** One requested change, with the value it replaces. */
export interface StyleChange {
  property: string
  from: string
  to: string
}

/** The edits that actually change something, in the editor's order. */
export function styleChanges(
  computed: Record<string, string>,
  edits: Record<string, string>
): StyleChange[] {
  return EDITABLE_PROPERTIES.flatMap(({ property }) => {
    const to = edits[property]?.trim()
    if (!to) return []
    const from = computed[property] ?? ""
    return to === from ? [] : [{ property, from, to }]
  })
}

/** Whether a pick carries anything for the agent to change. */
export function hasEdits(computed: Record<string, string>, edits: ElementEdits, text: string) {
  return (
    styleChanges(computed, edits.styles).length > 0 ||
    (edits.text !== undefined && edits.text !== text)
  )
}

/** `rgb(37, 99, 235)` → `#2563eb`, for a colour well; anything else → null. */
export function colorToHex(value: string): string | null {
  const hex = value.trim().match(/^#([0-9a-f]{6})$/i)
  if (hex) return `#${hex[1]!.toLowerCase()}`
  const short = value.trim().match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i)
  if (short)
    return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase()
  const rgb = value.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i)
  if (!rgb) return null
  if (rgb[4] !== undefined && Number.parseFloat(rgb[4]) === 0) return null
  const channel = (raw: string | undefined) =>
    Math.max(0, Math.min(255, Number(raw ?? 0)))
      .toString(16)
      .padStart(2, "0")
  return `#${channel(rgb[1])}${channel(rgb[2])}${channel(rgb[3])}`
}
