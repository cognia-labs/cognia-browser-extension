/**
 * What the page checks found — accessibility, design tokens, tech stack — as
 * the panel holds them between running a check and sending.
 *
 * Each belongs to the tab it was read from, like a pick, and each is sent only
 * while the person leaves it included: running a check is looking, sending it
 * is a separate choice, made on screen.
 */
import { A11Y_RULES, auditMarkdown, type A11yAudit, type A11yIssue } from "./a11y-audit"
import { tokensMarkdown, type DesignTokens } from "./design-tokens"
import { parsePerformance, performanceMarkdown, type PagePerformance } from "./page-performance"
import { parseSeo, seoMarkdown, type SeoReport } from "./seo-check"
import { layoutMarkdown, parseLayout, type LayoutCheck } from "./layout-check"
import { focusMarkdown, parseFocus, type FocusCheck } from "./focus-order"
import {
  STACK_CATEGORIES,
  stackMarkdown,
  type StackEntry,
  type StackFacts,
  type TechStack,
} from "./tech-stack"

export type Included<T> = T & { include: boolean }

export interface PageInsights {
  audit: Included<A11yAudit> | null
  tokens: Included<DesignTokens> | null
  stack: Included<TechStack> | null
  perf: Included<PagePerformance> | null
  seo: Included<SeoReport> | null
  layout: Included<LayoutCheck> | null
  focus: Included<FocusCheck> | null
}

export type InsightKind = keyof PageInsights

export const NO_INSIGHTS: PageInsights = {
  audit: null,
  tokens: null,
  stack: null,
  perf: null,
  seo: null,
  layout: null,
  focus: null,
}

/** Only the insights read from `tabId`. */
export function insightsForTab(insights: PageInsights, tabId: number): PageInsights {
  return {
    audit: insights.audit?.tabId === tabId ? insights.audit : null,
    tokens: insights.tokens?.tabId === tabId ? insights.tokens : null,
    stack: insights.stack?.tabId === tabId ? insights.stack : null,
    perf: insights.perf?.tabId === tabId ? insights.perf : null,
    seo: insights.seo?.tabId === tabId ? insights.seo : null,
    layout: insights.layout?.tabId === tabId ? insights.layout : null,
    focus: insights.focus?.tabId === tabId ? insights.focus : null,
  }
}

