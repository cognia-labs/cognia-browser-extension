import { Button } from "@cognia/plugin-ui"

import type { BrowserApi } from "@ext/src/lib/browser-api"
import type { FocusCheck, FocusIssue, FocusRule } from "@ext/src/lib/inspect/focus-order"

/** A `switch` with literal keys, so the locale coverage test can see them. */
export function focusRuleTitle(rule: FocusRule, message: (key: string) => string): string {
  switch (rule) {
    case "positive-tabindex":
      return message("focusRulePositive")
    case "hidden-focusable":
      return message("focusRuleHidden")
    case "order-jump":
      return message("focusRuleJump")
    case "unreachable-control":
      return message("focusRuleUnreachable")
  }
}

/**
 * The keyboard's way through the page: how many Tab stops there are, the
 * numbers drawn on the page for them, and what goes wrong — each finding
 * shown on the page or turned into a pick, the accessibility check's flow.
 */
export function FocusResult({
  api,
  check,
  numbersShown,
  issueBusy,
  pickedIds,
  canPick,
  onToggleNumbers,
  onShow,
  onPick,
}: {
  api: BrowserApi
  check: Omit<FocusCheck, "tabId" | "ranAt">
  numbersShown: boolean
  issueBusy: string | null
  pickedIds: string[]
  canPick: boolean
  onToggleNumbers: (show: boolean) => void
  onShow: (issue: FocusIssue) => void
  onPick: (issue: FocusIssue) => void
}) {
  return (
    <div className="space-y-1.5" data-testid="focus-result">
      <div className="flex flex-wrap items-center gap-1.5">
        <p className="text-[11px] text-muted-foreground" data-testid="focus-summary">
          {api.message("focusStops", [String(check.stops)])}
        </p>
        {check.stops > 0 ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-5 px-1.5 text-[10px]"
            onClick={() => onToggleNumbers(!numbersShown)}
            data-testid="focus-numbers"
          >
            {numbersShown ? api.message("focusHideNumbers") : api.message("focusShowNumbers")}
          </Button>
        ) : null}
      </div>
      {check.issues.length === 0 ? (
        <p className="text-[11px]">{api.message("focusClean")}</p>
      ) : (
        <ul className="space-y-1">
          {check.issues.map((issue, index) => {
            const picked = issue.elementId ? pickedIds.includes(issue.elementId) : false
            return (
              <li
                key={`${issue.rule}-${issue.elementId ?? index}`}
                className="space-y-0.5 rounded-control border border-border p-1.5"
                data-testid={`focus-issue-${index}`}
              >
                <p className="text-[11px] font-medium">{focusRuleTitle(issue.rule, api.message)}</p>
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
                      data-testid={`focus-show-${index}`}
                    >
                      {api.message("inspectLocate")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-5 px-1.5 text-[10px]"
                      disabled={issueBusy !== null || !canPick || picked}
                      onClick={() => onPick(issue)}
                      data-testid={`focus-pick-${index}`}
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
