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
  MAX_SHARED_WITH,
  RECORDINGS_KEY,
  appendStep,
  cleanStep,
  parseRecordings,
  readableBy,
  summaryOf,
  toPlaywright,
  type RecordedStep,
  type Recording,
  type RecordingSummary,
} from "./model"

export interface RecordingBrowser {
  tabInfo(tabId: number): Promise<{ url: string; title: string } | null>
  /** Put the recorder into the tab's page; `synthetic` also takes events the page did not get from a person. */
  injectRecorder(tabId: number, options: { synthetic: boolean }): Promise<void>
  /**
   * Take the recorder out of the tab's page. Answers the steps it had not
   * sent yet — typing still settling — for the worker to keep.
   */
  removeRecorder(tabId: number): Promise<unknown[] | void>
  /** Whether the extension may run scripts on pages matching `pattern`. */
  hasOrigin(pattern: string): Promise<boolean>
  /**
   * Register the recorder at `document_start` for exactly these patterns, so
   * it is in place before a page's first action; none unregisters it.
   */
  setRecorderScripts(matches: string[]): Promise<void>
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

/** How long a stop waits for a page to hand over its last steps. */
export const STOP_TAIL_MS = 2_000

export type RecordingCommand =
  | { op: "start"; tabId: number }
  | { op: "stop"; recordingId: string }
  /** `sessions`: only these conversations; absent, every conversation. */
  | { op: "share"; recordingId: string; shared: boolean; sessions?: string[] }
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

export function isRecordingAskMessage(value: unknown): value is { kind: "cognia-recording-ask" } {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { kind?: unknown }).kind === "cognia-recording-ask"
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

  /** The sites of the recording tabs, per scheme, where the extension may run. */
  let registered = ""
  async function syncScripts(starting: readonly number[] = []): Promise<void> {
    const patterns = new Set<string>()
    const tabIds = new Set([...Object.keys(await active()).map(Number), ...starting])
    for (const tabId of tabIds) {
      const tab = await browser.tabInfo(tabId).catch(() => null)
      try {
        const url = new URL(tab?.url ?? "")
        if (/^https?:$/.test(url.protocol)) patterns.add(`${url.protocol}//${url.hostname}/*`)
      } catch {
        // Gone, or not a web page: nothing to register for it.
      }
    }
    const granted: string[] = []
    for (const pattern of [...patterns].sort())
      if (await browser.hasOrigin(pattern).catch(() => false)) granted.push(pattern)
    const key = granted.join(" ")
    if (key === registered) return
    await browser.setRecorderScripts(granted)
    registered = key
  }

  /** The steps a page had not sent yet, or none once it has taken too long to say. */
  async function tailOf(tabId: number): Promise<RecordedStep[]> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const late = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), STOP_TAIL_MS)
    })
    try {
      const left = await Promise.race([browser.removeRecorder(tabId).catch(() => undefined), late])
      return Array.isArray(left)
        ? left.map(cleanStep).filter((step): step is RecordedStep => step !== null)
        : []
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * End a recording. The recorder comes out of its pages first, while the
   * tab still records: what was typed in the last moment is handed back
   * rather than sent after the recording is gone, and kept in it.
   */
  async function finish(recordingId: string): Promise<RecordingSummary | null> {
    const tabs = await active()
    const tabIds = Object.entries(tabs)
      .filter(([, id]) => id === recordingId)
      .map(([tabId]) => Number(tabId))
    const tail: RecordedStep[] = []
    for (const tabId of tabIds) tail.push(...(await tailOf(tabId)))
    for (const tabId of tabIds) delete tabs[String(tabId)]
    await session.set(ACTIVE_RECORDINGS_KEY, tabs)
    const recordings = await all()
    const recording = recordings.find((entry) => entry.id === recordingId)
    if (recording && (tail.length > 0 || !recording.stoppedAt)) {
      for (const step of tail) recording.steps = appendStep(recording.steps, step)
      recording.stoppedAt ??= now()
      await write(recordings)
    }
    await syncScripts().catch(() => undefined)
    return recording ? summaryOf(recording) : null
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
          // The agent's own recording is for it to read; the person's stays
          // private until they have seen the steps and share it.
          shared: options.byAgent,
          // For the conversation that recorded it; the person may share it wider.
          ...(options.byAgent && options.sessionId ? { sharedWith: [options.sessionId] } : {}),
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
        // The tab is said to be recording — to the panel, which then offers
        // Stop and so invites the next click or load — only once it is: the
        // recorder registered for the tab's site at `document_start`, so a load
        // that starts at once meets it, and put into the page already open.
        // Published first, the panel showed Stop while neither was in place,
        // and a page opened in that moment was not recorded at all.
        await syncScripts([tabId]).catch(() => undefined)
        let injected: unknown = null
        await browser
          .injectRecorder(tabId, { synthetic: options.byAgent })
          .catch((error: unknown) => {
            injected = error ?? new Error("the recorder could not be put in")
          })
        // Recording either way: a page that could not take the recorder now
        // gets it at its next load. Steps the recorder sends meanwhile wait in
        // the queue behind this, so they find the tab recording.
        tabs[String(tabId)] = recording.id
        await session.set(ACTIVE_RECORDINGS_KEY, tabs)
        if (injected) throw injected
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

    /**
     * A tab finished loading. The registered recorder is usually in already;
     * this puts it back where it could not be (a site it is not registered
     * for yet), and follows the tab to that site for the next load.
     */
    async tabLoaded(tabId: number) {
      const id = (await active())[String(tabId)]
      if (!id) return
      const recording = (await all()).find((entry) => entry.id === id)
      await browser
        .injectRecorder(tabId, { synthetic: recording?.byAgent === true })
        .catch(() => undefined)
      await serialize(() => syncScripts()).catch(() => undefined)
    },

    /**
     * The registered recorder asking, at `document_start`, whether its tab is
     * recording: how to start if so, null otherwise.
     */
    async askFor(tabId: number | undefined): Promise<{ synthetic: boolean } | null> {
      if (tabId === undefined) return null
      const id = (await active())[String(tabId)]
      if (!id) return null
      const recording = (await all()).find((entry) => entry.id === id)
      return recording ? { synthetic: recording.byAgent } : null
    },

    /** Every wake-up: the registration follows the tabs still recording. */
    sync: () => serialize(() => syncScripts()),

    async isRecording(tabId: number) {
      return (await active())[String(tabId)] !== undefined
    },

    /** What the conversation `sessionId` may read: the recordings shared with it. */
    async listShared(sessionId: string): Promise<RecordingSummary[]> {
      return (await all()).filter((entry) => readableBy(entry, sessionId)).map(summaryOf)
    },

    /** One recording, when shared with `sessionId`; otherwise as if there were none. */
    async getShared(id: string, format: "steps" | "playwright", sessionId: string) {
      const recording = (await all()).find(
        (entry) => entry.id === id && readableBy(entry, sessionId)
      )
      if (!recording)
        throw new RecordingError(
          "browser_recording_not_found",
          `no recording ${id} is shared with this conversation`
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
          const { sharedAt: _previous, sharedWith: _before, ...rest } = recordings[index]!
          const named = [
            ...new Set(
              (Array.isArray(command.sessions) ? command.sessions : []).filter(
                (id): id is string => typeof id === "string" && id.length > 0 && id.length <= 128
              )
            ),
          ].slice(0, MAX_SHARED_WITH)
          recordings[index] = {
            ...rest,
            shared: command.shared,
            ...(command.shared ? { sharedAt: now() } : {}),
            ...(command.shared && named.length > 0 ? { sharedWith: named } : {}),
          }
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
