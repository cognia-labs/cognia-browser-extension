/** @jest-environment <rootDir>/testing/jsdom-environment.cjs */
import { createChromeBrowserApi } from "./chrome-browser-api"
import { readYouTubeTranscript } from "./capture/youtube-transcript"
import type { PageCapture, PageCaptureOptions } from "./capture/page-capture"

interface ChromeStub {
  tabs: { query: jest.Mock; create: jest.Mock; get: jest.Mock }
  scripting: { executeScript: jest.Mock }
  storage: {
    local: { get: jest.Mock; set: jest.Mock; remove: jest.Mock }
    onChanged: { addListener: jest.Mock; removeListener: jest.Mock }
  }
  permissions: { contains: jest.Mock; request: jest.Mock }
  runtime: { getURL: jest.Mock }
  i18n: { getMessage: jest.Mock }
}

function stub(): ChromeStub {
  const chromeStub: ChromeStub = {
    tabs: {
      query: jest.fn(async () => [{ id: 7, url: "https://example.com/a", title: "A" }]),
      create: jest.fn(async () => undefined),
      get: jest.fn(async (id: number) => ({
        id,
        url: "https://example.com/b",
        title: "B",
      })),
    },
    scripting: {
      executeScript: jest.fn(async () => [{ result: { title: "A" } }]),
    },
    storage: {
      local: {
        get: jest.fn(async () => ({ "a.key": 42 })),
        set: jest.fn(async () => undefined),
        remove: jest.fn(async () => undefined),
      },
      onChanged: { addListener: jest.fn(), removeListener: jest.fn() },
    },
    permissions: {
      contains: jest.fn(async () => true),
      request: jest.fn(async () => true),
    },
    runtime: {
      getURL: jest.fn(() => "chrome-extension://abcdefghijklmnopabcdefghijklmnop/"),
    },
    i18n: { getMessage: jest.fn(() => "translated") },
  }
  ;(globalThis as unknown as { chrome: ChromeStub }).chrome = chromeStub
  return chromeStub
}

