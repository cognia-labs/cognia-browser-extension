/**
 * Request rules: answer, fail, delay, redirect or rewrite the headers of the
 * requests pages make (ADR-0242, `network-rules-v1`).
 *
 * Two kinds of owner share one vocabulary. The person keeps a library in
 * `chrome.storage.local`, grouped by the sites a group applies to, each group
 * and rule switched on or off. An agent sets rules for its own conversation;
 * those live in `chrome.storage.session`, only in the tabs that conversation
 * holds, and go when it is released, stopped or taken over. The worker is the
 * only writer of both; the panel sends it the change it wants.
 *
 * Each rule runs where the browser can apply it. Header rewrites, failures
 * and redirects become `declarativeNetRequest` session rules and reach every
 * request of the tab, frames and workers included. Made-up answers, changed
 * answers and holds need the request's body, which only the page's own
 * `fetch`/XHR expose, so they run in the page (`request-mocks.ts`).
 */
import {
  MAX_MOCK_BODY,
  MAX_MOCK_DELAY_MS,
  matchIsValid,
  type RequestMock,
} from "../inspect/request-mocks"

export const RULE_ACTIONS = [
  "fail",
  "respond",
  "modify",
  "delay",
  "redirect",
  "request_headers",
  "response_headers",
] as const
export type RuleAction = (typeof RULE_ACTIONS)[number]

export const RULE_METHODS = [
  "",
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
] as const

/** Where a rule can take effect. */
export type RuleCoverage = "all-requests" | "page-requests"

export interface NetworkRule {
  id: string
  /** `*` wildcards, `/regex/flags`, or else a case-insensitive part of the absolute URL. */
  match: string
  /** Upper-case; empty for any method. */
  method: string
  action: RuleAction
  /** `respond`: the status. `modify`: a status replacing the server's, or 0. */
  status: number
  /** `respond`: the body. `modify`: JSON merged into the answer, or text replacing it. */
  body: string
  /** `respond`/`modify`: response headers. `*_headers`: headers to set. */
  headers: Record<string, string>
  /** `*_headers`: header names to remove. */
  removeHeaders: string[]
  /** `redirect`: an absolute URL. */
  redirectTo: string
  delayMs: number
  /** How many matches it applies to; 0 for all. Only page rules can count. */
  times: number
  /** The share of matches it applies to, 1–100: a flaky server. Page rules only. */
  chance: number
  enabled: boolean
}

export interface RuleGroup {
  id: string
  name: string
  /**
   * Hosts whose pages the group applies to, each with its subdomains; `*` for
   * every site. A rule here catches requests those pages make, wherever they go.
   */
  sites: string[]
  enabled: boolean
  rules: NetworkRule[]
}

export interface RuleLibrary {
  v: 1
  groups: RuleGroup[]
}

/** The rules one agent conversation set, in the tabs it holds. */
export type AgentRuleSets = Record<string, NetworkRule[]>

/** The optional grant that lets the browser rewrite requests, on granted sites only. */
export const DNR_PERMISSION = "declarativeNetRequestWithHostAccess"
export const NETWORK_RULES_KEY = "cognia.networkRules.v1"
export const AGENT_NETWORK_RULES_KEY = "cognia.agent.networkRules.v1"
export const EXPORT_FORMAT = "cognia-network-rules"

export const MAX_GROUPS = 20
export const MAX_RULES_PER_GROUP = 50
export const MAX_AGENT_RULES = 50
const MAX_HEADERS = 20
const MAX_SITES = 20

export const EMPTY_LIBRARY: RuleLibrary = Object.freeze({ v: 1, groups: [] }) as RuleLibrary

/**
 * Header names the browser lets an extension rewrite: a token, and not one
 * whose rewrite would forge the request's origin to the extension itself.
 */
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,100}$/

export function coverageOf(
  rule: Pick<NetworkRule, "action" | "times" | "chance" | "delayMs">
): RuleCoverage {
  switch (rule.action) {
    case "request_headers":
    case "response_headers":
      return "all-requests"
    case "fail":
    case "redirect":
      // A count, a chance or a hold needs the page's own code to keep them.
      return rule.times > 0 || rule.chance < 100 || rule.delayMs > 0
        ? "page-requests"
        : "all-requests"
    default:
      return "page-requests"
  }
}

