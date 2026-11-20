/** @jest-environment <rootDir>/testing/jsdom-environment.cjs */
import { mainRequestMocks, type RequestMock } from "../inspect/request-mocks"

import { RULES_EVENT, RULES_SLOT, isolatedRuleLoader, mainRuleGate } from "./page"

const realFetch = jest.fn(async () => new Response("real"))

const answer: RequestMock = {
  id: "r1",
  match: "/api/orders*",
  method: "",
  action: "respond",
  status: 503,
  body: "down",
  headers: "",
  target: "",
  delayMs: 0,
  times: 0,
  chance: 100,
  enabled: true,
}

const holder = window as unknown as Record<string, unknown>
const loaders: (() => void)[] = []
const load = (ask: () => Promise<unknown>) => loaders.push(isolatedRuleLoader(ask))

beforeEach(() => {
  realFetch.mockClear()
  window.fetch = realFetch as unknown as typeof fetch
  delete holder.__cogniaRuleGate
  delete holder[`__cogniaRequestMocks${RULES_SLOT}`]
  delete holder.__cogniaRequestMocks
})

afterEach(() => {
  for (const dispose of loaders.splice(0)) dispose()
  jest.useRealTimers()
})

describe("the rule gate", () => {
  it("holds a request made before the rules and decides it against them", async () => {
    mainRuleGate()
    const early = fetch("https://shop.test/api/orders")
    await Promise.resolve()
    expect(realFetch).not.toHaveBeenCalled()
    load(async () => [answer])
    const response = await early
    expect(response.status).toBe(503)
    expect(await response.text()).toBe("down")
    expect(realFetch).not.toHaveBeenCalled()
    await fetch("https://shop.test/other")
    expect(realFetch).toHaveBeenCalledTimes(1)
  })

  it("finds a loader that answered before it started", async () => {
    load(async () => [answer])
    await Promise.resolve()
    await Promise.resolve()
    mainRuleGate()
    expect((await fetch("https://shop.test/api/orders")).status).toBe(503)
  })

  it("lets requests go after the hold when the worker does not answer", async () => {
    jest.useFakeTimers()
    mainRuleGate(500)
    const held = fetch("https://shop.test/api/orders")
    jest.advanceTimersByTime(500)
    jest.useRealTimers()
    expect(await (await held).text()).toBe("real")
  })

  it("ignores a second answer, which can only be the page's own", async () => {
    mainRuleGate()
    document.dispatchEvent(new CustomEvent(RULES_EVENT, { detail: "[]" }))
    document.dispatchEvent(new CustomEvent(RULES_EVENT, { detail: JSON.stringify([answer]) }))
    expect(await (await fetch("https://shop.test/api/orders")).text()).toBe("real")
  })

  it("runs apart from the panel's simulated requests", async () => {
    mainRuleGate()
    load(async () => [answer])
    await fetch("https://shop.test/warmup")
    mainRequestMocks([{ ...answer, id: "panel", match: "/panel", status: 418 }])
    expect((await fetch("https://shop.test/panel")).status).toBe(418)
    expect((await fetch("https://shop.test/api/orders")).status).toBe(503)
    mainRequestMocks([])
    expect((await fetch("https://shop.test/api/orders")).status).toBe(503)
  })
})
