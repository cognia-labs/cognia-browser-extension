/**
 * The worker's recordings (`recording-v1`): the only writer of what was
 * recorded and of which tab is recording.
 *
 * A tab records into one recording at a time. The recorder in the page sends
 * each step here; the worker checks that the tab sending it is recording,
 * appends it, and puts the recorder back on every load until the recording
 * stops — from the badge, the panel, the agent, or the tab closing.
 */
import type { StorageArea } from "../agent/storage-area"
import {
  ACTIVE_RECORDINGS_KEY,
  MAX_RECORDINGS,
  RECORDINGS_KEY,
  appendStep,
  cleanStep,
  parseRecordings,
  summaryOf,
  toPlaywright,
  type Recording,
  type RecordingSummary,
} from "./model"

export interface RecordingBrowser {
  tabInfo(tabId: number): Promise<{ url: string; title: string } | null>
  /** Put the recorder into the tab's page; `synthetic` also takes events the page did not get from a person. */
  injectRecorder(tabId: number, options: { synthetic: boolean }): Promise<void>
  removeRecorder(tabId: number): Promise<void>
}

export interface RecordingsDeps {
  local: StorageArea
  session: StorageArea
  browser: RecordingBrowser
  newId: () => string
  now: () => number
}

/** Tab id → recording id. */
type Active = Record<string, string>

export type RecordingCommand =
  | { op: "start"; tabId: number }
  | { op: "stop"; recordingId: string }
  | { op: "share"; recordingId: string; shared: boolean }
  | { op: "rename"; recordingId: string; title: string }
  | { op: "remove"; recordingId: string }

export interface RecordingCommandMessage {
  kind: "cognia-recordings"
  command: RecordingCommand
}

const OPS = new Set(["start", "stop", "share", "rename", "remove"])

export function isRecordingCommandMessage(value: unknown): value is RecordingCommandMessage {
  if (!value || typeof value !== "object") return false
  const record = value as Record<string, unknown>
  const command = record.command as Record<string, unknown> | null
  return (
    record.kind === "cognia-recordings" &&
    !!command &&
    typeof command === "object" &&
    OPS.has(String(command.op))
  )
}

export function isRecordingStepMessage(
  value: unknown
): value is { kind: "cognia-recording-step"; step: unknown } {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { kind?: unknown }).kind === "cognia-recording-step"
  )
}

export function isRecordingStopMessage(value: unknown): value is { kind: "cognia-recording-stop" } {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { kind?: unknown }).kind === "cognia-recording-stop"
  )
}

export class RecordingError extends Error {
  constructor(
    readonly code: "browser_recording_not_found" | "browser_page_restricted",
    message: string
  ) {
    super(message)
  }
}