function cleanHeaders(value: unknown): Record<string, string> {
  const headers: Record<string, string> = {}
  if (!value || typeof value !== "object" || Array.isArray(value)) return headers
  for (const [name, text] of Object.entries(value as Record<string, unknown>)) {
    if (Object.keys(headers).length >= MAX_HEADERS) break
    const key = name.trim()
    if (!HEADER_NAME.test(key) || typeof text !== "string") continue
    headers[key] = text.replace(/[\r\n]+/g, " ").slice(0, 2_000)
  }
  return headers
}

function cleanNames(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [
    ...new Set(
      value
        .filter((name): name is string => typeof name === "string")
        .map((name) => name.trim())
        .filter((name) => HEADER_NAME.test(name))
    ),
  ].slice(0, MAX_HEADERS)
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

const integer = (value: unknown, low: number, high: number, fallback: number) => {
  const number = Math.trunc(Number(value))
  return Number.isFinite(number) ? Math.max(low, Math.min(high, number)) : fallback
}

/** A rule that can be applied: in range, and matching something; null otherwise. */
export function cleanRule(input: unknown, id: string): NetworkRule | null {
  if (!input || typeof input !== "object") return null
  const record = input as Record<string, unknown>
  const match = String(record.match ?? "").trim()
  if (!match || match.replace(/\*/g, "") === "" || !matchIsValid(match)) return null
  const action = record.action as RuleAction
  if (!(RULE_ACTIONS as readonly unknown[]).includes(action)) return null
  const method = String(record.method ?? "").toUpperCase()
  const status = integer(record.status, 0, 599, 0)
  if (action === "respond" && status < 100) return null
  if (action === "modify" && status !== 0 && status < 100) return null
  const delayMs = integer(record.delayMs, 0, MAX_MOCK_DELAY_MS, 0)
  if (action === "delay" && delayMs === 0) return null
  const redirectTo = String(record.redirectTo ?? "").trim()
  if (action === "redirect" && !isHttpUrl(redirectTo)) return null
  const answers = action === "respond" || action === "modify"
  const rewrites = action === "request_headers" || action === "response_headers"
  const headers = answers || rewrites ? cleanHeaders(record.headers) : {}
  const removeHeaders = rewrites ? cleanNames(record.removeHeaders) : []
  if (rewrites && Object.keys(headers).length === 0 && removeHeaders.length === 0) return null
  const body = answers ? String(record.body ?? "").slice(0, MAX_MOCK_BODY) : ""
  if (action === "modify" && status === 0 && !body && Object.keys(headers).length === 0) return null
  return {
    id,
    match: match.slice(0, 500),
    method: (RULE_METHODS as readonly string[]).includes(method) ? method : "",
    action,
    status: answers ? status : 0,
    body,
    headers,
    removeHeaders,
    redirectTo: action === "redirect" ? redirectTo.slice(0, 2_000) : "",
    delayMs: rewrites ? 0 : delayMs,
    times: rewrites ? 0 : integer(record.times, 0, 1_000, 0),
    chance: rewrites ? 100 : integer(record.chance ?? 100, 1, 100, 100),
    enabled: record.enabled !== false,
  }
}

/** A host as a group names it: lower-case, `*` for every site; null if not a host. */
export function cleanSite(input: string): string | null {
  const trimmed = input.trim().toLowerCase()
  if (trimmed === "*") return "*"
  let host = trimmed.replace(/^\*\./, "")
  try {
    host = new URL(host.includes("://") ? host : `https://${host}`).hostname
  } catch {
    return null
  }
  host = host.replace(/\.$/, "")
  return host === "localhost" || /^[a-z0-9.-]+\.[a-z0-9-]+$/.test(host) || /^[\d.]+$/.test(host)
    ? host
    : null
}

function cleanGroup(input: unknown, fallbackId: string): RuleGroup | null {
  if (!input || typeof input !== "object") return null
  const record = input as Record<string, unknown>
  const id = typeof record.id === "string" && record.id ? record.id.slice(0, 64) : fallbackId
  const sites = Array.isArray(record.sites)
    ? [
        ...new Set(
          record.sites
            .filter((site): site is string => typeof site === "string")
            .map(cleanSite)
            .filter((site): site is string => site !== null)
        ),
      ].slice(0, MAX_SITES)
    : []
  if (sites.length === 0) return null
  const seen = new Set<string>()
  const rules: NetworkRule[] = []
  for (const [index, entry] of (Array.isArray(record.rules) ? record.rules : []).entries()) {
    const raw = entry as Record<string, unknown> | null
    let ruleId = typeof raw?.id === "string" && raw.id ? raw.id.slice(0, 64) : `${id}-${index}`
    if (seen.has(ruleId)) ruleId = `${ruleId}-${index}`
    const rule = cleanRule(entry, ruleId)
    if (!rule) continue
    seen.add(ruleId)
    rules.push(rule)
    if (rules.length === MAX_RULES_PER_GROUP) break
  }
  return {
    id,
    name:
      String(record.name ?? "")
        .trim()
        .slice(0, 80) || sites.join(", "),
    sites,
    enabled: record.enabled !== false,
    rules,
  }
}

/** The stored library, defensively: storage is written by older builds too. */
export function parseLibrary(value: unknown): RuleLibrary {
  if (!value || typeof value !== "object") return { v: 1, groups: [] }
  const groups: RuleGroup[] = []
  const seen = new Set<string>()
  const record = value as Record<string, unknown>
  for (const [index, entry] of (Array.isArray(record.groups) ? record.groups : []).entries()) {
    const group = cleanGroup(entry, `group-${index}`)
    if (!group || seen.has(group.id)) continue
    seen.add(group.id)
    groups.push(group)
    if (groups.length === MAX_GROUPS) break
  }
  return { v: 1, groups }
}

export function parseAgentRuleSets(value: unknown): AgentRuleSets {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const sets: AgentRuleSets = {}
  for (const [sessionId, rules] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(rules)) continue
    const clean = rules
      .map((rule, index) =>
        cleanRule(rule, String((rule as { id?: unknown } | null)?.id ?? `${sessionId}-${index}`))
      )
      .filter((rule): rule is NetworkRule => rule !== null)
      .slice(0, MAX_AGENT_RULES)
    if (clean.length > 0) sets[sessionId] = clean
  }
  return sets
}

