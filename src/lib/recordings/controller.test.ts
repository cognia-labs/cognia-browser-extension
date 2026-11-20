import { memoryStorageArea } from "../agent/storage-area"

import {
  STOP_TAIL_MS,
  createRecordings,
  isRecordingCommandMessage,
  type RecordingBrowser,
} from "./controller"
import { ACTIVE_RECORDINGS_KEY, RECORDINGS_KEY } from "./model"

function harness(
  tabs: Record<number, { url: string; title: string }> = {},
  granted: (pattern: string) => boolean = () => true
) {
  const scripts: string[][] = []
  const order: string[] = []
  /** What each tab's recorder still holds, handed back when it is taken out. */
  const tails: Record<number, unknown[]> = {}
  const local = memoryStorageArea()
  const session = memoryStorageArea()
  const injected: [number, boolean][] = []
  const removed: number[] = []
  const browser: RecordingBrowser = {
    tabInfo: async (tabId) => tabs[tabId] ?? null,
    injectRecorder: async (tabId, { synthetic }) => {
      order.push("inject")
      injected.push([tabId, synthetic])
    },
    removeRecorder: async (tabId) => {
      removed.push(tabId)
      // Still recording while the recorder hands back what it had not sent.
      order.push(
        `remove:${String(await session.get<Record<string, string>>(ACTIVE_RECORDINGS_KEY).then((tabs) => tabs?.[String(tabId)] ?? "none"))}`
      )
      const tail = tails[tabId] ?? []
      delete tails[tabId]
      return tail
    },
    hasOrigin: async (pattern) => granted(pattern),
    setRecorderScripts: async (matches) => {
      order.push("register")
      scripts.push(matches)
    },
  }
  let clock = 100
  let next = 0
  const recordings = createRecordings({
    local,
    session,
    browser,
    newId: () => `rec-${++next}`,
    now: () => clock++,
  })
  return { recordings, local, session, injected, removed, scripts, tabs, tails, order }
}

const SHOP = { url: "https://shop.test/", title: "Shop" }
const EMAIL = { locators: ['getByLabel("Email")'], role: "textbox", name: "Email" }
const click = (at: number) => ({
  action: "click",
  target: { locators: ['getByRole("button", { name: "Buy", exact: true })'] },
  at,
})