describe("createChromeBrowserApi", () => {
  it("injects the capture bundle before invoking it in the isolated world", async () => {
    const chromeStub = stub()
    const options = { wholePage: true, article: true }
    const result: PageCapture = {
      title: "Captured",
      url: "https://example.com",
      selection: null,
      readableText: "Body",
      readableCharacterCount: 4,
      article: null,
      metadata: {},
      isPdf: false,
    }
    chromeStub.scripting.executeScript.mockResolvedValueOnce([]).mockResolvedValueOnce([{ result }])
    expect(await createChromeBrowserApi().capturePage(7, options)).toEqual(result)
    expect(chromeStub.scripting.executeScript.mock.calls[0][0]).toEqual({
      target: { tabId: 7 },
      files: ["/page-capture.js"],
    })
    const invocation = chromeStub.scripting.executeScript.mock.calls[1][0] as {
      target: { tabId: number }
      args: PageCaptureOptions[]
      world?: string
      func: (options: PageCaptureOptions) => PageCapture
    }
    expect(invocation.target).toEqual({ tabId: 7 })
    expect(invocation.args).toEqual([options])
    expect(invocation.world).toBeUndefined()
    const capture = jest.fn(() => result)
    globalThis.__cogniaPageCapture = { capture }
    expect(invocation.func(options)).toBe(result)
    expect(capture).toHaveBeenCalledWith(options)
    globalThis.__cogniaPageCapture = undefined
  })

  it("rejects a missing page capture and propagates bundle injection failures", async () => {
    const chromeStub = stub()
    chromeStub.scripting.executeScript.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    await expect(
      createChromeBrowserApi().capturePage(7, {
        wholePage: false,
        article: true,
      })
    ).rejects.toThrow("the page could not be read")
    chromeStub.scripting.executeScript
      .mockReset()
      .mockRejectedValueOnce(new Error("permission denied"))
    await expect(
      createChromeBrowserApi().capturePage(7, {
        wholePage: false,
        article: true,
      })
    ).rejects.toThrow("permission denied")
    expect(chromeStub.scripting.executeScript).toHaveBeenCalledTimes(1)
  })

  it("reads transcripts in MAIN only after checking the tab URL", async () => {
    const chromeStub = stub()
    chromeStub.tabs.get.mockResolvedValue({
      id: 7,
      url: "https://www.youtube.com/watch?v=video",
    })
    const transcript = {
      status: "available",
      text: "[0:00] Hello",
      truncated: false,
    }
    chromeStub.scripting.executeScript.mockResolvedValueOnce([{ result: transcript }])
    expect(await createChromeBrowserApi().captureTranscript(7, "en")).toEqual(transcript)
    expect(chromeStub.tabs.get).toHaveBeenCalledWith(7)
    expect(chromeStub.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 7 },
      world: "MAIN",
      func: readYouTubeTranscript,
      args: ["en"],
    })
    chromeStub.scripting.executeScript.mockResolvedValueOnce([])
    expect(await createChromeBrowserApi().captureTranscript(7, "en")).toEqual({
      status: "unavailable",
      reason: "fetch_failed",
    })
  })

  it("does not inject transcript readers into non-video tabs", async () => {
    const chromeStub = stub()
    expect(await createChromeBrowserApi().captureTranscript(7, "en")).toEqual({
      status: "unavailable",
      reason: "not_a_video",
    })
    expect(chromeStub.scripting.executeScript).not.toHaveBeenCalled()
  })

  it("returns the active tab, or null when there is none we may touch", async () => {
    const chromeStub = stub()
    const api = createChromeBrowserApi()
    expect(await api.activeTab()).toEqual({
      id: 7,
      url: "https://example.com/a",
      title: "A",
    })

    chromeStub.tabs.query.mockResolvedValueOnce([{ id: undefined, url: undefined }])
    expect(await api.activeTab()).toBeNull()
    // A tab with no URL is one the extension has no `activeTab` grant for.
    chromeStub.tabs.query.mockResolvedValueOnce([])
    expect(await api.activeTab()).toBeNull()
  })

  it("resolves a tab by id, and treats a closed one as absent", async () => {
    const chromeStub = stub()
    const api = createChromeBrowserApi()
    expect(await api.tabById(7)).toEqual({
      id: 7,
      url: "https://example.com/b",
      title: "B",
    })

    // `chrome.tabs.get` REJECTS for a tab that has closed rather than
    // resolving null, and a closed tab is ordinary here: a recorded capture
    // request may be up to a minute old.
    chromeStub.tabs.get.mockRejectedValueOnce(new Error("No tab with id: 7."))
    expect(await api.tabById(7)).toBeNull()
  })

  it("reads a missing storage key as null rather than undefined", async () => {
    const chromeStub = stub()
    const api = createChromeBrowserApi()
    expect(await api.read("a.key")).toBe(42)
    chromeStub.storage.local.get.mockResolvedValueOnce({})
    expect(await api.read("a.key")).toBeNull()
  })

  it("asks for exactly the loopback origin and nothing wider", async () => {
    const chromeStub = stub()
    const api = createChromeBrowserApi()
    await api.hasLoopbackPermission()
    await api.requestLoopbackPermission()
    for (const mock of [chromeStub.permissions.contains, chromeStub.permissions.request]) {
      expect(mock).toHaveBeenCalledWith({ origins: ["http://127.0.0.1/*"] })
    }
  })

  it("reports its origin without the trailing slash the runtime returns", async () => {
    // The Host stores the bare origin and Chrome sends the bare origin in the
    // `Origin` header; a trailing slash here would never match either.
    stub()
    expect(createChromeBrowserApi().extensionOrigin()).toBe(
      "chrome-extension://abcdefghijklmnopabcdefghijklmnop"
    )
  })

  it("reports changes to one local key, and stops when asked", () => {
    const chromeStub = stub()
    const seen: unknown[] = []
    const stop = createChromeBrowserApi().onStorageChange("a.key", (value) => seen.push(value))
    const handler = chromeStub.storage.onChanged.addListener.mock.calls[0][0] as (
      changes: Record<string, { newValue?: unknown; oldValue?: unknown }>,
      area: string
    ) => void

    handler({ "a.key": { newValue: 7 } }, "local")
    // Another key, and the same key in another area, are somebody else's.
    handler({ "b.key": { newValue: 8 } }, "local")
    handler({ "a.key": { newValue: 9 } }, "sync")
    // A removal carries no `newValue`; the contract reports it as null.
    handler({ "a.key": { oldValue: 7 } }, "local")
    expect(seen).toEqual([7, null])

    stop()
    expect(chromeStub.storage.onChanged.removeListener).toHaveBeenCalledWith(handler)
  })

  it("passes substitutions through to the locale lookup", async () => {
    const chromeStub = stub()
    createChromeBrowserApi().message("pairFailed", ["boom"])
    expect(chromeStub.i18n.getMessage).toHaveBeenCalledWith("pairFailed", ["boom"])
  })
})

