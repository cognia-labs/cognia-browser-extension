/** @jest-environment <rootDir>/testing/jsdom-environment.cjs */
import { installPageHooks } from "./page-hooks"

type HookWindow = Parameters<typeof installPageHooks>[0]

describe("installPageHooks", () => {
  it("installs once and records console lines without swallowing them", () => {
    const win = window as unknown as HookWindow
    const spy = jest.spyOn(console, "warn").mockImplementation(() => undefined)
    const hooks = installPageHooks(win, () => 5)
    expect(installPageHooks(win)).toBe(hooks)
    win.console.warn("careful", { a: 1 })
    expect(hooks.drainConsole()).toEqual([{ level: "warn", text: 'careful {"a":1}', ts: 5 }])
    expect(hooks.drainConsole()).toEqual([])
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it("never blocks on a dialog, and answers by the policy set for the next one", () => {
    const hooks = (
      window as unknown as {
        __cogniaPageHooks: ReturnType<typeof installPageHooks>
      }
    ).__cogniaPageHooks
    expect(window.confirm("Delete?")).toBe(false)
    expect(hooks.lastDialog()).toMatchObject({
      type: "confirm",
      message: "Delete?",
      accepted: false,
    })
    hooks.setDialogPolicy({ accept: true, promptText: "Ada" })
    expect(window.prompt("Name?", "x")).toBe("Ada")
    // The policy is spent by one dialog.
    expect(window.prompt("Again?", "y")).toBeNull()
    window.alert("hi")
    expect(hooks.lastDialog()).toMatchObject({ type: "alert", accepted: true })
  })

  it("lets a person's recording peek without draining, and leaves their dialogs alone", async () => {
    const shown: string[] = []
    const win = {
      console: { log() {}, info() {}, warn() {}, error() {}, debug() {} },
      addEventListener() {},
      fetch: async () => ({ status: 503, ok: false }) as Response,
      XMLHttpRequest: undefined,
      confirm: (message: string) => {
        shown.push(message)
        return true
      },
    } as unknown as Parameters<typeof installPageHooks>[0]
    let clock = 100
    const hooks = installPageHooks(win, () => (clock += 1), { interceptDialogs: false })
    win.console.error("boom")
    await win.fetch("https://api.example/x")
    expect(hooks.peekConsole()).toEqual([{ level: "error", text: "boom", ts: 101 }])
    expect(hooks.peekNetwork()).toEqual([
      expect.objectContaining({ url: "https://api.example/x", status: 503, ts: 103 }),
    ])
    // Still there for the agent, which reads them without the timestamp.
    expect(hooks.drainNetwork()).toEqual([
      { url: "https://api.example/x", method: "GET", status: 503, ok: false, durationMs: 1 },
    ])
    expect(win.confirm("Really?")).toBe(true)
    expect(shown).toEqual(["Really?"])

    // The agent's own install turns dialog handling on for the document.
    expect(installPageHooks(win)).toBe(hooks)
    expect(win.confirm("Again?")).toBe(false)
    expect(shown).toEqual(["Really?"])
    expect(hooks.lastDialog()).toMatchObject({ type: "confirm", message: "Again?" })
  })

  it("counts fetch traffic and records its outcome", async () => {
    const win = {
      console: { log() {}, info() {}, warn() {}, error() {}, debug() {} },
      addEventListener() {},
      fetch: async () => ({ status: 201, ok: true }) as Response,
      XMLHttpRequest: undefined,
    } as unknown as HookWindow
    let clock = 0
    const hooks = installPageHooks(win, () => (clock += 10))
    await win.fetch("https://api.example/items", { method: "post" })
    expect(hooks.networkState()).toEqual({ pending: 0, completed: 1 })
    expect(hooks.drainNetwork()).toEqual([
      {
        url: "https://api.example/items",
        method: "POST",
        status: 201,
        ok: true,
        durationMs: 10,
      },
    ])
  })
})
