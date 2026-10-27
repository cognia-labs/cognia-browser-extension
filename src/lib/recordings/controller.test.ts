import { memoryStorageArea } from "../agent/storage-area"

import { createRecordings, isRecordingCommandMessage, type RecordingBrowser } from "./controller"
import { ACTIVE_RECORDINGS_KEY, RECORDINGS_KEY } from "./model"

function harness(tabs: Record<number, { url: string; title: string }> = {}) {
  const local = memoryStorageArea()
  const session = memoryStorageArea()
  const injected: [number, boolean][] = []
  const removed: number[] = []
  const browser: RecordingBrowser = {
    tabInfo: async (tabId) => tabs[tabId] ?? null,
    injectRecorder: async (tabId, { synthetic }) => {
      injected.push([tabId, synthetic])
    },
    removeRecorder: async (tabId) => {
      removed.push(tabId)
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
  return { recordings, local, session, injected, removed }
}

const SHOP = { url: "https://shop.test/", title: "Shop" }
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

  it("lets agents read only what is shared, with a generated test on request", async () => {
    const h = harness({ 5: SHOP })
    await h.recordings.start(5, { byAgent: false })
    await h.recordings.step(5, { action: "navigate", url: SHOP.url, at: 1 })
    await h.recordings.step(5, click(2))
    await h.recordings.stopTab(5)
    expect(await h.recordings.listShared()).toEqual([expect.objectContaining({ id: "rec-1" })])
    const got = await h.recordings.getShared("rec-1", "playwright")
    expect(got.recording.steps).toHaveLength(2)
    expect(got.playwright).toContain(
      'await page.getByRole("button", { name: "Buy", exact: true }).click()'
    )
    await h.recordings.command({ op: "share", recordingId: "rec-1", shared: false })
    expect(await h.recordings.listShared()).toEqual([])
    await expect(h.recordings.getShared("rec-1", "steps")).rejects.toMatchObject({
      code: "browser_recording_not_found",
    })
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

  it("accepts only known panel commands", () => {
    expect(isRecordingCommandMessage({ kind: "cognia-recordings", command: { op: "start" } })).toBe(
      true
    )
    expect(isRecordingCommandMessage({ kind: "cognia-recordings", command: { op: "wipe" } })).toBe(
      false
    )
  })
})