describe("createChromeBrowserApi — ADR-0228 surface", () => {
  function wideStub() {
    const base = stub() as unknown as Record<string, Record<string, unknown>>
    const port = { postMessage: jest.fn(), disconnect: jest.fn() }
    Object.assign(base.tabs!, {
      captureVisibleTab: jest.fn(async () => "data:image/png;base64,AA=="),
      update: jest.fn(async () => undefined),
    })
    Object.assign(base.permissions!, { remove: jest.fn(async () => true) })
    Object.assign(base.runtime!, {
      connect: jest.fn(() => port),
      sendMessage: jest.fn(async () => true),
    })
    Object.assign(base.storage!, {
      session: {
        get: jest.fn(async () => ({ "s.key": { draft: true } })),
        set: jest.fn(async () => undefined),
        remove: jest.fn(async () => undefined),
      },
    })
    return {
      chromeStub: base as unknown as ChromeStub & Record<string, never>,
      raw: base,
      port,
    }
  }

  it("reads and writes session storage separately from local", async () => {
    const { raw } = wideStub()
    const api = createChromeBrowserApi()
    expect(await api.readSession("s.key")).toEqual({ draft: true })
    await api.writeSession("s.key", 1)
    await api.removeSession(["s.key"])
    const session = (raw.storage as { session: { set: jest.Mock; remove: jest.Mock } }).session
    expect(session.set).toHaveBeenCalledWith({ "s.key": 1 })
    expect(session.remove).toHaveBeenCalledWith(["s.key"])
  })

  it("passes optional permission requests through unchanged", async () => {
    const { raw } = wideStub()
    const api = createChromeBrowserApi()
    await api.requestPermissions({
      permissions: ["tabs"],
      origins: ["https://a.test/*"],
    })
    await api.removePermissions({ origins: ["<all_urls>"] })
    const permissions = raw.permissions as {
      request: jest.Mock
      remove: jest.Mock
    }
    expect(permissions.request).toHaveBeenCalledWith({
      permissions: ["tabs"],
      origins: ["https://a.test/*"],
    })
    expect(permissions.remove).toHaveBeenCalledWith({
      origins: ["<all_urls>"],
    })
  })

  it("lists the window's tabs, dropping ones it cannot read, with their window", async () => {
    const { raw } = wideStub()
    ;(raw.tabs as { query: jest.Mock }).query.mockResolvedValueOnce([
      { id: 1, url: "https://a.test/", title: "A", windowId: 4 },
      { id: 2, title: "no url" },
    ])
    expect(await createChromeBrowserApi().listTabs()).toEqual([
      { id: 1, url: "https://a.test/", title: "A", windowId: 4 },
    ])
    expect((raw.tabs as { query: jest.Mock }).query).toHaveBeenCalledWith({
      currentWindow: true,
    })
  })

  it("captures PNG and measures and scrolls the page", async () => {
    const { raw } = wideStub()
    const api = createChromeBrowserApi()
    expect(await api.captureVisible(4)).toBe("data:image/png;base64,AA==")
    expect((raw.tabs as { captureVisibleTab: jest.Mock }).captureVisibleTab).toHaveBeenCalledWith(
      4,
      { format: "png" }
    )
    const executeScript = (raw.scripting as { executeScript: jest.Mock }).executeScript
    executeScript.mockResolvedValueOnce([
      {
        result: {
          scrollHeight: 10,
          viewportHeight: 5,
          viewportWidth: 3,
          scrollY: 0,
          dpr: 1,
        },
      },
    ])
    expect(await api.scrollMetrics(7)).toMatchObject({ scrollHeight: 10 })
    executeScript.mockResolvedValueOnce([{ result: 4 }])
    expect(await api.scrollTo(7, 9)).toBe(4)
    expect(executeScript.mock.calls.at(-1)?.[0]).toMatchObject({
      target: { tabId: 7 },
      args: [9],
    })
  })

  it("fetches bytes without credentials and refuses oversized ones", async () => {
    wideStub()
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({
        "content-type": "Application/PDF; charset=binary",
        "content-length": "3",
      }),
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    }))
    ;(globalThis as unknown as { fetch: unknown }).fetch = fetchMock
    const api = createChromeBrowserApi()
    expect(await api.fetchBytes("https://a.test/f.pdf", 10)).toEqual({
      bytes: new Uint8Array([1, 2, 3]),
      mediaType: "application/pdf",
    })
    expect(fetchMock).toHaveBeenCalledWith("https://a.test/f.pdf", {
      credentials: "omit",
      redirect: "follow",
    })
    await expect(api.fetchBytes("https://a.test/f.pdf", 2)).rejects.toThrow("too_large")
  })

  it("holds a named port to the worker", () => {
    const { raw, port } = wideStub()
    const handle = createChromeBrowserApi().connectPanel()
    expect((raw.runtime as { connect: jest.Mock }).connect).toHaveBeenCalledWith({
      name: "cognia-panel",
    })
    handle.post({ kind: "refresh-status" })
    handle.disconnect()
    expect(port.postMessage).toHaveBeenCalledWith({ kind: "refresh-status" })
    expect(port.disconnect).toHaveBeenCalled()
  })

  it("sends permission mutations to the worker instead of writing a second session store", async () => {
    const { raw } = wideStub()
    const api = createChromeBrowserApi()
    await api.answerSiteQuestion("q1", "once")
    await api.forgetSiteDecision("https://a.test")
    const runtime = raw.runtime as { sendMessage: jest.Mock }
    expect(runtime.sendMessage.mock.calls).toEqual([
      [
        {
          kind: "cognia-agent-permission",
          action: "answer",
          questionId: "q1",
          answer: "once",
        },
      ],
      [
        {
          kind: "cognia-agent-permission",
          action: "forget",
          origin: "https://a.test",
        },
      ],
    ])
    expect((raw.storage as { local: { set: jest.Mock } }).local.set).not.toHaveBeenCalled()
    expect((raw.storage as { session: { set: jest.Mock } }).session.set).not.toHaveBeenCalled()
    runtime.sendMessage.mockResolvedValueOnce(false)
    await expect(api.answerSiteQuestion("q1", "once")).rejects.toThrow()
  })
})

