import { useState, type PointerEvent } from "react"
import { Button, Input } from "@cognia/plugin-ui"
import { ArrowUpRightIcon, CircleDotIcon, PencilIcon, SquareIcon, Undo2Icon } from "lucide-react"

import type { BrowserApi } from "@ext/src/lib/browser-api"
import {
  ANNOTATION_COLORS,
  ANNOTATION_TOOLS,
  MAX_MARKER_NOTE,
  MAX_SHAPES,
  arrowHead,
  clamp01,
  isMarker,
  isMeaningful,
  nextMarker,
  renumber,
  strokeWidth,
  thinStroke,
  type AnnotationColor,
  type AnnotationTool,
  type Point,
  type Shape,
} from "@ext/src/lib/panel/annotations"

export interface ImageAnnotatorProps {
  api: BrowserApi
  /** The screenshot as taken, as a data URL; marks are drawn over it. */
  src: string
  /** Marks from an earlier pass, to carry on from. */
  initial: readonly Shape[]
  /** While the marks are being burned into the image. */
  saving: boolean
  onCancel: () => void
  onConfirm: (shapes: Shape[]) => void
}

/** A `switch` with literal keys, so the locale coverage test can see them. */
function toolLabel(tool: AnnotationTool, message: (key: string) => string): string {
  switch (tool) {
    case "box":
      return message("annotateToolBox")
    case "arrow":
      return message("annotateToolArrow")
    case "pen":
      return message("annotateToolPen")
    case "marker":
      return message("annotateToolMarker")
  }
}

const TOOL_ICONS = {
  box: SquareIcon,
  arrow: ArrowUpRightIcon,
  pen: PencilIcon,
  marker: CircleDotIcon,
} as const

/** Before the image says its own size; only the aspect of the preview depends on it. */
const FALLBACK_SIZE = { width: 1000, height: 625 }

function ShapeView({
  shape,
  size,
  index,
}: {
  shape: Shape
  size: { width: number; height: number }
  index?: number
}) {
  const line = strokeWidth(size)
  const at = (point: Point) => ({ x: point.x * size.width, y: point.y * size.height })
  const testId = index === undefined ? "annotate-draft" : `annotate-shape-${index}`
  const stroke = {
    stroke: shape.color,
    strokeWidth: line,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    fill: "none",
  }
  switch (shape.kind) {
    case "box": {
      const a = at(shape.from)
      const b = at(shape.to)
      return (
        <rect
          x={Math.min(a.x, b.x)}
          y={Math.min(a.y, b.y)}
          width={Math.abs(b.x - a.x)}
          height={Math.abs(b.y - a.y)}
          {...stroke}
          data-testid={testId}
        />
      )
    }
    case "arrow": {
      const a = at(shape.from)
      const b = at(shape.to)
      const [left, right] = arrowHead(a, b, line * 4 + 8)
      return (
        <path
          d={`M${a.x} ${a.y}L${b.x} ${b.y}M${left.x} ${left.y}L${b.x} ${b.y}L${right.x} ${right.y}`}
          {...stroke}
          data-testid={testId}
        />
      )
    }
    case "pen":
      return (
        <polyline
          points={shape.points
            .map(at)
            .map((point) => `${point.x},${point.y}`)
            .join(" ")}
          {...stroke}
          data-testid={testId}
        />
      )
    case "marker": {
      const centre = at(shape.at)
      const radius = line * 3.5 + 4
      return (
        <g data-testid={testId}>
          <circle
            cx={centre.x}
            cy={centre.y}
            r={radius}
            fill={shape.color}
            stroke="#ffffff"
            strokeWidth={Math.max(1, line / 2)}
          />
          <text
            x={centre.x}
            y={centre.y + radius * 0.05}
            fill="#ffffff"
            fontSize={Math.round(radius * 1.15)}
            fontWeight={700}
            textAnchor="middle"
            dominantBaseline="central"
            fontFamily="system-ui, -apple-system, sans-serif"
          >
            {shape.n}
          </text>
        </g>
      )
    }
  }
}

/**
 * Mark up a screenshot before it is sent (Jam): boxes, arrows, freehand and
 * numbered markers, each marker with a note that travels as text.
 *
 * Marks are drawn in the image's own pixels over the preview, so what is seen
 * here is what is burned into the attachment. Undo takes back the last mark;
 * a marker removed from the list renumbers the rest, so the numbers the agent
 * reads always run 1, 2, 3.
 */
