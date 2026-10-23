/** @jest-environment <rootDir>/testing/jsdom-environment.cjs */
import {
  cleanMock,
  mainRequestMocks,
  matchIsValid,
  MOCK_STORE_KEY,
  mocksMarkdown,
  mockSummary,
  restoreKeptMocks,
  type RequestMock,
} from "./request-mocks"

const realFetch = jest.fn(async () => new Response("real"))

function rule(overrides: Partial<RequestMock> = {}): RequestMock {
  return {
    id: "r1",
    match: "/api/orders*",
    method: "",
    action: "respond",
    status: 503,
    body: '{"error":"down"}',
    headers: "",
    target: "",
    delayMs: 0,
    times: 0,
    chance: 100,
    enabled: true,
    ...overrides,
  }
}

const realBeacon = jest.fn(() => true)

beforeEach(() => {
  realFetch.mockClear()
  realFetch.mockImplementation(async () => new Response("real"))
  realBeacon.mockClear()
  window.fetch = realFetch as unknown as typeof fetch
  navigator.sendBeacon = realBeacon
})

afterEach(() => {
  mainRequestMocks([])
  delete (window as unknown as Record<string, unknown>).__cogniaRequestMocks
  sessionStorage.clear()
  jest.restoreAllMocks()
})

const NOTHING = { installed: false, kept: false, hits: {}, log: [] }

function xhr(method: string, url: string, responseType: XMLHttpRequestResponseType = "") {
  const request = new XMLHttpRequest()
  request.open(method, url)
  request.responseType = responseType
  const done = new Promise<string>((resolve) => {
    request.addEventListener("load", () => resolve("load"))
    request.addEventListener("error", () => resolve("error"))
  })
  request.send()
  return { request, done }
}