export function createRecordings(deps: RecordingsDeps) {
  const { local, session, browser, now } = deps
  let queue: Promise<unknown> = Promise.resolve()
  const serialize = <T>(work: () => Promise<T>): Promise<T> => {
    const run = queue.then(work)
    queue = run.catch(() => undefined)
    return run
  }
  const all = async () => parseRecordings(await local.get(RECORDINGS_KEY))
  const active = async () => ((await session.get<Active>(ACTIVE_RECORDINGS_KEY)) ?? {}) as Active
  const write = (recordings: Recording[]) => local.set(RECORDINGS_KEY, recordings)

  async function finish(recordingId: string): Promise<RecordingSummary | null> {
    const tabs = await active()
    const tabIds = Object.entries(tabs)
      .filter(([, id]) => id === recordingId)
      .map(([tabId]) => Number(tabId))
    for (const tabId of tabIds) delete tabs[String(tabId)]
    await session.set(ACTIVE_RECORDINGS_KEY, tabs)
    const recordings = await all()
    const recording = recordings.find((entry) => entry.id === recordingId)
    if (!recording) return null
    if (!recording.stoppedAt) {
      recording.stoppedAt = now()
      await write(recordings)
    }
    for (const tabId of tabIds) await browser.removeRecorder(tabId).catch(() => undefined)
    return summaryOf(recording)
  }

  const self = {
    /** Start recording in a tab, or answer the recording it is already in. */
    start(tabId: number, options: { byAgent: boolean; sessionId?: string }) {
      return serialize(async () => {
        const tabs = await active()
        const recordings = await all()
        const current = tabs[String(tabId)]
        const existing = current ? recordings.find((entry) => entry.id === current) : undefined
        if (existing) return summaryOf(existing)
        const tab = await browser.tabInfo(tabId)
        if (!tab || !/^https?:/.test(tab.url))
          throw new RecordingError(
            "browser_page_restricted",
            "Only http and https pages can be recorded."
          )
        const recording: Recording = {
          id: deps.newId(),
          title: tab.title.slice(0, 200),
          url: tab.url,
          startedAt: now(),
          byAgent: options.byAgent,
          ...(options.sessionId ? { sessionId: options.sessionId } : {}),
          shared: true,
          steps: [],
        }
        // The oldest go when there are too many; one still recording stays.
        const recordingIds = new Set(Object.values(tabs))
        const kept = [recording, ...recordings]
        while (kept.length > MAX_RECORDINGS) {
          const index = kept.findLastIndex((entry) => !recordingIds.has(entry.id))
          if (index <= 0) break
          kept.splice(index, 1)
        }
        await write(kept)
        tabs[String(tabId)] = recording.id
        await session.set(ACTIVE_RECORDINGS_KEY, tabs)
        await browser.injectRecorder(tabId, { synthetic: options.byAgent })
        return summaryOf(recording)
      })
    },

    stop: (recordingId: string) => serialize(() => finish(recordingId)),

    /** Stop whatever the tab records into. */
    stopTab(tabId: number) {
      return serialize(async () => {
        const id = (await active())[String(tabId)]
        return id ? finish(id) : null
      })
    },

    /** Stop every recording a conversation started; answers them, newest first. */
    stopSession(sessionId: string) {
      return serialize(async () => {
        const recordings = await all()
        const ids = new Set(Object.values(await active()))
        const stopped: RecordingSummary[] = []
        for (const recording of recordings) {
          if (recording.sessionId !== sessionId || !ids.has(recording.id)) continue
          const summary = await finish(recording.id)
          if (summary) stopped.push(summary)
        }
        return stopped
      })
    },

    /** A step from the recorder in a tab; dropped unless that tab is recording. */
    step(tabId: number | undefined, input: unknown) {
      return serialize(async () => {
        if (tabId === undefined) return false
        const id = (await active())[String(tabId)]
        const step = cleanStep(input)
        if (!id || !step) return false
        const recordings = await all()
        const recording = recordings.find((entry) => entry.id === id)
        if (!recording) return false
        recording.steps = appendStep(recording.steps, step)
        await write(recordings)
        return true
      })
    },

    /** A tab finished loading: put the recorder back if it is recording. */
    async tabLoaded(tabId: number) {
      const id = (await active())[String(tabId)]
      if (!id) return
      const recording = (await all()).find((entry) => entry.id === id)
      await browser
        .injectRecorder(tabId, { synthetic: recording?.byAgent === true })
        .catch(() => undefined)
    },

    async isRecording(tabId: number) {
      return (await active())[String(tabId)] !== undefined
    },

    /** What an agent may read: the recordings shared with agents. */
    async listShared(): Promise<RecordingSummary[]> {
      return (await all()).filter((entry) => entry.shared).map(summaryOf)
    },

    async getShared(id: string, format: "steps" | "playwright") {
      const recording = (await all()).find((entry) => entry.id === id && entry.shared)
      if (!recording)
        throw new RecordingError(
          "browser_recording_not_found",
          `no recording ${id} is shared with agents`
        )
      return {
        recording: { ...summaryOf(recording), steps: recording.steps },
        ...(format === "playwright" ? { playwright: toPlaywright(recording) } : {}),
      }
    },

    /** A change from the panel, which only the panel may send. */
    command(command: RecordingCommand): Promise<RecordingSummary | boolean | null> {
      if (command.op === "start") return self.start(command.tabId, { byAgent: false })
      if (command.op === "stop") return self.stop(command.recordingId)
      return serialize(async () => {
        const recordings = await all()
        const index = recordings.findIndex((entry) => entry.id === command.recordingId)
        if (index < 0) return false
        if (command.op === "remove") {
          if (Object.values(await active()).includes(command.recordingId)) return false
          recordings.splice(index, 1)
        } else if (command.op === "share") {
          recordings[index] = { ...recordings[index]!, shared: command.shared }
        } else {
          recordings[index] = {
            ...recordings[index]!,
            title: command.title.trim().slice(0, 200) || recordings[index]!.title,
          }
        }
        await write(recordings)
        return true
      })
    },
  }
  return self
}

export type Recordings = ReturnType<typeof createRecordings>
