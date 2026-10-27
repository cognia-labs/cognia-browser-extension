import type { DnrRule } from "./dnr"
import { cleanRule, parseLibrary, type AgentRuleSets } from "./rules"
import { syncNetworkRules, type RuleSyncBrowser } from "./sync"

function browser(
  options: { dnr?: boolean; origins?: (pattern: string) => boolean; existing?: number[] } = {}
) {
  const calls = {
    updates: [] as { remove: number[]; add: DnrRule[] }[],
    scripts: [] as string[][],
  }
  const api: RuleSyncBrowser = {
    hasDnr: async () => options.dnr ?? true,
    sessionRuleIds: async () => options.existing ?? [],
    updateSessionRules: async (remove, add) => {
      calls.updates.push({ remove, add })
    },
    isRegexSupported: async (regex) => !regex.includes("(?<"),
    hasOrigin: async (pattern) => options.origins?.(pattern) ?? true,
    setPageScripts: async (matches) => {
      calls.scripts.push(matches)
    },
  }
  return { api, calls }
}

const library = parseLibrary({
  groups: [
    {
      id: "shop",
      sites: ["shop.test"],
      rules: [
        { id: "env", match: "/api/", action: "request_headers", headers: { "X-Env": "staging" } },
        { id: "answer", match: "/api/orders", action: "respond", status: 503 },
        { id: "paused", match: "/x", action: "fail", enabled: false },
      ],
    },
    {
      id: "off",
      sites: ["off.test"],
      enabled: false,
      rules: [{ id: "never", match: "/y", action: "fail" }],
    },
  ],
})

describe("syncNetworkRules", () => {
  it("replaces the session rules and registers page scripts for page rules", async () => {
    const { api, calls } = browser({ existing: [11, 12] })
    const agent: AgentRuleSets = {
      s1: [cleanRule({ match: "/slow", action: "fail" }, "s1:a")!],
    }
    const status = await syncNetworkRules(api, library, agent, { s1: [5] })
    expect(status).toEqual({ needsDnr: false, missingOrigins: [], unsupported: [] })
    expect(calls.updates).toHaveLength(1)
    const [update] = calls.updates
    expect(update!.remove).toEqual([11, 12])
    // The agent's rule, then the person's header rewrite as two (pages and documents).
    expect(update!.add.map((rule) => rule.id)).toEqual([1, 2, 3])
    expect(update!.add[0]).toMatchObject({ priority: 4_000, condition: { tabIds: [5] } })
    expect(update!.add[1]!.priority).toBeLessThan(update!.add[0]!.priority)
    expect(calls.scripts).toEqual([
      [
        "http://shop.test/*",
        "https://shop.test/*",
        "http://*.shop.test/*",
        "https://*.shop.test/*",
      ],
    ])
  })

  it("says what is missing instead of failing", async () => {
    const { api, calls } = browser({ dnr: false, origins: () => false })
    const status = await syncNetworkRules(api, library, {}, {})
    expect(status).toEqual({
      needsDnr: true,
      missingOrigins: ["*://shop.test/*", "*://*.shop.test/*"],
      unsupported: [],
    })
    expect(calls.updates).toEqual([])
    expect(calls.scripts).toEqual([[]])
  })

  it("counts a site reachable on either scheme, and runs the gate only where granted", async () => {
    const { api, calls } = browser({ origins: (pattern) => pattern === "http://shop.test/*" })
    const status = await syncNetworkRules(api, library, {}, {})
    expect(status.missingOrigins).toEqual([])
    expect(calls.scripts).toEqual([["http://shop.test/*"]])
  })

  it("skips a rule whose expression the browser cannot run", async () => {
    const { api, calls } = browser()
    const odd = parseLibrary({
      groups: [
        {
          id: "g",
          sites: ["*"],
          rules: [{ id: "look", match: "/(?<id>\\d+)/", action: "fail" }],
        },
      ],
    })
    const status = await syncNetworkRules(api, odd, {}, {})
    expect(status.unsupported).toEqual(["look"])
    expect(calls.updates).toEqual([])
    expect(calls.scripts).toEqual([[]])
  })

  it("clears what an earlier sync left when nothing is left to apply", async () => {
    const { api, calls } = browser({ existing: [1] })
    await syncNetworkRules(api, parseLibrary(null), {}, {})
    expect(calls.updates).toEqual([{ remove: [1], add: [] }])
    expect(calls.scripts).toEqual([[]])
  })
})
