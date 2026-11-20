import {
  CompanionApiError,
  type BrowserContextSubmissionStatusV1,
  type BrowserContextSubmissionSummaryV1,
  type BrowserSubmissionStatus,
} from "@cognia/companion-client"

import type { AgentBrowser } from "../agent/executor"
import { pageAct, pageActingBar, pageOverlayAbi } from "../agent/page-functions"
import { PENDING_SITE_QUESTIONS_KEY } from "../agent/site-permissions"
import { AGENT_SESSIONS_KEY } from "../agent/sessions"
import type { SocketLike } from "../agent/socket-client"
import { memoryStorageArea } from "../agent/storage-area"
import { SESSION_KEYS, STORAGE_KEYS } from "../browser-api"
import type { HostClient } from "../client"
import { STATUS_SNAPSHOT_KEY, type StatusSnapshot } from "./status-tracker"
import { STATUS_ALARM, createWorker } from "./worker"
import { fakeNetworkRulesBrowser } from "../network-rules/fake-browser"

const pairing = {
  baseUrl: "http://127.0.0.1:27891",
  tenantId: "t",
  deviceId: "d",
  extensionOrigin: "chrome-extension://x",
  pairedAt: 1,
}

function item(
  submissionId: string,
  status: BrowserSubmissionStatus,
  extra: Partial<BrowserContextSubmissionSummaryV1> = {}
): BrowserContextSubmissionSummaryV1 {
  return {
    submissionId,
    title: `Task ${submissionId}`,
    sourceHost: "example.com",
    captureMode: "metadata",
    status,
    submittedAt: 1,
    updatedAt: 1,
    deepLink: "",
    ...extra,
  }
}

const flush = async () => {
  for (let index = 0; index < 5; index++) await new Promise((resolve) => setTimeout(resolve, 0))
}

describe("worker-owned permission mutations", () => {
  it("preserves both decisions when panel actions arrive together", async () => {
    const h = harness()
    await h.session.set(PENDING_SITE_QUESTIONS_KEY, [
      {
        id: "qa",
        session: "s",
        origin: "https://a.test",
        operation: "act",
        askedAt: 5_000,
      },
      {
        id: "qb",
        session: "s",
        origin: "https://b.test",
        operation: "act",
        askedAt: 5_000,
      },
    ])
    await Promise.all([
      h.worker.onPermissionMessage(
        {
          kind: "cognia-agent-permission",
          action: "answer",
          questionId: "qa",
          answer: "always",
        },
        "chrome-extension://x/sidepanel.html"
      ),
      h.worker.onPermissionMessage(
        {
          kind: "cognia-agent-permission",
          action: "answer",
          questionId: "qb",
          answer: "never",
        },
        "chrome-extension://x/sidepanel.html"
      ),
    ])
    expect(await h.worker.runtime.permissions.decisions()).toEqual({
      "https://a.test": "always",
      "https://b.test": "never",
    })
  })
  it("asks Cognia again to stop a paused conversation, from the panel only", async () => {
    const h = harness()
    await h.worker.runtime.sessions.updateSession("s1", 5_000, (s) => ({
      ...s,
      tabIds: [5],
      takeover: true,
    }))
    const message = {
      kind: "cognia-agent-permission",
      action: "stop-host-task",
      session: "s1",
    } as const
    await expect(h.worker.onPermissionMessage(message, "https://a.test/")).resolves.toBe(false)
    expect((await h.worker.runtime.sessions.get("s1"))?.hostStop).toBeUndefined()
    // Not paired: no Host to ask, so the answer kept is that nothing confirmed it.
    await expect(
      h.worker.onPermissionMessage(message, "chrome-extension://x/sidepanel.html")
    ).resolves.toBe(true)
    expect((await h.worker.runtime.sessions.get("s1"))?.hostStop?.outcome).toBe("failed")
  })

  it("rejects web content and uses the same session queue as Takeover", async () => {
    const h = harness()
    await h.worker.runtime.sessions.updateSession("s1", 5_000, (s) => ({
      ...s,
      tabIds: [5],
    }))
    await h.session.set(PENDING_SITE_QUESTIONS_KEY, [
      {
        id: "q1",
        session: "s1",
        origin: "https://a.test",
        operation: "act",
        askedAt: 5_000,
      },
    ])
    const message = {
      kind: "cognia-agent-permission",
      action: "answer",
      questionId: "q1",
      answer: "once",
    } as const
    for (const url of [undefined, "https://a.test", "chrome-extension://other/sidepanel.html"]) {
      await expect(h.worker.onPermissionMessage(message, url)).resolves.toBe(false)
    }
    let release!: () => void
    let entered!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const waiting = new Promise<void>((resolve) => {
      entered = resolve
    })
    const set = h.session.set.bind(h.session)
    jest.spyOn(h.session, "set").mockImplementationOnce(async (key, value) => {
      expect(key).toBe(AGENT_SESSIONS_KEY)
      entered()
      await held
      await set(key, value)
    })
    const answer = h.worker.onPermissionMessage(message, "chrome-extension://x/sidepanel.html")
    await waiting
    let paused = false
    const takeover = h.worker.runtime
      .control({ kind: "cognia-agent-control", session: "s1", action: "takeover" }, 5)
      .then(() => {
        paused = true
      })
    await flush()
    expect(paused).toBe(false)
    release()
    await Promise.all([answer, takeover])
    expect(await h.worker.runtime.sessions.get("s1")).toMatchObject({
      takeover: true,
      onceOrigins: ["https://a.test"],
    })
  })
})

