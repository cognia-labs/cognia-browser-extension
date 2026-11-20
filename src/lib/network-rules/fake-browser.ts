/**
 * {@link NetworkRulesBrowser} without Chrome, for the tests of everything
 * that builds the request rules: records what a real browser would be told.
 */
import type { MockHits, RequestMock } from "../inspect/request-mocks"
import type { NetworkRulesBrowser } from "./controller"
import type { DnrRule } from "./dnr"

export function fakeNetworkRulesBrowser(
  options: { dnr?: boolean; origins?: (pattern: string) => boolean } = {}
) {
  const state = {
    session: [] as DnrRule[],
    scripts: [] as string[],
    pages: new Map<number, RequestMock[]>(),
    hits: new Map<number, MockHits>(),
    urls: new Map<number, string>(),
  }
  const browser: NetworkRulesBrowser = {
    hasDnr: async () => options.dnr ?? true,
    sessionRuleIds: async () => state.session.map((rule) => rule.id),
    updateSessionRules: async (remove, add) => {
      state.session = [...state.session.filter((rule) => !remove.includes(rule.id)), ...add]
    },
    isRegexSupported: async () => true,
    hasOrigin: async (pattern) => options.origins?.(pattern) ?? true,
    tabUrl: async (tabId) => state.urls.get(tabId) ?? null,
    setPageScripts: async (matches) => {
      state.scripts = matches
    },
    runPageRules: async (tabId, rules) => {
      if (rules !== null) state.pages.set(tabId, rules)
      return state.hits.get(tabId) ?? { installed: true, kept: false, hits: {}, log: [] }
    },
  }
  return { browser, state }
}
