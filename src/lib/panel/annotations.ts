/**
 * Marks on a screenshot (Jam, a designer's red pen): boxes, arrows, freehand
 * strokes and numbered markers whose notes say what each mark means.
 *
 * The image carries the marks, burned in, because that is what every agent
 * and every person downstream can see; the numbered notes travel as text as
 * well, because a model reads "2. this padding is 12px, should be 16px"
 * far better than it reads handwriting. Shapes are kept in coordinates
 * relative to the image (0–1), so the small preview and the full-size
 * capture draw the same marks.
 */
import { blobToBase64, dataUrlToBlob, type ImageOpsDeps } from "../agent/image-ops"

export type AnnotationTool = "box" | "arrow" | "pen" | "marker"

export const ANNOTATION_TOOLS: readonly AnnotationTool[] = ["box", "arrow", "pen", "marker"]

/** Red, amber, green, blue: legible on light and dark pages alike. */
export const ANNOTATION_COLORS = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6"] as const

export type AnnotationColor = (typeof ANNOTATION_COLORS)[number]

/** A point relative to the image: 0,0 its top left, 1,1 its bottom right. */
export interface Point {
  x: number
  y: number
}

export type Shape =
  | { kind: "box"; color: AnnotationColor; from: Point; to: Point }
  | { kind: "arrow"; color: AnnotationColor; from: Point; to: Point }
  | { kind: "pen"; color: AnnotationColor; points: Point[] }
  | { kind: "marker"; color: AnnotationColor; at: Point; n: number; note: string }

export type Marker = Extract<Shape, { kind: "marker" }>

/** What an attachment keeps so it can be marked up again from the clean shot. */
export interface AttachmentAnnotation {
  /** The screenshot as taken, as a data URL. */
  original: string
  shapes: Shape[]
}

export const MAX_SHAPES = 60
export const MAX_MARKER_NOTE = 300
/** A stroke longer than this is thinned; a scribble is not more precise for its points. */
const MAX_PEN_POINTS = 400

export const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

export const isMarker = (shape: Shape): shape is Marker => shape.kind === "marker"

/** The number the next marker gets. */
export function nextMarker(shapes: readonly Shape[]): number {
  return shapes.filter(isMarker).reduce((top, marker) => Math.max(top, marker.n), 0) + 1
}

/** Markers numbered 1, 2, 3… in the order they were placed, after one was taken away. */
export function renumber(shapes: readonly Shape[]): Shape[] {
  let n = 0
  return shapes.map((shape) => (isMarker(shape) ? { ...shape, n: ++n } : shape))
}

/** A freehand stroke with at most {@link MAX_PEN_POINTS} points, evenly kept. */
export function thinStroke(points: readonly Point[]): Point[] {
  if (points.length <= MAX_PEN_POINTS) return [...points]
  const step = (points.length - 1) / (MAX_PEN_POINTS - 1)
  return Array.from({ length: MAX_PEN_POINTS }, (_, index) => points[Math.round(index * step)]!)
}

/** Whether a drag made a mark worth keeping, rather than a stray click. */
export function isMeaningful(shape: Shape, size: { width: number; height: number }): boolean {
  const length = (a: Point, b: Point) =>
    Math.hypot((a.x - b.x) * size.width, (a.y - b.y) * size.height)
  switch (shape.kind) {
    case "box":
      return (
        Math.abs(shape.to.x - shape.from.x) * size.width >= 4 &&
        Math.abs(shape.to.y - shape.from.y) * size.height >= 4
      )
    case "arrow":
      return length(shape.from, shape.to) >= 8
    case "pen":
      return shape.points.length >= 2
    case "marker":
      return true
  }
}

/** The stroke width marks are drawn with on an image of this size. */
export function strokeWidth(size: { width: number; height: number }): number {
  return Math.max(2, Math.round(Math.max(size.width, size.height) / 400))
}

/** The two short strokes of an arrow's head, at its `to` end. */
export function arrowHead(
  from: { x: number; y: number },
  to: { x: number; y: number },
  length: number
): [{ x: number; y: number }, { x: number; y: number }] {
  const angle = Math.atan2(to.y - from.y, to.x - from.x)
  const spread = Math.PI / 7
  return [
    { x: to.x - length * Math.cos(angle - spread), y: to.y - length * Math.sin(angle - spread) },
    { x: to.x - length * Math.cos(angle + spread), y: to.y - length * Math.sin(angle + spread) },
  ]
}