function harness(
  options: {
    paired?: boolean
    canNotify?: boolean
    browser?: AgentBrowser
    /** Storage of a worker that ran before: a restart keeps both areas. */
    local?: ReturnType<typeof memoryStorageArea>
    session?: ReturnType<typeof memoryStorageArea>
  } = {}
) {
  const local = options.local ?? memoryStorageArea()
  const session = options.session ?? memoryStorageArea()
  let items: BrowserContextSubmissionSummaryV1[] = []
  let listFails = false
  const pages: Record<
    string,
    { items: BrowserContextSubmissionSummaryV1[]; nextPageToken?: string }
  > = {}
  /** What `get` answers per id: a status, or what it throws. Unknown ids are refused. */
  const details: Record<string, BrowserSubmissionStatus | Error> = {}
  /** What `cancel` throws per id, when it does not succeed. */
  const cancelErrors: Record<string, Error> = {}
  const bars: unknown[] = []
  const cancelled: string[] = []
  const badges: { text: string; tone: string }[] = []
  const notifications: { id: string; title: string; message: string }[] = []
  const alarms = new Set<string>()
  const sockets: string[] = []
  const wires: (SocketLike & { sent: unknown[] })[] = []
  const client = {
    list: jest.fn(async (options: { pageToken?: string } = {}) => {
      if (listFails) throw new Error("offline")
      if (options.pageToken) return pages[options.pageToken] ?? { items: [] }
      return pages.first ?? { items }
    }),
    get: jest.fn(async (id: string): Promise<BrowserContextSubmissionStatusV1> => {
      const detail = details[id]
      if (detail instanceof Error) throw detail
      if (!detail) throw new CompanionApiError("no such submission", "not_found", 404)
      return { submissionId: id, status: detail, updatedAt: 2, deepLink: "" }
    }),
    cancel: jest.fn(async (id: string) => {
      const error = cancelErrors[id]
      if (error) throw error
      cancelled.push(id)
      return {}
    }),
    socketTicket: jest.fn(async () => ({ ticket: "tk", expiresIn: 30 })),
    invalidate: jest.fn(),
  } as unknown as HostClient
  if (options.paired !== false) void local.set(STORAGE_KEYS.pairing, pairing)
  const worker = createWorker({
    local,
    session,
    loadClient: async () => client,
    browser:
      options.browser ??
      ({
        message: (key: string) => key,
        run: async (_tab: number, _world: string, fn: unknown, args: unknown[]) => {
          if (fn === pageActingBar) bars.push(args[0])
          return true
        },
      } as unknown as AgentBrowser),
    networkRulesBrowser: fakeNetworkRulesBrowser().browser,
    recordingBrowser: {
      tabInfo: async () => null,
      injectRecorder: async () => undefined,
      removeRecorder: async () => undefined,
      hasOrigin: async () => true,
      setRecorderScripts: async () => undefined,
    },
    createSocket: (url) => {
      sockets.push(url)
      const wire = {
        readyState: 1,
        sent: [] as unknown[],
        send: (data: string) => {
          wire.sent.push(JSON.parse(data))
        },
        close: () => undefined,
        onopen: null,
        onmessage: null,
        onclose: null,
        onerror: null,
      } satisfies SocketLike & { sent: unknown[] }
      wires.push(wire)
      return wire
    },
    setBadge: async (badge) => {
      badges.push(badge)
    },
    canNotify: async () => options.canNotify ?? true,
    notify: async (id, title, message) => {
      notifications.push({ id, title, message })
    },
    ensureAlarm: async (name) => {
      alarms.add(name)
    },
    clearAlarm: async (name) => {
      alarms.delete(name)
    },
    extensionVersion: "1.0.0",
    panelUrl: "chrome-extension://x/sidepanel.html",
    message: (key, subs) => (subs ? `${key}(${subs.join(",")})` : key),
    now: () => 5_000,
    random: () => 0.5,
    newId: () => "q1",
    sleep: async () => undefined,
    setTimeout: () => 0,
    clearTimeout: () => undefined,
    setInterval: () => 0,
    clearInterval: () => undefined,
  })
  return {
    worker,
    local,
    session,
    client,
    cancelled,
    badges,
    notifications,
    alarms,
    sockets,
    wires,
    pages,
    details,
    cancelErrors,
    bars,
    snapshot: async () => (await session.get<StatusSnapshot>(STATUS_SNAPSHOT_KEY)) ?? null,
    setItems: (next: BrowserContextSubmissionSummaryV1[]) => {
      items = next
    },
    failList: (fail: boolean) => {
      listFails = fail
    },
  }
}

