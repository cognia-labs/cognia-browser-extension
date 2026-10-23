import { useRef, useState, type ReactNode } from "react"
import {
  Badge,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Slider,
  Switch,
  Textarea,
  cn,
} from "@cognia/plugin-ui"
import { ChevronDownIcon, WrenchIcon } from "lucide-react"

import { SECTION_TRIGGER_CLASS, SectionHeading } from "@ext/src/components/panel-section"
import type { BrowserApi } from "@ext/src/lib/browser-api"
import {
  OVERLAY_SCALES,
  VIEWPORT_PRESETS,
  type DesignOverlayState,
  type ViewportPresetId,
} from "@ext/src/lib/inspect/design-overlay"
import type { DevReport } from "@ext/src/lib/inspect/dev-report"
import { mismatchPercent, type DesignDiff } from "@ext/src/lib/inspect/design-diff"

/** The overlay's controls, without the image bytes the page already holds. */
export type OverlaySettings = Omit<DesignOverlayState, "image"> & { name: string }

export type PageToolAction = "record" | "report" | "overlay" | "viewport" | "mocks" | "compare"

export interface PageToolsProps {
  api: BrowserApi
  /** When the recorder started on the tab, if it is listening. */
  recordingSince: number | null
  report: DevReport | null
  overlay: OverlaySettings | null
  busy: PageToolAction | null
  onRecord: () => void
  onAttachReport: () => void
  onReportChange: (text: string) => void
  onRemoveReport: () => void
  onOverlayFile: (file: File) => void
  onOverlayChange: (next: OverlaySettings) => void
  onOverlayRemove: () => void
  onViewport: (preset: ViewportPresetId) => void
  /** The last comparison of the page with the mock, while it is to be sent. */
  designDiff?: Omit<DesignDiff, "tabId" | "ranAt"> | null
  onCompare?: () => void
  onRemoveDiff?: () => void
  /** More tools for the same tab, after these: the simulated requests. */
  children?: ReactNode
  /** Whether those have something under way, which opens the section too. */
  childrenActive?: boolean
}

/** A `switch` with literal keys, so the locale coverage test can see them. */
function viewportLabel(id: ViewportPresetId, message: (key: string) => string): string {
  switch (id) {
    case "mobile":
      return message("viewportMobile")
    case "tablet":
      return message("viewportTablet")
    case "laptop":
      return message("viewportLaptop")
    case "desktop":
      return message("viewportDesktop")
  }
}

function scaleLabel(scale: number): string {
  return scale === 1 ? "1x" : scale === 0.5 ? "2x" : "3x"
}

function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

/**
 * The checks around a change, besides pointing at it: what the console and
 * the page's requests said while a bug was reproduced (Jam), how the build
 * lines up with its design mock (PerfectPixel), how it reads at other
 * screen sizes (Responsive Viewer), and how it copes with its requests
 * failing (Requestly). Each works on the tab being captured.
 */
