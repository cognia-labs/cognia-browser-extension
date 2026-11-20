/**
 * The request rules, assembled for the worker: the store, the browser sync,
 * the answer a page's loader asks for, and what an agent conversation may do
 * with its own rules (`network-rules-v1`).
 *
 * Every change ends in a sync, and syncs run one at a time from storage, so
 * the browser always ends up matching the last change rather than whichever
 * sync finished last.
 */
import type { MockHits, RequestMock } from "../inspect/request-mocks"
import type { AgentSessions } from "../agent/sessions"
import type { StorageArea } from "../agent/storage-area"
import { RULES_SLOT } from "./page"
import { coverageOf, pageMocks, rulesForHost, type NetworkRule, type RuleCoverage } from "./rules"
import { NetworkRuleStore, type RuleCommand, type RuleCommandResult } from "./store"
import { RULE_SYNC_STATUS_KEY, syncNetworkRules, type RuleSyncBrowser } from "./sync"

export interface NetworkRulesBrowser extends RuleSyncBrowser {
  /** A tab's address, or null when it is gone. */
  tabUrl(tabId: number): Promise<string | null>
  /** Run the request engine's rule slot in a tab's page; `null` reads its hits. */
  runPageRules(tabId: number, rules: RequestMock[] | null): Promise<MockHits | null>
}

export interface NetworkRulesDeps {
  local: StorageArea
  session: StorageArea
  newId: () => string
  browser: NetworkRulesBrowser
  sessions: () => Promise<AgentSessions>
}

/** A rule as an agent reads it back (ADR-0242). */
export interface AgentRuleState {
  id: string
  match: string
  method?: string
  action: NetworkRule["action"]
  status?: number
  body?: string
  headers?: Record<string, string>
  removeHeaders?: string[]
  delayMs?: number
  redirectTo?: string
  times?: number
  coverage: RuleCoverage
  /** Matches counted in the page; `null` for a rule the browser applies, which it does not count. */
  hits: number | null
}

function hostOf(url: string | undefined): string | null {
  try {
    const parsed = new URL(url ?? "")
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.hostname : null
  } catch {
    return null
  }
}

function agentView(rule: NetworkRule, hits: number | null): AgentRuleState {
  return {
    id: rule.id,
    match: rule.match,
    ...(rule.method ? { method: rule.method } : {}),
    action: rule.action,
    ...(rule.status ? { status: rule.status } : {}),
    ...(rule.body ? { body: rule.body } : {}),
    ...(Object.keys(rule.headers).length ? { headers: rule.headers } : {}),
    ...(rule.removeHeaders.length ? { removeHeaders: rule.removeHeaders } : {}),
    ...(rule.delayMs ? { delayMs: rule.delayMs } : {}),
    ...(rule.redirectTo ? { redirectTo: rule.redirectTo } : {}),
    ...(rule.times ? { times: rule.times } : {}),
    coverage: coverageOf(rule),
    hits,
  }
}

