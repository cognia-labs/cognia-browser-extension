/**
 * Make the browser match the stored rules: the `declarativeNetRequest`
 * session rules, and the page scripts registered for the sites whose rules
 * the page itself must run.
 *
 * Session rules are gone when the browser restarts, and a registration can
 * outlive the library it was made for, so the worker runs this on every
 * wake-up and after every change, from storage, replacing what is there.
 */
import { compileRule, sitePatterns, type DnrRule } from "./dnr"
import { coverageOf, type AgentRuleSets, type RuleLibrary } from "./rules"

/** The browser calls one sync needs; `chrome-network-rules.ts` binds them. */
export interface RuleSyncBrowser {
  /** `declarativeNetRequestWithHostAccess`, an optional grant. */
  hasDnr(): Promise<boolean>
  sessionRuleIds(): Promise<number[]>
  updateSessionRules(removeRuleIds: number[], addRules: DnrRule[]): Promise<void>
  isRegexSupported(regex: string, caseSensitive: boolean): Promise<boolean>
  /** Whether the extension may run scripts on pages matching `pattern`. */
  hasOrigin(pattern: string): Promise<boolean>
  /** Register the page scripts for exactly these patterns; none unregisters them. */
  setPageScripts(matches: string[]): Promise<void>
}

/** What the panel needs to say about the rules it cannot apply yet. */
export interface RuleSyncStatus {
  /** Some rule needs the browser to rewrite requests, and that is not granted. */
  needsDnr: boolean
  /** Site patterns of the person's rules the extension may not reach yet. */
  missingOrigins: string[]
  /** Rules whose expression the browser's engine cannot run. */
  unsupported: string[]
}

export const RULE_SYNC_STATUS_KEY = "cognia.networkRules.status.v1"

/** Agent rules above the person's: the conversation set them for its own test. */
const AGENT_PRIORITY = 4_000
const LIBRARY_PRIORITY = 2_000

export async function syncNetworkRules(
  browser: RuleSyncBrowser,
  library: RuleLibrary,
  agentSets: AgentRuleSets,
  tabsBySession: Readonly<Record<string, readonly number[]>>
): Promise<RuleSyncStatus> {
  let id = 0
  const nextId = () => ++id
  const status: RuleSyncStatus = { needsDnr: false, missingOrigins: [], unsupported: [] }
  const compiled: DnrRule[] = []
  const add = async (rules: DnrRule[], ruleId: string) => {
    for (const rule of rules) {
      const regex = rule.condition.regexFilter
      if (
        regex !== undefined &&
        !(await browser.isRegexSupported(regex, rule.condition.isUrlFilterCaseSensitive === true))
      ) {
        status.unsupported.push(ruleId)
        return
      }
    }
    compiled.push(...rules)
  }

  let order = 0
  const pageSites = new Set<string>()
  for (const [sessionId, rules] of Object.entries(agentSets)) {
    const tabIds = [...(tabsBySession[sessionId] ?? [])]
    for (const rule of rules) {
      // A conversation's tabs can open any site, and the gate is registered
      // by site: while it has page rules, every page asks the worker, and
      // only its tabs get an answer.
      if (rule.enabled && coverageOf(rule) === "page-requests") pageSites.add("*://*/*")
      await add(
        compileRule(rule, { tabIds }, nextId, Math.max(1, AGENT_PRIORITY - order++)),
        rule.id
      )
    }
  }
  order = 0
  // The browser applies a rule only on sites the extension may reach.
  const accessSites = new Set<string>()
  for (const group of library.groups) {
    if (!group.enabled) continue
    if (group.rules.some((rule) => rule.enabled))
      for (const pattern of sitePatterns(group.sites)) accessSites.add(pattern)
    for (const rule of group.rules) {
      if (!rule.enabled) continue
      if (coverageOf(rule) === "page-requests") {
        for (const pattern of sitePatterns(group.sites)) pageSites.add(pattern)
        continue
      }
      await add(
        compileRule(rule, { sites: group.sites }, nextId, Math.max(1, LIBRARY_PRIORITY - order++)),
        rule.id
      )
    }
  }

  const dnr = await browser.hasDnr()
  if (compiled.length > 0 && !dnr) status.needsDnr = true
  if (dnr) {
    const existing = await browser.sessionRuleIds()
    if (existing.length > 0 || compiled.length > 0)
      await browser.updateSessionRules(existing, compiled)
  }

  const granted: string[] = []
  for (const pattern of new Set([...accessSites, ...pageSites])) {
    const allowed = await browser.hasOrigin(pattern)
    if (!allowed && accessSites.has(pattern)) status.missingOrigins.push(pattern)
    if (allowed && pageSites.has(pattern)) granted.push(pattern)
  }
  await browser.setPageScripts(granted)
  return status
}