export function ImageAnnotator({
  api,
  src,
  initial,
  saving,
  onCancel,
  onConfirm,
}: ImageAnnotatorProps) {
  const [shapes, setShapes] = useState<Shape[]>(() => [...initial])
  const [tool, setTool] = useState<AnnotationTool>("box")
  const [color, setColor] = useState<AnnotationColor>(ANNOTATION_COLORS[0])
  const [draft, setDraft] = useState<Shape | null>(null)
  const [size, setSize] = useState(FALLBACK_SIZE)
  const full = shapes.length >= MAX_SHAPES

  const point = (event: PointerEvent<HTMLDivElement>): Point => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return {
      x: clamp01((event.clientX - bounds.left) / (bounds.width || 1)),
      y: clamp01((event.clientY - bounds.top) / (bounds.height || 1)),
    }
  }

  const onDown = (event: PointerEvent<HTMLDivElement>) => {
    if (full || saving) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const at = point(event)
    if (tool === "marker") {
      setShapes((current) => [
        ...current,
        { kind: "marker", color, at, n: nextMarker(current), note: "" },
      ])
      return
    }
    setDraft(
      tool === "pen"
        ? { kind: "pen", color, points: [at] }
        : { kind: tool, color, from: at, to: at }
    )
  }

  const onMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!draft) return
    const at = point(event)
    setDraft((current) => {
      if (!current) return current
      if (current.kind === "pen") return { ...current, points: [...current.points, at] }
      if (current.kind === "box" || current.kind === "arrow") return { ...current, to: at }
      return current
    })
  }

  const onUp = () => {
    if (!draft) return
    const done = draft.kind === "pen" ? { ...draft, points: thinStroke(draft.points) } : draft
    setDraft(null)
    if (isMeaningful(done, size)) setShapes((current) => [...current, done])
  }

  const markers = shapes.filter(isMarker)

  return (
    <div className="space-y-2" data-testid="annotator">
      <p className="text-[11px] text-muted-foreground">{api.message("annotateHint")}</p>
      <div className="flex flex-wrap items-center gap-1">
        {ANNOTATION_TOOLS.map((entry) => {
          const Icon = TOOL_ICONS[entry]
          return (
            <Button
              key={entry}
              size="sm"
              variant={tool === entry ? "default" : "outline"}
              className="h-6 w-6 p-0"
              onClick={() => setTool(entry)}
              aria-label={toolLabel(entry, api.message)}
              aria-pressed={tool === entry}
              title={toolLabel(entry, api.message)}
              data-testid={`annotate-tool-${entry}`}
            >
              <Icon className="size-3.5" aria-hidden="true" />
            </Button>
          )
        })}
        <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
        {ANNOTATION_COLORS.map((entry, index) => (
          <button
            key={entry}
            type="button"
            className={`h-5 w-5 rounded-full border-2 ${color === entry ? "border-foreground" : "border-transparent"}`}
            style={{ background: entry }}
            onClick={() => setColor(entry)}
            aria-label={api.message("annotateColor", [entry])}
            aria-pressed={color === entry}
            data-testid={`annotate-color-${index}`}
          />
        ))}
        <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
        <Button
          size="sm"
          variant="ghost"
          className="h-6 w-6 p-0"
          disabled={shapes.length === 0}
          onClick={() => setShapes((current) => renumber(current.slice(0, -1)))}
          aria-label={api.message("annotateUndo")}
          title={api.message("annotateUndo")}
          data-testid="annotate-undo"
        >
          <Undo2Icon className="size-3.5" aria-hidden="true" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-[11px]"
          disabled={shapes.length === 0}
          onClick={() => setShapes([])}
          data-testid="annotate-clear"
        >
          {api.message("annotateClear")}
        </Button>
      </div>
      <div
        className="relative cursor-crosshair touch-none select-none overflow-hidden rounded-control border border-border"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => setDraft(null)}
        data-testid="annotate-surface"
      >
        <img
          src={src}
          alt={api.message("annotateAlt")}
          className="block w-full"
          draggable={false}
          onLoad={(event) => {
            const image = event.currentTarget
            if (image.naturalWidth > 0 && image.naturalHeight > 0)
              setSize({ width: image.naturalWidth, height: image.naturalHeight })
          }}
        />
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox={`0 0 ${size.width} ${size.height}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {shapes.map((shape, index) => (
            <ShapeView key={index} shape={shape} size={size} index={index} />
          ))}
          {draft ? <ShapeView shape={draft} size={size} /> : null}
        </svg>
      </div>
      {full ? (
        <p className="text-[11px] text-muted-foreground" data-testid="annotate-full">
          {api.message("annotateFull")}
        </p>
      ) : null}
      {markers.length > 0 ? (
        <ol className="space-y-1" data-testid="annotate-notes">
          {markers.map((marker) => (
            <li key={marker.n} className="flex items-center gap-1.5">
              <span
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                style={{ background: marker.color }}
                aria-hidden="true"
              >
                {marker.n}
              </span>
              <Input
                value={marker.note}
                maxLength={MAX_MARKER_NOTE}
                placeholder={api.message("annotateNotePlaceholder")}
                aria-label={api.message("annotateNoteLabel", [String(marker.n)])}
                onChange={(event) => {
                  const note = event.target.value
                  setShapes((current) =>
                    current.map((shape) =>
                      isMarker(shape) && shape.n === marker.n ? { ...shape, note } : shape
                    )
                  )
                }}
                className="h-6 px-1.5 text-[11px]"
                data-testid={`annotate-note-${marker.n}`}
              />
              <Button
                size="sm"
                variant="ghost"
                className="h-6 shrink-0 px-1.5 text-[10px]"
                onClick={() =>
                  setShapes((current) =>
                    renumber(current.filter((shape) => !(isMarker(shape) && shape.n === marker.n)))
                  )
                }
                aria-label={api.message("annotateRemoveMarker", [String(marker.n)])}
                data-testid={`annotate-remove-${marker.n}`}
              >
                {api.message("remove")}
              </Button>
            </li>
          ))}
        </ol>
      ) : null}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={saving}
          onClick={() => onConfirm(shapes)}
          data-testid="annotate-confirm"
        >
          {saving ? api.message("annotateSaving") : api.message("annotateConfirm")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={saving}
          onClick={onCancel}
          data-testid="annotate-cancel"
        >
          {api.message("cancel")}
        </Button>
      </div>
    </div>
  )
}