describe("mainRequestMocks — fetch", () => {
  it("answers a matching request with the status and body asked for, and counts it", async () => {
    expect(mainRequestMocks([rule()])).toEqual({ installed: true, kept: false, hits: {}, log: [] })
    const response = await fetch("/api/orders?page=2")
    expect(realFetch).not.toHaveBeenCalled()
    expect(response.status).toBe(503)
    expect(response.statusText).toBe("Service Unavailable")
    expect(response.headers.get("content-type")).toBe("application/json")
    await expect(response.json()).resolves.toEqual({ error: "down" })
    expect(mainRequestMocks(null)).toMatchObject({
      installed: true,
      hits: { r1: { count: 1, lastUrl: "http://localhost/api/orders?page=2" } },
      log: [
        {
          rule: "r1",
          method: "GET",
          url: "http://localhost/api/orders?page=2",
          outcome: "503",
        },
      ],
    })
  })

  it("lets through what does not match, by URL or by method", async () => {
    mainRequestMocks([rule({ method: "POST" })])
    await fetch("/api/orders")
    await fetch("/api/users", { method: "POST" })
    expect(realFetch).toHaveBeenCalledTimes(2)
    await fetch(new Request("http://localhost/api/orders/7", { method: "POST" }))
    expect(realFetch).toHaveBeenCalledTimes(2)
  })

  it("fails a request like a dropped connection, and sends a body-less status without one", async () => {
    mainRequestMocks([
      rule({ action: "fail" }),
      rule({ id: "r2", match: "/api/empty", status: 204 }),
    ])
    await expect(fetch("/api/orders")).rejects.toThrow(new TypeError("Failed to fetch"))
    const empty = await fetch("/api/empty")
    expect(empty.status).toBe(204)
    await expect(empty.text()).resolves.toBe("")
  })

  it("holds a request back and then sends it, unless the page gives up first", async () => {
    mainRequestMocks([rule({ action: "delay", delayMs: 20 })])
    const started = Date.now()
    await expect(fetch("/api/orders").then((response) => response.text())).resolves.toBe("real")
    expect(Date.now() - started).toBeGreaterThanOrEqual(15)
    const controller = new AbortController()
    const held = fetch("/api/orders", { signal: controller.signal })
    controller.abort()
    await expect(held).rejects.toMatchObject({ name: "AbortError" })
    expect(realFetch).toHaveBeenCalledTimes(1)
  })

  it("stops when cleared, and says so when the page no longer has the rules", async () => {
    mainRequestMocks([rule()])
    expect(mainRequestMocks([])).toEqual(NOTHING)
    await fetch("/api/orders")
    expect(realFetch).toHaveBeenCalledTimes(1)
    delete (window as unknown as Record<string, unknown>).__cogniaRequestMocks
    expect(mainRequestMocks(null)).toEqual(NOTHING)
  })

  it("matches regular expressions, and leaves paused rules alone", async () => {
    mainRequestMocks([
      rule({ id: "paused", match: "*", enabled: false }),
      rule({ match: "/orders\\/\\d+$/", status: 404 }),
    ])
    expect((await fetch("/api/orders/12")).status).toBe(404)
    await expect((await fetch("/api/orders/12/items")).text()).resolves.toBe("real")
    expect(mainRequestMocks(null).hits).not.toHaveProperty("paused")
  })

  it("applies to the first few matches only, and keeps that count while the rules change", async () => {
    mainRequestMocks([rule({ times: 2 })])
    await fetch("/api/orders")
    // The same rule again, say after another was added: still one left, not two.
    mainRequestMocks([rule({ times: 2 }), rule({ id: "r2", match: "/other" })])
    expect((await fetch("/api/orders")).status).toBe(503)
    await expect((await fetch("/api/orders")).text()).resolves.toBe("real")
    expect(mainRequestMocks(null).hits.r1).toMatchObject({ count: 2 })
  })

  it("strikes at random when given a chance", async () => {
    const random = jest.spyOn(Math, "random")
    mainRequestMocks([rule({ chance: 30 })])
    random.mockReturnValueOnce(0.1)
    expect((await fetch("/api/orders")).status).toBe(503)
    random.mockReturnValueOnce(0.9)
    expect((await fetch("/api/orders")).status).toBe(200)
  })

  it("changes the server's real answer: JSON merged, status and headers as asked", async () => {
    realFetch.mockImplementation(
      async () =>
        new Response('{"user":{"name":"Ada","plan":"free"},"items":[1]}', {
          status: 200,
          headers: { "content-type": "application/json", "content-length": "52", "x-real": "1" },
        })
    )
    mainRequestMocks([
      rule({
        action: "modify",
        status: 402,
        body: '{"user":{"plan":"pro"},"items":[]}',
        headers: "x-mock: yes",
      }),
    ])
    const response = await fetch("/api/orders")
    expect(realFetch).toHaveBeenCalledTimes(1)
    expect(response.status).toBe(402)
    expect(response.headers.get("x-real")).toBe("1")
    expect(response.headers.get("x-mock")).toBe("yes")
    expect(response.headers.get("content-length")).toBeNull()
    await expect(response.json()).resolves.toEqual({
      user: { name: "Ada", plan: "pro" },
      items: [],
    })
    expect(mainRequestMocks(null).log[0]).toMatchObject({ outcome: "402 (modified)" })
  })

  it("replaces a text answer, and keeps the server's status when none is asked", async () => {
    realFetch.mockImplementation(async () => new Response("<p>real</p>", { status: 201 }))
    mainRequestMocks([rule({ action: "modify", status: 0, body: "<p>changed</p>" })])
    const response = await fetch("/api/orders")
    expect(response.status).toBe(201)
    await expect(response.text()).resolves.toBe("<p>changed</p>")
  })

  it("sends a request elsewhere: a full URL with the match's groups, or the matched part replaced", async () => {
    mainRequestMocks([
      rule({
        action: "redirect",
        match: "/\\/api\\/(\\w+)/",
        target: "http://localhost:3000/v2/$1",
      }),
      rule({ id: "r2", action: "redirect", match: "/legacy", target: "/modern" }),
    ])
    await fetch("/api/orders?page=1")
    await fetch("/legacy/feed")
    expect(realFetch.mock.calls.map((call) => String((call as unknown[])[0]))).toEqual([
      "http://localhost:3000/v2/orders",
      "http://localhost/modern/feed",
    ])
    expect(mainRequestMocks(null).log.map((entry) => entry.outcome)).toEqual([
      "→ http://localhost:3000/v2/orders",
      "→ http://localhost/modern/feed",
    ])
  })
})

