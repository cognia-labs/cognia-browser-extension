import { useState } from "react"
import {
  Badge,
  Button,
  Checkbox,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Label,
  cn,
  useCopy,
} from "@cognia/plugin-ui"
import { ChevronDownIcon, ShieldCheckIcon } from "lucide-react"

import { SECTION_TRIGGER_CLASS, SectionHeading } from "@ext/src/components/panel-section"
import type { BrowserApi } from "@ext/src/lib/browser-api"
import type { A11yImpact, A11yIssue, A11yRule } from "@ext/src/lib/inspect/a11y-audit"
import type { InsightKind, PageInsights } from "@ext/src/lib/inspect/insights"
import { parseColor, toHslString, toRgbString } from "@ext/src/lib/inspect/page-colors"
import { PerformanceResult } from "./performance-result"
import { SeoResult } from "./seo-result"
import { StackResult } from "./stack-result"
import { LayoutResult } from "./layout-result"
import type { LayoutIssue } from "@ext/src/lib/inspect/layout-check"
import { FocusResult } from "./focus-result"
import type { FocusIssue } from "@ext/src/lib/inspect/focus-order"

export type AuditAction = InsightKind | "eyedropper"

export interface PageAuditProps {
  api: BrowserApi
  /** The checks run on the page in the panel. */
  insights: PageInsights
  busy: AuditAction | null
  /** The finding being shown or picked, by element id. */
  issueBusy: string | null
  /** Findings already among the picks, by element id. */
  pickedIds: string[]
  /** Whether another pick fits. */
  canPick: boolean
  /** Colours picked from the screen, newest first. */
  pickedColors: string[]
  /** Whether this browser offers a screen eyedropper. */
  canEyedrop: boolean
  onRun: (kind: InsightKind) => void
  onInclude: (kind: InsightKind, include: boolean) => void
  onShowIssue: (issue: A11yIssue) => void
  onPickIssue: (issue: A11yIssue) => void
  onShowLayoutIssue: (issue: LayoutIssue) => void
  onPickLayoutIssue: (issue: LayoutIssue) => void
  /** Whether the Tab stops are numbered on the page. */
  focusNumbers?: boolean
  onToggleFocusNumbers?: (show: boolean) => void
  onShowFocusIssue?: (issue: FocusIssue) => void
  onPickFocusIssue?: (issue: FocusIssue) => void
  onEyedropper: () => void
}

/** A `switch` with literal keys, so the locale coverage test can see them. */
export function ruleTitle(rule: A11yRule, message: (key: string) => string): string {
  switch (rule) {
    case "image-alt":
      return message("accessRuleImageAlt")
    case "button-name":
      return message("accessRuleButtonName")
    case "link-name":
      return message("accessRuleLinkName")
    case "label":
      return message("accessRuleLabel")
    case "color-contrast":
      return message("accessRuleContrast")
    case "html-lang":
      return message("accessRuleLang")
    case "document-title":
      return message("accessRuleTitle")
    case "heading-order":
      return message("accessRuleHeadingOrder")
    case "empty-heading":
      return message("accessRuleEmptyHeading")
    case "duplicate-id":
      return message("accessRuleDuplicateId")
    case "target-size":
      return message("accessRuleTargetSize")
    case "aria-hidden-focus":
      return message("accessRuleHiddenFocus")
    case "frame-title":
      return message("accessRuleFrameTitle")
    case "tabindex":
      return message("accessRuleTabindex")
  }
}

function impactLabel(impact: A11yImpact, message: (key: string) => string): string {
  switch (impact) {
    case "critical":
      return message("accessImpactCritical")
    case "serious":
      return message("accessImpactSerious")
    case "moderate":
      return message("accessImpactModerate")
    case "minor":
      return message("accessImpactMinor")
  }
}

const IMPACT_VARIANT = {
  critical: "destructive",
  serious: "warning",
  moderate: "secondary",
  minor: "outline",
} as const

const SHOWN_ISSUES = 12

/** "Include in what is sent", for one check's result. */
function IncludeToggle({
  api,
  kind,
  checked,
  onInclude,
}: {
  api: BrowserApi
  kind: InsightKind
  checked: boolean
  onInclude: (kind: InsightKind, include: boolean) => void
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Checkbox
        id={`cognia-include-${kind}`}
        checked={checked}
        onCheckedChange={(next) => onInclude(kind, next === true)}
        data-testid={`insight-include-${kind}`}
      />
      <Label htmlFor={`cognia-include-${kind}`} className="text-[11px]">
        {api.message("insightInclude")}
      </Label>
    </div>
  )
}