export function PageTools({
  api,
  recordingSince,
  report,
  overlay,
  busy,
  onRecord,
  onAttachReport,
  onReportChange,
  onRemoveReport,
  onOverlayFile,
  onOverlayChange,
  onOverlayRemove,
  onViewport,
  designDiff = null,
  onCompare,
  onRemoveDiff,
  children,
  childrenActive = false,
}: PageToolsProps) {
  // Open by itself while something is under way, until the person says otherwise.
  const [open, setOpen] = useState<boolean | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const expanded =
    open ?? (recordingSince !== null || report !== null || overlay !== null || childrenActive)
  return (
    <Collapsible open={expanded} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={SECTION_TRIGGER_CLASS}
          data-testid="page-tools-toggle"
        >
          <SectionHeading
            icon={WrenchIcon}
            tone="warning"
            level="span"
            title={api.message("pageToolsTitle")}
            subtitle={api.message("pageToolsSubtitle")}
          />
          <ChevronDownIcon
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform",
              expanded && "rotate-180"
            )}
            aria-hidden="true"
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4 px-3 pt-1 pb-3" data-testid="page-tools">
        <div className="space-y-1.5" data-testid="dev-report-tools">
          <h3 className="text-xs font-medium">{api.message("devReportTitle")}</h3>
          <p className="text-[11px] text-muted-foreground">{api.message("devReportHint")}</p>
          <div className="flex flex-wrap items-center gap-1">
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[11px]"
              disabled={busy !== null}
              onClick={onRecord}
              data-testid="dev-record"
            >
              {busy === "record"
                ? api.message("attachWorking")
                : recordingSince !== null
                  ? api.message("devRecordRestart")
                  : api.message("devRecordStart")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[11px]"
              disabled={busy !== null}
              onClick={onAttachReport}
              data-testid="dev-attach"
            >
              {busy === "report"
                ? api.message("attachWorking")
                : report
                  ? api.message("devReportRefresh")
                  : api.message("devReportAttach")}
            </Button>
            {recordingSince !== null ? (
              <Badge variant="secondary" className="text-[10px]" data-testid="dev-recording">
                {api.message("devRecordingSince", [clock(recordingSince)])}
              </Badge>
            ) : null}
          </div>
          {report ? (
            <div className="space-y-1" data-testid="dev-report">
              <div className="flex flex-wrap gap-1">
                <Badge
                  variant={report.counts.errors > 0 ? "destructive" : "outline"}
                  className="text-[10px]"
                >
                  {api.message("devReportErrors", [String(report.counts.errors)])}
                </Badge>
                <Badge variant="outline" className="text-[10px]">
                  {api.message("devReportWarnings", [String(report.counts.warnings)])}
                </Badge>
                <Badge
                  variant={report.counts.failedRequests > 0 ? "warning" : "outline"}
                  className="text-[10px]"
                >
                  {api.message("devReportFailedRequests", [String(report.counts.failedRequests)])}
                </Badge>
                {report.counts.steps > 0 ? (
                  <Badge variant="secondary" className="text-[10px]" data-testid="dev-report-steps">
                    {api.message("devReportSteps", [String(report.counts.steps)])}
                  </Badge>
                ) : null}
              </div>
              <Label htmlFor="cognia-dev-report" className="text-[11px] text-muted-foreground">
                {api.message("devReportEdit")}
              </Label>
              <Textarea
                id="cognia-dev-report"
                rows={6}
                value={report.text}
                onChange={(event) => onReportChange(event.target.value)}
                className="font-mono text-[11px]"
                data-testid="dev-report-text"
              />
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[11px]"
                onClick={onRemoveReport}
                data-testid="dev-report-remove"
              >
                {api.message("remove")}
              </Button>
            </div>
          ) : null}
        </div>

        <div className="space-y-1.5" data-testid="overlay-tools">
          <h3 className="text-xs font-medium">{api.message("overlayTitle")}</h3>
          <p className="text-[11px] text-muted-foreground">{api.message("overlayHint")}</p>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            tabIndex={-1}
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ""
              if (file) onOverlayFile(file)
            }}
            data-testid="overlay-file"
          />
          <div className="flex flex-wrap items-center gap-1">
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[11px]"
              disabled={busy !== null}
              onClick={() => fileRef.current?.click()}
              data-testid="overlay-choose"
            >
              {busy === "overlay"
                ? api.message("attachWorking")
                : overlay
                  ? api.message("overlayReplace")
                  : api.message("overlayChoose")}
            </Button>
            {overlay && onCompare ? (
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-[11px]"
                disabled={busy !== null}
                onClick={onCompare}
                title={api.message("compareHint")}
                data-testid="overlay-compare"
              >
                {busy === "compare" ? api.message("attachWorking") : api.message("compareRun")}
              </Button>
            ) : null}
            {overlay ? (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[11px]"
                onClick={onOverlayRemove}
                data-testid="overlay-remove"
              >
                {api.message("remove")}
              </Button>
            ) : null}
          </div>
          {designDiff ? (
            <div
              className="space-y-1 rounded-control border border-border p-1.5"
              data-testid="design-diff"
            >
              <div className="flex items-center gap-1.5">
                <Badge
                  variant={designDiff.mismatched === 0 ? "secondary" : "warning"}
                  className="text-[10px]"
                  data-testid="design-diff-share"
                >
                  {mismatchPercent(designDiff)}
                </Badge>
                <p className="min-w-0 flex-1 text-[11px]">
                  {api.message("compareSummary", [
                    String(designDiff.regions.length),
                    `${designDiff.area.width}×${designDiff.area.height}`,
                  ])}
                </p>
                {onRemoveDiff ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-5 px-1.5 text-[10px]"
                    onClick={onRemoveDiff}
                    data-testid="design-diff-remove"
                  >
                    {api.message("remove")}
                  </Button>
                ) : null}
              </div>
              {designDiff.regions.length > 0 ? (
                <ol className="space-y-0.5 font-mono text-[10px] text-muted-foreground">
                  {designDiff.regions.map((region, index) => (
                    <li key={index} data-testid={`design-diff-region-${index}`}>
                      {index + 1}. {region.width}×{region.height} @ {region.x},{region.y}
                    </li>
                  ))}
                </ol>
              ) : null}
            </div>
          ) : null}
          {overlay ? (
            <div className="space-y-2" data-testid="overlay-controls">
              <p className="truncate text-[11px]" title={overlay.name}>
                {overlay.name}
              </p>
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground" id="cognia-overlay-opacity">
                  {api.message("overlayOpacity", [String(Math.round(overlay.opacity * 100))])}
                </Label>
                <Slider
                  value={[Math.round(overlay.opacity * 100)]}
                  min={0}
                  max={100}
                  step={5}
                  aria-labelledby="cognia-overlay-opacity"
                  onValueChange={([value]) =>
                    onOverlayChange({ ...overlay, opacity: (value ?? 50) / 100 })
                  }
                  data-testid="overlay-opacity"
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                {(["x", "y"] as const).map((axis) => (
                  <div key={axis} className="space-y-1">
                    <Label
                      htmlFor={`cognia-overlay-${axis}`}
                      className="text-[11px] text-muted-foreground"
                    >
                      {axis === "x" ? api.message("overlayOffsetX") : api.message("overlayOffsetY")}
                    </Label>
                    <Input
                      id={`cognia-overlay-${axis}`}
                      type="number"
                      value={overlay[axis]}
                      onChange={(event) => {
                        const value = Number(event.target.value)
                        if (Number.isFinite(value)) onOverlayChange({ ...overlay, [axis]: value })
                      }}
                      className="h-6 px-1.5 text-[11px]"
                      data-testid={`overlay-${axis}`}
                    />
                  </div>
                ))}
                <div className="space-y-1">
                  <Label
                    htmlFor="cognia-overlay-scale"
                    className="text-[11px] text-muted-foreground"
                  >
                    {api.message("overlayScale")}
                  </Label>
                  <Select
                    value={String(overlay.scale)}
                    onValueChange={(next) => onOverlayChange({ ...overlay, scale: Number(next) })}
                  >
                    <SelectTrigger
                      id="cognia-overlay-scale"
                      className="h-6 w-full px-1.5 text-[11px]"
                      data-testid="overlay-scale"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {OVERLAY_SCALES.map((scale) => (
                        <SelectItem key={scale} value={String(scale)}>
                          {scaleLabel(scale)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-1.5">
                  <Switch
                    id="cognia-overlay-visible"
                    size="sm"
                    checked={overlay.visible}
                    onCheckedChange={(visible) => onOverlayChange({ ...overlay, visible })}
                    data-testid="overlay-visible"
                  />
                  <Label htmlFor="cognia-overlay-visible" className="text-[11px]">
                    {api.message("overlayVisible")}
                  </Label>
                </div>
                <div className="flex items-center gap-1.5">
                  <Switch
                    id="cognia-overlay-difference"
                    size="sm"
                    checked={overlay.difference}
                    onCheckedChange={(difference) => onOverlayChange({ ...overlay, difference })}
                    data-testid="overlay-difference"
                  />
                  <Label htmlFor="cognia-overlay-difference" className="text-[11px]">
                    {api.message("overlayDifference")}
                  </Label>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="space-y-1.5" data-testid="viewport-tools">
          <h3 className="text-xs font-medium">{api.message("viewportTitle")}</h3>
          <p className="text-[11px] text-muted-foreground">{api.message("viewportHint")}</p>
          <div className="flex flex-wrap gap-1">
            {VIEWPORT_PRESETS.map((preset) => (
              <Button
                key={preset.id}
                size="sm"
                variant="outline"
                className="h-6 px-2 text-[11px]"
                disabled={busy !== null}
                onClick={() => onViewport(preset.id)}
                data-testid={`viewport-${preset.id}`}
              >
                {viewportLabel(preset.id, api.message)} {preset.width}×{preset.height}
              </Button>
            ))}
          </div>
        </div>
        {children}
      </CollapsibleContent>
    </Collapsible>
  )
}
