import {
  EXPORT_FORMAT,
  MAX_RULES_PER_GROUP,
  cleanRule,
  cleanSite,
  coverageOf,
  exportLibrary,
  groupAppliesTo,
  importLibrary,
  pageMocks,
  parseAgentRuleSets,
  parseLibrary,
  ruleSummary,
  rulesForHost,
  rulesFromMocks,
  type RuleLibrary,
} from "./rules"

const header = (headers: Record<string, string>, removeHeaders: string[] = []) => ({
  match: "/api/*",
  action: "request_headers",
  headers,
  removeHeaders,
})

describe("cleanRule", () => {
  it("keeps what each action needs and drops the rest", () => {
    expect(
      cleanRule(
        { match: " /api/orders* ", action: "respond", status: 503, body: "{}", redirectTo: "x" },
        "r1"
      )
    ).toEqual({
      id: "r1",
      match: "/api/orders*",
      method: "",
      action: "respond",
      status: 503,
      body: "{}",
      headers: {},
      removeHeaders: [],
      redirectTo: "",
      delayMs: 0,
      times: 0,
      chance: 100,
      enabled: true,
    })
    expect(
      cleanRule(header({ Authorization: "Bearer t" }, ["Cookie", "bad name"]), "h")
    ).toMatchObject({
      headers: { Authorization: "Bearer t" },
      removeHeaders: ["Cookie"],
      body: "",
      status: 0,
    })
  })

  it("refuses a rule that would match nothing or do nothing", () => {
    expect(cleanRule({ match: "**", action: "fail" }, "a")).toBeNull()
    expect(cleanRule({ match: "/(/", action: "fail" }, "a")).toBeNull()
    expect(cleanRule({ match: "/a", action: "teleport" }, "a")).toBeNull()
    expect(cleanRule({ match: "/a", action: "respond", status: 42 }, "a")).toBeNull()
    expect(cleanRule({ match: "/a", action: "delay" }, "a")).toBeNull()
    expect(
      cleanRule({ match: "/a", action: "redirect", redirectTo: "javascript:x" }, "a")
    ).toBeNull()
    expect(cleanRule(header({}), "a")).toBeNull()
    expect(cleanRule({ match: "/a", action: "modify" }, "a")).toBeNull()
  })

  it("strips line breaks from header values", () => {
    expect(cleanRule(header({ "X-Test": "a\r\nInjected: b" }), "h")?.headers).toEqual({
      "X-Test": "a Injected: b",
    })
  })
})

describe("coverageOf", () => {
  it("puts header rewrites and plain failures in the browser, bodies and counts in the page", () => {
    const base = { times: 0, chance: 100, delayMs: 0 }
    expect(coverageOf({ ...base, action: "request_headers" })).toBe("all-requests")
    expect(coverageOf({ ...base, action: "fail" })).toBe("all-requests")
    expect(coverageOf({ ...base, action: "redirect" })).toBe("all-requests")
    expect(coverageOf({ ...base, action: "fail", times: 2 })).toBe("page-requests")
    expect(coverageOf({ ...base, action: "fail", delayMs: 100 })).toBe("page-requests")
    expect(coverageOf({ ...base, action: "respond" })).toBe("page-requests")
    expect(coverageOf({ ...base, action: "delay", delayMs: 10 })).toBe("page-requests")
  })
})

describe("sites and groups", () => {
  it("normalizes hosts and takes `*` for every site", () => {
    expect(cleanSite("https://Shop.Example.com/cart")).toBe("shop.example.com")
    expect(cleanSite("*.example.com")).toBe("example.com")
    expect(cleanSite("*")).toBe("*")
    expect(cleanSite("localhost")).toBe("localhost")
    expect(cleanSite("127.0.0.1")).toBe("127.0.0.1")
    expect(cleanSite("not a host")).toBeNull()
  })

  it("applies a group to its sites and their subdomains, not look-alikes", () => {
    expect(groupAppliesTo({ sites: ["example.com"] }, "api.example.com")).toBe(true)
    expect(groupAppliesTo({ sites: ["example.com"] }, "notexample.com")).toBe(false)
    expect(groupAppliesTo({ sites: ["*"] }, "anything.test")).toBe(true)
  })

  it("collects the enabled rules of the enabled groups for a host", () => {
    const library = parseLibrary({
      groups: [
        {
          id: "g1",
          sites: ["example.com"],
          rules: [
            { id: "a", match: "/a", action: "fail" },
            { id: "b", match: "/b", action: "fail", enabled: false },
          ],
        },
        {
          id: "g2",
          sites: ["example.com"],
          enabled: false,
          rules: [{ id: "c", match: "/c", action: "fail" }],
        },
        { id: "g3", sites: ["other.test"], rules: [{ id: "d", match: "/d", action: "fail" }] },
      ],
    })
    expect(rulesForHost(library, "www.example.com").map((rule) => rule.id)).toEqual(["a"])
  })
})

