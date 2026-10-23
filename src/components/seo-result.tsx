import { useState } from "react"
import {
  Badge,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@cognia/plugin-ui"

import type { BrowserApi } from "@ext/src/lib/browser-api"
import type { SeoReport, SeoRule, SeoSeverity } from "@ext/src/lib/inspect/seo-check"

/** A `switch` with literal keys, so the locale coverage test can see them. */
export function seoRuleTitle(rule: SeoRule, message: (key: string) => string): string {
  switch (rule) {
    case "title-missing":
      return message("seoRuleTitleMissing")
    case "title-length":
      return message("seoRuleTitleLength")
    case "description-missing":
      return message("seoRuleDescriptionMissing")
    case "description-length":
      return message("seoRuleDescriptionLength")
    case "canonical-missing":
      return message("seoRuleCanonicalMissing")
    case "canonical-multiple":
      return message("seoRuleCanonicalMultiple")
    case "noindex":
      return message("seoRuleNoindex")
    case "viewport-missing":
      return message("seoRuleViewport")
    case "h1-count":
      return message("seoRuleHeadingOne")
    case "og-missing":
      return message("seoRuleOpenGraph")
    case "og-image-relative":
      return message("seoRuleOpenGraphImage")
    case "twitter-missing":
      return message("seoRuleTwitter")
    case "structured-data-missing":
      return message("seoRuleStructuredMissing")
    case "structured-data-invalid":
      return message("seoRuleStructuredInvalid")
    case "image-alt":
      return message("seoRuleImageAlt")
    case "link-text":
      return message("seoRuleLinkText")
  }
}

function severityLabel(severity: SeoSeverity, message: (key: string) => string): string {
  switch (severity) {
    case "error":
      return message("seoSeverityError")
    case "warning":
      return message("seoSeverityWarning")
    case "info":
      return message("seoSeverityInfo")
  }
}

const SEVERITY_VARIANT = { error: "destructive", warning: "warning", info: "outline" } as const

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/**
 * How the page presents itself: the findings, a preview of the card a shared
 * link would show (built from the page's own Open Graph tags, falling back as
 * the sites that render cards do), and the heading outline.
 */
export function SeoResult({
  api,
  report,
}: {
  api: BrowserApi
  report: Omit<SeoReport, "tabId" | "ranAt">
}) {
  const [outline, setOutline] = useState(false)
  const tag = (property: string) =>
    report.social.find((entry) => entry.property === property)?.content
  const card = {
    image: tag("og:image") ?? tag("twitter:image"),
    title: tag("og:title") ?? tag("twitter:title") ?? report.title,
    description: tag("og:description") ?? tag("twitter:description") ?? report.description,
    site: tag("og:site_name") ?? hostOf(tag("og:url") ?? report.canonical ?? report.url),
  }
  return (
    <div className="space-y-2" data-testid="seo-result">
      {report.issues.length === 0 ? (
        <p className="text-[11px]">{api.message("seoClean")}</p>
      ) : (
        <ul className="space-y-1">
          {report.issues.map((issue, index) => (
            <li
              key={issue.rule}
              className="flex items-start gap-1.5 text-[11px]"
              data-testid={`seo-issue-${index}`}
            >
              <Badge variant={SEVERITY_VARIANT[issue.severity]} className="shrink-0 text-[10px]">
                {severityLabel(issue.severity, api.message)}
              </Badge>
              <span>
                {seoRuleTitle(issue.rule, api.message)}
                {issue.detail ? (
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {" "}
                    · {issue.detail}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-1">
        <p className="text-[11px] text-muted-foreground">{api.message("seoPreviewTitle")}</p>
        <div
          className="overflow-hidden rounded-control border border-border"
          data-testid="seo-card"
        >
          {card.image && /^https?:\/\//.test(card.image) ? (
            <img
              src={card.image}
              alt=""
              referrerPolicy="no-referrer"
              className="block aspect-[1.91/1] w-full bg-muted object-cover"
              data-testid="seo-card-image"
            />
          ) : (
            <div className="flex aspect-[1.91/1] w-full items-center justify-center bg-muted text-[11px] text-muted-foreground">
              {api.message("seoPreviewNoImage")}
            </div>
          )}
          <div className="space-y-0.5 p-2">
            <p className="truncate text-[10px] uppercase text-muted-foreground">{card.site}</p>
            <p className="line-clamp-2 text-xs font-medium" data-testid="seo-card-title">
              {card.title ?? api.message("seoPreviewNoTitle")}
            </p>
            {card.description ? (
              <p className="line-clamp-2 text-[11px] text-muted-foreground">{card.description}</p>
            ) : null}
          </div>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground" data-testid="seo-summary">
        {api.message("seoSummary", [
          String(report.counts.words),
          String(report.counts.links),
          report.structuredData.length > 0 ? report.structuredData.join(", ") : "—",
        ])}
      </p>

      {report.headings.length > 0 ? (
        <Collapsible open={outline} onOpenChange={setOutline}>
          <CollapsibleTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[11px]"
              data-testid="seo-outline-toggle"
            >
              {api.message("seoOutline", [String(report.headings.length)])}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ol
              className="space-y-0.5 rounded-control border border-border p-1.5"
              data-testid="seo-outline"
            >
              {report.headings.map((heading, index) => (
                <li
                  key={index}
                  className="truncate text-[11px]"
                  style={{ paddingLeft: `${(heading.level - 1) * 10}px` }}
                >
                  <span className="font-mono text-[10px] text-muted-foreground">
                    h{heading.level}{" "}
                  </span>
                  {heading.text || api.message("seoEmptyHeading")}
                </li>
              ))}
            </ol>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  )
}