/** Whether `host` is one of the group's sites, or a subdomain of one. */
export function groupAppliesTo(group: Pick<RuleGroup, "sites">, host: string): boolean {
  const lower = host.toLowerCase()
  return group.sites.some((site) => site === "*" || lower === site || lower.endsWith(`.${site}`))
}

/** The enabled rules of the enabled groups that apply to pages on `host`. */
export function rulesForHost(library: RuleLibrary, host: string): NetworkRule[] {
  return library.groups
    .filter((group) => group.enabled && groupAppliesTo(group, host))
    .flatMap((group) => group.rules.filter((rule) => rule.enabled))
}

/** The page engine's shape of a rule it runs: one whose coverage is `page-requests`. */
export function toPageMock(rule: NetworkRule): RequestMock {
  return {
    id: rule.id,
    match: rule.match,
    method: rule.method,
    action: rule.action as RequestMock["action"],
    status: rule.status,
    body: rule.body,
    headers: Object.entries(rule.headers)
      .map(([name, value]) => `${name}: ${value}`)
      .join("\n"),
    target: rule.redirectTo,
    delayMs: rule.delayMs,
    times: rule.times,
    chance: rule.chance,
    enabled: rule.enabled,
  }
}

/** The rules the page itself must run, in the page engine's shape. */
export function pageMocks(rules: readonly NetworkRule[]): RequestMock[] {
  return rules
    .filter((rule) => rule.enabled && coverageOf(rule) === "page-requests")
    .map(toPageMock)
}

/** `Name: value` a line, as people paste them from DevTools. */
export function headerLines(text: string): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const line of text.split("\n")) {
    const at = line.indexOf(":")
    if (at <= 0) continue
    headers[line.slice(0, at).trim()] = line.slice(at + 1).trim()
  }
  return headers
}

/**
 * The tab's simulated requests (`request-mocks.ts`) as saved rules, for
 * keeping them for the site. A redirect to a path resolves against the page
 * it was made on; one that only replaces part of the address cannot be kept,
 * and is counted as skipped rather than saved as something else.
 */
