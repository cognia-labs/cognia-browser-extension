import { memoryStorageArea } from "../agent/storage-area"

import { AGENT_NETWORK_RULES_KEY, MAX_GROUPS, NETWORK_RULES_KEY } from "./rules"
import { NetworkRuleStore, isRuleCommandMessage } from "./store"

function harness() {
  const local = memoryStorageArea()
  const session = memoryStorageArea()
  let next = 0
  const store = new NetworkRuleStore(local, session, () => `id-${++next}`)
  return { store, local, session }
}

describe("NetworkRuleStore", () => {
  it("builds the library one change at a time", async () => {
    const { store } = harness()
    expect(
      await store.apply({ op: "add-group", name: "", sites: ["https://Shop.test/x"] })
    ).toEqual({
      ok: true,
    })
    const [group] = (await store.library()).groups
    expect(group).toMatchObject({ id: "id-1", name: "shop.test", sites: ["shop.test"], rules: [] })
    await store.apply({ op: "add-rule", groupId: "id-1", rule: { match: "/a", action: "fail" } })
    await store.apply({
      op: "add-rule",
      groupId: "id-1",
      rule: { match: "/b", action: "respond", status: 404 },
    })
    await store.apply({ op: "move-rule", groupId: "id-1", ruleId: "id-3", by: -1 })
    await store.apply({ op: "toggle-rule", groupId: "id-1", ruleId: "id-2", enabled: false })
    const rules = (await store.library()).groups[0]!.rules
    expect(rules.map((rule) => [rule.id, rule.enabled])).toEqual([
      ["id-3", true],
      ["id-2", false],
    ])
    await store.apply({
      op: "update-rule",
      groupId: "id-1",
      ruleId: "id-3",
      rule: { match: "/b", action: "respond", status: 500 },
    })
    expect((await store.library()).groups[0]!.rules[0]!.status).toBe(500)
    await store.apply({ op: "remove-rule", groupId: "id-1", ruleId: "id-2" })
    await store.apply({ op: "update-group", groupId: "id-1", enabled: false, name: "Shop" })
    expect((await store.library()).groups[0]).toMatchObject({ name: "Shop", enabled: false })
    await store.apply({ op: "remove-group", groupId: "id-1" })
    expect((await store.library()).groups).toEqual([])
  })

  it("answers why it refused a change and leaves the library as it was", async () => {
    const { store, local } = harness()
    expect(await store.apply({ op: "add-group", name: "x", sites: ["not a host"] })).toEqual({
      ok: false,
      error: "invalid_sites",
    })
    await store.apply({ op: "add-group", name: "x", sites: ["a.test"] })
    expect(
      await store.apply({ op: "add-rule", groupId: "id-1", rule: { match: "", action: "fail" } })
    ).toEqual({ ok: false, error: "invalid_rule" })
    expect(await store.apply({ op: "remove-rule", groupId: "id-1", ruleId: "nope" })).toEqual({
      ok: false,
      error: "unknown_rule",
    })
    expect(await store.apply({ op: "remove-group", groupId: "nope" })).toEqual({
      ok: false,
      error: "unknown_group",
    })
    for (let index = 1; index < MAX_GROUPS; index += 1)
      await store.apply({ op: "add-group", name: "", sites: ["a.test"] })
    expect(await store.apply({ op: "add-group", name: "", sites: ["a.test"] })).toEqual({
      ok: false,
      error: "too_many_groups",
    })
    expect(((await local.get(NETWORK_RULES_KEY)) as { groups: unknown[] }).groups).toHaveLength(
      MAX_GROUPS
    )
  })

  it("adds a group with its rules at once, and counts the ones it could not keep", async () => {
    const { store } = harness()
    expect(
      await store.apply({
        op: "add-group",
        name: "",
        sites: ["shop.test"],
        rules: [
          { match: "/a", action: "fail" },
          { match: "", action: "fail" },
        ],
      })
    ).toEqual({ ok: true, skipped: 1 })
    expect((await store.library()).groups[0]!.rules).toEqual([
      expect.objectContaining({ match: "/a" }),
    ])
  })

  it("serializes changes that land together", async () => {
    const { store } = harness()
    await Promise.all([
      store.apply({ op: "add-group", name: "one", sites: ["a.test"] }),
      store.apply({ op: "add-group", name: "two", sites: ["b.test"] }),
    ])
    expect((await store.library()).groups.map((group) => group.name)).toEqual(["one", "two"])
  })

  it("imports groups under fresh ids beside the existing ones", async () => {
    const { store } = harness()
    await store.apply({ op: "add-group", name: "mine", sites: ["a.test"] })
    await store.apply({
      op: "import",
      groups: [
        {
          id: "id-1",
          name: "theirs",
          sites: ["b.test"],
          enabled: true,
          rules: [
            {
              ...((await store.library()).groups[0]!.rules[0] ?? {}),
              id: "x",
              match: "/x",
              action: "fail",
            } as never,
          ],
        },
      ],
    })
    const groups = (await store.library()).groups
    expect(groups.map((group) => group.name)).toEqual(["mine", "theirs"])
    expect(new Set(groups.map((group) => group.id)).size).toBe(2)
  })

  it("keeps a conversation's rules apart, all-or-nothing", async () => {
    const { store, session } = harness()
    expect(
      await store.setAgentRules("s1", [
        { match: "/a", action: "fail" },
        { match: "/b", action: "teleport" },
      ])
    ).toEqual({ ok: false, index: 1 })
    expect(await session.get(AGENT_NETWORK_RULES_KEY)).toBeNull()
    const set = await store.setAgentRules("s1", [{ match: "/a", action: "fail" }])
    expect(set).toMatchObject({ ok: true, rules: [{ match: "/a" }] })
    await store.setAgentRules("s2", [{ match: "/c", action: "fail" }])
    await store.apply({
      op: "remove-agent-rule",
      sessionId: "s1",
      ruleId: (set as { rules: { id: string }[] }).rules[0]!.id,
    })
    expect(Object.keys(await store.agentSets())).toEqual(["s2"])
    await store.pruneAgents(new Set())
    expect(await store.agentSets()).toEqual({})
  })
})

describe("isRuleCommandMessage", () => {
  it("accepts only known changes", () => {
    expect(
      isRuleCommandMessage({ kind: "cognia-network-rules", command: { op: "remove-group" } })
    ).toBe(true)
    expect(isRuleCommandMessage({ kind: "cognia-network-rules", command: { op: "wipe" } })).toBe(
      false
    )
    expect(isRuleCommandMessage({ kind: "other", command: { op: "import" } })).toBe(false)
  })
})
