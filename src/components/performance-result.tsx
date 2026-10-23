import { useState } from "react"
import {
  Badge,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@cognia/plugin-ui"

import type { BrowserApi } from "@ext/src/lib/browser-api"
import {
  formatBytes,
  formatVital,
  performanceMarkdown,
  vitals,
  type PagePerformance,
  type Rating,
  type VitalName,
} from "@ext/src/lib/inspect/page-performance"
import { MarkdownView } from "./markdown-view"

/** A `switch` with literal keys, so the locale coverage test can see them. */
function vitalLabel(name: VitalName, message: (key: string) => string): string {
  switch (name) {
    case "lcp":
      return message("perfVitalLcp")
    case "cls":
      return message("perfVitalCls")
    case "inp":
      return message("perfVitalInp")
    case "fcp":
      return message("perfVitalFcp")
    case "ttfb":
      return message("perfVitalTtfb")
    case "tbt":
      return message("perfVitalTbt")
  }
}

function ratingLabel(rating: Rating, message: (key: string) => string): string {
  switch (rating) {
    case "good":
      return message("perfGood")
    case "needs-improvement":
      return message("perfNeedsWork")
    case "poor":
      return message("perfPoor")
  }
}

const RATING_VARIANT = {
  good: "secondary",
  "needs-improvement": "warning",
  poor: "destructive",
} as const

/**
 * One visit's performance, as the browser measured it: the Web Vitals with
 * their ratings first, then what is most likely behind them, and the full
 * report — exactly as it would be sent — a click away.
 */
export function PerformanceResult({
  api,
  report,
}: {
  api: BrowserApi
  report: Omit<PagePerformance, "tabId" | "ranAt">
}) {
  const [details, setDetails] = useState(false)
  const measured = vitals(report)
  const findings = [
    report.images.oversized.length > 0
      ? api.message("perfOversized", [String(report.images.oversized.length)])
      : null,
    report.images.unsized > 0 ? api.message("perfUnsized", [String(report.images.unsized)]) : null,
    report.resources.renderBlocking.length > 0
      ? api.message("perfBlocking", [String(report.resources.renderBlocking.length)])
      : null,
    report.scripts[0]
      ? api.message("perfSlowScript", [
          report.scripts[0].source.split("/").pop() || report.scripts[0].source,
          String(report.scripts[0].ms),
        ])
      : null,
  ].filter((entry): entry is string => entry !== null)
  return (
    <div className="space-y-1.5" data-testid="perf-result">
      {measured.length > 0 ? (
        <dl className="grid grid-cols-2 gap-1">
          {measured.map((vital) => (
            <div
              key={vital.name}
              className="rounded-control border border-border p-1.5"
              data-testid={`perf-vital-${vital.name}`}
            >
              <dt className="truncate text-[10px] text-muted-foreground">
                {vitalLabel(vital.name, api.message)}
              </dt>
              <dd className="flex items-center justify-between gap-1">
                <span className="font-mono text-xs font-medium">
                  {formatVital(vital.name, vital.value)}
                </span>
                <Badge variant={RATING_VARIANT[vital.rating]} className="text-[9px]">
                  {ratingLabel(vital.rating, api.message)}
                </Badge>
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-[11px] text-muted-foreground">{api.message("perfNoVitals")}</p>
      )}
      <p className="text-[11px] text-muted-foreground" data-testid="perf-summary">
        {api.message("perfSummary", [
          String(report.resources.count),
          formatBytes(report.resources.bytes),
          String(report.dom.elements),
        ])}
      </p>
      {findings.length > 0 ? (
        <ul className="list-disc space-y-0.5 pl-4 text-[11px]" data-testid="perf-findings">
          {findings.map((finding) => (
            <li key={finding}>{finding}</li>
          ))}
        </ul>
      ) : null}
      <Collapsible open={details} onOpenChange={setDetails}>
        <CollapsibleTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[11px]"
            data-testid="perf-details-toggle"
          >
            {details ? api.message("perfDetailsHide") : api.message("perfDetailsShow")}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="max-h-72 overflow-auto rounded-control border border-border p-2">
            <MarkdownView api={api} source={performanceMarkdown(report)} testId="perf-details" />
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
