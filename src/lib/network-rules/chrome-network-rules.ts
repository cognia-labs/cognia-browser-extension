/**
 * `chrome.*` behind {@link NetworkRulesBrowser}. Everything that decides
 * lives in the modules beside this one, under Jest; this file only adapts.
 */
import { mainRequestMocks, type RequestMock } from "../inspect/request-mocks"
import type { NetworkRulesBrowser } from "./controller"
import type { DnrRule } from "./dnr"
import { RULES_SLOT } from "./page"

export const DNR_PERMISSION = "declarativeNetRequestWithHostAccess"
export const RULE_GATE_FILE = "/network-rules-gate.js"
export const RULE_LOADER_FILE = "/network-rules-loader.js"
const GATE_ID = "cognia-network-rules-gate"
const LOADER_ID = "cognia-network-rules-loader"

export function createChromeNetworkRulesBrowser(): NetworkRulesBrowser {
  const hasDnr = () =>
    chrome.permissions.contains({
      permissions: [DNR_PERMISSION as chrome.runtime.ManifestPermission],
    })
  return {
    hasDnr,
    async sessionRuleIds() {
      return (await chrome.declarativeNetRequest.getSessionRules()).map((rule) => rule.id)
    },
    async updateSessionRules(removeRuleIds: number[], addRules: DnrRule[]) {
      await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds,
        addRules: addRules as unknown as chrome.declarativeNetRequest.Rule[],
      })
    },
    async isRegexSupported(regex, isCaseSensitive) {
      if (!(await hasDnr())) return true
      const result = await chrome.declarativeNetRequest.isRegexSupported({ regex, isCaseSensitive })
      return result.isSupported
    },
    hasOrigin: (pattern) => chrome.permissions.contains({ origins: [pattern] }),
    async setPageScripts(matches) {
      const registered = await chrome.scripting.getRegisteredContentScripts({
        ids: [GATE_ID, LOADER_ID],
      })
      if (registered.length > 0)
        await chrome.scripting.unregisterContentScripts({
          ids: registered.map((script) => script.id),
        })
      if (matches.length === 0) return
      const common = {
        matches,
        runAt: "document_start" as const,
        allFrames: false,
        persistAcrossSessions: true,
      }
      await chrome.scripting.registerContentScripts([
        { ...common, id: GATE_ID, js: [RULE_GATE_FILE.slice(1)], world: "MAIN" },
        { ...common, id: LOADER_ID, js: [RULE_LOADER_FILE.slice(1)], world: "ISOLATED" },
      ])
    },
    async runPageRules(tabId, rules: RequestMock[] | null) {
      const [injected] = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: mainRequestMocks,
        args: [rules, false, RULES_SLOT],
      })
      return (injected?.result as ReturnType<typeof mainRequestMocks> | undefined) ?? null
    },
  }
}
