/**
 * Request rules as `declarativeNetRequest` session rules: the half of a rule
 * the browser applies to every request of a tab, frames and workers included
 * (`rules.ts` decides which half a rule is).
 *
 * The shapes are written out here rather than taken from `@types/chrome`,
 * whose string enums only exist inside the browser; the worker hands these
 * to `chrome.declarativeNetRequest.updateSessionRules` as they are.
 */
import { coverageOf, type NetworkRule } from "./rules"

export interface DnrHeader {
  header: string
  operation: "set" | "remove"
  value?: string
}

export interface DnrCondition {
  urlFilter?: string
  regexFilter?: string
  isUrlFilterCaseSensitive?: boolean
  requestMethods?: string[]
  resourceTypes?: string[]
  initiatorDomains?: string[]
  requestDomains?: string[]
  tabIds?: number[]
}

export interface DnrRule {
  id: number
  priority: number
  condition: DnrCondition
  action:
    | { type: "block" }
    | { type: "redirect"; redirect: { url: string } }
    | { type: "modifyHeaders"; requestHeaders?: DnrHeader[]; responseHeaders?: DnrHeader[] }
}

/** Every request type, for header rewrites, which should reach documents too. */
const ALL_TYPES = [
  "main_frame",
  "sub_frame",
  "stylesheet",
  "script",
  "image",
  "font",
  "object",
  "xmlhttprequest",
  "ping",
  "csp_report",
  "media",
  "websocket",
  "webtransport",
  "webbundle",
  "other",
]

/** Who a rule is for: pages on some sites, or the tabs one conversation holds. */
export type DnrScope = { sites: string[] } | { tabIds: number[] }

const REGEX_LITERAL = /^\/(.*[\\^$.|?+()[\]{].*)\/([dimsu]*)$/

/**
 * A rule's URL test. A `/regex/flags` stays an expression. A plain match is a
 * part of the URL with `*` for anything, which is exactly `urlFilter`, unless
 * it holds a character `urlFilter` treats specially, or one it cannot carry.
 */
export function urlCondition(
  match: string
): Pick<DnrCondition, "urlFilter" | "regexFilter" | "isUrlFilterCaseSensitive"> {
  const literal = REGEX_LITERAL.exec(match)
  if (literal) {
    return {
      regexFilter: literal[1]!,
      isUrlFilterCaseSensitive: !literal[2]!.includes("i"),
    }
  }
  if (!/[|^]/.test(match) && /^[\x20-\x7e]*$/.test(match)) {
    return { urlFilter: match, isUrlFilterCaseSensitive: false }
  }
  const escaped = match
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*")
  return { regexFilter: escaped, isUrlFilterCaseSensitive: false }
}

function headerOperations(rule: NetworkRule): DnrHeader[] {
  return [
    ...Object.entries(rule.headers).map(([header, value]) => ({
      header,
      operation: "set" as const,
      value,
    })),
    ...rule.removeHeaders.map((header) => ({ header, operation: "remove" as const })),
  ]
}

/**
 * The session rules for one request rule: none when it runs in the page.
 * A site-scoped header rewrite takes two, because a page's own navigation is
 * started by the page before it, not by the site: one for what the site's
 * pages ask for, one for the site's own documents.
 */
export function compileRule(
  rule: NetworkRule,
  scope: DnrScope,
  nextId: () => number,
  priority: number
): DnrRule[] {
  if (!rule.enabled || coverageOf(rule) !== "all-requests") return []
  const base: DnrCondition = {
    ...urlCondition(rule.match),
    ...(rule.method ? { requestMethods: [rule.method.toLowerCase()] } : {}),
  }
  const rewrites = rule.action === "request_headers" || rule.action === "response_headers"
  const action: DnrRule["action"] =
    rule.action === "fail"
      ? { type: "block" }
      : rule.action === "redirect"
        ? { type: "redirect", redirect: { url: rule.redirectTo } }
        : rule.action === "request_headers"
          ? { type: "modifyHeaders", requestHeaders: headerOperations(rule) }
          : { type: "modifyHeaders", responseHeaders: headerOperations(rule) }
  // Without `resourceTypes` a rule skips top-level documents: right for a
  // failure or a redirect, which would otherwise block the page itself.
  const types = rewrites ? { resourceTypes: ALL_TYPES } : {}
  if ("tabIds" in scope) {
    if (scope.tabIds.length === 0) return []
    return [
      { id: nextId(), priority, condition: { ...base, ...types, tabIds: scope.tabIds }, action },
    ]
  }
  const sites = scope.sites.filter((site) => site !== "*")
  if (sites.length < scope.sites.length) {
    return [{ id: nextId(), priority, condition: { ...base, ...types }, action }]
  }
  const rules: DnrRule[] = [
    { id: nextId(), priority, condition: { ...base, ...types, initiatorDomains: sites }, action },
  ]
  if (rewrites) {
    rules.push({
      id: nextId(),
      priority,
      condition: { ...base, resourceTypes: ["main_frame", "sub_frame"], requestDomains: sites },
      action,
    })
  }
  return rules
}

/** Match patterns for the pages of a group's sites, for registering page scripts. */
export function sitePatterns(sites: readonly string[]): string[] {
  if (sites.includes("*")) return ["*://*/*"]
  return [
    ...new Set(
      sites.flatMap((site) =>
        /^[\d.]+$/.test(site) || site === "localhost"
          ? [`*://${site}/*`]
          : [`*://${site}/*`, `*://*.${site}/*`]
      )
    ),
  ]
}
