import { newSession, type AgentSessions } from "../agent/sessions"
import { memoryStorageArea } from "../agent/storage-area"

import { createNetworkRules } from "./controller"
import { fakeNetworkRulesBrowser } from "./fake-browser"
import { RULE_SYNC_STATUS_KEY } from "./sync"

function harness(options: Parameters<typeof fakeNetworkRulesBrowser>[0] = {}) {
  const local = memoryStorageArea()
  const session = memoryStorageArea()
  const fake = fakeNetworkRulesBrowser(options)
  let sessions: AgentSessions = {}
  let next = 0
  const rules = createNetworkRules({
    local,
    session,
    newId: () => `id-${++next}`,
    browser: fake.browser,
    sessions: async () => sessions,
  })
  const hold = (id: string, tabIds: number[]) => {
    sessions = {
      ...sessions,
      [id]: { ...newSession(id, 0), tabIds, activeTabId: tabIds[0] ?? null },
    }
    return sessions
  }
  return {
    rules,
    fake,
    session,
    hold,
    end: (id: string) => {
      const { [id]: _gone, ...rest } = sessions
      sessions = rest
    },
  }
}

const tab = (id: number, url = "https://shop.test/") => ({ id, url })

describe("the person's rules", () => {
  it("apply after each change and report what they still need", async () => {
    const { rules, fake, session } = harness({
      dnr: false,
      origins: (pattern) => pattern === "http://shop.test/*",
    })
    await rules.command({ op: "add-group", name: "Shop", sites: ["shop.test"] })
    await rules.command({
      op: "add-rule",
      groupId: "id-1",
      rule: { match: "/api/orders", action: "respond", status: 503 },
    })
    await rules.command({
      op: "add-rule",
      groupId: "id-1",
      rule: { match: "/api/", action: "request_headers", headers: { "X-Env": "staging" } },
    })
    expect(fake.state.scripts).toEqual(["http://shop.test/*"])
    expect(await session.get(RULE_SYNC_STATUS_KEY)).toEqual({
      needsDnr: true,
      missingOrigins: [],
      unsupported: [],
    })
    expect(await rules.pageRulesFor(9, "https://www.shop.test/cart")).toEqual([
      expect.objectContaining({ match: "/api/orders", action: "respond", status: 503 }),
    ])
    expect(await rules.pageRulesFor(9, "https://other.test/")).toEqual([])
    expect(await rules.pageRulesFor(9, "chrome://settings")).toEqual([])
  })
})