describe("parseLibrary", () => {
  it("falls back to empty, drops groups without sites and caps rules", () => {
    expect(parseLibrary(null)).toEqual({ v: 1, groups: [] })
    const rules = Array.from({ length: MAX_RULES_PER_GROUP + 5 }, (_, index) => ({
      id: `r${index}`,
      match: `/p${index}`,
      action: "fail",
    }))
    const library = parseLibrary({
      groups: [
        { id: "none", sites: [], rules },
        { id: "g", sites: ["example.com"], rules },
        { id: "g", sites: ["dup.test"], rules: [] },
      ],
    })
    expect(library.groups.map((group) => group.id)).toEqual(["g"])
    expect(library.groups[0]!.rules).toHaveLength(MAX_RULES_PER_GROUP)
    expect(library.groups[0]!.name).toBe("example.com")
  })

  it("keeps each conversation's rules apart", () => {
    expect(
      parseAgentRuleSets({
        s1: [
          { id: "x", match: "/x", action: "fail" },
          { match: "", action: "fail" },
        ],
        s2: "nope",
      })
    ).toEqual({ s1: [expect.objectContaining({ id: "x" })] })
  })
})

describe("pageMocks", () => {
  it("hands the page engine only what the page must run", () => {
    const rules = [
      cleanRule({ match: "/a", action: "fail" }, "browser")!,
      cleanRule({ match: "/b", action: "respond", status: 200, headers: { "X-A": "1" } }, "page")!,
    ]
    expect(pageMocks(rules)).toEqual([
      expect.objectContaining({ id: "page", action: "respond", headers: "X-A: 1", target: "" }),
    ])
  })
})

describe("export and import", () => {
  const library: RuleLibrary = parseLibrary({
    groups: [
      {
        id: "g",
        name: "Shop",
        sites: ["shop.test"],
        rules: [{ id: "r", match: "/a", action: "fail" }],
      },
    ],
  })

  it("round-trips through a file with fresh ids", () => {
    const text = exportLibrary(library, Date.UTC(2026, 9, 27))
    expect(JSON.parse(text)).toMatchObject({
      format: EXPORT_FORMAT,
      v: 1,
      exportedAt: "2026-10-27T00:00:00.000Z",
    })
    let next = 0
    const outcome = importLibrary(text, () => `new-${next++}`)
    expect(outcome).toMatchObject({ ok: true, skipped: 0 })
    if (!outcome.ok) throw new Error("import failed")
    expect(outcome.groups[0]).toMatchObject({ name: "Shop", sites: ["shop.test"] })
    expect(outcome.groups[0]!.id).toMatch(/^new-/)
    expect(outcome.groups[0]!.rules[0]!.id).toMatch(/^new-/)
  })

  it("refuses another file and counts the rules it could not take", () => {
    expect(importLibrary("not json", () => "x")).toEqual({ ok: false, reason: "invalid" })
    expect(importLibrary(JSON.stringify({ groups: [] }), () => "x")).toEqual({
      ok: false,
      reason: "invalid",
    })
    let next = 0
    const outcome = importLibrary(
      JSON.stringify({
        format: EXPORT_FORMAT,
        groups: [
          {
            sites: ["a.test"],
            rules: [
              { match: "/a", action: "fail" },
              { match: "", action: "fail" },
            ],
          },
        ],
      }),
      () => `id-${next++}`
    )
    expect(outcome).toMatchObject({ ok: true, skipped: 1 })
  })
})

describe("rulesFromMocks", () => {
  const mock = {
    id: "m",
    match: "/api/orders*",
    method: "GET",
    action: "respond" as const,
    status: 503,
    body: "down",
    headers: "x-a: 1\nnot a header",
    target: "",
    delayMs: 0,
    times: 2,
    chance: 50,
    enabled: true,
  }

  it("keeps a tab's rules for the site, resolving a redirect path against the page", () => {
    const { rules, skipped } = rulesFromMocks(
      [
        mock,
        {
          ...mock,
          id: "r",
          action: "redirect",
          target: "/v2/orders",
          status: 0,
          body: "",
          headers: "",
        },
        { ...mock, id: "x", action: "redirect", target: "v2", status: 0, body: "", headers: "" },
      ],
      "https://shop.test/cart"
    )
    expect(skipped).toBe(1)
    expect(rules).toEqual([
      expect.objectContaining({
        match: "/api/orders*",
        method: "GET",
        status: 503,
        headers: { "x-a": "1" },
        times: 2,
        chance: 50,
      }),
      expect.objectContaining({ action: "redirect", redirectTo: "https://shop.test/v2/orders" }),
    ])
  })
})

describe("ruleSummary", () => {
  it("says what each rule does", () => {
    expect(
      ruleSummary(cleanRule({ match: "/a", method: "post", action: "fail", times: 2 }, "a")!)
    ).toBe("POST `/a` → network error (first 2 only)")
    expect(ruleSummary(cleanRule(header({ Authorization: "x" }, ["Cookie"]), "h")!)).toBe(
      "Any method `/api/*` → sets request `Authorization`, removes request `Cookie`"
    )
  })
})