/** The Markdown each included insight adds: the stack frames, the rest report. */
export function insightSections(
  insights: PageInsights,
  tabId: number
): { context: string[]; reports: string[] } {
  const own = insightsForTab(insights, tabId)
  return {
    context: own.stack?.include ? [stackMarkdown(own.stack)] : [],
    reports: [
      ...(own.audit?.include ? [auditMarkdown(own.audit)] : []),
      ...(own.focus?.include ? [focusMarkdown(own.focus)] : []),
      ...(own.layout?.include ? [layoutMarkdown(own.layout)] : []),
      ...(own.tokens?.include ? [tokensMarkdown(own.tokens)] : []),
      ...(own.perf?.include ? [performanceMarkdown(own.perf)] : []),
      ...(own.seo?.include ? [seoMarkdown(own.seo)] : []),
    ],
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function base(value: unknown): { tabId: number; ranAt: number; include: boolean } | null {
  if (!isRecord(value) || typeof value.tabId !== "number" || typeof value.ranAt !== "number")
    return null
  return { tabId: value.tabId, ranAt: value.ranAt, include: value.include !== false }
}

const IMPACTS = ["critical", "serious", "moderate", "minor"]

function isIssue(value: unknown): value is A11yIssue {
  return (
    isRecord(value) &&
    (A11Y_RULES as readonly unknown[]).includes(value.rule) &&
    IMPACTS.includes(value.impact as string) &&
    ["elementId", "selector", "label", "detail"].every(
      (key) => value[key] === undefined || typeof value[key] === "string"
    )
  )
}

const listOf = <T>(value: unknown, guard: (item: unknown) => item is T): T[] =>
  Array.isArray(value) ? value.filter(guard) : []

const isCounted = (item: unknown): item is { value: string; count: number } =>
  isRecord(item) && typeof item.value === "string" && typeof item.count === "number"

function isStackEntry(item: unknown): item is StackEntry {
  return (
    isRecord(item) &&
    typeof item.name === "string" &&
    (STACK_CATEGORIES as readonly unknown[]).includes(item.category) &&
    ["version", "detail", "evidence"].every(
      (key) => item[key] === undefined || typeof item[key] === "string"
    )
  )
}

function parseStackFacts(value: unknown): StackFacts | null {
  if (!isRecord(value)) return null
  const count = (key: string) => (typeof value[key] === "number" ? value[key] : 0)
  const kb = (key: string) => (typeof value[key] === "number" ? value[key] : null)
  return {
    scripts: count("scripts"),
    moduleScripts: count("moduleScripts"),
    inlineScripts: count("inlineScripts"),
    stylesheets: count("stylesheets"),
    jsKb: kb("jsKb"),
    cssKb: kb("cssKb"),
    protocol: typeof value.protocol === "string" ? value.protocol : null,
    serviceWorker: value.serviceWorker === true,
    manifest: value.manifest === true,
    importMap: value.importMap === true,
    customElements: listOf(
      value.customElements,
      (item): item is string => typeof item === "string"
    ),
    thirdParty: listOf(
      value.thirdParty,
      (item): item is { host: string; count: number } =>
        isRecord(item) && typeof item.host === "string" && typeof item.count === "number"
    ),
  }
}

/**
 * Stored insights this build can show, from an unsent draft. Anything
 * malformed is dropped rather than shown: the draft is the panel's own
 * memory, but a check can always be run again.
 */
export function parseInsights(value: unknown): PageInsights {
  if (!isRecord(value)) return NO_INSIGHTS
  const audit = base(value.audit)
  const tokens = base(value.tokens)
  const stack = base(value.stack)
  const perf = base(value.perf)
  const perfRead = perf ? parsePerformance(value.perf) : null
  const seo = base(value.seo)
  const seoRead = seo ? parseSeo(value.seo) : null
  const layout = base(value.layout)
  const layoutRead = layout ? parseLayout(value.layout) : null
  const focus = base(value.focus)
  const focusRead = focus ? parseFocus(value.focus) : null
  const rawAudit = value.audit as Record<string, unknown> | undefined
  const rawTokens = value.tokens as Record<string, unknown> | undefined
  const rawStack = value.stack as Record<string, unknown> | undefined
  return {
    audit: audit
      ? {
          ...audit,
          issues: listOf(rawAudit?.issues, isIssue),
          checked: typeof rawAudit?.checked === "number" ? rawAudit.checked : 0,
          truncated: rawAudit?.truncated === true,
        }
      : null,
    tokens: tokens
      ? {
          ...tokens,
          colors: listOf(
            rawTokens?.colors,
            (item): item is DesignTokens["colors"][number] =>
              isRecord(item) &&
              typeof item.hex === "string" &&
              /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/.test(item.hex) &&
              typeof item.count === "number" &&
              Array.isArray(item.uses)
          ),
          fonts: listOf(rawTokens?.fonts, isCounted),
          type: listOf(
            rawTokens?.type,
            (item): item is DesignTokens["type"][number] =>
              isRecord(item) &&
              ["family", "size", "weight", "lineHeight", "sample"].every(
                (key) => typeof item[key] === "string"
              ) &&
              typeof item.count === "number"
          ),
          spacing: listOf(rawTokens?.spacing, isCounted),
          radii: listOf(rawTokens?.radii, isCounted),
          shadows: listOf(rawTokens?.shadows, isCounted),
          variables: listOf(
            rawTokens?.variables,
            (item): item is { name: string; value: string } =>
              isRecord(item) && typeof item.name === "string" && typeof item.value === "string"
          ),
          breakpoints: listOf(
            rawTokens?.breakpoints,
            (item): item is string => typeof item === "string"
          ),
          scanned: typeof rawTokens?.scanned === "number" ? rawTokens.scanned : 0,
        }
      : null,
    stack: stack
      ? {
          ...stack,
          entries: listOf(rawStack?.entries, isStackEntry),
          development: typeof rawStack?.development === "boolean" ? rawStack.development : null,
          facts: parseStackFacts(rawStack?.facts),
        }
      : null,
    perf: perf && perfRead ? { ...perf, ...perfRead } : null,
    seo: seo && seoRead ? { ...seo, ...seoRead } : null,
    layout: layout && layoutRead ? { ...layout, ...layoutRead } : null,
    focus: focus && focusRead ? { ...focus, ...focusRead } : null,
  }
}