export function createNetworkRules(deps: NetworkRulesDeps) {
  const store = new NetworkRuleStore(deps.local, deps.session, deps.newId)
  let syncing: Promise<unknown> = Promise.resolve()
  /** The tabs the last sync scoped each conversation's rules to. */
  let scoped = ""
  const scopeOf = (sessions: AgentSessions, sets: Record<string, unknown>) =>
    JSON.stringify(
      Object.keys(sets)
        .sort()
        .map((id) => [id, sessions[id]?.tabIds ?? []])
    )

  /** Hosts an agent is about to load, added to the gate before the load starts. */
  const upcoming = new Set<string>()
  /** Hosts the last sync registered the gate for, for a conversation's page rules. */
  let gated = new Set<string>()

  async function ownerOf(tabId: number) {
    const sessions = await deps.sessions()
    return Object.values(sessions).find((session) => session.tabIds.includes(tabId)) ?? null
  }

  async function hasPageRules(sessionId: string) {
    return ((await store.agentSets())[sessionId] ?? []).some(
      (rule) => rule.enabled && coverageOf(rule) === "page-requests"
    )
  }

  function sync(): Promise<void> {
    const run = syncing.then(async () => {
      const sessions = await deps.sessions()
      await store.pruneAgents(new Set(Object.keys(sessions)))
      const tabsBySession = Object.fromEntries(
        Object.values(sessions).map((session) => [session.id, session.tabIds])
      )
      const sets = await store.agentSets()
      scoped = scopeOf(sessions, sets)
      const agentHosts = new Set<string>(upcoming)
      upcoming.clear()
      for (const id of Object.keys(sets)) {
        for (const tabId of sessions[id]?.tabIds ?? []) {
          const host = hostOf((await deps.browser.tabUrl(tabId).catch(() => null)) ?? undefined)
          if (host) agentHosts.add(host)
        }
      }
      const status = await syncNetworkRules(
        deps.browser,
        await store.library(),
        sets,
        tabsBySession,
        [...agentHosts]
      )
      gated = agentHosts
      await deps.session.set(RULE_SYNC_STATUS_KEY, status)
    })
    syncing = run.catch(() => undefined)
    return run
  }

  /** The page rules for one tab: its conversation's first, then the person's for its site. */
  async function pageRulesFor(tabId: number, url: string | undefined): Promise<RequestMock[]> {
    const host = hostOf(url)
    if (!host) return []
    const sessions = await deps.sessions()
    const owner = Object.values(sessions).find((session) => session.tabIds.includes(tabId))
    const agent = owner ? ((await store.agentSets())[owner.id] ?? []) : []
    return pageMocks([...agent, ...rulesForHost(await store.library(), host)])
  }

  /** Put a conversation's page rules into the pages it already has open. */
  async function repaint(tabs: readonly { id: number; url?: string }[]): Promise<void> {
    for (const tab of tabs) {
      await deps.browser
        .runPageRules(tab.id, await pageRulesFor(tab.id, tab.url))
        .catch(() => undefined)
    }
  }

  /** The pages a conversation has open now, as the browser reports them. */
  async function openTabs(sessionId: string): Promise<{ id: number; url: string }[]> {
    const session = (await deps.sessions())[sessionId]
    const tabs: { id: number; url: string }[] = []
    for (const id of session?.tabIds ?? []) {
      const url = await deps.browser.tabUrl(id).catch(() => null)
      if (url) tabs.push({ id, url })
    }
    return tabs
  }

  return {
    sync,
    pageRulesFor,

    /**
     * An agent is about to load `url`: the gate goes there first, so the
     * page's first requests meet the conversation's rules.
     */
    async beforeNavigate(sessionId: string, url: string): Promise<void> {
      const host = hostOf(url)
      if (!host || gated.has(host) || !(await hasPageRules(sessionId))) return
      upcoming.add(host)
      await sync()
    },

    /**
     * A tab changed address or finished loading. A conversation's tab that
     * reached a site some other way — a link, a redirect — gets the gate for
     * the next load there, and the rules in this page once it has loaded.
     */
    async tabUpdated(tabId: number, url: string | undefined, complete: boolean): Promise<void> {
      const owner = await ownerOf(tabId)
      if (!owner || !(await hasPageRules(owner.id))) return
      const host = hostOf(url)
      if (host && !gated.has(host)) await sync().catch(() => undefined)
      if (complete)
        await deps.browser
          .runPageRules(tabId, await pageRulesFor(tabId, url))
          .catch(() => undefined)
    },

    /**
     * The conversations changed. Their rules follow their tabs, so a tab
     * gained or lost means a sync; anything else they record does not.
     */
    async sessionsChanged(sessions: AgentSessions): Promise<void> {
      const sets = await store.agentSets()
      if (scopeOf(sessions, sets) !== scoped) await sync().catch(() => undefined)
    },

    async command(command: RuleCommand): Promise<RuleCommandResult> {
      const result = await store.apply(command)
      if (!result.ok) return result
      await sync().catch(() => undefined)
      // The browser's rules follow the sync; a page's simulated responses run
      // in the page, which loaded the old set. Removing a conversation's rule
      // in the panel takes it out of the pages it has open now, as setting and
      // clearing the set do — not at their next reload.
      if (command.op === "remove-agent-rule") await repaint(await openTabs(command.sessionId))
      return result
    },

    async setAgentRules(
      sessionId: string,
      rules: unknown,
      tabs: readonly { id: number; url?: string }[]
    ) {
      const result = await store.setAgentRules(sessionId, rules)
      if (!result.ok) return result
      await sync()
      await repaint(tabs)
      return { ok: true as const, rules: result.rules.map((rule) => agentView(rule, 0)) }
    },

    async clearAgent(sessionId: string, tabs: readonly { id: number; url?: string }[]) {
      const had = ((await store.agentSets())[sessionId] ?? []).length > 0
      await store.clearAgent(sessionId)
      if (!had) return
      await sync().catch(() => undefined)
      await repaint(tabs)
    },

    /** A conversation's rules, with the page's counts summed over its tabs. */
    async listAgent(sessionId: string, tabIds: readonly number[]): Promise<AgentRuleState[]> {
      const rules = (await store.agentSets())[sessionId] ?? []
      const counts = new Map<string, number>()
      if (rules.some((rule) => coverageOf(rule) === "page-requests")) {
        for (const tabId of tabIds) {
          const hits = await deps.browser.runPageRules(tabId, null).catch(() => null)
          for (const [id, hit] of Object.entries(hits?.hits ?? {}))
            counts.set(id, (counts.get(id) ?? 0) + hit.count)
        }
      }
      return rules.map((rule) =>
        agentView(rule, coverageOf(rule) === "page-requests" ? (counts.get(rule.id) ?? 0) : null)
      )
    },

    library: () => store.library(),
    agentSets: () => store.agentSets(),
  }
}

export type NetworkRules = ReturnType<typeof createNetworkRules>

export { RULES_SLOT }