export function rulesFromMocks(
  mocks: readonly RequestMock[],
  pageUrl: string
): { rules: NetworkRule[]; skipped: number } {
  const rules: NetworkRule[] = []
  let skipped = 0
  for (const mock of mocks) {
    let redirectTo = ""
    if (mock.action === "redirect") {
      try {
        redirectTo = /^(?:https?:)?\/\/|^\//.test(mock.target)
          ? new URL(mock.target, pageUrl).href
          : ""
      } catch {
        redirectTo = ""
      }
    }
    const rule = cleanRule(
      {
        match: mock.match,
        method: mock.method,
        action: mock.action,
        status: mock.status,
        body: mock.body,
        headers: headerLines(mock.headers),
        redirectTo,
        delayMs: mock.delayMs,
        times: mock.times,
        chance: mock.chance,
        enabled: mock.enabled,
      },
      mock.id
    )
    if (rule) rules.push(rule)
    else skipped += 1
  }
  return { rules, skipped }
}

/** A file the person can keep, share, and import again. */
export function exportLibrary(library: RuleLibrary, now: number): string {
  return `${JSON.stringify(
    {
      format: EXPORT_FORMAT,
      v: 1,
      exportedAt: new Date(now).toISOString(),
      groups: library.groups,
    },
    null,
    2
  )}\n`
}

export type ImportOutcome =
  { ok: true; groups: RuleGroup[]; skipped: number } | { ok: false; reason: "invalid" | "empty" }

/** Groups read from an exported file, with fresh ids so they never replace existing ones. */
export function importLibrary(text: string, newId: () => string): ImportOutcome {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { ok: false, reason: "invalid" }
  }
  const record = value as Record<string, unknown> | null
  if (!record || record.format !== EXPORT_FORMAT || !Array.isArray(record.groups))
    return { ok: false, reason: "invalid" }
  const groups: RuleGroup[] = []
  let skipped = 0
  for (const entry of record.groups) {
    const raw = entry as Record<string, unknown> | null
    const rules = Array.isArray(raw?.rules) ? raw.rules : []
    const group = cleanGroup(
      { ...raw, id: newId(), rules: rules.map((rule) => ({ ...(rule as object), id: newId() })) },
      newId()
    )
    if (!group) {
      skipped += 1
      continue
    }
    skipped += rules.length - group.rules.length
    groups.push(group)
  }
  return groups.length > 0 ? { ok: true, groups, skipped } : { ok: false, reason: "empty" }
}

/** One line for a rule, as the panel and the agent read it. */
export function ruleSummary(rule: NetworkRule): string {
  const target = `${rule.method || "Any method"} \`${rule.match}\``
  const after = rule.delayMs > 0 ? ` after ${rule.delayMs} ms` : ""
  const limits = [
    rule.times > 0 ? `first ${rule.times} only` : "",
    rule.chance < 100 ? `${rule.chance}% of the time` : "",
    rule.enabled ? "" : "paused",
  ]
    .filter(Boolean)
    .join(", ")
  const tail = limits ? ` (${limits})` : ""
  const headerList = (names: string[]) => names.map((name) => `\`${name}\``).join(", ")
  switch (rule.action) {
    case "fail":
      return `${target} → network error${after}${tail}`
    case "respond":
      return `${target} → ${rule.status}${rule.body ? " with a body" : ""}${after}${tail}`
    case "modify":
      return `${target} → the server's answer${rule.status ? ` as ${rule.status}` : ""}${rule.body ? " with the body changed" : ""}${Object.keys(rule.headers).length ? " with headers added" : ""}${after}${tail}`
    case "delay":
      return `${target} → held back ${rule.delayMs} ms, then sent${tail}`
    case "redirect":
      return `${target} → sent to \`${rule.redirectTo}\`${after}${tail}`
    case "request_headers":
    case "response_headers": {
      const which = rule.action === "request_headers" ? "request" : "response"
      const set = Object.keys(rule.headers)
      const parts = [
        set.length ? `sets ${which} ${headerList(set)}` : "",
        rule.removeHeaders.length ? `removes ${which} ${headerList(rule.removeHeaders)}` : "",
      ].filter(Boolean)
      return `${target} → ${parts.join(", ")}${tail}`
    }
  }
}