/**
 * Checks of the whole page, beside the picks: a first accessibility pass
 * (axe DevTools), the design tokens the page really uses with a screen
 * eyedropper (CSS Peeper, ColorZilla, WhatFont), what it is built with
 * (Wappalyzer), how this visit performed (Lighthouse, Web Vitals), and how it
 * presents itself to search and link previews (META SEO inspector). Each
 * result can go with the submission, or not.
 */
export function PageAudit({
  api,
  insights,
  busy,
  issueBusy,
  pickedIds,
  canPick,
  pickedColors,
  canEyedrop,
  onRun,
  onInclude,
  onShowIssue,
  onPickIssue,
  onShowLayoutIssue,
  onPickLayoutIssue,
  focusNumbers = false,
  onToggleFocusNumbers = () => undefined,
  onShowFocusIssue = () => undefined,
  onPickFocusIssue = () => undefined,
  onEyedropper,
}: PageAuditProps) {
  const [open, setOpen] = useState<boolean | null>(null)
  const [allIssues, setAllIssues] = useState(false)
  const [showVariables, setShowVariables] = useState(false)
  const { copy } = useCopy()
  const { audit, tokens, stack, perf, seo, layout, focus } = insights
  const expanded = open ?? Object.values(insights).some((entry) => entry !== null)
  const issues = audit ? (allIssues ? audit.issues : audit.issues.slice(0, SHOWN_ISSUES)) : []
  const counts = audit
    ? (["critical", "serious", "moderate", "minor"] as const).map(
        (impact) =>
          [impact, audit.issues.filter((issue) => issue.impact === impact).length] as const
      )
    : []
  const runButton = (kind: InsightKind, idle: string, again: boolean) => (
    <Button
      size="sm"
      variant="outline"
      className="h-6 px-2 text-[11px]"
      disabled={busy !== null}
      onClick={() => onRun(kind)}
      data-testid={`insight-run-${kind}`}
    >
      {busy === kind ? api.message("attachWorking") : again ? api.message("insightRunAgain") : idle}
    </Button>
  )

  return (
    <Collapsible open={expanded} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={SECTION_TRIGGER_CLASS}
          data-testid="page-audit-toggle"
        >
          <SectionHeading
            icon={ShieldCheckIcon}
            tone="success"
            level="span"
            title={api.message("pageAuditTitle")}
            subtitle={api.message("pageAuditSubtitle")}
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
      <CollapsibleContent className="space-y-4 px-3 pt-1 pb-3" data-testid="page-audit">
        <div className="space-y-1.5" data-testid="a11y-tools">
          <h3 className="text-xs font-medium">{api.message("accessTitle")}</h3>
          <p className="text-[11px] text-muted-foreground">{api.message("accessHint")}</p>
          <div className="flex flex-wrap items-center gap-2">
            {runButton("audit", api.message("accessRun"), audit !== null)}
            {audit ? (
              <IncludeToggle api={api} kind="audit" checked={audit.include} onInclude={onInclude} />
            ) : null}
          </div>
          {audit ? (
            <div className="space-y-1.5" data-testid="a11y-result">
              {audit.issues.length === 0 ? (
                <p className="text-[11px]">{api.message("accessClean", [String(audit.checked)])}</p>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {counts
                    .filter(([, count]) => count > 0)
                    .map(([impact, count]) => (
                      <Badge key={impact} variant={IMPACT_VARIANT[impact]} className="text-[10px]">
                        {impactLabel(impact, api.message)} {count}
                      </Badge>
                    ))}
                </div>
              )}
              <ul className="space-y-1">
                {issues.map((issue, index) => (
                  <li
                    key={`${issue.rule}-${issue.elementId ?? index}`}
                    className="space-y-0.5 rounded-control border border-border p-1.5"
                    data-testid={`a11y-issue-${index}`}
                  >
                    <div className="flex items-start gap-1.5">
                      <Badge
                        variant={IMPACT_VARIANT[issue.impact]}
                        className="shrink-0 text-[10px]"
                      >
                        {impactLabel(issue.impact, api.message)}
                      </Badge>
                      <span className="text-[11px] font-medium">
                        {ruleTitle(issue.rule, api.message)}
                      </span>
                    </div>
                    {issue.label || issue.detail ? (
                      <p className="break-all font-mono text-[10px] text-muted-foreground">
                        {[issue.label, issue.detail].filter(Boolean).join(" · ")}
                      </p>
                    ) : null}
                    {issue.elementId ? (
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-5 px-1.5 text-[10px]"
                          disabled={issueBusy !== null}
                          onClick={() => onShowIssue(issue)}
                          data-testid={`a11y-show-${index}`}
                        >
                          {api.message("inspectLocate")}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-5 px-1.5 text-[10px]"
                          disabled={
                            issueBusy !== null || !canPick || pickedIds.includes(issue.elementId)
                          }
                          onClick={() => onPickIssue(issue)}
                          data-testid={`a11y-pick-${index}`}
                        >
                          {pickedIds.includes(issue.elementId)
                            ? api.message("accessPicked")
                            : api.message("accessPick")}
                        </Button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
              {audit.issues.length > SHOWN_ISSUES ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-[11px]"
                  onClick={() => setAllIssues((current) => !current)}
                  data-testid="a11y-show-all"
                >
                  {allIssues
                    ? api.message("accessShowFewer")
                    : api.message("accessShowAll", [String(audit.issues.length)])}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="space-y-1.5" data-testid="focus-tools">
          <h3 className="text-xs font-medium">{api.message("focusTitle")}</h3>
          <p className="text-[11px] text-muted-foreground">{api.message("focusHint")}</p>
          <div className="flex flex-wrap items-center gap-2">
            {runButton("focus", api.message("focusRun"), focus !== null)}
            {focus ? (
              <IncludeToggle api={api} kind="focus" checked={focus.include} onInclude={onInclude} />
            ) : null}
          </div>
          {focus ? (
            <FocusResult
              api={api}
              check={focus}
              numbersShown={focusNumbers}
              issueBusy={issueBusy}
              pickedIds={pickedIds}
              canPick={canPick}
              onToggleNumbers={onToggleFocusNumbers}
              onShow={onShowFocusIssue}
              onPick={onPickFocusIssue}
            />
          ) : null}
        </div>

        <div className="space-y-1.5" data-testid="layout-tools">
          <h3 className="text-xs font-medium">{api.message("layoutTitle")}</h3>
          <p className="text-[11px] text-muted-foreground">{api.message("layoutHint")}</p>
          <div className="flex flex-wrap items-center gap-2">
            {runButton("layout", api.message("layoutRun"), layout !== null)}
            {layout ? (
              <IncludeToggle
                api={api}
                kind="layout"
                checked={layout.include}
                onInclude={onInclude}
              />
            ) : null}
          </div>
          {layout ? (
            <LayoutResult
              api={api}
              check={layout}
              issueBusy={issueBusy}
              pickedIds={pickedIds}
              canPick={canPick}
              onShow={onShowLayoutIssue}
              onPick={onPickLayoutIssue}
            />
          ) : null}
        </div>

        <div className="space-y-1.5" data-testid="tokens-tools">
          <h3 className="text-xs font-medium">{api.message("tokensTitle")}</h3>
          <p className="text-[11px] text-muted-foreground">{api.message("tokensHint")}</p>
          <div className="flex flex-wrap items-center gap-2">
            {runButton("tokens", api.message("tokensRun"), tokens !== null)}
            {canEyedrop ? (
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-[11px]"
                disabled={busy !== null}
                onClick={onEyedropper}
                data-testid="eyedropper"
              >
                {api.message("eyedropperRun")}
              </Button>
            ) : null}
            {tokens ? (
              <IncludeToggle
                api={api}
                kind="tokens"
                checked={tokens.include}
                onInclude={onInclude}
              />
            ) : null}
          </div>
          {pickedColors.length > 0 ? (
            <ul className="space-y-1" data-testid="eyedropper-colors">
              {pickedColors.map((hex) => {
                const rgba = parseColor(hex)
                const formats = rgba ? [hex, toRgbString(rgba), toHslString(rgba)] : [hex]
                return (
                  <li key={hex} className="flex flex-wrap items-center gap-1">
                    <span
                      className="h-4 w-4 shrink-0 rounded border border-border"
                      style={{ backgroundColor: hex }}
                      aria-hidden="true"
                    />
                    {formats.map((format) => (
                      <Button
                        key={format}
                        size="sm"
                        variant="ghost"
                        className="h-5 px-1 font-mono text-[10px]"
                        onClick={() => void copy(format)}
                        aria-label={api.message("inspectCopy", [format])}
                      >
                        {format}
                      </Button>
                    ))}
                  </li>
                )
              })}
            </ul>
          ) : null}
          {tokens ? (
            <div className="space-y-2" data-testid="tokens-result">
              {tokens.colors.length > 0 ? (
                <div className="space-y-1">
                  <p className="text-[11px] text-muted-foreground">{api.message("tokensColors")}</p>
                  <div className="flex flex-wrap gap-1">
                    {tokens.colors.map((color) => (
                      <button
                        key={color.hex}
                        type="button"
                        title={`${color.hex} ×${color.count} (${color.uses.join(", ")})`}
                        aria-label={api.message("inspectCopy", [color.hex])}
                        onClick={() => void copy(color.hex)}
                        className="h-6 w-6 rounded border border-border"
                        style={{ backgroundColor: color.hex }}
                        data-testid={`token-color-${color.hex.slice(1)}`}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
              {tokens.type.length > 0 ? (
                <div className="space-y-0.5">
                  <p className="text-[11px] text-muted-foreground">{api.message("tokensType")}</p>
                  <ul className="space-y-0.5">
                    {tokens.type.slice(0, 8).map((entry) => (
                      <li
                        key={`${entry.family}-${entry.size}-${entry.weight}-${entry.lineHeight}`}
                        className="truncate font-mono text-[10px]"
                        title={entry.sample}
                      >
                        {entry.family} · {entry.size} / {entry.weight} / {entry.lineHeight} ×
                        {entry.count}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {(
                [
                  ["tokensSpacing", tokens.spacing],
                  ["tokensRadii", tokens.radii],
                ] as const
              ).map(([key, values]) =>
                values.length > 0 ? (
                  <div key={key} className="space-y-0.5">
                    <p className="text-[11px] text-muted-foreground">
                      {key === "tokensSpacing"
                        ? api.message("tokensSpacing")
                        : api.message("tokensRadii")}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {values.map((entry) => (
                        <Badge
                          key={entry.value}
                          variant="outline"
                          className="font-mono text-[10px]"
                        >
                          {entry.value}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ) : null
              )}
              {tokens.breakpoints.length > 0 ? (
                <p className="text-[11px]">
                  <span className="text-muted-foreground">{api.message("tokensBreakpoints")} </span>
                  <span className="font-mono">{tokens.breakpoints.join(" · ")}</span>
                </p>
              ) : null}
              {tokens.variables.length > 0 ? (
                <Collapsible open={showVariables} onOpenChange={setShowVariables}>
                  <CollapsibleTrigger asChild>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-[11px]"
                      data-testid="tokens-variables-toggle"
                    >
                      {api.message("tokensVariables", [String(tokens.variables.length)])}
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <pre className="max-h-40 overflow-auto rounded-control border border-border p-1.5 font-mono text-[10px]">
                      {tokens.variables
                        .map((variable) => `${variable.name}: ${variable.value};`)
                        .join("\n")}
                    </pre>
                  </CollapsibleContent>
                </Collapsible>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="space-y-1.5" data-testid="stack-tools">
          <h3 className="text-xs font-medium">{api.message("stackTitle")}</h3>
          <p className="text-[11px] text-muted-foreground">{api.message("stackHint")}</p>
          <div className="flex flex-wrap items-center gap-2">
            {runButton("stack", api.message("stackRun"), stack !== null)}
            {stack ? (
              <IncludeToggle api={api} kind="stack" checked={stack.include} onInclude={onInclude} />
            ) : null}
          </div>
          {stack ? <StackResult api={api} stack={stack} /> : null}
        </div>

        <div className="space-y-1.5" data-testid="perf-tools">
          <h3 className="text-xs font-medium">{api.message("perfTitle")}</h3>
          <p className="text-[11px] text-muted-foreground">{api.message("perfHint")}</p>
          <div className="flex flex-wrap items-center gap-2">
            {runButton("perf", api.message("perfRun"), perf !== null)}
            {perf ? (
              <IncludeToggle api={api} kind="perf" checked={perf.include} onInclude={onInclude} />
            ) : null}
          </div>
          {perf ? <PerformanceResult api={api} report={perf} /> : null}
        </div>

        <div className="space-y-1.5" data-testid="seo-tools">
          <h3 className="text-xs font-medium">{api.message("seoTitle")}</h3>
          <p className="text-[11px] text-muted-foreground">{api.message("seoHint")}</p>
          <div className="flex flex-wrap items-center gap-2">
            {runButton("seo", api.message("seoRun"), seo !== null)}
            {seo ? (
              <IncludeToggle api={api} kind="seo" checked={seo.include} onInclude={onInclude} />
            ) : null}
          </div>
          {seo ? <SeoResult api={api} report={seo} /> : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
