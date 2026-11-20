/**
 * The service worker's job, as one testable unit (ADR-0228 §4–7).
 *
 * The worker used to do almost nothing, because MV3 reclaims it at will. It
 * now owns three things only a worker can:
 *
 *  - **Status while the panel is closed.** A one-minute `chrome.alarms` poll
 *    while any task can still change on its own, plus the device socket's
 *    hints when it is open; the toolbar badge, and opt-in notifications.
 *  - **The device socket**, open while something wants it: agent mode, a
 *    conversation holding tabs, or an open panel.
 *  - **The agent**: operation frames, the in-page bar's buttons, new-tab
 *    links and closed tabs.
 *
 * Everything it must remember across wake-ups is in `chrome.storage`; the
 * module state here is a cache that `start()` rebuilds.
 */
import {
  CompanionApiError,
  isTerminalBrowserSubmissionStatus,
  type BrowserContextSubmissionSummaryV1,
} from "@cognia/companion-client"
import { AGENT_PROFILE } from "../agent/protocol"

import {
  createAgentRuntime,
  type AgentRuntime,
  type HostCancelOutcome,
} from "../agent/agent-runtime"
import type { AgentBrowser } from "../agent/executor"
import {
  PENDING_SITE_QUESTIONS_KEY,
  type SiteQuestion,
  type AgentPermissionMessage,
} from "../agent/site-permissions"
import {
  browserCompanionSocketUrl,
  createSocketClient,
  type SocketClient,
  type SocketLike,
  type SocketState,
} from "../agent/socket-client"
import type { AgentSessions } from "../agent/sessions"
import type { StorageArea } from "../agent/storage-area"
import { createNetworkRules, type NetworkRulesBrowser } from "../network-rules/controller"
import type { RuleCommand, RuleCommandResult } from "../network-rules/store"
import {
  createRecordings,
  type RecordingBrowser,
  type RecordingCommand,
} from "../recordings/controller"
import { SESSION_KEYS, STORAGE_KEYS } from "../browser-api"
import type { HostClient, PairingRecord } from "../client"
import { parsePreferences, type ExtensionPreferences } from "../preferences"
import {
  EMPTY_SNAPSHOT,
  STATUS_SNAPSHOT_KEY,
  badgeFor,
  countStatuses,
  diffStatuses,
  followUps,
  notificationMessageKey,
  shouldKeepPolling,
  type Badge,
  type StatusItem,
  type StatusSnapshot,
} from "./status-tracker"

export const STATUS_ALARM = "cognia-status-poll"
export { PANEL_PORT } from "../browser-api"
export const STATUS_POLL_MINUTES = 1
/** Rows read per status poll; the badge counts within the newest of them. */
export const STATUS_PAGE_SIZE = 50
/**
 * Unsettled tasks past the newest page that one read follows by id. A task
 * still running when fifty newer ones finished is followed to its end rather
 * than dropped from the badge; past this many, the oldest are let go.
 */
export const MAX_FOLLOWED = 20
/** Pages of the list Stop searches for a conversation's task (fifty rows each). */
export const MAX_CANCEL_PAGES = 40
/** Notification ids carry what they are about, so a click knows where to go. */
export const NOTIFICATION_PREFIX = "cognia:"

/**
 * Whether the Host answered and refused, as opposed to not being reached, or
 * being too busy to say. A refusal is a final word about that submission.
 */
function isRefusal(error: unknown): boolean {
  return (
    error instanceof CompanionApiError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 429
  )
}

