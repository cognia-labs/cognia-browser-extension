import { Button } from "@cognia/plugin-ui"

import type { BrowserApi } from "@ext/src/lib/browser-api"
import type { LayoutCheck, LayoutIssue, LayoutRule } from "@ext/src/lib/inspect/layout-check"

/** A `switch` with literal keys, so the locale coverage test can see them. */
export function layoutRuleTitle(rule: LayoutRule, message: (key: string) => string): string {
  switch (rule) {
    case "horizontal-overflow":
      return message("layoutRuleOverflow")
    case "clipped-text":
      return message("layoutRuleClipped")
    case "distorted-image":
      return message("layoutRuleDistorted")
    case "small-text":
      return message("layoutRuleSmallText")
  }
}

/**
 * Layout bugs at this viewport, each one shown on the page or turned into a
 * pick with what was found as its note — the accessibility check's flow.
 */
export function LayoutResult({
  api,
  check,
  issueBusy,
  pickedIds,
  canPick,
  onShow,
  onPick,
}: {
  api: BrowserApi
  check: Omit<LayoutCheck, "tabId" | "ranAt">
  issueBusy: string | null
  pickedIds: string[]
  canPick: boolean
  onShow: (issue: LayoutIssue) => void
  onPick: (issue: LayoutIssue) => void
}) {
  const scrolls = check.pageWidth > check.viewport.width + 1
  return (
    <div className="space-y-1.5" data-testid="layout-result">
      <p className="text-[11px] text-muted-foreground" data-testid="layout-summary">
        {scrolls
          ? api.message("layoutScrolls", [String(check.pageWidth), String(check.viewport.width)])
          : api.message("layoutFits", [String(check.viewport.width)])}
      </p>
      {check.issues.length === 0 ? (
        <p className="text-[11px]">{api.message("layoutClean", [String(check.checked)])}</p>
      ) : (
        <ul className="space-y-1">
          {check.issues.map((issue, index) => {
            const picked = issue.elementId ? pickedIds.includes(issue.elementId) : false
            return (
              <li
                key={`${issue.rule}-${issue.elementId ?? index}`}
                className="space-y-0.5 rounded-control border border-border p-1.5"
                data-testid={`layout-issue-${index}`}
              >
                <p className="text-[11px] font-medium">
                  {layoutRuleTitle(issue.rule, api.message)}
                </p>
                <p className="break-all font-mono text-[10px] text-muted-foreground">
                  {[issue.label, issue.detail].filter(Boolean).join(" · ")}
                </p>
                {issue.elementId ? (
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-5 px-1.5 text-[10px]"
                      disabled={issueBusy !== null}
                      onClick={() => onShow(issue)}
                      data-testid={`layout-show-${index}`}
                    >
                      {api.message("inspectLocate")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-5 px-1.5 text-[10px]"
                      disabled={issueBusy !== null || !canPick || picked}
                      onClick={() => onPick(issue)}
                      data-testid={`layout-pick-${index}`}
                    >
                      {picked ? api.message("accessPicked") : api.message("accessPick")}
                    </Button>
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