/** `count` finished tasks, newer than anything a test started with. */
function finished(count: number, prefix = "new"): BrowserContextSubmissionSummaryV1[] {
  return Array.from({ length: count }, (_, index) => item(`${prefix}-${index}`, "completed"))
}

describe("tasks past the newest page", () => {
  it("follows a running task pushed off the first page to its end, announcing it once", async () => {
    const h = harness()
    await h.local.set(STORAGE_KEYS.preferences, { notifications: true })
    h.setItems([item("a", "running", { title: "Long task", sessionId: "s1" })])
    await h.worker.start()

    // Fifty newer tasks finished; "a" is on the second page, still running.
    h.setItems(finished(50))
    h.details.a = "running"
    await h.worker.onAlarm(STATUS_ALARM)
    expect(h.client.get).toHaveBeenCalledWith("a")
    expect(h.badges.at(-1)).toEqual({ text: "1", tone: "busy" })
    expect(h.alarms.has(STATUS_ALARM)).toBe(true)
    expect((await h.snapshot())?.tracked).toEqual({
      a: { label: "Long task", sessionId: "s1" },
    })

    h.details.a = "completed"
    await h.worker.onAlarm(STATUS_ALARM)
    expect(h.notifications).toEqual([
      { id: "cognia:submission:a", title: "notifyCompleted", message: "Long task" },
    ])
    expect(h.badges.at(-1)).toEqual({ text: "", tone: "none" })
    expect(h.alarms.has(STATUS_ALARM)).toBe(false)

    // Finished is final: it is not asked about again, nor announced again.
    jest.mocked(h.client.get).mockClear()
    await h.worker.onAlarm(STATUS_ALARM)
    expect(h.client.get).not.toHaveBeenCalled()
    expect(h.notifications).toHaveLength(1)
  })

  it("stops following a task the Host refuses to answer for", async () => {
    const h = harness()
    h.setItems([item("a", "running")])
    await h.worker.start()
    h.setItems(finished(50))
    await h.worker.onAlarm(STATUS_ALARM)
    expect(h.client.get).toHaveBeenCalledWith("a")
    expect(h.badges.at(-1)).toEqual({ text: "", tone: "none" })
    expect(h.alarms.has(STATUS_ALARM)).toBe(false)
    expect((await h.snapshot())?.statuses).not.toHaveProperty("a")
  })

  it("keeps a followed task as last seen while the Host cannot be asked about it", async () => {
    const h = harness()
    h.setItems([item("a", "needs_input")])
    await h.worker.start()
    h.setItems(finished(50))
    h.details.a = new TypeError("Failed to fetch")
    await h.worker.onAlarm(STATUS_ALARM)
    expect(h.badges.at(-1)).toEqual({ text: "1", tone: "attention" })
    expect(h.alarms.has(STATUS_ALARM)).toBe(true)
    expect((await h.snapshot())?.statuses.a).toBe("needs_input")
  })

  it("follows at most a bounded number of tasks per read", async () => {
    const h = harness()
    h.setItems(Array.from({ length: 30 }, (_, index) => item(`r-${index}`, "running")))
    await h.worker.start()
    h.setItems(finished(50))
    for (let index = 0; index < 30; index++) h.details[`r-${index}`] = "running"
    await h.worker.onAlarm(STATUS_ALARM)
    expect(h.client.get).toHaveBeenCalledTimes(20)
    expect(h.badges.at(-1)).toEqual({ text: "20", tone: "busy" })
  })

  it("keeps following after the worker restarts", async () => {
    const before = harness()
    before.setItems([item("a", "running")])
    await before.worker.start()

    const after = harness({ local: before.local, session: before.session })
    after.setItems(finished(50))
    after.details.a = "running"
    await after.worker.start()
    expect(after.client.get).toHaveBeenCalledWith("a")
    expect(after.badges.at(-1)).toEqual({ text: "1", tone: "busy" })
    expect(after.alarms.has(STATUS_ALARM)).toBe(true)
  })

  it("announces what finished while the worker slept", async () => {
    const before = harness()
    await before.local.set(STORAGE_KEYS.preferences, { notifications: true })
    before.setItems([item("a", "running")])
    await before.worker.start()

    const after = harness({ local: before.local, session: before.session })
    after.setItems([item("a", "completed")])
    await after.worker.start()
    expect(after.notifications).toEqual([
      { id: "cognia:submission:a", title: "notifyCompleted", message: "Task a" },
    ])
  })
})

