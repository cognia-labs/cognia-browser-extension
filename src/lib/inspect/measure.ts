/**
 * Distances between two elements on the page (VisBug's measure tool), as the
 * person sees them and as the agent reads them.
 *
 * "This gap should be 16px" is the most common design review comment, and
 * the one a screenshot carries worst: the agent cannot read pixels off an
 * image reliably, and does not know which boxes the person meant. A
 * measurement names both elements by selector and says the numbers.
 *
 * Boxes are border boxes in CSS pixels, from `getBoundingClientRect` — what
 * the browser laid out, not what any stylesheet asked for.
 */
import type { ElementBox } from "./element-context"

export interface MeasuredElement {
  elementId: string
  selector: string
  label: string
  box: ElementBox
}

/** Where `to` is, seen from `from`. */
export type MeasureRelation = "apart" | "inside" | "contains" | "overlap" | "same"

export interface Spacing {
  top: number
  right: number
  bottom: number
  left: number
}

export interface BoxMeasure {
  relation: MeasureRelation
  /** The empty space between the boxes along x, when they do not overlap there. */
  horizontal?: { gap: number; side: "left" | "right" }
  /** The empty space between the boxes along y, when they do not overlap there. */
  vertical?: { gap: number; side: "above" | "below" }
  /** How far the inner box sits from each edge of the outer one, when one holds the other. */
  insets?: Spacing
  /**
   * `to`'s edges and centres minus `from`'s, signed: 0 is aligned, a few
   * pixels either way is the near miss a review is looking for.
   */
  offsets: Spacing & { centerX: number; centerY: number }
}

export interface Measurement {
  id: string
  tabId: number
  pageUrl: string
  measuredAt: number
  from: MeasuredElement
  to: MeasuredElement
  measure: BoxMeasure
  note: string
}

/** A measurement as the picker answers it; `more` when Shift asks to keep measuring. */
export type MeasureResult = {
  from: MeasuredElement
  to: MeasuredElement
  measure: BoxMeasure
  more?: boolean
} | null

/** More measurements than this is a spec sheet, not a review. */
export const MAX_MEASUREMENTS = 12

const round = (value: number) => Math.round(value * 100) / 100

const right = (box: ElementBox) => box.x + box.width
const bottom = (box: ElementBox) => box.y + box.height

function holds(outer: ElementBox, inner: ElementBox): boolean {
  return (
    inner.x >= outer.x - 0.5 &&
    inner.y >= outer.y - 0.5 &&
    right(inner) <= right(outer) + 0.5 &&
    bottom(inner) <= bottom(outer) + 0.5
  )
}

function insetsOf(outer: ElementBox, inner: ElementBox): Spacing {
  return {
    top: round(inner.y - outer.y),
    right: round(right(outer) - right(inner)),
    bottom: round(bottom(outer) - bottom(inner)),
    left: round(inner.x - outer.x),
  }
}

export function measureBoxes(from: ElementBox, to: ElementBox): BoxMeasure {
  const offsets = {
    top: round(to.y - from.y),
    right: round(right(to) - right(from)),
    bottom: round(bottom(to) - bottom(from)),
    left: round(to.x - from.x),
    centerX: round(to.x + to.width / 2 - (from.x + from.width / 2)),
    centerY: round(to.y + to.height / 2 - (from.y + from.height / 2)),
  }
  const same = [offsets.top, offsets.right, offsets.bottom, offsets.left].every(
    (value) => Math.abs(value) < 0.5
  )
  if (same) return { relation: "same", offsets }
  if (holds(from, to)) return { relation: "inside", insets: insetsOf(from, to), offsets }
  if (holds(to, from)) return { relation: "contains", insets: insetsOf(to, from), offsets }
  const measure: BoxMeasure = { relation: "overlap", offsets }
  if (to.x >= right(from)) measure.horizontal = { gap: round(to.x - right(from)), side: "right" }
  else if (right(to) <= from.x)
    measure.horizontal = { gap: round(from.x - right(to)), side: "left" }
  if (to.y >= bottom(from)) measure.vertical = { gap: round(to.y - bottom(from)), side: "below" }
  else if (bottom(to) <= from.y)
    measure.vertical = { gap: round(from.y - bottom(to)), side: "above" }
  if (measure.horizontal || measure.vertical) measure.relation = "apart"
  return measure
}

/** A line to draw on the page between two edges, with its length as its label. */
export interface MeasureGuide {
  x1: number
  y1: number
  x2: number
  y2: number
  label: string
}

