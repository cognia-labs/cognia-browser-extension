import { Badge, Button, Card, CardContent, Input } from "@cognia/plugin-ui"

import type { BrowserApi } from "@ext/src/lib/browser-api"
import { pixels, type BoxMeasure, type Measurement } from "@ext/src/lib/inspect/measure"

export interface MeasurementsProps {
  api: BrowserApi
  measurements: Measurement[]
  /** Measurements whose elements the page no longer has. */
  detached: string[]
  /** The measurement being shown on the page, if any. */
  busy: string | null
  onNote: (id: string, note: string) => void
  onShow: (id: string) => void
  onRemove: (id: string) => void
}

/** The distances, as compact chips: the numbers are the point. */
function distanceChips(measure: BoxMeasure, message: (key: string) => string): string[] {
  switch (measure.relation) {
    case "same":
      return [message("measureSame")]
    case "overlap":
      return [message("measureOverlap")]
    case "inside":
    case "contains": {
      const insets = measure.insets!
      return [
        `↑ ${pixels(insets.top)}`,
        `→ ${pixels(insets.right)}`,
        `↓ ${pixels(insets.bottom)}`,
        `← ${pixels(insets.left)}`,
      ]
    }
    case "apart":
      return [
        ...(measure.horizontal ? [`↔ ${pixels(measure.horizontal.gap)}`] : []),
        ...(measure.vertical ? [`↕ ${pixels(measure.vertical.gap)}`] : []),
      ]
  }
}

/** A `switch` with literal keys, so the locale coverage test can see them. */
function relationLabel(measure: BoxMeasure, message: (key: string) => string): string {
  switch (measure.relation) {
    case "inside":
      return message("measureInside")
    case "contains":
      return message("measureContains")
    case "apart":
      return message("measureApart")
    case "overlap":
    case "same":
      return ""
  }
}

/** Edges a few pixels apart: usually a mistake, which is what a review is for. */
function nearlyAligned(measure: BoxMeasure): boolean {
  if (measure.relation === "same") return false
  return Object.values(measure.offsets).some((value) => {
    const delta = Math.abs(value)
    return delta >= 0.5 && delta <= 4
  })
}

/**
 * Distances the person measured on the page (VisBug), each with what they
 * want it to be. The numbers are what the browser laid out; "Show" draws
 * them on the page again and re-measures, so a previewed edit's effect is
 * read off the page rather than worked out.
 */
export function Measurements({
  api,
  measurements,
  detached,
  busy,
  onNote,
  onShow,
  onRemove,
}: MeasurementsProps) {
  if (measurements.length === 0) return null
  return (
    <div className="space-y-2" data-testid="measurements">
      <p className="text-xs font-medium">
        {api.message("measureTitle", [String(measurements.length)])}
      </p>
      <ol className="space-y-2">
        {measurements.map((measurement, index) => {
          const relation = relationLabel(measurement.measure, api.message)
          const gone = detached.includes(measurement.id)
          return (
            <li key={measurement.id} className="animate-enter motion-reduce:animate-none">
              <Card data-testid={`measure-${index}`}>
                <CardContent className="space-y-1.5 p-2">
                  <p className="break-all font-mono text-[11px]">
                    <span className="font-sans font-medium">{index + 1}. </span>
                    {measurement.from.label}
                    <span className="text-muted-foreground"> → </span>
                    {measurement.to.label}
                  </p>
                  <div
                    className="flex flex-wrap items-center gap-1"
                    data-testid={`measure-distances-${index}`}
                  >
                    {relation ? (
                      <span className="text-[11px] text-muted-foreground">{relation}</span>
                    ) : null}
                    {distanceChips(measurement.measure, api.message).map((chip) => (
                      <Badge key={chip} variant="secondary" className="font-mono text-[10px]">
                        {chip}
                      </Badge>
                    ))}
                    {nearlyAligned(measurement.measure) ? (
                      <Badge
                        variant="warning"
                        className="text-[10px]"
                        data-testid={`measure-near-${index}`}
                      >
                        {api.message("measureNearlyAligned")}
                      </Badge>
                    ) : null}
                    {gone ? (
                      <Badge
                        variant="warning"
                        className="text-[10px]"
                        data-testid={`measure-detached-${index}`}
                      >
                        {api.message("inspectDetached")}
                      </Badge>
                    ) : null}
                  </div>
                  <Input
                    value={measurement.note}
                    placeholder={api.message("measureNotePlaceholder")}
                    aria-label={api.message("measureNoteLabel", [String(index + 1)])}
                    onChange={(event) => onNote(measurement.id, event.target.value)}
                    className="h-7 text-[11px]"
                    data-testid={`measure-note-${index}`}
                  />
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-[11px]"
                      disabled={busy !== null}
                      onClick={() => onShow(measurement.id)}
                      data-testid={`measure-show-${index}`}
                    >
                      {busy === measurement.id
                        ? api.message("attachWorking")
                        : api.message("measureShow")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-[11px]"
                      onClick={() => onRemove(measurement.id)}
                      data-testid={`measure-remove-${index}`}
                    >
                      {api.message("remove")}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