describe("createChromeBrowserApi — inspecting the page", () => {
  type Call = {
    target: { tabId: number }
    files?: string[]
    world?: string
    func?: unknown
    args?: unknown[]
  }
  const calls = (chromeStub: ChromeStub) =>
    chromeStub.scripting.executeScript.mock.calls.map((call) => call[0] as Call)

  it("injects the picker, waits for the pick, then reads the framework in the main world", async () => {
    const chromeStub = stub()
    const picked = { elementId: "e1", selector: "#save", probeToken: "tok" }
    chromeStub.scripting.executeScript
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ result: picked }])
      .mockResolvedValueOnce([{ result: { framework: "react", components: [] } }])
      .mockResolvedValueOnce([{ result: undefined }])
    const description = await createChromeBrowserApi().pickElement(3, "hint")
    expect(description).toEqual({
      elementId: "e1",
      selector: "#save",
      framework: { framework: "react", components: [] },
    })
    const [inject, pick, framework, cleanup] = calls(chromeStub)
    expect(inject).toEqual({ target: { tabId: 3 }, files: ["/element-picker.js"] })
    expect(pick?.args).toEqual(["hint", 120_000])
    expect(pick?.world).toBeUndefined()
    expect(framework).toMatchObject({ world: "MAIN", args: ["tok"] })
    // The stamp is cleared in the isolated world whatever the main world did.
    expect(cleanup).toMatchObject({ target: { tabId: 3 }, args: ["tok"] })
    expect(cleanup?.world).toBeUndefined()
  })

  it("keeps a pick whose main-world read fails, and answers null for a cancelled one", async () => {
    const chromeStub = stub()
    chromeStub.scripting.executeScript
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ result: { elementId: "e1", probeToken: "t" } }])
      .mockRejectedValueOnce(new Error("main world unavailable"))
      .mockResolvedValueOnce([])
    await expect(createChromeBrowserApi().pickElement(3, "hint")).resolves.toEqual({
      elementId: "e1",
    })
    chromeStub.scripting.executeScript
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ result: null }])
    await expect(createChromeBrowserApi().pickElement(3, "hint")).resolves.toBeNull()
  })

  it("chooses several in one pass, each read in the main world in turn", async () => {
    const chromeStub = stub()
    const labels = { hint: "hint", selected: "{n} chosen", done: "Done" }
    chromeStub.scripting.executeScript
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          result: [
            { elementId: "e1", probeToken: "t1" },
            { elementId: "e2", probeToken: "t2" },
          ],
        },
      ])
      .mockResolvedValueOnce([{ result: { framework: "react", components: [] } }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ result: null }])
      .mockResolvedValueOnce([])
    await expect(createChromeBrowserApi().pickElements(3, labels, 7)).resolves.toEqual([
      { elementId: "e1", framework: { framework: "react", components: [] } },
      { elementId: "e2" },
    ])
    const [, pick, first, , second] = calls(chromeStub)
    expect(pick?.args).toEqual([labels, 120_000, 7])
    expect(first).toMatchObject({ world: "MAIN", args: ["t1"] })
    expect(second).toMatchObject({ world: "MAIN", args: ["t2"] })
    chromeStub.scripting.executeScript
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ result: null }])
    await expect(createChromeBrowserApi().pickElements(3, labels, 7)).resolves.toBeNull()
  })

  it("describes a finding through the picker already on the page, with its framework", async () => {
    const chromeStub = stub()
    chromeStub.scripting.executeScript
      .mockResolvedValueOnce([{ result: { elementId: "e4", selector: "#hero", probeToken: "t4" } }])
      .mockResolvedValueOnce([{ result: { framework: "vue", components: [] } }])
      .mockResolvedValueOnce([])
    await expect(createChromeBrowserApi().describeElement(3, "e4")).resolves.toEqual({
      elementId: "e4",
      selector: "#hero",
      framework: { framework: "vue", components: [] },
    })
    const [describe, framework] = calls(chromeStub)
    expect(describe).toMatchObject({ target: { tabId: 3 }, args: ["e4"] })
    expect(describe?.world).toBeUndefined()
    expect(framework).toMatchObject({ world: "MAIN", args: ["t4"] })
    // A finding the page has since dropped is no pick.
    chromeStub.scripting.executeScript.mockResolvedValueOnce([{ result: null }])
    await expect(createChromeBrowserApi().describeElement(3, "gone")).resolves.toBeNull()
  })

  it("checks and reads the page in the isolated world, after injecting the picker", async () => {
    const chromeStub = stub()
    const api = createChromeBrowserApi()
    const audit = { issues: [], checked: 3, truncated: false }
    chromeStub.scripting.executeScript
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ result: audit }])
    await expect(api.auditAccessibility(6)).resolves.toEqual(audit)
    const tokens = { colors: [], scanned: 1 }
    chromeStub.scripting.executeScript
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ result: tokens }])
    await expect(api.readDesignTokens(6)).resolves.toEqual(tokens)
    const [injectAudit, runAudit, injectTokens, runTokens] = calls(chromeStub)
    for (const inject of [injectAudit, injectTokens])
      expect(inject).toEqual({ target: { tabId: 6 }, files: ["/element-picker.js"] })
    for (const run of [runAudit, runTokens]) expect(run?.world).toBeUndefined()
    chromeStub.scripting.executeScript.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    await expect(api.auditAccessibility(6)).rejects.toThrow()
  })

  it("measures through the picker, from a held anchor when Shift asked to keep going", async () => {
    const chromeStub = stub()
    const api = createChromeBrowserApi()
    const result = {
      from: { elementId: "a" },
      to: { elementId: "b" },
      measure: { relation: "apart" },
    }
    chromeStub.scripting.executeScript.mockResolvedValueOnce([]).mockResolvedValueOnce([{ result }])
    await expect(
      api.measureElements(4, { hint: "First", anchorHint: "Second" }, "a")
    ).resolves.toEqual(result)
    const [inject, measure] = calls(chromeStub)
    expect(inject).toEqual({ target: { tabId: 4 }, files: ["/element-picker.js"] })
    expect(measure?.args).toEqual(["First", "Second", 120_000, "a"])
    expect(measure?.world).toBeUndefined()
    chromeStub.scripting.executeScript
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ result: null }])
    await expect(api.measureElements(4, { hint: "F", anchorHint: "S" })).resolves.toBeNull()
    expect(calls(chromeStub)[3]?.args).toEqual(["F", "S", 120_000, null])
    chromeStub.scripting.executeScript.mockResolvedValueOnce([{ result }])
    await expect(api.showMeasurement(4, "a", "b")).resolves.toEqual(result)
    expect(calls(chromeStub)[4]).toMatchObject({ target: { tabId: 4 }, args: ["a", "b"] })
  })

  it("adjusts through the picker, and finishes it there", async () => {
    const chromeStub = stub()
    const api = createChromeBrowserApi()
    const labels = { margin: "Margin", padding: "Padding" }
    chromeStub.scripting.executeScript
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ result: { width: "130px" } }])
    await expect(api.adjustElement(4, "e1", "Adjust", labels)).resolves.toEqual({
      width: "130px",
    })
    const [inject, adjust] = calls(chromeStub)
    expect(inject).toEqual({ target: { tabId: 4 }, files: ["/element-picker.js"] })
    expect(adjust?.args).toEqual(["e1", "Adjust", labels, 120_000])
    expect(adjust?.world).toBeUndefined()
    chromeStub.scripting.executeScript.mockResolvedValueOnce([{ result: true }])
    await api.finishAdjust(4)
    expect(calls(chromeStub)[2]).toMatchObject({ target: { tabId: 4 } })
  })

  it("installs simulated responses in the main world, where the page's fetch is", async () => {
    const chromeStub = stub()
    const hits = { installed: true, kept: false, hits: {}, log: [] }
    const rules = [
      {
        id: "r",
        match: "/api",
        method: "",
        action: "fail",
        status: 0,
        body: "",
        headers: "",
        target: "",
        delayMs: 0,
        times: 0,
        chance: 100,
        enabled: true,
      },
    ] as const
    chromeStub.scripting.executeScript.mockResolvedValueOnce([{ result: hits }])
    await expect(createChromeBrowserApi().setRequestMocks(9, [...rules])).resolves.toEqual(hits)
    expect(calls(chromeStub)[0]).toMatchObject({
      target: { tabId: 9 },
      world: "MAIN",
      args: [rules, false],
    })
    chromeStub.scripting.executeScript.mockResolvedValueOnce([{ result: hits }])
    await createChromeBrowserApi().setRequestMocks(9, [...rules], true)
    expect(calls(chromeStub)[1]?.args).toEqual([rules, true])
    chromeStub.scripting.executeScript.mockResolvedValueOnce([])
    await expect(createChromeBrowserApi().setRequestMocks(9, null)).rejects.toThrow()
  })

  it("keeps simulated responses across reloads with the site's permission, and stops", async () => {
    const chromeStub = stub()
    const registered: { id: string; matches: string[] }[] = []
    const scripting = Object.assign(chromeStub.scripting, {
      getRegisteredContentScripts: jest.fn(async () => registered.map((entry) => ({ ...entry }))),
      registerContentScripts: jest.fn(async (scripts: { id: string; matches: string[] }[]) => {
        registered.push(...scripts.map(({ id, matches }) => ({ id, matches })))
      }),
      updateContentScripts: jest.fn(async (scripts: { matches: string[] }[]) => {
        registered[0]!.matches = scripts[0]!.matches
      }),
      unregisterContentScripts: jest.fn(async () => {
        registered.length = 0
      }),
    })
    const api = createChromeBrowserApi()
    await expect(api.keepRequestMocks("https://shop.test:8443/cart?x=1", true)).resolves.toBe(true)
    expect(chromeStub.permissions.request).toHaveBeenCalledWith({
      origins: ["https://shop.test/*"],
    })
    expect(scripting.registerContentScripts).toHaveBeenCalledWith([
      {
        id: "cognia-request-mocks",
        matches: ["https://shop.test/*"],
        js: ["request-mocks.js"],
        runAt: "document_start",
        world: "MAIN",
        allFrames: false,
        persistAcrossSessions: false,
      },
    ])
    await api.keepRequestMocks("http://127.0.0.1:4173/", true)
    expect(registered[0]?.matches).toEqual(["https://shop.test/*", "http://127.0.0.1/*"])
    await api.keepRequestMocks("https://shop.test/", false)
    expect(registered[0]?.matches).toEqual(["http://127.0.0.1/*"])
    await api.keepRequestMocks("http://127.0.0.1/", false)
    expect(scripting.unregisterContentScripts).toHaveBeenCalledWith({
      ids: ["cognia-request-mocks"],
    })
    // Stopping asks for nothing.
    expect(chromeStub.permissions.request).toHaveBeenCalledTimes(2)
  })

  it("keeps nothing without the site's permission, or off the web", async () => {
    const chromeStub = stub()
    const scripting = Object.assign(chromeStub.scripting, {
      getRegisteredContentScripts: jest.fn(async () => []),
      registerContentScripts: jest.fn(async () => undefined),
    })
    chromeStub.permissions.request.mockResolvedValueOnce(false)
    const api = createChromeBrowserApi()
    await expect(api.keepRequestMocks("https://shop.test/", true)).resolves.toBe(false)
    await expect(api.keepRequestMocks("chrome://settings", true)).resolves.toBe(false)
    await expect(api.keepRequestMocks("not a url", true)).resolves.toBe(false)
    expect(chromeStub.permissions.request).toHaveBeenCalledTimes(1)
    expect(scripting.registerContentScripts).not.toHaveBeenCalled()
  })

  it("checks the focus order through the picker, and numbers or hides its stops", async () => {
    const chromeStub = stub()
    const api = createChromeBrowserApi()
    const focus = { stops: 3, issues: [], truncated: false }
    chromeStub.scripting.executeScript
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ result: focus }])
    await expect(api.checkFocus(5)).resolves.toEqual(focus)
    expect(calls(chromeStub)[0]).toEqual({ target: { tabId: 5 }, files: ["/element-picker.js"] })
    chromeStub.scripting.executeScript.mockResolvedValueOnce([{ result: true }])
    await expect(api.showFocusOrder(5, false)).resolves.toBe(true)
    expect(calls(chromeStub)[2]?.args).toEqual([false])
    chromeStub.scripting.executeScript.mockResolvedValueOnce([])
    await expect(api.showFocusOrder(5, true)).resolves.toBe(false)
  })

  it("draws the floating toolbar, hides it for a shot, and hears only its own buttons", async () => {
    const chromeStub = stub()
    const api = createChromeBrowserApi()
    chromeStub.scripting.executeScript.mockResolvedValueOnce([{ result: true }])
    const state = { active: null } as never
    await expect(api.setPageToolbar(4, state)).resolves.toBe(true)
    expect(calls(chromeStub)[0]).toMatchObject({ target: { tabId: 4 }, args: [state] })
    expect(calls(chromeStub)[0]?.world).toBeUndefined()
    chromeStub.scripting.executeScript.mockResolvedValueOnce([])
    await api.hidePageChrome(4, true)
    expect(calls(chromeStub)[1]?.args).toEqual([true])

    const listeners: ((message: unknown, sender: unknown) => boolean)[] = []
    Object.assign(chromeStub.runtime, {
      id: "self",
      onMessage: {
        addListener: (listener: (typeof listeners)[number]) => listeners.push(listener),
        removeListener: (listener: (typeof listeners)[number]) =>
          listeners.splice(listeners.indexOf(listener), 1),
      },
    })
    const heard = jest.fn()
    const stop = api.onToolbarAction(heard)
    const press = (message: unknown, sender: unknown) => listeners[0]!(message, sender)
    expect(press({ kind: "cognia-toolbar", action: "pick" }, { id: "self", tab: { id: 4 } })).toBe(
      false
    )
    press({ kind: "cognia-toolbar", action: "pick" }, { id: "other", tab: { id: 4 } })
    press({ kind: "cognia-toolbar", action: "pick" }, { id: "self" })
    press({ kind: "cognia-toolbar", action: "erase" }, { id: "self", tab: { id: 4 } })
    expect(heard.mock.calls).toEqual([["pick", 4]])
    stop()
    expect(listeners).toHaveLength(0)
  })

  it("reads and follows a tab's browser zoom", async () => {
    const chromeStub = stub()
    const listeners: ((change: { tabId: number; newZoomFactor: number }) => void)[] = []
    Object.assign(chromeStub.tabs, {
      getZoom: jest
        .fn()
        .mockResolvedValueOnce(1.5)
        .mockResolvedValueOnce(0)
        .mockRejectedValueOnce(new Error("No tab with id: 3.")),
      onZoomChange: {
        addListener: (listener: (typeof listeners)[number]) => listeners.push(listener),
        removeListener: (listener: (typeof listeners)[number]) =>
          listeners.splice(listeners.indexOf(listener), 1),
      },
    })
    const api = createChromeBrowserApi()
    await expect(api.readTabZoom(3)).resolves.toBe(1.5)
    await expect(api.readTabZoom(3)).resolves.toBe(1)
    await expect(api.readTabZoom(3)).resolves.toBe(1)
    const heard = jest.fn()
    const stop = api.onTabZoom(heard)
    listeners[0]!({ tabId: 3, newZoomFactor: 2 })
    expect(heard).toHaveBeenCalledWith(3, 2)
    stop()
    expect(listeners).toHaveLength(0)
  })

  it("says whether a cancel ended a pass, so the panel can ask again", async () => {
    const chromeStub = stub()
    const api = createChromeBrowserApi()
    chromeStub.scripting.executeScript.mockResolvedValueOnce([{ result: false }])
    await expect(api.cancelPick(2)).resolves.toBe(false)
    chromeStub.scripting.executeScript.mockResolvedValueOnce([{ result: true }])
    await expect(api.cancelPick(2)).resolves.toBe(true)
  })

  it("reads where the page is scrolled once it has painted", async () => {
    const chromeStub = stub()
    const view = { scrollX: 0, scrollY: 40, width: 1280, height: 800 }
    chromeStub.scripting.executeScript.mockResolvedValueOnce([{ result: view }])
    await expect(createChromeBrowserApi().readPageView(3)).resolves.toEqual(view)
    expect(calls(chromeStub)[0]?.world).toBeUndefined()
    chromeStub.scripting.executeScript.mockResolvedValueOnce([])
    await expect(createChromeBrowserApi().readPageView(3)).rejects.toThrow()
  })

  it("reads the visit's performance in the main world", async () => {
    const chromeStub = stub()
    const read = { navigation: { type: "navigate" } }
    chromeStub.scripting.executeScript.mockResolvedValueOnce([{ result: read }])
    await expect(createChromeBrowserApi().readPerformance(8)).resolves.toEqual(read)
    expect(calls(chromeStub)[0]).toMatchObject({ target: { tabId: 8 }, world: "MAIN" })
    chromeStub.scripting.executeScript.mockResolvedValueOnce([])
    await expect(createChromeBrowserApi().readPerformance(8)).rejects.toThrow()
  })

  it("reads the stack in the main world, where frameworks announce themselves", async () => {
    const chromeStub = stub()
    const stack = { entries: [{ name: "React", category: "framework" }], development: true }
    chromeStub.scripting.executeScript.mockResolvedValueOnce([{ result: stack }])
    await expect(createChromeBrowserApi().detectStack(7)).resolves.toEqual(stack)
    expect(calls(chromeStub)[0]).toMatchObject({ target: { tabId: 7 }, world: "MAIN" })
    expect(calls(chromeStub)[0]?.files).toBeUndefined()
    chromeStub.scripting.executeScript.mockResolvedValueOnce([])
    await expect(createChromeBrowserApi().detectStack(7)).rejects.toThrow()
  })

  it("installs the recorder in the main world, without the agent's dialog handling", async () => {
    const chromeStub = stub()
    chromeStub.scripting.executeScript.mockResolvedValue([{ result: true }])
    const api = createChromeBrowserApi()
    await api.startDevRecording(5)
    expect(calls(chromeStub)[0]).toEqual({
      target: { tabId: 5 },
      world: "MAIN",
      files: ["/dev-hooks.js"],
    })
    await expect(api.isDevRecording(5)).resolves.toBe(true)
    expect(calls(chromeStub)[1]?.world).toBe("MAIN")
  })

  it("reports edits that found no element, and refuses an overlay the page did not take", async () => {
    const chromeStub = stub()
    const api = createChromeBrowserApi()
    chromeStub.scripting.executeScript.mockResolvedValueOnce([{ result: false }])
    await expect(api.previewElementEdits(5, "e1", { styles: { gap: "4px" } })).resolves.toBe(false)
    expect(calls(chromeStub)[0]?.args).toEqual(["e1", { styles: { gap: "4px" } }])
    chromeStub.scripting.executeScript.mockResolvedValueOnce([{ result: false }])
    await expect(api.setDesignOverlay(5, null)).rejects.toThrow()
  })

  it("makes the page editable through the picker, and reads the changes back", async () => {
    const chromeStub = stub()
    const api = createChromeBrowserApi()
    chromeStub.scripting.executeScript
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ result: true }])
    await expect(api.editPageText(5, "Edit")).resolves.toBe(true)
    expect(calls(chromeStub)[0]).toEqual({ target: { tabId: 5 }, files: ["/element-picker.js"] })
    expect(calls(chromeStub)[1]?.args).toEqual(["Edit"])
    const changes = [{ label: "h1", before: "a", after: "b" }]
    chromeStub.scripting.executeScript.mockResolvedValueOnce([{ result: changes }])
    await expect(api.stopEditingPageText(5, true)).resolves.toEqual(changes)
    expect(calls(chromeStub)[2]?.args).toEqual([true])
    chromeStub.scripting.executeScript.mockResolvedValueOnce([])
    await expect(api.stopEditingPageText(5, false)).resolves.toEqual([])
  })

  it("reads SEO in the isolated world, after injecting the picker", async () => {
    const chromeStub = stub()
    const seo = { title: "T", counts: {}, issues: [] }
    chromeStub.scripting.executeScript
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ result: seo }])
    await expect(createChromeBrowserApi().readSeo(6)).resolves.toEqual(seo)
    expect(calls(chromeStub)[0]).toEqual({ target: { tabId: 6 }, files: ["/element-picker.js"] })
    expect(calls(chromeStub)[1]?.world).toBeUndefined()
  })

  it("checks the layout in the isolated world, after injecting the picker", async () => {
    const chromeStub = stub()
    const layout = { viewport: { width: 390, height: 844 }, pageWidth: 390, issues: [] }
    chromeStub.scripting.executeScript
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ result: layout }])
    await expect(createChromeBrowserApi().checkLayout(6)).resolves.toEqual(layout)
    expect(calls(chromeStub)[0]).toEqual({ target: { tabId: 6 }, files: ["/element-picker.js"] })
    expect(calls(chromeStub)[1]?.world).toBeUndefined()
  })

  it("sizes a viewport window by what the tab actually got", async () => {
    const chromeStub = stub() as ChromeStub & {
      windows: { create: jest.Mock; update: jest.Mock }
    }
    chromeStub.windows = {
      create: jest.fn(async () => ({ id: 9, tabs: [{ id: 11 }] })),
      update: jest.fn(async () => undefined),
    }
    chromeStub.tabs.get.mockResolvedValueOnce({ id: 11, width: 374, height: 780 })
    await createChromeBrowserApi().openViewport("https://example.com/x", {
      width: 390,
      height: 844,
    })
    expect(chromeStub.windows.create).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://example.com/x",
        type: "popup",
        width: 390,
        height: 844,
      })
    )
    expect(chromeStub.windows.update).toHaveBeenCalledWith(9, { width: 406, height: 908 })
  })
})