describe("a conversation's rules", () => {
  it("reach only its tabs, first, and go into the pages it has open", async () => {
    const { rules, fake, hold } = harness()
    await rules.command({ op: "add-group", name: "", sites: ["shop.test"] })
    await rules.command({
      op: "add-rule",
      groupId: "id-1",
      rule: { match: "/api/orders", action: "respond", status: 200 },
    })
    hold("s1", [5])
    fake.state.urls.set(5, "https://shop.test/cart")
    const set = await rules.setAgentRules(
      "s1",
      [
        { match: "/api/orders", action: "respond", status: 503 },
        { match: "/track", action: "fail" },
      ],
      [tab(5)]
    )
    expect(set).toMatchObject({
      ok: true,
      rules: [
        { match: "/api/orders", coverage: "page-requests", hits: 0 },
        { match: "/track", coverage: "all-requests", hits: 0 },
      ],
    })
    expect(fake.state.session).toEqual([
      expect.objectContaining({
        action: { type: "block" },
        condition: expect.objectContaining({ tabIds: [5] }),
      }),
    ])
    // Only where its tab is: no other page waits for the gate.
    expect(fake.state.scripts).toContain("https://shop.test/*")
    expect(fake.state.scripts).not.toContain("https://*/*")
    expect(fake.state.pages.get(5)!.map((rule) => rule.status)).toEqual([503, 200])
    expect(await rules.pageRulesFor(6, "https://shop.test/")).toEqual([
      expect.objectContaining({ status: 200 }),
    ])
  })

  it("count the page's matches and leave the browser's uncounted", async () => {
    const { rules, fake, hold } = harness()
    hold("s1", [5, 6])
    const set = await rules.setAgentRules(
      "s1",
      [
        { match: "/a", action: "respond", status: 503 },
        { match: "/b", action: "fail" },
      ],
      []
    )
    const pageId = (set as { rules: { id: string }[] }).rules[0]!.id
    for (const id of [5, 6])
      fake.state.hits.set(id, {
        installed: true,
        kept: false,
        hits: { [pageId]: { count: id - 3, lastUrl: null } },
        log: [],
      })
    expect((await rules.listAgent("s1", [5, 6])).map((rule) => rule.hits)).toEqual([5, null])
  })

  it("follow the conversation's tabs and end with it", async () => {
    const { rules, fake, hold, end } = harness()
    hold("s1", [5])
    await rules.setAgentRules("s1", [{ match: "/b", action: "fail" }], [tab(5)])
    await rules.sessionsChanged(hold("s1", [5, 7]))
    expect(fake.state.session[0]!.condition.tabIds).toEqual([5, 7])
    const before = fake.state.session
    await rules.sessionsChanged(hold("s1", [5, 7]))
    expect(fake.state.session).toBe(before)
    await rules.clearAgent("s1", [tab(5), tab(7)])
    expect(fake.state.session).toEqual([])
    expect(fake.state.pages.get(5)).toEqual([])
    await rules.setAgentRules("s1", [{ match: "/b", action: "fail" }], [])
    end("s1")
    await rules.sync()
    expect(await rules.agentSets()).toEqual({})
    expect(fake.state.session).toEqual([])
  })

  it("take a rule removed in the panel out of the pages already open", async () => {
    const { rules, fake, hold } = harness()
    hold("s1", [5])
    fake.state.urls.set(5, "https://shop.test/cart")
    const set = await rules.setAgentRules(
      "s1",
      [{ match: "/api/orders", action: "respond", status: 503 }],
      [tab(5)]
    )
    expect(fake.state.pages.get(5)!.map((rule) => rule.status)).toEqual([503])
    const ruleId = (set as { rules: { id: string }[] }).rules[0]!.id
    expect(await rules.command({ op: "remove-agent-rule", sessionId: "s1", ruleId })).toEqual({
      ok: true,
    })
    // The last one gone: the open page answers for real again, without a reload.
    expect(fake.state.pages.get(5)).toEqual([])
    expect(await rules.agentSets()).toEqual({})
    // And a stop or take-over afterwards has nothing left to undo.
    await rules.clearAgent("s1", [tab(5)])
    expect(fake.state.pages.get(5)).toEqual([])
  })

  it("move the gate where the agent goes, before it loads", async () => {
    const { rules, fake, hold } = harness()
    hold("s1", [5])
    fake.state.urls.set(5, "https://shop.test/")
    await rules.setAgentRules("s1", [{ match: "/a", action: "respond", status: 503 }], [tab(5)])
    await rules.beforeNavigate("s1", "https://pay.test/checkout")
    expect(fake.state.scripts).toContain("https://pay.test/*")
    // Not for a conversation without page rules.
    hold("s2", [9])
    await rules.beforeNavigate("s2", "https://other.test/")
    expect(fake.state.scripts).not.toContain("https://other.test/*")
  })

  it("follow a tab that reached a new site by itself, and fill its page", async () => {
    const { rules, fake, hold } = harness()
    hold("s1", [5])
    fake.state.urls.set(5, "https://shop.test/")
    await rules.setAgentRules("s1", [{ match: "/a", action: "respond", status: 503 }], [])
    fake.state.urls.set(5, "https://elsewhere.test/")
    await rules.tabUpdated(5, "https://elsewhere.test/", false)
    expect(fake.state.scripts).toContain("https://elsewhere.test/*")
    expect(fake.state.pages.has(5)).toBe(false)
    await rules.tabUpdated(5, "https://elsewhere.test/", true)
    expect(fake.state.pages.get(5)).toEqual([expect.objectContaining({ status: 503 })])
    // A tab no conversation holds is left alone.
    await rules.tabUpdated(8, "https://elsewhere.test/", true)
    expect(fake.state.pages.has(8)).toBe(false)
  })

  it("refuses a set with any rule it cannot apply", async () => {
    const { rules, hold } = harness()
    hold("s1", [5])
    expect(
      await rules.setAgentRules("s1", [{ match: "/ok", action: "fail" }, { match: "" }], [])
    ).toEqual({ ok: false, index: 1 })
  })
})