describe("createWorker", () => {
  it.each(["revoke", "disconnect", "disable"])(
    "cancels an action awaiting site permission on %s",
    async (event) => {
      const effects: unknown[] = []
      const browser = {
        message: (key: string) => key,
        getTab: async () => ({
          id: 1,
          windowId: 1,
          url: "https://a.test/",
          status: "complete",
        }),
        group: async () => 1,
        styleGroup: async () => undefined,
        injectFile: async () => undefined,
        run: async (_tab: number, _world: string, fn: unknown) => {
          if (fn === pageOverlayAbi) return 1
          if (fn === pageAct) effects.push("click")
          return { ok: true }
        },
      } as unknown as AgentBrowser
      const h = harness({ browser })
      await h.local.set(STORAGE_KEYS.preferences, { agentMode: true })
      await h.worker.start()
      await flush()
      const wire = h.wires[0]!
      wire.onopen?.({})
      const receive = (frame: unknown) => wire.onmessage?.({ data: JSON.stringify(frame) })
      receive({
        t: "welcome",
        v: 1,
        agentProfile: "agent-safe-v1",
        connectionId: "c",
        driveAllowed: true,
      })
      receive({
        t: "op",
        id: "click",
        op: "act",
        args: { session: "s", startTabId: 1, ref: "r1", action: "click" },
        deadlineMs: 30_000,
      })
      await flush()
      const [question] = await h.worker.runtime.permissions.questions()
      expect(question).toBeDefined()
      if (event === "revoke") receive({ t: "drive", allowed: false })
      else if (event === "disconnect") wire.onclose?.({ code: 1008, reason: "revoked" })
      else
        await h.worker.onLocalChange(STORAGE_KEYS.preferences, {
          agentMode: false,
        })
      await flush()
      await h.worker.runtime.permissions.answer(question!.id, "once")
      await flush()
      expect(effects).toEqual([])
      expect(await h.worker.runtime.permissions.questions()).toEqual([])
      expect(wire.sent).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ t: "result", id: "click", ok: true })])
      )
      h.worker.socket.stop()
    }
  )

  it("does nothing on the network while unpaired, and clears the badge", async () => {
    const h = harness({ paired: false })
    await h.worker.start()
    expect(h.client.list).not.toHaveBeenCalled()
    expect(h.badges.at(-1)).toEqual({ text: "", tone: "none" })
    expect(h.alarms.size).toBe(0)
    expect(h.sockets).toEqual([])
  })

  it("polls while work is running with the panel closed, and opens the socket for hints", async () => {
    const h = harness()
    h.setItems([item("a", "running"), item("b", "needs_input")])
    await h.worker.start()
    await flush()
    expect(h.badges.at(-1)).toEqual({ text: "2", tone: "attention" })
    expect(h.alarms.has(STATUS_ALARM)).toBe(true)
    expect(h.sockets).toEqual(["ws://127.0.0.1:27891/ws/browser-companion?ticket=tk"])

    h.setItems([item("a", "completed"), item("b", "completed")])
    await h.worker.onAlarm(STATUS_ALARM)
    expect(h.alarms.has(STATUS_ALARM)).toBe(false)
    expect(h.badges.at(-1)).toEqual({ text: "", tone: "none" })
  })

  it("notifies transitions only when allowed and the panel is closed", async () => {
    const h = harness()
    await h.local.set(STORAGE_KEYS.preferences, { notifications: true })
    h.setItems([item("a", "running")])
    await h.worker.start()
    h.setItems([item("a", "completed")])
    await h.worker.onAlarm(STATUS_ALARM)
    expect(h.notifications).toEqual([
      {
        id: "cognia:submission:a",
        title: "notifyCompleted",
        message: "Task a",
      },
    ])

    h.worker.panelOpened()
    h.setItems([item("a", "completed"), item("b", "needs_input")])
    await h.worker.refreshNow()
    expect(h.notifications).toHaveLength(1)
  })

  it("stays quiet without the notifications preference or permission", async () => {
    const off = harness()
    off.setItems([item("a", "running")])
    await off.worker.start()
    off.setItems([item("a", "failed")])
    await off.worker.onAlarm(STATUS_ALARM)
    expect(off.notifications).toEqual([])

    const denied = harness({ canNotify: false })
    await denied.local.set(STORAGE_KEYS.preferences, { notifications: true })
    denied.setItems([item("a", "running")])
    await denied.worker.start()
    denied.setItems([item("a", "failed")])
    await denied.worker.onAlarm(STATUS_ALARM)
    expect(denied.notifications).toEqual([])
  })

  it("keeps the alarm and the badge when the Host is unreachable", async () => {
    const h = harness()
    h.setItems([item("a", "running")])
    await h.worker.start()
    const badges = h.badges.length
    h.failList(true)
    await h.worker.onAlarm(STATUS_ALARM)
    expect(h.alarms.has(STATUS_ALARM)).toBe(true)
    expect(h.badges).toHaveLength(badges)
  })

  it("leaves polling to an open panel and resumes it when the panel closes", async () => {
    const h = harness()
    h.setItems([item("a", "running")])
    await h.worker.start()
    h.worker.panelOpened()
    await flush()
    expect(h.alarms.has(STATUS_ALARM)).toBe(false)
    h.worker.panelClosed()
    await flush()
    expect(h.alarms.has(STATUS_ALARM)).toBe(true)
  })

  it("shows ! for a waiting site decision", async () => {
    const h = harness()
    await h.worker.start()
    await h.session.set(PENDING_SITE_QUESTIONS_KEY, [
      {
        id: "q",
        session: "s",
        origin: "https://a.test",
        operation: "act",
        askedAt: 1,
      },
    ])
    await h.worker.onQuestionsChange()
    expect(h.badges.at(-1)).toEqual({ text: "!", tone: "attention" })
  })

  it("keeps the socket while agent mode is on, and drops it when nothing wants it", async () => {
    const h = harness()
    await h.worker.start()
    await flush()
    expect(h.sockets).toHaveLength(0)
    await h.worker.onLocalChange(STORAGE_KEYS.preferences, { agentMode: true })
    await flush()
    expect(h.sockets).toHaveLength(1)
    await h.worker.onLocalChange(STORAGE_KEYS.preferences, {
      agentMode: false,
    })
    expect(await h.session.get(SESSION_KEYS.socketState)).toEqual({
      kind: "stopped",
    })
  })

  it("forgets the old Host when the pairing changes", async () => {
    const h = harness()
    await h.worker.start()
    await h.session.set(STATUS_SNAPSHOT_KEY, {
      primed: true,
      statuses: { a: "running" },
    })
    await h.local.set(STORAGE_KEYS.pairing, { ...pairing, deviceId: "d2" })
    await h.worker.onLocalChange(STORAGE_KEYS.pairing, null)
    expect(h.client.invalidate).toHaveBeenCalled()
    expect(await h.session.get(STATUS_SNAPSHOT_KEY)).toEqual({
      primed: true,
      statuses: {},
      owner: "http://127.0.0.1:27891#d2",
    })
    await h.local.remove(STORAGE_KEYS.pairing)
    await h.worker.onLocalChange(STORAGE_KEYS.pairing, null)
    expect(h.worker.state().paired).toBe(false)
  })

  it("cancels the conversation's live task when the bar's Stop is pressed, searching a second page", async () => {
    const h = harness()
    h.pages.first = {
      items: [item("old", "completed", { sessionId: "s1" })],
      nextPageToken: "50",
    }
    h.pages["50"] = { items: [item("live", "running", { sessionId: "s1" })] }
    await h.worker.start()
    await h.worker.runtime.sessions.updateSession("s1", 5_000, (s) => ({
      ...s,
      tabIds: [3],
    }))
    await h.worker.runtime.control(
      { kind: "cognia-agent-control", session: "s1", action: "stop" },
      3
    )
    expect(h.cancelled).toEqual(["live"])
  })

  it("asks for the conversation's live task first among the ones it already follows", async () => {
    const h = harness()
    h.setItems([item("live", "running", { sessionId: "s1" })])
    await h.worker.start()
    h.setItems(finished(50))
    h.details.live = "running"
    await h.worker.onAlarm(STATUS_ALARM)
    await h.worker.runtime.sessions.updateSession("s1", 5_000, (s) => ({ ...s, tabIds: [3] }))
    const listed = jest.mocked(h.client.list).mock.calls.length
    await h.worker.runtime.control(
      { kind: "cognia-agent-control", session: "s1", action: "stop" },
      3
    )
    expect(h.cancelled).toEqual(["live"])
    // Found without paging through the list for it.
    expect(jest.mocked(h.client.list).mock.calls.slice(listed)).toEqual(
      expect.not.arrayContaining([[expect.objectContaining({ pageToken: expect.anything() })]])
    )
    expect(h.bars.at(-1)).not.toHaveProperty("notice")
  })

  it("pages past the second page to the conversation's task", async () => {
    const h = harness()
    h.pages.first = { items: finished(50), nextPageToken: "p2" }
    h.pages.p2 = { items: finished(50, "older"), nextPageToken: "p3" }
    h.pages.p3 = { items: [item("live", "running", { sessionId: "s1" })] }
    await h.worker.start()
    await h.worker.runtime.sessions.updateSession("s1", 5_000, (s) => ({ ...s, tabIds: [3] }))
    await h.worker.runtime.control(
      { kind: "cognia-agent-control", session: "s1", action: "stop" },
      3
    )
    expect(h.cancelled).toEqual(["live"])
    expect(h.bars.at(-1)).toEqual(expect.objectContaining({ takenOver: true }))
    expect(h.bars.at(-1)).not.toHaveProperty("notice")
  })

  it("looks further when a followed task finished since, and says nothing when none is left", async () => {
    const h = harness()
    h.setItems([item("done", "running", { sessionId: "s1" })])
    await h.worker.start()
    await h.worker.runtime.sessions.updateSession("s1", 5_000, (s) => ({ ...s, tabIds: [3] }))
    h.cancelErrors.done = new CompanionApiError("already finished", "not_cancellable", 409)
    h.setItems([item("done", "completed", { sessionId: "s1" })])
    await h.worker.runtime.control(
      { kind: "cognia-agent-control", session: "s1", action: "stop" },
      3
    )
    expect(h.cancelled).toEqual([])
    expect(h.bars.at(-1)).not.toHaveProperty("notice")
    expect(await h.worker.runtime.sessions.get("s1")).toMatchObject({ takeover: true })
  })

  it.each([
    ["the list cannot be read", (h: ReturnType<typeof harness>) => h.failList(true)],
    [
      "the cancel does not reach the Host",
      (h: ReturnType<typeof harness>) => {
        h.cancelErrors.live = new TypeError("Failed to fetch")
      },
    ],
    [
      "another device is driving it",
      (h: ReturnType<typeof harness>) => {
        h.cancelErrors.live = new CompanionApiError("driven", "session_driven_elsewhere", 409)
      },
    ],
  ])("pauses the browser but says Cognia did not confirm Stop when %s", async (_case, fail) => {
    const h = harness()
    h.pages.first = { items: finished(50), nextPageToken: "p2" }
    h.pages.p2 = { items: [item("live", "running", { sessionId: "s1" })] }
    await h.worker.start()
    await h.worker.runtime.sessions.updateSession("s1", 5_000, (s) => ({ ...s, tabIds: [3] }))
    fail(h)
    await expect(
      h.worker.runtime.control({ kind: "cognia-agent-control", session: "s1", action: "stop" }, 3)
    ).resolves.toBe(true)
    expect(h.cancelled).toEqual([])
    expect(await h.worker.runtime.sessions.get("s1")).toMatchObject({ takeover: true })
    expect(h.bars.at(-1)).toEqual(
      expect.objectContaining({ takenOver: true, notice: "agentBarStopUnconfirmed" })
    )
  })

  it("reads notification ids back", () => {
    const h = harness()
    expect(h.worker.notificationTarget("cognia:submission:a:b")).toEqual({
      kind: "submission",
      id: "a:b",
    })
    expect(h.worker.notificationTarget("cognia:site:q1")).toEqual({
      kind: "site",
      id: "q1",
    })
    expect(h.worker.notificationTarget("other")).toBeNull()
    expect(h.worker.notificationTarget("cognia:weird:x")).toBeNull()
  })
})