export interface WorkerDeps {
  local: StorageArea
  session: StorageArea
  /** The paired Host's client, or null when this browser is not paired. */
  loadClient(pairing: PairingRecord): Promise<HostClient | null>
  browser: AgentBrowser
  networkRulesBrowser: NetworkRulesBrowser
  recordingBrowser: RecordingBrowser
  createSocket(url: string): SocketLike
  setBadge(badge: Badge): Promise<void>
  /** Whether the optional `notifications` permission is granted. */
  canNotify(): Promise<boolean>
  notify(id: string, title: string, message: string): Promise<void>
  ensureAlarm(name: string, periodMinutes: number): Promise<void>
  clearAlarm(name: string): Promise<void>
  extensionVersion: string
  panelUrl: string
  message(key: string, substitutions?: string[]): string
  now(): number
  random(): number
  newId(): string
  sleep(ms: number): Promise<void>
  setTimeout(callback: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
  setInterval(callback: () => void, ms: number): unknown
  clearInterval(handle: unknown): void
}

/** What the hello tells the Host this build implements. */
export const EXTENSION_FEATURES = [
  AGENT_PROFILE,
  "status-hints-v1",
  "network-rules-v1",
  "recording-v1",
]

export function createWorker(deps: WorkerDeps) {
  let pairing: PairingRecord | null = null
  let client: HostClient | null = null
  let preferences: ExtensionPreferences = parsePreferences(null)
  let localMode = false
  let pairingLoad = 0
  let panelPorts = 0
  let keepPolling = false
  let refreshing: Promise<void> | null = null
  let refreshAgain = false
  let permissionChanges: Promise<unknown> = Promise.resolve()

  // Its sessions are the runtime's, read lazily: the two are built together.
  const networkRules = createNetworkRules({
    local: deps.local,
    session: deps.session,
    newId: deps.newId,
    browser: deps.networkRulesBrowser,
    sessions: () => runtime.sessions.all(),
  })

  const recordings = createRecordings({
    local: deps.local,
    session: deps.session,
    browser: deps.recordingBrowser,
    newId: deps.newId,
    now: deps.now,
  })

  const runtime: AgentRuntime = createAgentRuntime({
    browser: deps.browser,
    local: deps.local,
    session: deps.session,
    now: deps.now,
    sleep: deps.sleep,
    newId: deps.newId,
    onQuestion: (question) => void announceQuestion(question),
    cancelConversation: (sessionId) => cancelConversation(sessionId),
    networkRules,
    recordings,
  })

  const socket: SocketClient = createSocketClient({
    issueTicket: async () => {
      if (!client) throw Object.assign(new Error("not paired"), { code: "not_paired" })
      return (await client.socketTicket()).ticket
    },
    socketUrl: (ticket) => browserCompanionSocketUrl(pairing?.baseUrl ?? "", ticket),
    createSocket: deps.createSocket,
    execute: (operation, args, deadlineMs, signal) =>
      runtime.execute(operation, args, deadlineMs, signal),
    canExecute: () => !localMode && preferences.agentMode,
    extensionVersion: deps.extensionVersion,
    features: EXTENSION_FEATURES,
    onStatusHint: () => {
      void deps.session.set(SESSION_KEYS.statusHint, deps.now())
      void refreshStatus()
    },
    onDrive: () => undefined,
    onState: (state: SocketState) => {
      void deps.session.set(SESSION_KEYS.socketState, state)
    },
    now: deps.now,
    random: deps.random,
    setTimeout: deps.setTimeout,
    clearTimeout: deps.clearTimeout,
    setInterval: deps.setInterval,
    clearInterval: deps.clearInterval,
  })

  async function questionCount(): Promise<number> {
    return ((await deps.session.get<SiteQuestion[]>(PENDING_SITE_QUESTIONS_KEY)) ?? []).length
  }

  async function wantsNotification(): Promise<boolean> {
    return preferences.notifications && (await deps.canNotify())
  }

  async function announceQuestion(question: SiteQuestion): Promise<void> {
    await refreshBadgeOnly()
    if (!(await wantsNotification())) return
    const host = (() => {
      try {
        return new URL(question.origin).host
      } catch {
        return question.origin
      }
    })()
    await deps
      .notify(
        `${NOTIFICATION_PREFIX}site:${question.id}`,
        deps.message("notifySiteQuestionTitle"),
        deps.message("notifySiteQuestion", [host])
      )
      .catch(() => undefined)
  }

  let lastCounts = { running: 0, needsInput: 0 }

  async function refreshBadgeOnly(): Promise<void> {
    await deps.setBadge(badgeFor(lastCounts, await questionCount())).catch(() => undefined)
  }

  async function readStatus(): Promise<void> {
    if (!client) {
      lastCounts = { running: 0, needsInput: 0 }
      keepPolling = false
      await refreshBadgeOnly()
      return
    }
    const readingClient = client
    let items: BrowserContextSubmissionSummaryV1[]
    try {
      items = (await client.list({ limit: STATUS_PAGE_SIZE })).items
    } catch {
      // Host down or unreachable: keep the alarm, so the badge recovers when
      // it is back, and leave the last badge rather than blanking it.
      keepPolling = true
      return
    }
    if (client !== readingClient) return
    const snapshot = (await deps.session.get<StatusSnapshot>(STATUS_SNAPSHOT_KEY)) ?? EMPTY_SNAPSHOT
    const followed = await follow(readingClient, snapshot, items)
    if (client !== readingClient) return
    const all: StatusItem[] = [...items, ...followed]
    lastCounts = countStatuses(all)
    keepPolling = shouldKeepPolling(all)
    await refreshBadgeOnly()

    const { transitions, next } = diffStatuses(snapshot, all)
    await deps.session.set(STATUS_SNAPSHOT_KEY, next)
    // The open panel shows these itself; a notification on top is noise.
    if (transitions.length === 0 || panelPorts > 0 || !(await wantsNotification())) return
    for (const transition of transitions) {
      await deps
        .notify(
          `${NOTIFICATION_PREFIX}submission:${transition.item.submissionId}`,
          deps.message(notificationMessageKey(transition.to)),
          transition.item.title || transition.item.sourceHost || ""
        )
        .catch(() => undefined)
    }
  }

  /**
   * The tasks last seen unsettled that the newest page no longer holds, read
   * one by one. A refusal (gone, or another device's) ends following one; a
   * Host that could not answer leaves it as it was last seen, to ask again.
   */
  async function follow(
    readingClient: HostClient,
    snapshot: StatusSnapshot,
    items: readonly StatusItem[]
  ): Promise<StatusItem[]> {
    const followed: StatusItem[] = []
    for (const submissionId of followUps(snapshot, items, MAX_FOLLOWED)) {
      const known = snapshot.tracked?.[submissionId]
      const label = known?.label ? { title: known.label } : {}
      try {
        const status = await readingClient.get(submissionId)
        const sessionId = status.sessionId ?? known?.sessionId
        followed.push({
          submissionId,
          status: status.status,
          ...label,
          ...(sessionId ? { sessionId } : {}),
        })
      } catch (error) {
        if (isRefusal(error)) continue
        followed.push({
          submissionId,
          status: snapshot.statuses[submissionId]!,
          ...label,
          ...(known?.sessionId ? { sessionId: known.sessionId } : {}),
        })
      }
    }
    return followed
  }

  /** One read at a time; a hint during a read schedules exactly one more. */
  function refreshStatus(): Promise<void> {
    if (refreshing) {
      refreshAgain = true
      return refreshing
    }
    refreshing = (async () => {
      try {
        do {
          refreshAgain = false
          await readStatus()
        } while (refreshAgain)
        await reconcile()
      } finally {
        refreshing = null
      }
    })()
    return refreshing
  }

  /** Start or stop the alarm and the socket to match what is wanted now. */
  async function reconcile(): Promise<void> {
    // The alarm covers the panel-closed case only; an open panel polls itself.
    if (client && keepPolling && panelPorts === 0) {
      await deps.ensureAlarm(STATUS_ALARM, STATUS_POLL_MINUTES)
    } else {
      await deps.clearAlarm(STATUS_ALARM)
    }
    const wanted =
      client !== null &&
      (preferences.agentMode || panelPorts > 0 || keepPolling || (await runtime.hasSessions()))
    if (wanted) socket.start()
    else socket.stop()
  }

  async function loadPairing(): Promise<void> {
    const load = ++pairingLoad
    const next = localMode ? null : await deps.local.get<PairingRecord>(STORAGE_KEYS.pairing)
    if (load !== pairingLoad || (localMode && next)) return
    const changed =
      (next?.deviceId ?? null) !== (pairing?.deviceId ?? null) ||
      (next?.baseUrl ?? null) !== (pairing?.baseUrl ?? null)
    if (!changed && (client || !next)) return
    client?.invalidate()
    socket.stop()
    pairing = next
    client = null
    const loaded = next ? await deps.loadClient(next).catch(() => null) : null
    if (load !== pairingLoad) {
      loaded?.invalidate()
      return
    }
    client = loaded
    // A woken worker loads its client again; what it saw of that same
    // pairing's tasks is still true, and forgetting it would lose what
    // finished while it slept and the tasks it follows past the first page.
    const owner = next ? `${next.baseUrl}#${next.deviceId}` : undefined
    const stored = await deps.session.get<StatusSnapshot>(STATUS_SNAPSHOT_KEY).catch(() => null)
    if (load !== pairingLoad || (owner && stored?.owner === owner)) return
    await deps.session.set(
      STATUS_SNAPSHOT_KEY,
      owner ? { ...EMPTY_SNAPSHOT, owner } : EMPTY_SNAPSHOT
    )
  }

  /**
   * Stop on the in-page bar: cancel the Host task acting in that conversation,
   * and say whether the Host confirmed it.
   *
   * The tasks the status reads already follow for that conversation are tried
   * first; then the list, the only index from conversation to submission this
   * device may read, newest first, where the first unsettled match is the one
   * acting. "none" is said only when the whole list was read and nothing in
   * it is still going; anything the Host did not answer is "failed".
   */
  async function cancelConversation(sessionId: string): Promise<HostCancelOutcome> {
    const reading = client
    if (!reading) return "failed"
    const tried = new Set<string>()
    const cancel = async (submissionId: string): Promise<HostCancelOutcome | "refused"> => {
      tried.add(submissionId)
      try {
        await reading.cancel(submissionId)
      } catch (error) {
        const code = error instanceof CompanionApiError ? error.code : ""
        // Another device is driving it: running, and not stopped from here.
        return isRefusal(error) && code !== "session_driven_elsewhere" ? "refused" : "failed"
      }
      void refreshStatus()
      return "cancelled"
    }
    const snapshot = (await deps.session.get<StatusSnapshot>(STATUS_SNAPSHOT_KEY)) ?? EMPTY_SNAPSHOT
    for (const [submissionId, tracked] of Object.entries(snapshot.tracked ?? {})) {
      const status = snapshot.statuses[submissionId]
      if (tracked.sessionId !== sessionId || !status || isTerminalBrowserSubmissionStatus(status))
        continue
      const outcome = await cancel(submissionId)
      // Refused: it finished since, or is not this device's; look further.
      if (outcome !== "refused") return outcome
    }
    let pageToken: string | undefined
    for (let page = 0; page < MAX_CANCEL_PAGES; page++) {
      let result: Awaited<ReturnType<HostClient["list"]>>
      try {
        result = await reading.list({
          limit: STATUS_PAGE_SIZE,
          ...(pageToken ? { pageToken } : {}),
        })
      } catch {
        return "failed"
      }
      const match = result.items.find(
        (item) =>
          item.sessionId === sessionId &&
          !tried.has(item.submissionId) &&
          !isTerminalBrowserSubmissionStatus(item.status)
      )
      if (match) {
        const outcome = await cancel(match.submissionId)
        return outcome === "refused" ? "failed" : outcome
      }
      if (!result.nextPageToken) return "none"
      pageToken = result.nextPageToken
    }
    // The list goes on past what one press reads: nothing found is not "none".
    return "failed"
  }

  return {
    runtime,
    socket,
    networkRules,

    /** A request-rule change from the panel, which only the panel may send. */
    onNetworkRuleCommand(
      command: RuleCommand,
      senderUrl: string | undefined
    ): Promise<RuleCommandResult | false> {
      if (senderUrl?.split(/[?#]/)[0] !== deps.panelUrl) return Promise.resolve(false)
      return networkRules.command(command)
    },

    recordings,

    /** A recording change from the panel, which only the panel may send. */
    onRecordingCommand(command: RecordingCommand, senderUrl: string | undefined) {
      if (senderUrl?.split(/[?#]/)[0] !== deps.panelUrl) return Promise.resolve(false)
      return recordings.command(command)
    },

    /** A page's loader asking for its tab's rules, at `document_start`. */
    pageRules(tabId: number | undefined, url: string | undefined) {
      return tabId === undefined ? Promise.resolve([]) : networkRules.pageRulesFor(tabId, url)
    },

    onSessionsChange(sessions: AgentSessions | null): Promise<void> {
      return networkRules.sessionsChanged(sessions ?? {})
    },

    onPermissionMessage(
      message: AgentPermissionMessage,
      senderUrl: string | undefined
    ): Promise<boolean> {
      // Extension content scripts share runtime.id, so require the actual panel URL.
      if (senderUrl?.split(/[?#]/)[0] !== deps.panelUrl) return Promise.resolve(false)
      if (message.action === "stop-host-task")
        // Not a permission change: it waits on the Host, and must not hold
        // up an answer to a site question queued behind it.
        return runtime.retryHostStop(message.session).then((outcome) => outcome !== null)
      const run = permissionChanges.then(async () => {
        if (message.action === "answer")
          await runtime.permissions.answer(message.questionId, message.answer)
        else await runtime.permissions.setDecision(message.origin, null)
        return true
      })
      permissionChanges = run.catch(() => undefined)
      return run
    },

    /** Every wake-up: rebuild the cache from storage, then reconcile. */
    async start(): Promise<void> {
      preferences = parsePreferences(await deps.local.get(STORAGE_KEYS.preferences))
      localMode = (await deps.local.get(STORAGE_KEYS.localMode)) === true
      await loadPairing()
      // Session rules do not survive a browser restart; the stored ones do.
      await networkRules.sync().catch(() => undefined)
      await recordings.sync().catch(() => undefined)
      await refreshStatus()
    },

    async onAlarm(name: string): Promise<void> {
      if (name !== STATUS_ALARM) return
      await refreshStatus()
    },

    /** A local storage key changed: pairing or preferences. */
    async onLocalChange(key: string, value: unknown): Promise<void> {
      if (key === STORAGE_KEYS.localMode) {
        localMode = value === true
        if (localMode) socket.stop()
        await loadPairing()
        await refreshStatus()
      } else if (key === STORAGE_KEYS.preferences) {
        const before = preferences
        preferences = parsePreferences(value)
        if (!preferences.agentMode) socket.cancelOperations("browser_agent_mode_disabled")
        if (before.agentMode !== preferences.agentMode && preferences.agentMode) socket.retryNow()
        await reconcile()
      } else if (key === STORAGE_KEYS.pairing) {
        await loadPairing()
        await refreshStatus()
      }
    },

    /** Site questions changed (asked, answered, dropped): the badge follows. */
    async onQuestionsChange(): Promise<void> {
      await refreshBadgeOnly()
    },

    panelOpened(): void {
      panelPorts += 1
      void reconcile()
    },

    panelClosed(): void {
      panelPorts = Math.max(0, panelPorts - 1)
      // A fresh read now, so the alarm resumes if work is still running.
      void refreshStatus()
    },

    /** The submission a notification is about, if it is about one. */
    notificationTarget(id: string): { kind: "submission" | "site"; id: string } | null {
      if (!id.startsWith(NOTIFICATION_PREFIX)) return null
      const [kind, ...rest] = id.slice(NOTIFICATION_PREFIX.length).split(":")
      const target = rest.join(":")
      if ((kind === "submission" || kind === "site") && target) return { kind, id: target }
      return null
    },

    /** The panel asked for an immediate refresh (a submit just landed). */
    refreshNow: () => refreshStatus(),

    /** Whether the socket should be kept; exposed for tests. */
    state: () => ({
      paired: client !== null,
      panelPorts,
      keepPolling,
      preferences,
    }),
  }
}

export type Worker = ReturnType<typeof createWorker>