/** The 2D context calls the marks need; a real canvas has all of them. */
export interface AnnotationContext {
  strokeStyle: string
  fillStyle: string
  lineWidth: number
  lineCap: string
  lineJoin: string
  font: string
  textAlign: string
  textBaseline: string
  beginPath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  arc(x: number, y: number, radius: number, start: number, end: number): void
  stroke(): void
  fill(): void
  strokeRect(x: number, y: number, width: number, height: number): void
  fillText(text: string, x: number, y: number): void
}

/** Draw `shapes` over an image of `width` × `height` already on `ctx`. */
export function drawShapes(
  ctx: AnnotationContext,
  shapes: readonly Shape[],
  width: number,
  height: number
): void {
  const line = strokeWidth({ width, height })
  const at = (point: Point) => ({ x: point.x * width, y: point.y * height })
  ctx.lineCap = "round"
  ctx.lineJoin = "round"
  for (const shape of shapes) {
    ctx.strokeStyle = shape.color
    ctx.fillStyle = shape.color
    ctx.lineWidth = line
    switch (shape.kind) {
      case "box": {
        const a = at(shape.from)
        const b = at(shape.to)
        ctx.strokeRect(
          Math.min(a.x, b.x),
          Math.min(a.y, b.y),
          Math.abs(b.x - a.x),
          Math.abs(b.y - a.y)
        )
        break
      }
      case "arrow": {
        const a = at(shape.from)
        const b = at(shape.to)
        const [left, right] = arrowHead(a, b, line * 4 + 8)
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.moveTo(left.x, left.y)
        ctx.lineTo(b.x, b.y)
        ctx.lineTo(right.x, right.y)
        ctx.stroke()
        break
      }
      case "pen": {
        const [first, ...rest] = shape.points.map(at)
        if (!first) break
        ctx.beginPath()
        ctx.moveTo(first.x, first.y)
        for (const point of rest) ctx.lineTo(point.x, point.y)
        ctx.stroke()
        break
      }
      case "marker": {
        const centre = at(shape.at)
        const radius = line * 3.5 + 4
        ctx.beginPath()
        ctx.arc(centre.x, centre.y, radius, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = "#ffffff"
        ctx.lineWidth = Math.max(1, line / 2)
        ctx.stroke()
        ctx.fillStyle = "#ffffff"
        ctx.font = `700 ${Math.round(radius * 1.15)}px system-ui, -apple-system, sans-serif`
        ctx.textAlign = "center"
        ctx.textBaseline = "middle"
        ctx.fillText(String(shape.n), centre.x, centre.y + radius * 0.05)
        break
      }
    }
  }
}

/** The screenshot with its marks burned in, as base64 PNG without the prefix. */
export async function renderAnnotated(
  deps: ImageOpsDeps,
  dataUrl: string,
  shapes: readonly Shape[]
): Promise<string> {
  const bitmap = await deps.decode(dataUrlToBlob(dataUrl))
  const { width, height } = bitmap
  const surface = deps.surface(width, height)
  const ctx = surface.getContext("2d")
  if (!ctx) throw new Error("no 2d canvas context")
  ctx.drawImage(bitmap, 0, 0, width, height, 0, 0, width, height)
  bitmap.close?.()
  drawShapes(ctx as unknown as AnnotationContext, shapes, width, height)
  return blobToBase64(await surface.convertToBlob({ type: "image/png" }))
}

const SHAPE_WORDS: Record<Exclude<Shape["kind"], "marker">, [string, string]> = {
  box: ["box", "boxes"],
  arrow: ["arrow", "arrows"],
  pen: ["freehand stroke", "freehand strokes"],
}

/**
 * The notes on marked-up screenshots, as the agent reads them; "" when no
 * attachment is marked up.
 */
export function annotationsMarkdown(
  annotated: readonly { name: string; shapes: readonly Shape[] }[]
): string {
  const marked = annotated.filter((entry) => entry.shapes.length > 0)
  if (marked.length === 0) return ""
  const lines = [
    "## Screenshot annotations",
    "",
    "The person drew on these attached screenshots. Numbers match the numbered markers in the images.",
  ]
  for (const { name, shapes } of marked) {
    const counts = (["box", "arrow", "pen"] as const)
      .map((kind) => [kind, shapes.filter((shape) => shape.kind === kind).length] as const)
      .filter(([, count]) => count > 0)
      .map(([kind, count]) => `${count} ${SHAPE_WORDS[kind][count === 1 ? 0 : 1]}`)
    const markers = shapes.filter(isMarker)
    if (markers.length > 0)
      counts.push(`${markers.length} numbered ${markers.length === 1 ? "marker" : "markers"}`)
    lines.push("", `- \`${name}\`: ${counts.join(", ")}`)
    for (const marker of markers) {
      const note = marker.note.trim()
      lines.push(`  ${marker.n}. ${note || "(no note)"}`)
    }
  }
  return lines.join("\n")
}
