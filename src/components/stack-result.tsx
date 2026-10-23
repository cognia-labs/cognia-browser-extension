import { useState } from "react"
import {
  Badge,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  cn,
} from "@cognia/plugin-ui"
import { ChevronDownIcon } from "lucide-react"

import type { BrowserApi } from "@ext/src/lib/browser-api"
import {
  STACK_CATEGORIES,
  type DetectedStack,
  type StackCategory,
  type StackFacts,
} from "@ext/src/lib/inspect/tech-stack"

/** A `switch` with literal keys, so the locale coverage test can see them. */
export function stackCategoryTitle(
  category: StackCategory,
  message: (key: string) => string
): string {
  switch (category) {
    case "meta-framework":
      return message("stackCategoryMetaFramework")
    case "framework":
      return message("stackCategoryFramework")
    case "cms":
      return message("stackCategoryCms")
    case "ui-library":
      return message("stackCategoryUi")
    case "styling":
      return message("stackCategoryStyling")
    case "state":
      return message("stackCategoryState")
    case "build":
      return message("stackCategoryBuild")
    case "library":
      return message("stackCategoryLibrary")
    case "analytics":
      return message("stackCategoryAnalytics")
    case "monitoring":
      return message("stackCategoryMonitoring")
    case "payments":
      return message("stackCategoryPayments")
    case "auth":
      return message("stackCategoryAuth")
    case "service":
      return message("stackCategoryService")
    case "hosting":
      return message("stackCategoryHosting")
  }
}

function Fact({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="min-w-0 rounded-md bg-muted/60 px-2 py-1" data-testid={testId}>
      <p className="truncate text-[10px] text-muted-foreground">{label}</p>
      <p className="truncate text-xs font-medium tabular-nums">{value}</p>
    </div>
  )
}

function Facts({ api, facts }: { api: BrowserApi; facts: StackFacts }) {
  const flags = [
    facts.serviceWorker ? api.message("stackFactServiceWorker") : null,
    facts.manifest ? api.message("stackFactManifest") : null,
    facts.importMap ? api.message("stackFactImportMap") : null,
  ].filter((flag): flag is string => flag !== null)
  return (
    <div className="space-y-1.5" data-testid="stack-facts">
      <div className="grid grid-cols-3 gap-1">
        <Fact
          label={api.message("stackFactScripts")}
          value={api.message("stackFactScriptsValue", [
            String(facts.scripts),
            String(facts.inlineScripts),
          ])}
          testId="stack-fact-scripts"
        />
        <Fact
          label={api.message("stackFactJs")}
          value={facts.jsKb === null ? "—" : `${facts.jsKb} KB`}
          testId="stack-fact-js"
        />
        <Fact
          label={api.message("stackFactCss")}
          value={facts.cssKb === null ? "—" : `${facts.cssKb} KB`}
          testId="stack-fact-css"
        />
      </div>
      {facts.protocol || flags.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {facts.protocol ? (
            <Badge variant="outline" className="font-mono text-[10px]">
              {facts.protocol}
            </Badge>
          ) : null}
          {flags.map((flag) => (
            <Badge key={flag} variant="outline" className="text-[10px]">
              {flag}
            </Badge>
          ))}
        </div>
      ) : null}
      {facts.customElements.length > 0 ? (
        <p className="text-[11px] break-all text-muted-foreground" data-testid="stack-elements">
          {api.message("stackFactElements")}{" "}
          <span className="font-mono text-foreground">
            {facts.customElements.map((tag) => `<${tag}>`).join(" ")}
          </span>
        </p>
      ) : null}
      {facts.thirdParty.length > 0 ? (
        <div className="space-y-0.5" data-testid="stack-third-party">
          <p className="text-[11px] text-muted-foreground">{api.message("stackFactThirdParty")}</p>
          <ul className="space-y-0.5 font-mono text-[10px]">
            {facts.thirdParty.map(({ host, count }) => (
              <li key={host} className="flex gap-2">
                <span className="min-w-0 flex-1 truncate">{host}</span>
                <span className="shrink-0 text-muted-foreground tabular-nums">{count}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

/**
 * What the page is built with, by kind (Wappalyzer): each finding with its
 * version and the evidence it rests on, then how the page is put together.
 */
export function StackResult({ api, stack }: { api: BrowserApi; stack: DetectedStack }) {
  const [evidence, setEvidence] = useState(false)
  const groups = STACK_CATEGORIES.map((category) => ({
    category,
    entries: stack.entries.filter((entry) => entry.category === category),
  })).filter((group) => group.entries.length > 0)
  return (
    <div className="space-y-2" data-testid="stack-result">
      {stack.entries.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">{api.message("stackNone")}</p>
      ) : (
        <>
          <p className="text-[11px] text-muted-foreground" data-testid="stack-count">
            {api.message("stackCount", [String(stack.entries.length)])}
          </p>
          <dl className="space-y-1.5">
            {groups.map(({ category, entries }) => (
              <div
                key={category}
                className="grid grid-cols-[6.5rem_1fr] items-start gap-2"
                data-testid={`stack-group-${category}`}
              >
                <dt className="pt-0.5 text-[10px] font-medium text-muted-foreground uppercase">
                  {stackCategoryTitle(category, api.message)}
                </dt>
                <dd className="flex min-w-0 flex-wrap gap-1">
                  {entries.map((entry) => (
                    <Badge
                      key={entry.name}
                      variant="secondary"
                      className="max-w-full gap-1 text-[10px]"
                      title={entry.evidence}
                    >
                      <span className="truncate">{entry.name}</span>
                      {entry.version ? (
                        <span className="font-mono opacity-70">{entry.version}</span>
                      ) : null}
                      {entry.detail ? <span className="opacity-70">· {entry.detail}</span> : null}
                    </Badge>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}
      {stack.development !== null ? (
        <p
          className={cn(
            "rounded-md px-2 py-1 text-[11px]",
            stack.development ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"
          )}
          data-testid="stack-build"
        >
          {stack.development ? api.message("stackDevelopment") : api.message("stackProduction")}
        </p>
      ) : null}
      {stack.facts ? <Facts api={api} facts={stack.facts} /> : null}
      {stack.entries.some((entry) => entry.evidence) ? (
        <Collapsible open={evidence} onOpenChange={setEvidence}>
          <CollapsibleTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 gap-1 px-1.5 text-[11px]"
              data-testid="stack-evidence-toggle"
            >
              <ChevronDownIcon
                className={cn("size-3 transition-transform", !evidence && "-rotate-90")}
                aria-hidden="true"
              />
              {api.message("stackEvidence")}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul
              className="max-h-56 space-y-0.5 overflow-y-auto rounded-md border border-border p-1.5 text-[10px]"
              data-testid="stack-evidence"
            >
              {stack.entries.map((entry) => (
                <li key={entry.name} className="flex gap-2">
                  <span className="w-28 shrink-0 truncate font-medium">{entry.name}</span>
                  <span className="min-w-0 flex-1 font-mono break-all text-muted-foreground">
                    {entry.evidence ?? "—"}
                  </span>
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  )
}