describe("mainRequestMocks — beacons", () => {
  it("refuses a failed beacon, and redirects or lets through the rest", () => {
    mainRequestMocks([
      rule({ action: "fail", match: "/collect" }),
      rule({ id: "r2", action: "redirect", match: "/track", target: "/sink" }),
    ])
    expect(navigator.sendBeacon("/collect", "x")).toBe(false)
    expect(navigator.sendBeacon("/track", "y")).toBe(true)
    expect(navigator.sendBeacon("/other", "z")).toBe(true)
    expect(realBeacon.mock.calls).toEqual([
      ["http://localhost/sink", "y"],
      ["/other", "z"],
    ])
  })
})

describe("mainRequestMocks — XMLHttpRequest", () => {
  it("answers a matching request with its status, body and content type", async () => {
    mainRequestMocks([rule({ status: 422, method: "POST" })])
    const { request, done } = xhr("POST", "/api/orders")
    await expect(done).resolves.toBe("load")
    expect(request.readyState).toBe(4)
    expect(request.status).toBe(422)
    expect(request.responseText).toBe('{"error":"down"}')
    expect(request.getResponseHeader("Content-Type")).toBe("application/json")
    const json = xhr("POST", "/api/orders", "json")
    await json.done
    expect(json.request.response).toEqual({ error: "down" })
  })

  it("fails a matching request with an error and status 0", async () => {
    mainRequestMocks([rule({ action: "fail" })])
    const { request, done } = xhr("GET", "/api/orders")
    await expect(done).resolves.toBe("error")
    expect(request.status).toBe(0)
  })

  it("changes the real answer, fetched as the request would have gone", async () => {
    realFetch.mockImplementation(
      async () => new Response('{"total":3}', { headers: { "content-type": "application/json" } })
    )
    mainRequestMocks([rule({ action: "modify", status: 0, body: '{"total":0}' })])
    const request = new XMLHttpRequest()
    request.open("GET", "/api/orders")
    request.setRequestHeader("x-token", "abc")
    const done = new Promise((resolve) => request.addEventListener("load", resolve))
    request.send()
    await done
    expect(realFetch).toHaveBeenCalledWith(
      "http://localhost/api/orders",
      expect.objectContaining({ method: "GET", headers: [["x-token", "abc"]] })
    )
    expect(request.status).toBe(200)
    expect(JSON.parse(request.responseText)).toEqual({ total: 0 })
    expect(request.getResponseHeader("content-type")).toBe("application/json")
  })
})

describe("keeping rules across reloads", () => {
  it("writes kept rules to the tab's storage, and puts them back on the next load", async () => {
    expect(mainRequestMocks([rule()], true)).toMatchObject({ installed: true, kept: true })
    expect(JSON.parse(sessionStorage.getItem(MOCK_STORE_KEY)!)).toEqual([rule()])
    // A reload: the page's globals are gone, its storage is not.
    delete (window as unknown as Record<string, unknown>).__cogniaRequestMocks
    window.fetch = realFetch as unknown as typeof fetch
    restoreKeptMocks()
    expect((await fetch("/api/orders")).status).toBe(503)
    expect(mainRequestMocks(null)).toMatchObject({ installed: true, kept: true })
  })

  it("forgets them when they are no longer kept, and ignores what it cannot use", () => {
    mainRequestMocks([rule()], true)
    expect(mainRequestMocks([rule()]).kept).toBe(false)
    expect(sessionStorage.getItem(MOCK_STORE_KEY)).toBeNull()
    sessionStorage.setItem(MOCK_STORE_KEY, "not json")
    delete (window as unknown as Record<string, unknown>).__cogniaRequestMocks
    restoreKeptMocks()
    sessionStorage.setItem(MOCK_STORE_KEY, JSON.stringify([{ id: "x", match: "**" }]))
    restoreKeptMocks()
    expect(mainRequestMocks(null).installed).toBe(false)
  })

  it("keeps the log to the most recent requests of rules still there", async () => {
    mainRequestMocks([rule(), rule({ id: "r2", match: "/x" })])
    await fetch("/x")
    for (let index = 0; index < 55; index++) await fetch(`/api/orders/${index}`)
    const { log } = mainRequestMocks(null)
    expect(log).toHaveLength(50)
    expect(log.at(-1)?.url).toBe("http://localhost/api/orders/54")
    expect(mainRequestMocks([rule({ id: "r2", match: "/x" })]).log).toEqual([])
  })
})

