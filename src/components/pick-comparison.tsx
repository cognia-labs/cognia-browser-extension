import { Badge, Button, Checkbox, Label, cn, useCopy } from "@cognia/plugin-ui"
import { Columns3Icon } from "lucide-react"

import type { BrowserApi } from "@ext/src/lib/browser-api"
import type { PickedElement } from "@ext/src/lib/inspect/element-context"
import { comparePicks, comparisonMarkdown } from "@ext/src/lib/inspect/pick-compare"

/**
 * How the picks on the page differ, once there are two or more (CSS Peeper,
 * VisBug): a table of the styles that are not the same, each value that
 * differs from the first pick's marked — and, when the person asks, sent
 * with the task.
 */
export function PickComparisonCard({
  api,
  picks,
  included,
  onInclude,
}: {
  api: BrowserApi
  picks: readonly PickedElement[]
  included: boolean
  onInclude: (included: boolean) => void
}) {
  const { copied, copy } = useCopy()
  const comparison = comparePicks(picks)
  if (!comparison) return null
  const { differences } = comparison
  return (
    <section
      className="animate-enter space-y-2 rounded-lg border border-border bg-card p-2.5 motion-reduce:animate-none"
      data-testid="pick-compare"
    >
      <div className="flex items-center gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-info/12 text-info">
          <Columns3Icon className="size-3.5" aria-hidden="true" />
        </span>
        <h3 className="min-w-0 flex-1 text-xs font-semibold">
          {api.message("compareTitle", [String(comparison.picks.length)])}
        </h3>
        <Badge
          variant={differences.length > 0 ? "warning" : "success"}
          data-testid="pick-compare-count"
        >
          {differences.length > 0
            ? api.message("compareDifferences", [String(differences.length)])
            : api.message("compareSame")}
        </Badge>
      </div>
      {differences.length > 0 ? (
        <div className="max-h-64 overflow-auto rounded-md border border-border">
          <table className="w-full border-collapse text-[11px]">
            <thead className="sticky top-0 bg-muted">
              <tr>
                <th className="sticky left-0 bg-muted px-2 py-1 text-left font-medium text-muted-foreground">
                  {api.message("compareProperty")}
                </th>
                {comparison.picks.map((pick, index) => (
                  <th
                    key={`${pick.selector}-${index}`}
                    className="max-w-28 truncate px-2 py-1 text-left font-mono font-medium"
                    title={pick.selector}
                  >
                    {index + 1}. {pick.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {differences.map((difference, row) => (
                <tr
                  key={difference.property}
                  className="border-t border-border"
                  data-testid={`pick-compare-row-${row}`}
                >
                  <td className="sticky left-0 bg-card px-2 py-1 font-mono text-muted-foreground">
                    {difference.property}
                  </td>
                  {difference.values.map((value, column) => (
                    <td key={column} className="px-1 py-0.5 align-top">
                      <span
                        className={cn(
                          "inline-block max-w-40 rounded px-1 py-0.5 font-mono break-all",
                          column > 0 && value !== difference.values[0] && "bg-warning/15",
                          value === null && "text-muted-foreground"
                        )}
                      >
                        {value ?? "—"}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          {api.message("compareAllSame", [String(comparison.same)])}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label className="gap-1.5 text-[11px] font-normal">
          <Checkbox
            checked={included}
            onCheckedChange={(next) => onInclude(next === true)}
            data-testid="pick-compare-include"
          />
          {api.message("compareInclude")}
        </Label>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-[11px]"
          onClick={() => void copy(comparisonMarkdown(comparison))}
          data-testid="pick-compare-copy"
        >
          {copied ? api.message("copyContextDone") : api.message("compareCopy")}
        </Button>
      </div>
    </section>
  )
}