describe("createRecordings", () => {
  it("records a tab's steps until it stops, and only that tab's", async () => {
    const h = harness({ 5: SHOP, 6: SHOP })
    const started = await h.recordings.start(5, { byAgent: false })
    expect(started).toMatchObject({ id: "rec-1", title: "Shop", stepCount: 0, byAgent: false })
    expect(h.injected).toEqual([[5, false]])
    expect(await h.recordings.start(5, { byAgent: false })).toMatchObject({ id: "rec-1" })
    expect(await h.recordings.step(5, { action: "navigate", url: SHOP.url, at: 1 })).toBe(true)
    expect(await h.recordings.step(5, click(2))).toBe(true)
    expect(await h.recordings.step(6, click(3))).toBe(false)
    expect(await h.recordings.step(5, { action: "click", target: { locators: ["evil()"] } })).toBe(
      false
    )
    await h.recordings.tabLoaded(5)
    await h.recordings.tabLoaded(6)
    expect(h.injected).toEqual([
      [5, false],
      [5, false],
    ])
    const stopped = await h.recordings.stopTab(5)
    expect(stopped).toMatchObject({ id: "rec-1", stepCount: 2, stoppedAt: expect.any(Number) })
    expect(h.removed).toEqual([5])
    expect(await h.session.get(ACTIVE_RECORDINGS_KEY)).toEqual({})
    expect(await h.recordings.step(5, click(4))).toBe(false)
  })

  it("refuses a page that is not on the web", async () => {
    const h = harness({ 5: { url: "chrome://settings", title: "" } })
    await expect(h.recordings.start(5, { byAgent: false })).rejects.toMatchObject({
      code: "browser_page_restricted",
    })
  })

  it("keeps the person's recording private until they share it", async () => {
    const h = harness({ 5: SHOP, 6: SHOP })
    expect(await h.recordings.start(5, { byAgent: false })).toMatchObject({ shared: false })
    expect(await h.recordings.start(6, { byAgent: true, sessionId: "s1" })).toMatchObject({
      shared: true,
    })
    await h.recordings.step(5, { action: "fill", target: EMAIL, value: "me@shop.test", at: 1 })
    await h.recordings.stopTab(5)
    expect((await h.recordings.listShared("s1")).map((entry) => entry.id)).toEqual(["rec-2"])
    await expect(h.recordings.getShared("rec-1", "steps", "s1")).rejects.toMatchObject({
      code: "browser_recording_not_found",
    })
    await h.recordings.command({ op: "share", recordingId: "rec-1", shared: true })
    const [kept] = (await h.local.get<{ id: string; sharedAt?: number }[]>(RECORDINGS_KEY))!.filter(
      (entry) => entry.id === "rec-1"
    )
    expect(kept!.sharedAt).toEqual(expect.any(Number))
    expect((await h.recordings.listShared("s1")).map((entry) => entry.id).sort()).toEqual([
      "rec-1",
      "rec-2",
    ])
    await h.recordings.command({ op: "share", recordingId: "rec-1", shared: false })
    const [unshared] = (await h.local.get<{ id: string }[]>(RECORDINGS_KEY))!.filter(
      (entry) => entry.id === "rec-1"
    )
    expect(unshared).not.toHaveProperty("sharedAt")
  })

  it("registers the recorder for the site before putting it in the tab", async () => {
    const h = harness({ 5: SHOP })
    await h.recordings.start(5, { byAgent: false })
    expect(h.order).toEqual(["register", "inject"])
  })

  it("keeps the typing a page had not sent when the panel stops it, once", async () => {
    const h = harness({ 5: SHOP })
    await h.recordings.start(5, { byAgent: false })
    await h.recordings.step(5, { action: "navigate", url: SHOP.url, at: 1 })
    h.tails[5] = [
      { action: "fill", target: EMAIL, value: "me@shop.test", at: 2 },
      { action: "click", target: { locators: ["evil()"] }, at: 3 },
    ]
    const stopped = await h.recordings.command({ op: "stop", recordingId: "rec-1" })
    expect(stopped).toMatchObject({ stepCount: 2, stoppedAt: expect.any(Number) })
    // The recorder came out while the tab was still recording into rec-1.
    expect(h.order).toContain("remove:rec-1")
    const [recording] =
      (await h.local.get<{ steps: { action: string; value?: string }[] }[]>(RECORDINGS_KEY))!
    expect(recording!.steps.map((step) => [step.action, step.value])).toEqual([
      ["navigate", undefined],
      ["fill", "me@shop.test"],
    ])
    // Stopping again finds nothing left to add.
    await h.recordings.command({ op: "stop", recordingId: "rec-1" })
    expect((await h.local.get<{ steps: unknown[] }[]>(RECORDINGS_KEY))![0]!.steps).toHaveLength(2)
    expect(await h.recordings.step(5, click(4))).toBe(false)
  })

  it("does not wait forever for a page that will not answer", async () => {
    jest.useFakeTimers()
    try {
      const h = harness({ 5: SHOP })
      await h.recordings.start(5, { byAgent: false })
      // A page that hangs: the recorder never answers.
      const hung = createRecordings({
        local: h.local,
        session: h.session,
        browser: {
          tabInfo: async () => SHOP,
          injectRecorder: async () => undefined,
          removeRecorder: () => new Promise(() => undefined),
          hasOrigin: async () => true,
          setRecorderScripts: async () => undefined,
        },
        newId: () => "unused",
        now: () => 9,
      })
      const stopping = hung.stopTab(5)
      await jest.advanceTimersByTimeAsync(STOP_TAIL_MS)
      expect(await stopping).toMatchObject({ id: "rec-1", stoppedAt: expect.any(Number) })
    } finally {
      jest.useRealTimers()
    }
  })

  it("lets agents read only what is shared, with a generated test on request", async () => {
    const h = harness({ 5: SHOP })
    await h.recordings.start(5, { byAgent: false })
    await h.recordings.step(5, { action: "navigate", url: SHOP.url, at: 1 })
    await h.recordings.step(5, click(2))
    await h.recordings.stopTab(5)
    await h.recordings.command({ op: "share", recordingId: "rec-1", shared: true })
    expect(await h.recordings.listShared("s1")).toEqual([expect.objectContaining({ id: "rec-1" })])
    const got = await h.recordings.getShared("rec-1", "playwright", "s1")
    expect(got.recording.steps).toHaveLength(2)
    expect(got.playwright).toContain(
      'await page.getByRole("button", { name: "Buy", exact: true }).click()'
    )
    await h.recordings.command({ op: "share", recordingId: "rec-1", shared: false })
    expect(await h.recordings.listShared("s1")).toEqual([])
    await expect(h.recordings.getShared("rec-1", "steps", "s1")).rejects.toMatchObject({
      code: "browser_recording_not_found",
    })
  })

  it("shares with one conversation, and an agent's recording with its own only", async () => {
    const h = harness({ 5: SHOP, 6: SHOP })
    await h.recordings.start(5, { byAgent: false })
    await h.recordings.start(6, { byAgent: true, sessionId: "s1" })
    await h.recordings.stopTab(5)
    await h.recordings.stopTab(6)
    const ids = async (session: string) =>
      (await h.recordings.listShared(session)).map((entry) => entry.id).sort()
    // The agent's recording is for the conversation that made it.
    expect(await ids("s1")).toEqual(["rec-2"])
    expect(await ids("s2")).toEqual([])
    await expect(h.recordings.getShared("rec-2", "steps", "s2")).rejects.toMatchObject({
      code: "browser_recording_not_found",
    })

    // The person's, with one other conversation: that one reads it, no other.
    await h.recordings.command({
      op: "share",
      recordingId: "rec-1",
      shared: true,
      sessions: ["s2"],
    })
    expect(await ids("s2")).toEqual(["rec-1"])
    expect(await ids("s1")).toEqual(["rec-2"])
    // A conversation is never told who else a recording is shared with.
    expect(await h.recordings.getShared("rec-1", "steps", "s2")).not.toHaveProperty(
      "recording.sharedWith"
    )

    // Widened to every conversation, then the agent's too.
    await h.recordings.command({ op: "share", recordingId: "rec-1", shared: true })
    await h.recordings.command({ op: "share", recordingId: "rec-2", shared: true })
    expect(await ids("s3")).toEqual(["rec-1", "rec-2"])
    await h.recordings.command({ op: "share", recordingId: "rec-2", shared: false })
    expect(await ids("s1")).toEqual(["rec-1"])
  })

  it("stops what a conversation recorded when it ends, and keeps the person's", async () => {
    const h = harness({ 5: SHOP, 6: SHOP })
    await h.recordings.start(5, { byAgent: true, sessionId: "s1" })
    await h.recordings.start(6, { byAgent: false })
    expect(h.injected).toEqual([
      [5, true],
      [6, false],
    ])
    expect(await h.recordings.stopSession("s1")).toEqual([
      expect.objectContaining({ id: "rec-1", byAgent: true }),
    ])
    expect(await h.recordings.isRecording(6)).toBe(true)
    expect(await h.recordings.stopSession("s1")).toEqual([])
  })

  it("renames and removes from the panel, never one still recording", async () => {
    const h = harness({ 5: SHOP })
    await h.recordings.command({ op: "start", tabId: 5 })
    expect(await h.recordings.command({ op: "remove", recordingId: "rec-1" })).toBe(false)
    await h.recordings.command({ op: "rename", recordingId: "rec-1", title: " Checkout " })
    await h.recordings.command({ op: "stop", recordingId: "rec-1" })
    expect((await h.local.get<{ title: string }[]>(RECORDINGS_KEY))![0]!.title).toBe("Checkout")
    expect(await h.recordings.command({ op: "remove", recordingId: "rec-1" })).toBe(true)
    expect(await h.local.get(RECORDINGS_KEY)).toEqual([])
  })

  it("says a tab records only once the recorder is registered and in the page", async () => {
    const h = harness({ 5: SHOP })
    const set = h.session.set.bind(h.session)
    h.session.set = async (key, value) => {
      if (key === ACTIVE_RECORDINGS_KEY) h.order.push("publish")
      return set(key, value)
    }
    await h.recordings.start(5, { byAgent: false })
    // The panel learns of the recording from this key and offers Stop: by
    // then a load that starts at once meets the recorder at `document_start`.
    expect(h.order).toEqual(["register", "inject", "publish"])
    expect(await h.recordings.isRecording(5)).toBe(true)
  })

  it("keeps a tab recording when the open page refuses the recorder, for its next load", async () => {
    const h = harness({ 5: SHOP })
    h.order.length = 0
    const browserInject = jest.fn().mockRejectedValue(new Error("Frame was removed"))
    const failing = createRecordings({
      local: h.local,
      session: h.session,
      browser: {
        tabInfo: async () => SHOP,
        injectRecorder: browserInject,
        removeRecorder: async () => [],
        hasOrigin: async () => true,
        setRecorderScripts: async () => undefined,
      },
      newId: () => "rec-x",
      now: () => 1,
    })
    await expect(failing.start(5, { byAgent: false })).rejects.toThrow("Frame was removed")
    expect(await failing.isRecording(5)).toBe(true)
    expect(await failing.askFor(5)).toEqual({ synthetic: false })
  })

  it("registers the recorder for the recording tabs' sites, and answers it there", async () => {
    const h = harness(
      { 5: SHOP, 6: { url: "http://other.test/a", title: "" }, 7: SHOP },
      (pattern) => pattern !== "http://other.test/*"
    )
    await h.recordings.start(5, { byAgent: false })
    await h.recordings.start(6, { byAgent: true, sessionId: "s1" })
    expect(h.scripts).toEqual([["https://shop.test/*"]])
    expect(await h.recordings.askFor(5)).toEqual({ synthetic: false })
    expect(await h.recordings.askFor(6)).toEqual({ synthetic: true })
    expect(await h.recordings.askFor(7)).toBeNull()
    expect(await h.recordings.askFor(undefined)).toBeNull()

    // The tab moved to a granted site: the next load is covered there too.
    h.tabs[6] = { url: "https://next.test/", title: "" }
    await h.recordings.tabLoaded(6)
    expect(h.scripts.at(-1)).toEqual(["https://next.test/*", "https://shop.test/*"])
    await h.recordings.tabLoaded(6)
    expect(h.scripts).toHaveLength(2)

    await h.recordings.stopTab(5)
    await h.recordings.stopTab(6)
    expect(h.scripts.at(-1)).toEqual([])
  })

  it("accepts only known panel commands", () => {
    expect(isRecordingCommandMessage({ kind: "cognia-recordings", command: { op: "start" } })).toBe(
      true
    )
    expect(isRecordingCommandMessage({ kind: "cognia-recordings", command: { op: "wipe" } })).toBe(
      false
    )
  })
})