describe("rules in the panel", () => {
  it("knows a regular expression that does not compile", () => {
    expect(matchIsValid("/api/*")).toBe(true)
    expect(matchIsValid("/api/orders")).toBe(true)
    expect(cleanMock(rule({ match: "/api/v1/" }))).toMatchObject({ match: "/api/v1/" })
    expect(matchIsValid("/orders\\/\\d+/i")).toBe(true)
    expect(matchIsValid("/orders(/")).toBe(false)
    expect(cleanMock(rule({ match: "/orders(/" }))).toBeNull()
  })

  it("keeps the new actions only when they can do something", () => {
    expect(cleanMock(rule({ action: "redirect", target: " " }))).toBeNull()
    expect(cleanMock(rule({ action: "redirect", target: "/v2", body: "x" }))).toMatchObject({
      target: "/v2",
      body: "",
      status: 0,
    })
    expect(cleanMock(rule({ action: "modify", status: 0, body: "", headers: "" }))).toBeNull()
    expect(cleanMock(rule({ action: "modify", status: 0, headers: "x-a: 1" }))).not.toBeNull()
    expect(cleanMock(rule({ times: -3, chance: 400, enabled: undefined }))).toMatchObject({
      times: 0,
      chance: 100,
      enabled: true,
    })
    expect(cleanMock({ id: "bare", match: "/a", action: "fail" })).toMatchObject({
      headers: "",
      target: "",
      times: 0,
      chance: 100,
      enabled: true,
    })
  })

  it("keeps only rules that can do something", () => {
    expect(cleanMock(rule({ match: "  /api  ", method: "TRACE" }))).toEqual(
      rule({ match: "/api", method: "" })
    )
    expect(cleanMock(rule({ match: "**" }))).toBeNull()
    expect(cleanMock(rule({ status: 99 }))).toBeNull()
    expect(cleanMock(rule({ action: "delay", delayMs: 0 }))).toBeNull()
    expect(cleanMock(rule({ action: "delay", delayMs: 90_000 }))).toMatchObject({
      delayMs: 30_000,
      status: 0,
      body: "",
    })
    expect(cleanMock(rule({ action: "fail", body: "x" }))).toMatchObject({ body: "", status: 0 })
  })

  it("tells the agent which requests were simulated and how often", () => {
    expect(mockSummary(rule({ action: "fail", method: "GET" }))).toBe(
      "GET `/api/orders*` → network error"
    )
    expect(mockSummary(rule({ action: "delay", delayMs: 1500 }))).toBe(
      "Any method `/api/orders*` → held back 1500 ms, then sent"
    )
    expect(mockSummary(rule({ action: "modify", status: 0, times: 3, chance: 50 }))).toBe(
      "Any method `/api/orders*` → the server's answer with the body changed (first 3 only, 50% of the time)"
    )
    expect(mockSummary(rule({ action: "redirect", target: "/v2", enabled: false }))).toBe(
      "Any method `/api/orders*` → sent to `/v2` (paused)"
    )
    const text = mocksMarkdown([rule(), rule({ id: "r2", action: "fail", match: "/x" })], {
      installed: true,
      kept: false,
      hits: { r1: { count: 2, lastUrl: "http://a.test/api/orders" } },
      log: [
        {
          rule: "r1",
          method: "GET",
          url: "http://a.test/api/orders?token=secret",
          at: 1,
          outcome: "503",
        },
      ],
    })
    expect(text).toContain("## Simulated requests (2)")
    expect(text).toContain("simulated, not the backend's")
    expect(text).toContain("- Any method `/api/orders*` → 503 with a body — matched 2 times")
    expect(text).toContain('  {"error":"down"}')
    expect(text).toContain("- Any method `/x` → network error — not matched")
    expect(text).toContain("Requests caught, most recent last:")
    expect(text).toContain("- GET `/api/orders?…` → 503")
    expect(text).not.toContain("secret")
    expect(mocksMarkdown([], null)).toBe("")
  })
})