/** Pixels, without a trailing `.0`. */
export function pixels(value: number): string {
  const rounded = Math.round(value * 10) / 10
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}px`
}

/** Where the overlay draws the distances of `measure`, in viewport pixels. */
export function measureGuides(
  from: ElementBox,
  to: ElementBox,
  measure: BoxMeasure
): MeasureGuide[] {
  const guides: MeasureGuide[] = []
  const add = (x1: number, y1: number, x2: number, y2: number, length: number) => {
    if (length >= 0.5) guides.push({ x1, y1, x2, y2, label: pixels(length) })
  }
  if (measure.insets) {
    const [outer, inner] = measure.relation === "inside" ? [from, to] : [to, from]
    const midX = inner.x + inner.width / 2
    const midY = inner.y + inner.height / 2
    add(midX, outer.y, midX, inner.y, measure.insets.top)
    add(right(inner), midY, right(outer), midY, measure.insets.right)
    add(midX, bottom(inner), midX, bottom(outer), measure.insets.bottom)
    add(outer.x, midY, inner.x, midY, measure.insets.left)
    return guides
  }
  // Along the stretch both boxes share, else from the middle of `from`.
  const sharedY = [Math.max(from.y, to.y), Math.min(bottom(from), bottom(to))] as const
  const y = sharedY[0] <= sharedY[1] ? (sharedY[0] + sharedY[1]) / 2 : from.y + from.height / 2
  const sharedX = [Math.max(from.x, to.x), Math.min(right(from), right(to))] as const
  const x = sharedX[0] <= sharedX[1] ? (sharedX[0] + sharedX[1]) / 2 : from.x + from.width / 2
  const { horizontal, vertical } = measure
  if (horizontal?.side === "right") add(right(from), y, to.x, y, horizontal.gap)
  if (horizontal?.side === "left") add(right(to), y, from.x, y, horizontal.gap)
  if (vertical?.side === "below") add(x, bottom(from), x, to.y, vertical.gap)
  if (vertical?.side === "above") add(x, bottom(to), x, from.y, vertical.gap)
  return guides
}

function code(value: string): string {
  const fence = value.includes("`") ? "``" : "`"
  return `${fence}${value}${fence}`
}

const EDGE_NAMES: [keyof BoxMeasure["offsets"], string][] = [
  ["left", "Left edges"],
  ["right", "Right edges"],
  ["top", "Top edges"],
  ["bottom", "Bottom edges"],
  ["centerX", "Horizontal centres"],
  ["centerY", "Vertical centres"],
]

/** Edges that line up, and the near misses (a few pixels) a review is after. */
export function alignmentNotes(measure: BoxMeasure): string[] {
  if (measure.relation === "same") return []
  const aligned: string[] = []
  const near: string[] = []
  for (const [key, name] of EDGE_NAMES) {
    const delta = Math.abs(measure.offsets[key])
    if (delta < 0.5) aligned.push(name.toLowerCase())
    else if (delta <= 4) near.push(`${name.toLowerCase()} are ${pixels(delta)} off`)
  }
  return [
    ...(aligned.length > 0 ? [`Aligned: ${aligned.join(", ")}`] : []),
    ...(near.length > 0 ? [`Nearly aligned: ${near.join("; ")}`] : []),
  ]
}

function boxText(element: MeasuredElement): string {
  const { box } = element
  return `${code(element.selector)} ${pixels(box.width).slice(0, -2)}×${pixels(box.height)} at (${Math.round(box.x)}, ${Math.round(box.y)})`
}

/** What `measure` says, as one sentence. */
export function relationText(measurement: Pick<Measurement, "from" | "to" | "measure">): string {
  const { from, to, measure } = measurement
  const a = code(from.label)
  const b = code(to.label)
  const spacing = (insets: Spacing) =>
    `${pixels(insets.top)} top, ${pixels(insets.right)} right, ${pixels(insets.bottom)} bottom, ${pixels(insets.left)} left`
  switch (measure.relation) {
    case "same":
      return `${a} and ${b} occupy the same box`
    case "inside":
      return `${b} sits inside ${a}: ${spacing(measure.insets!)}`
    case "contains":
      return `${a} sits inside ${b}: ${spacing(measure.insets!)}`
    case "overlap":
      return `${a} and ${b} overlap`
    case "apart": {
      const across = measure.horizontal
        ? `${pixels(measure.horizontal.gap)} to the ${measure.horizontal.side} of ${a}`
        : null
      const down = measure.vertical
        ? `${pixels(measure.vertical.gap)} ${measure.vertical.side}`
        : null
      if (across && down) return `${b} is ${across} and ${down} it`
      return across ? `${b} is ${across}` : `${b} is ${down} ${a}`
    }
  }
}

export function measurementsMarkdown(measurements: readonly Measurement[]): string {
  if (measurements.length === 0) return ""
  const lines = [
    `## Measurements (${measurements.length})`,
    "",
    "Distances the person measured between elements on the page: border boxes in CSS pixels, as laid out at the time. Selectors match the live page.",
  ]
  measurements.forEach((measurement, index) => {
    lines.push(
      "",
      `${index + 1}. ${relationText(measurement)}`,
      `   - From ${boxText(measurement.from)}; to ${boxText(measurement.to)}`
    )
    for (const note of alignmentNotes(measurement.measure)) lines.push(`   - ${note}`)
    if (measurement.note.trim()) lines.push(`   - **Requested:** ${measurement.note.trim()}`)
  })
  return lines.join("\n")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value)

function parseMeasured(value: unknown): MeasuredElement | null {
  if (
    !isRecord(value) ||
    typeof value.elementId !== "string" ||
    typeof value.selector !== "string" ||
    typeof value.label !== "string" ||
    !isRecord(value.box) ||
    !["x", "y", "width", "height"].every((key) =>
      isNumber((value.box as Record<string, unknown>)[key])
    )
  )
    return null
  const box = value.box as Record<string, number>
  return {
    elementId: value.elementId,
    selector: value.selector,
    label: value.label,
    box: { x: box.x!, y: box.y!, width: box.width!, height: box.height! },
  }
}

/**
 * A stored measurement this build can show, from an unsent draft. The
 * numbers are worked out again from the stored boxes rather than trusted.
 */
export function parseMeasurement(value: unknown): Measurement | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !isNumber(value.tabId) ||
    typeof value.pageUrl !== "string" ||
    !isNumber(value.measuredAt) ||
    typeof value.note !== "string"
  )
    return null
  const from = parseMeasured(value.from)
  const to = parseMeasured(value.to)
  if (!from || !to) return null
  return {
    id: value.id,
    tabId: value.tabId,
    pageUrl: value.pageUrl,
    measuredAt: value.measuredAt,
    from,
    to,
    measure: measureBoxes(from.box, to.box),
    note: value.note,
  }
}
