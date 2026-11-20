import { compileRule, requestPatterns, sitePatterns, urlCondition } from "./dnr"
import { cleanRule } from "./rules"

function ids() {
  let id = 0
  return () => ++id
}

describe("urlCondition", () => {
  it("keeps a plain part of the URL as a case-insensitive urlFilter", () => {
    expect(urlCondition("/api/orders*")).toEqual({
      urlFilter: "/api/orders*",
      isUrlFilterCaseSensitive: false,
    })
  })

  it("turns a regular expression into regexFilter, honouring its i flag", () => {
    expect(urlCondition("/orders\\/\\d+/")).toEqual({
      regexFilter: "orders\\/\\d+",
      isUrlFilterCaseSensitive: true,
    })
    expect(urlCondition("/orders\\/\\d+/i").isUrlFilterCaseSensitive).toBe(false)
  })

  it("escapes what urlFilter would read as an anchor or cannot carry", () => {
    expect(urlCondition("a|b*c")).toEqual({
      regexFilter: "a\\|b.*c",
      isUrlFilterCaseSensitive: false,
    })
    expect(urlCondition("/搜索")).toMatchObject({ regexFilter: "/搜索" })
  })
})

describe("compileRule", () => {
  it("leaves rules the page runs to the page", () => {
    const rule = cleanRule({ match: "/a", action: "respond", status: 200 }, "r")!
    expect(compileRule(rule, { sites: ["shop.test"] }, ids(), 1)).toEqual([])
    const paused = cleanRule({ match: "/a", action: "fail", enabled: false }, "r")!
    expect(compileRule(paused, { sites: ["shop.test"] }, ids(), 1)).toEqual([])
  })

  it("blocks and redirects what the site's pages request, documents excepted", () => {
    const fail = cleanRule({ match: "/api/*", method: "post", action: "fail" }, "f")!
    expect(compileRule(fail, { sites: ["shop.test"] }, ids(), 5)).toEqual([
      {
        id: 1,
        priority: 5,
        condition: {
          urlFilter: "/api/*",
          isUrlFilterCaseSensitive: false,
          requestMethods: ["post"],
          initiatorDomains: ["shop.test"],
        },
        action: { type: "block" },
      },
    ])
    const redirect = cleanRule(
      { match: "/old", action: "redirect", redirectTo: "https://new.test/" },
      "r"
    )!
    expect(compileRule(redirect, { sites: ["*"] }, ids(), 1)[0]).toMatchObject({
      condition: { urlFilter: "/old" },
      action: { type: "redirect", redirect: { url: "https://new.test/" } },
    })
  })

  it("rewrites headers of every request type, and of the site's own documents", () => {
    const rule = cleanRule(
      {
        match: "/",
        action: "request_headers",
        headers: { "X-Env": "staging" },
        removeHeaders: ["Cookie"],
      },
      "h"
    )!
    const [fromPages, documents] = compileRule(rule, { sites: ["shop.test"] }, ids(), 1)
    expect(fromPages!.condition).toMatchObject({ initiatorDomains: ["shop.test"] })
    expect(fromPages!.condition.resourceTypes).toContain("main_frame")
    expect(fromPages!.action).toEqual({
      type: "modifyHeaders",
      requestHeaders: [
        { header: "X-Env", operation: "set", value: "staging" },
        { header: "Cookie", operation: "remove" },
      ],
    })
    expect(documents!.condition).toMatchObject({
      requestDomains: ["shop.test"],
      resourceTypes: ["main_frame", "sub_frame"],
    })
  })

  it("scopes a conversation's rules to its tabs, and to nothing without tabs", () => {
    const rule = cleanRule(
      { match: "/", action: "response_headers", headers: { "Cache-Control": "no-store" } },
      "h"
    )!
    expect(compileRule(rule, { tabIds: [7, 9] }, ids(), 1)).toEqual([
      expect.objectContaining({
        condition: expect.objectContaining({ tabIds: [7, 9] }),
        action: {
          type: "modifyHeaders",
          responseHeaders: [{ header: "Cache-Control", operation: "set", value: "no-store" }],
        },
      }),
    ])
    expect(compileRule(rule, { tabIds: [] }, ids(), 1)).toEqual([])
  })
})

describe("sitePatterns", () => {
  it("covers each site and its subdomains on both schemes, or every site", () => {
    expect(sitePatterns(["shop.test", "localhost"])).toEqual([
      "http://shop.test/*",
      "https://shop.test/*",
      "http://*.shop.test/*",
      "https://*.shop.test/*",
      "http://localhost/*",
      "https://localhost/*",
    ])
    expect(sitePatterns(["shop.test", "*"])).toEqual(["http://*/*", "https://*/*"])
  })

  it("asks for a site in as few patterns as one prompt needs", () => {
    expect(requestPatterns("shop.test")).toEqual(["*://shop.test/*", "*://*.shop.test/*"])
    expect(requestPatterns("127.0.0.1")).toEqual(["*://127.0.0.1/*"])
    expect(requestPatterns("*")).toEqual(["<all_urls>"])
  })
})
