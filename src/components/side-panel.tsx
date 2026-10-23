import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type {
  BrowserAttachmentRefV1,
  BrowserCaptureMode,
  BrowserContextLimits,
  BrowserContextSubmissionSummaryV1,
  BrowserImageContextV1,
  BrowserLinkContextV1,
  BrowserPageContextV1,
} from "@cognia/companion-client"
import {
  BROWSER_ATTACHMENT_MEDIA_TYPES,
  BROWSER_CONTEXT_LIMITS,
  companionRetryAfterMs,
  resolveBrowserContextLimits,
} from "@cognia/companion-client"
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Switch,
  Textarea,
  cn,
  useCopy,
} from "@cognia/plugin-ui"
import {
  CameraIcon,
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  FileTextIcon,
  HistoryIcon,
  MousePointer2Icon,
  MousePointerClickIcon,
  PanelLeftIcon,
  PencilLineIcon,
  RefreshCwIcon,
  RulerIcon,
  ScanLineIcon,
  ScanTextIcon,
  Settings2Icon,
  SendIcon,
  SparklesIcon,
  SquareMousePointerIcon,
  Trash2Icon,
} from "lucide-react"

import {
  ActivityStrip,
  CollapsibleCard,
  PanelSection,
  ToolTile,
} from "@ext/src/components/panel-section"
import { applyAppearance, isAppliedAppearance } from "@ext/src/lib/appearance/apply-appearance"
import {
  AttachmentUploadError,
  base64ToBytes,
  uploadAttachment,
} from "@ext/src/lib/attachment-upload"
import {
  SESSION_KEYS,
  STORAGE_KEYS,
  type BrowserApi,
  type PanelPort,
  type TabRef,
} from "@ext/src/lib/browser-api"
import {
  CAPTURE_REQUEST_KEY,
  isFreshCaptureRequest,
  parseCaptureRequest,
  type CaptureRequest,
} from "@ext/src/lib/capture/capture-request"
import { isYouTubeWatchUrl } from "@ext/src/lib/capture/youtube-transcript"
import { normalizeCaptureUrl } from "@ext/src/lib/capture/normalize-url"
import { clearDeviceKey } from "@ext/src/lib/device-key"
import { DESIGN_OVERLAY_MAX_BYTES, VIEWPORT_PRESETS } from "@ext/src/lib/inspect/design-overlay"
import { buildDevReport, type DevReport } from "@ext/src/lib/inspect/dev-report"
import type {
  ElementBox,
  ElementDescription,
  PickedElement,
} from "@ext/src/lib/inspect/element-context"
import {
  MAX_PICKS,
  inspectionMarkdown,
  promptForClipboard,
  exportFileName,
  exportMarkdown,
  withInspection,
} from "@ext/src/lib/inspect/inspect-markdown"
import type { A11yIssue } from "@ext/src/lib/inspect/a11y-audit"
import type { LayoutIssue } from "@ext/src/lib/inspect/layout-check"
import type { FocusIssue } from "@ext/src/lib/inspect/focus-order"
import type { ToolbarAction, ToolbarState } from "@ext/src/lib/inspect/page-toolbar"
import { designDiffMarkdown, type DesignDiff } from "@ext/src/lib/inspect/design-diff"
import { comparePicks, comparisonMarkdown } from "@ext/src/lib/inspect/pick-compare"
import { PickComparisonCard } from "@ext/src/components/pick-comparison"
import {
  cleanMock,
  mocksMarkdown,
  type MockHits,
  type RequestMock,
} from "@ext/src/lib/inspect/request-mocks"
import {
  NO_INSIGHTS,
  insightSections,
  insightsForTab,
  type InsightKind,
  type PageInsights,
} from "@ext/src/lib/inspect/insights"
import {
  MAX_MEASUREMENTS,
  measurementsMarkdown,
  type Measurement,
  type MeasureResult,
} from "@ext/src/lib/inspect/measure"
import { sanitizeEdits } from "@ext/src/lib/inspect/style-edits"
import { textChangesMarkdown, type TextChange } from "@ext/src/lib/inspect/text-edits"
import { annotationsMarkdown, type Shape } from "@ext/src/lib/panel/annotations"
import { isEmptyDraft, parseDraft, type PanelDraft } from "@ext/src/lib/panel/drafts"
import {
  buildPageContext,
  checkPages,
  contextContentBytes,
  toCapturedPage,
  withoutUnsupported,
} from "@ext/src/lib/panel/page-context"
import { quickActionInstruction } from "@ext/src/lib/panel/quick-actions"
import {
  captureFullPage,
  captureVisible,
  elementCrop,
  fileNameFromUrl,
  screenshotAttachment,
  sniffMediaType,
  type PendingAttachment,
} from "@ext/src/lib/panel/screenshots"
import { usePreferences } from "@ext/src/lib/panel/use-stored-value"
import { isBlockedUrl } from "@ext/src/lib/preferences"
import {
  createHostClient,
  pairWithHost,
  restoreSigner,
  type HostClient,
  type PairingRecord,
} from "@ext/src/lib/client"
import {
  APPEARANCE_OVERRIDES,
  STALE_CATALOGUE_CODES,
  STATUSES_WITH_A_REASON,
  appearanceOverrideMessage,
  captureModeFor,
  hasFeature,
  initialTargetParams,
  isAppearanceOverride,
  isCompatible,
  panelStateForError,
  pollIntervalFor,
  preferredModeFor,
  selectedTargetId,
  stopFailureMessage,
  submitFailureMessage,
  targetLabel,
  targetParamsSatisfied,
  targetsForWorkspace,
  type AppearanceOverride,
  type CapturedPage,
  type CaptureScope,
  type PanelState,
} from "@ext/src/lib/panel-state"
import { AgentSettings } from "./agent-settings"
import { AttachmentsBar, type AttachAction } from "./attachments-bar"
import { CaptureEditor } from "./capture-editor"
import { CapturePreview } from "./capture-preview"
import { ExtensionSettings } from "./extension-settings"
import { ExtraPages } from "./extra-pages"
import { ImageAnnotator } from "./image-annotator"
import { Measurements } from "./measurements"
import { PageAudit, ruleTitle, type AuditAction } from "./page-audit"
import { layoutRuleTitle } from "./layout-result"
import { focusRuleTitle } from "./focus-result"
import { RequestMocks } from "./request-mocks"
import { PageTools, type OverlaySettings, type PageToolAction } from "./page-tools"
import { PairScreen } from "./pair-screen"
import { PickedElements, type PickAction } from "./picked-elements"
import { PromptTools } from "./prompt-tools"
import { RecentList } from "./recent-list"
import { RegionCropper } from "./region-cropper"
import { SiteQuestions } from "./site-questions"
import { TextChanges } from "./text-changes"

export interface SidePanelProps {
  api: BrowserApi
  /** Test seam. Defaults to the real network client. */
  makeClient?: typeof createHostClient
  now?: () => number
}

/**
 * The default clock, defined once.
 *
 * An inline `() => Date.now()` default is a new function on every render, and
 * `now` is a dependency of the capture callbacks — so every render rebuilt
 * them, and every rebuild re-ran the effect that picks up a recorded capture.
 */
const systemNow = () => Date.now()

/**
 * A submission the Host accepted but could not start, because its runtime was
 * not there to run it (`host_unavailable`).
 *
 * The contract calls that "a real state, not an error": the Host recorded the
 * capture and keeps the row redrivable, so a retry under the SAME submission id
 * finishes the job in the conversation the first attempt created, rather than
 * opening a second one beside it.
 */
interface StalledSubmission {
  submissionId: string
}

/** Which destructive setting is waiting for a second click, if any. */
type PendingConfirmation = "disconnect" | "clear-local" | null

/**
 * The whole side panel.
 *
 * State lives here rather than in the service worker because MV3 reclaims the
 * worker whenever it likes, and a captured page held there would vanish
 * mid-review with no event to notice it. The panel is alive exactly while the
 * user is looking at it, which is also exactly when this state is meaningful.
 *
 * Nothing captured ever reaches storage. The page text, the selection and the
 * instruction live in React state and die with the panel; what persists is the
 * public pairing record, the Host's appearance, and the last workspace choice.
 */
export function SidePanel({ api, makeClient = createHostClient, now = systemNow }: SidePanelProps) {
  const [state, setState] = useState<PanelState>({ kind: "loading" })
  const [instruction, setInstruction] = useState("")
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [preferredTargetId, setPreferredTargetId] = useState<string | null>(null)
  const [targetParams, setTargetParams] = useState<Record<string, string>>({})
  const [scope, setScope] = useState<CaptureScope>("auto")
  // Other tabs in the same submission (ADR-0228 §2).
  const [extraPages, setExtraPages] = useState<CapturedPage[]>([])
  // Screenshots and files, uploaded at submit (ADR-0228 §3).
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const [attachBusy, setAttachBusy] = useState<AttachAction | null>(null)
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({})
  const [regionSource, setRegionSource] = useState<string | null>(null)
  // A screenshot being marked up: its id, the clean shot, the marks so far.
  const [annotating, setAnnotating] = useState<{
    id: string
    src: string
    shapes: Shape[]
  } | null>(null)
  const [annotateBusy, setAnnotateBusy] = useState(false)
  // The recent list's search and the pages loaded past the polled first one.
  const [query, setQuery] = useState("")
  const [olderItems, setOlderItems] = useState<BrowserContextSubmissionSummaryV1[]>([])
  const [nextPageToken, setNextPageToken] = useState<string | undefined>(undefined)
  const [loadingMore, setLoadingMore] = useState(false)
  // The captured tab has moved on since; the capture describes a page that
  // is no longer on screen.
  const [staleTab, setStaleTab] = useState(false)
  // A restored draft that had attachments the draft could not keep.
  const [droppedAttachments, setDroppedAttachments] = useState(0)
  const [preferences, updatePreferences] = usePreferences(api)
  const [includeFullUrl, setIncludeFullUrl] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  // Assumed absent until proven otherwise. Over-explaining a prompt that does
  // not appear is a smaller failure than a system dialog nobody was warned
  // about.
  const [hasPermission, setHasPermission] = useState(false)
  const [override, setOverride] = useState<AppearanceOverride>("follow-host")
  // Read by the connect path through a ref rather than a dependency. As a
  // dependency, choosing an appearance re-ran the whole connect effect, which
  // replaced the ready state — and with it the page the user had captured and
  // was halfway through describing.
  const overrideRef = useRef<AppearanceOverride>("follow-host")
  const [stalled, setStalled] = useState<StalledSubmission | null>(null)
  const [confirming, setConfirming] = useState<PendingConfirmation>(null)
  const [localCleared, setLocalCleared] = useState(false)
  const [disconnected, setDisconnected] = useState(false)
  const [failureCodes, setFailureCodes] = useState<Record<string, string>>({})
  const [answers, setAnswers] = useState<Record<string, { text?: string; truncated?: boolean }>>({})
  const [expanded, setExpanded] = useState<string[]>([])
  const [stopping, setStopping] = useState<string | null>(null)
  // Elements picked on the captured page, and what the picker is doing.
  const [picks, setPicks] = useState<PickedElement[]>([])
  const [detachedPicks, setDetachedPicks] = useState<string[]>([])
  const [pickingTab, setPickingTab] = useState<number | null>(null)
  // What the pointer on the page is for while `pickingTab` is set.
  const [pointing, setPointing] = useState<"pick" | "measure" | "adjust">("pick")
  // Distances measured between elements on the captured page.
  const [measurements, setMeasurements] = useState<Measurement[]>([])
  const [measureBusy, setMeasureBusy] = useState<string | null>(null)
  const [detachedMeasures, setDetachedMeasures] = useState<string[]>([])
  // Words edited on the page itself (Design Mode): the tab being edited, and
  // what changed once the person was done.
  const [textEditingTab, setTextEditingTab] = useState<number | null>(null)
  const [textChanges, setTextChanges] = useState<{ tabId: number; changes: TextChange[] } | null>(
    null
  )
  const textEditingTabRef = useRef<number | null>(null)
  const [pickBusy, setPickBusy] = useState<{ elementId: string; action: PickAction } | null>(null)
  // The console and network report, the recorder behind it, the design mock.
  const [devReport, setDevReport] = useState<DevReport | null>(null)
  const [recording, setRecording] = useState<{ tabId: number; since: number } | null>(null)
  const [overlay, setOverlay] = useState<(OverlaySettings & { tabId: number }) | null>(null)
  const [toolBusy, setToolBusy] = useState<PageToolAction | null>(null)
  const [mocks, setMocks] = useState<MocksState | null>(null)
  const [designDiff, setDesignDiff] = useState<(DesignDiff & { attachmentId?: string }) | null>(
    null
  )
  // Whole-page checks — accessibility, design tokens, stack — and the colours
  // sampled from the screen.
  const [insights, setInsights] = useState<PageInsights>(NO_INSIGHTS)
  const [auditBusy, setAuditBusy] = useState<AuditAction | null>(null)
  const [issueBusy, setIssueBusy] = useState<string | null>(null)
  const [pickedColors, setPickedColors] = useState<string[]>([])
  const { copied: contextCopied, copy: copyText } = useCopy()
  // Read by callbacks that must not be rebuilt on every edit.
  const picksRef = useRef<PickedElement[]>([])
  const measurementsRef = useRef<Measurement[]>([])
  const attachmentsRef = useRef<PendingAttachment[]>([])
  const previewTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const pickingTabRef = useRef<number | null>(null)
  const overlayTabRef = useRef<number | null>(null)
  const mocksTabRef = useRef<number | null>(null)
  const mocksKeptRef = useRef<string | null>(null)
  const [focusNumbers, setFocusNumbers] = useState(false)
  /** Whether how the picks differ goes with the task. */
  const [compareIncluded, setCompareIncluded] = useState(false)
  /** The tab with the floating toolbar on it, while it is shown. */
  const [toolbarTab, setToolbarTab] = useState<number | null>(null)
  const toolbarTabRef = useRef<number | null>(null)
  const toolbarStateRef = useRef<ToolbarState | null>(null)
  const toolbarActionRef = useRef<((action: ToolbarAction, tabId: number) => void) | null>(null)
  /** That tab's browser zoom: the toolbar keeps its size and shows a minimap when zoomed in. */
  const [toolbarZoom, setToolbarZoom] = useState(1)
  /** The tab with Tab stops numbered on it, so they come off when nothing shows them. */
  const focusShownRef = useRef<number | null>(null)
  /** The mock's bytes, kept for comparing: the page holds them, but in a closed shadow root. */
  const overlayImageRef = useRef<string | null>(null)
  const readingMocksRef = useRef(false)
  const startPickRef = useRef<((tabId?: number) => Promise<void>) | null>(null)
  const clientRef = useRef<HostClient | null>(null)
  const portRef = useRef<PanelPort | null>(null)
  const queryRef = useRef("")
  const instructionRef = useRef<HTMLTextAreaElement | null>(null)
  // The `updatedAt` each expanded answer was last fetched at, so a poll
  // re-reads a running task's answer only when it has moved.
  const answerFetchedAtRef = useRef<Record<string, number>>({})
  // Earliest time the next poll may run, when the Host asked for a pause.
  const pollNotBeforeRef = useRef(0)
  const draftRestoredRef = useRef(false)
  const pendingSubmissionRef = useRef<{
    fingerprint: string
    submissionId: string
  } | null>(null)
  // Ids already asked about, so an answered row is not re-fetched every poll —
  // held in a ref rather than derived from `failureCodes` so this effect does
  // not depend on the state it writes.
  const askedForReasonRef = useRef<Set<string>>(new Set())
  // The capture request last acted on, so the mount read and a storage change
  // arriving together cannot capture the same gesture twice.
  const consumedCaptureRef = useRef<string | null>(null)
  // The Host's own ceilings once it has said them. A build-time constant would
  // be wrong on exactly the machines where the extension and the Host have
  // drifted, which is why the limits travel with the capability.
  const limitsRef = useRef<BrowserContextLimits>(BROWSER_CONTEXT_LIMITS)

  useEffect(() => {
    picksRef.current = picks
  }, [picks])
  useEffect(() => {
    measurementsRef.current = measurements
  }, [measurements])
  useEffect(() => {
    textEditingTabRef.current = textEditingTab
  }, [textEditingTab])
  // A panel closed while the page is being edited leaves the edits where they
  // are, but not the page editable.
  useEffect(
    () => () => {
      if (textEditingTabRef.current !== null)
        void api.stopEditingPageText(textEditingTabRef.current, true).catch(() => undefined)
    },
    [api]
  )
  useEffect(() => {
    attachmentsRef.current = attachments
  }, [attachments])
  useEffect(() => {
    pickingTabRef.current = pickingTab
  }, [pickingTab])
  useEffect(() => {
    overlayTabRef.current = overlay?.tabId ?? null
  }, [overlay])
  useEffect(() => {
    mocksTabRef.current = mocks?.tabId ?? null
    mocksKeptRef.current = mocks?.keptUrl ?? null
  }, [mocks])
  useEffect(() => {
    toolbarTabRef.current = toolbarTab
  }, [toolbarTab])
  // The toolbar's buttons, answered by the latest handlers.
  useEffect(
    () => api.onToolbarAction((action, tabId) => toolbarActionRef.current?.(action, tabId)),
    [api]
  )
  // Its tab's zoom, read when it is shown and followed from then on.
  useEffect(() => {
    if (toolbarTab === null) return
    let live = true
    void api.readTabZoom(toolbarTab).then((zoom) => {
      if (live) setToolbarZoom(zoom)
    })
    const stop = api.onTabZoom((tabId, zoom) => {
      if (tabId === toolbarTab) setToolbarZoom(zoom)
    })
    return () => {
      live = false
      stop()
      setToolbarZoom(1)
    }
  }, [api, toolbarTab])
  // A focus check sent, cleared or replaced by another tab's takes its
  // numbers off the page with it.
  const focusCheckTab = insights.focus?.tabId ?? null
  useEffect(() => {
    const shown = focusShownRef.current
    if (shown === null || shown === focusCheckTab) return
    focusShownRef.current = null
    setFocusNumbers(false)
    void api.showFocusOrder(shown, false).catch(() => undefined)
  }, [api, focusCheckTab])
  // A panel closed mid-pick takes the pick with it, rather than leaving the
  // page waiting for a click nobody will act on; pending previews are dropped.
  useEffect(() => {
    const timers = previewTimersRef.current
    return () => {
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
      if (pickingTabRef.current !== null)
        void api.cancelPick(pickingTabRef.current).catch(() => undefined)
      // The mock's controls live here; a mock nobody can move or remove
      // would stay on the page until it reloads.
      if (overlayTabRef.current !== null)
        void api.setDesignOverlay(overlayTabRef.current, null).catch(() => undefined)
      // So are the simulated requests': a page left failing on purpose,
      // with nothing to say so, would look broken.
      if (mocksTabRef.current !== null)
        void api.setRequestMocks(mocksTabRef.current, []).catch(() => undefined)
      if (mocksKeptRef.current !== null)
        void api.keepRequestMocks(mocksKeptRef.current, false).catch(() => undefined)
      if (focusShownRef.current !== null)
        void api.showFocusOrder(focusShownRef.current, false).catch(() => undefined)
      // The toolbar is the panel's remote control: nothing answers it once
      // the panel is gone.
      if (toolbarTabRef.current !== null)
        void api.setPageToolbar(toolbarTabRef.current, null).catch(() => undefined)
    }
  }, [api])

  /**
   * Put picked elements back as the page had them, and forget them there.
   * Best effort: a tab that closed or navigated has nothing left to revert.
   */
  const releasePicks = useCallback(
    (released: readonly PickedElement[]) => {
      const byTab = new Map<number, string[]>()
      for (const pick of released) {
        const timer = previewTimersRef.current.get(pick.elementId)
        if (timer) clearTimeout(timer)
        previewTimersRef.current.delete(pick.elementId)
        byTab.set(pick.tabId, [...(byTab.get(pick.tabId) ?? []), pick.elementId])
      }
      for (const [tabId, ids] of byTab) void api.releaseElements(tabId, ids).catch(() => undefined)
    },
    [api]
  )

  /**
   * Forget measured elements on the page, except those a pick still holds:
   * the picker hands one element one id, and a pick's preview must outlive
   * a measurement taken from it.
   */
  const releaseMeasurements = useCallback(
    (
      released: readonly Measurement[],
      keep: readonly { tabId: number; elementId: string }[] = picksRef.current
    ) => {
      const byTab = new Map<number, Set<string>>()
      for (const measurement of released) {
        const ids = byTab.get(measurement.tabId) ?? new Set<string>()
        for (const id of [measurement.from.elementId, measurement.to.elementId])
          if (!keep.some((held) => held.tabId === measurement.tabId && held.elementId === id))
            ids.add(id)
        byTab.set(measurement.tabId, ids)
      }
      for (const [tabId, ids] of byTab)
        if (ids.size > 0) void api.releaseElements(tabId, [...ids]).catch(() => undefined)
    },
    [api]
  )

  // Paint before anything else. The stored appearance is the Host's last
  // answer, so a panel reopened offline still looks like the app rather than
  // flashing the fallback palette and then correcting itself.
  useEffect(() => {
    void api
      .read<unknown>(STORAGE_KEYS.appearance)
      .then((stored) => {
        if (isAppliedAppearance(stored)) applyAppearance(document.documentElement, stored)
      })
      .catch(() => undefined)
  }, [api])

  useEffect(() => {
    void api.hasLoopbackPermission().then(setHasPermission)
  }, [api])

  // Recover a submission whose response never arrived.
  //
  // This used to live only in the ref, which dies with the panel — so the one
  // case it existed for (the panel closing mid-submit) was exactly the case it
  // could not cover, and reopening minted a fresh id for the same capture. The
  // id is not content: it is a UUID and a fingerprint of the choices, so it is
  // safe in `chrome.storage.local` alongside the pairing record.
  useEffect(() => {
    void api
      .read<{ fingerprint: string; submissionId: string }>(STORAGE_KEYS.pendingSubmission)
      .then((stored) => {
        if (stored?.fingerprint && stored.submissionId) pendingSubmissionRef.current = stored
      })
      .catch(() => undefined)
  }, [api])

  /**
   * Work out where this browser stands with the Host.
   *
   * Returns the answer rather than applying it. Setting state from inside an
   * async function that an effect calls is the shape React's own lint rule
   * objects to — and the objection is fair: it makes "what does connecting
   * decide?" unanswerable without tracing every branch's side effects. As a
   * pure-ish resolver, the branches are one `switch` worth of reading.
   */
  const resolveConnection = useCallback(async (): Promise<{
    state: PanelState
    workspaceId?: string | null
    override?: AppearanceOverride
    nextPageToken?: string
  }> => {
    // The stored appearance override first, because the very first capability
    // call already asks for a mode. Read here rather than in an effect of its
    // own: as separate effects the two raced, and the loser either asked for
    // the wrong mode or re-ran the connection when the override arrived.
    const storedOverride = await api
      .read<unknown>(STORAGE_KEYS.appearanceOverride)
      .catch(() => null)
    if (isAppearanceOverride(storedOverride)) overrideRef.current = storedOverride
    const override = overrideRef.current
    let connection: {
      pairing: PairingRecord
      signer: NonNullable<Awaited<ReturnType<typeof restoreSigner>>>
    }
    try {
      const pairing = await api.read<PairingRecord>(STORAGE_KEYS.pairing)
      if (!pairing) return { state: { kind: "unpaired" }, override }
      const signer = await restoreSigner(pairing)
      if (!signer) {
        // The public record survived but the key did not — a profile copied
        // between machines, or IndexedDB cleared. Treat it as unpaired rather
        // than as an error: the remedy is the same and the state is honest.
        await api.remove([STORAGE_KEYS.pairing])
        return { state: { kind: "unpaired" }, override }
      }
      connection = { pairing, signer }
    } catch {
      return { state: { kind: "storage-error" } }
    }
    const { pairing, signer } = connection
    const client = makeClient({ pairing, signer })
    clientRef.current = client
    try {
      let capability = await client.capability(preferredModeFor(override, undefined, prefersDark()))
      if (!isCompatible(capability)) {
        return {
          state: {
            kind: "incompatible",
            hostSchemaVersion: capability.schemaVersion,
          },
          override,
        }
      }
      // Only now is `followsSystem` known, and it is the one input the Host
      // cannot supply itself. Asking again is a second round trip, and only for
      // a Host in system mode with no local override — the alternative is
      // painting the panel dark for everyone whose system is light, which is
      // what it did before.
      const wanted = preferredModeFor(override, capability.followsSystem, prefersDark())
      if (wanted && wanted !== capability.appearance.mode) {
        capability = await client.capability(wanted)
      }
      applyAppearance(document.documentElement, capability.appearance)
      void api.write(STORAGE_KEYS.appearance, capability.appearance)
      const stored = await api.read<string>(STORAGE_KEYS.lastWorkspaceId)
      const chosen =
        capability.workspaces.find((w) => w.id === stored) ??
        capability.workspaces.find((w) => w.isDefault) ??
        capability.workspaces[0]
      const page = await client.list()
      return {
        state: {
          kind: "ready",
          pairing,
          capability,
          capabilityRevision: page.capabilityRevision,
          recent: page.items,
          captured: null,
        },
        workspaceId: chosen?.id ?? null,
        override,
        ...(page.nextPageToken ? { nextPageToken: page.nextPageToken } : {}),
      }
    } catch (error) {
      const state = panelStateForError(error, pairing)
      // A revoked device's cached access token is dead and its refresh will be
      // refused too. Dropping the client without invalidating leaves that token
      // in the session cache, so a reconnect on the same panel replays it once
      // before finding out — one wasted round trip that reports as an
      // authentication failure rather than as "reconnect".
      if (state.kind === "revoked") client.invalidate()
      return { state, override }
    }
  }, [api, makeClient])

  const connect = useCallback(async () => {
    const next = await resolveConnection()
    setState(next.state)
    if (next.workspaceId !== undefined) setWorkspaceId(next.workspaceId)
    if (next.override) setOverride(next.override)
    setNextPageToken(next.nextPageToken)
  }, [resolveConnection])

  useEffect(() => {
    let cancelled = false
    void resolveConnection().then((next) => {
      if (cancelled) return
      setState(next.state)
      if (next.workspaceId !== undefined) setWorkspaceId(next.workspaceId)
      if (next.override) setOverride(next.override)
      setNextPageToken(next.nextPageToken)
    })
    return () => {
      cancelled = true
    }
  }, [resolveConnection])

  // Follow the Host's ceilings once they are known. Written from an effect so
  // the capture callbacks can read the current value without being rebuilt
  // every time the capability object is replaced by a poll.
  const hostLimits = state.kind === "ready" ? state.capability.limits : undefined
  useEffect(() => {
    limitsRef.current = hostLimits ?? BROWSER_CONTEXT_LIMITS
  }, [hostLimits])

  // The Host's feature list, read by the capture callbacks through a ref for
  // the same reason the limits are.
  const hostFeatures = state.kind === "ready" ? state.capability.features : undefined
  const featuresRef = useRef(hostFeatures ?? [])
  useEffect(() => {
    featuresRef.current = hostFeatures ?? []
  }, [hostFeatures])

  /**
   * Read one tab into a {@link CapturedPage}, or say why it could not be.
   *
   * Only what this Host reads is kept (`withoutUnsupported`), so the preview
   * shows and counts exactly what will be sent; a YouTube watch page also has
   * its transcript read, and "no captions" is kept as the stated outcome.
   */
  const readPage = useCallback(
    async (
      tab: TabRef,
      requested: CaptureScope,
      extras: {
        link?: BrowserLinkContextV1
        image?: BrowserImageContextV1
      } = {}
    ): Promise<{ ok: true; page: CapturedPage } | { ok: false; message: string }> => {
      const decision = normalizeCaptureUrl(tab.url, includeFullUrl)
      if (!decision.ok) return { ok: false, message: api.message("captureRestricted") }
      if (isBlockedUrl(tab.url, preferences.blockedHosts)) {
        return { ok: false, message: api.message("captureBlocked") }
      }
      const features = featuresRef.current
      let capture
      try {
        capture = await api.capturePage(tab.id, {
          wholePage: requested !== "auto",
          article: requested === "article" && features.includes("article"),
        })
      } catch {
        // `activeTab` is granted to the gesture that invoked the extension, on
        // the tab it was invoked from — and it lapses on navigation. Switching
        // tabs with the panel open is the ordinary way to arrive here, so this
        // is an instruction rather than an error.
        return { ok: false, message: api.message("captureNoGrant") }
      }
      const transcript =
        features.includes("transcript") && isYouTubeWatchUrl(tab.url)
          ? await api.captureTranscript(tab.id, navigator.language || "en").catch(() => ({
              status: "unavailable" as const,
              reason: "fetch_failed" as const,
            }))
          : null
      const page = toCapturedPage(
        {
          tabId: tab.id,
          tabTitle: tab.title,
          normalizedUrl: decision.url,
          rawUrl: tab.url,
          strippedQuery: decision.strippedQuery || decision.strippedFragment,
          capture,
          transcript,
          link: extras.link ?? null,
          image: extras.image ?? null,
          capturedAt: now(),
        },
        resolveBrowserContextLimits(limitsRef.current)
      )
      return { ok: true, page: withoutUnsupported(page, features) }
    },
    [api, includeFullUrl, now, preferences.blockedHosts]
  )

  /**
   * Read a page and put it in the preview.
   *
   * `tabId` names the tab the user actually gestured on. It matters because
   * the gesture and this call are not in the same moment: a context-menu click
   * happens in the background worker, which records the request and opens the
   * panel, and the panel may be starting from nothing. By then "the active
   * tab" can be a different page — or, when the panel is a tab rather than a
   * side panel, the panel itself. Falling back to the active tab is right only
   * for the panel's own capture button, where the gesture *is* here.
   */
  const runCapture = useCallback(
    async (
      requested: CaptureScope | boolean,
      tabId?: number,
      extras: {
        link?: BrowserLinkContextV1
        image?: BrowserImageContextV1
      } = {}
    ): Promise<CapturedPage | null> => {
      const wanted: CaptureScope =
        requested === true ? "page" : requested === false ? "auto" : requested
      const tab = tabId === undefined ? await api.activeTab() : await api.tabById(tabId)
      if (!tab) {
        // A recorded request whose tab has since closed. Saying so beats
        // silently doing nothing, which reads as the extension being broken.
        if (tabId !== undefined) setSubmitError(api.message("captureNoGrant"))
        return null
      }
      const outcome = await readPage(tab, wanted, extras)
      if (!outcome.ok) {
        setSubmitError(outcome.message)
        return null
      }
      setSubmitError(null)
      // A new capture is a new submission: whatever the previous one left
      // stalled belongs to the page that was on screen then.
      setStalled(null)
      setStaleTab(false)
      setScope(wanted)
      // Picks and a report describe one page; a capture of another drops them.
      const elsewhere = picksRef.current.filter(
        (pick) => pick.tabId !== outcome.page.tabId || pick.pageUrl !== outcome.page.rawUrl
      )
      if (elsewhere.length > 0) {
        releasePicks(elsewhere)
        setPicks((current) => current.filter((pick) => !elsewhere.includes(pick)))
      }
      const measuredElsewhere = measurementsRef.current.filter(
        (entry) => entry.tabId !== outcome.page.tabId || entry.pageUrl !== outcome.page.rawUrl
      )
      if (measuredElsewhere.length > 0) {
        releaseMeasurements(measuredElsewhere, [])
        setMeasurements((current) => current.filter((entry) => !measuredElsewhere.includes(entry)))
      }
      setDevReport((current) => (current && current.tabId !== outcome.page.tabId ? null : current))
      setTextChanges((current) =>
        current && current.tabId !== outcome.page.tabId ? null : current
      )
      setInsights((current) => insightsForTab(current, outcome.page.tabId))
      setState((current) =>
        current.kind === "ready" ? { ...current, captured: outcome.page } : current
      )
      return outcome.page
    },
    [api, readPage, releasePicks, releaseMeasurements]
  )

  /**
   * Fetch a right-clicked image's bytes as an attachment, when the Host takes
   * attachments and the browser lets the extension read that address. When it
   * does not — no grant for the image's site — the image still goes as its
   * address in the context, and the panel says the file itself is not attached.
   */
  const attachImageFromUrl = useCallback(
    async (url: string) => {
      if (!featuresRef.current.includes("attachments")) return
      const limits = resolveBrowserContextLimits(limitsRef.current)
      try {
        const fetched = await api.fetchBytes(url, limits.attachmentBytes)
        const mediaType = sniffMediaType(fetched.bytes, fetched.mediaType)
        if (
          !BROWSER_ATTACHMENT_MEDIA_TYPES.includes(mediaType) ||
          mediaType === "application/pdf"
        ) {
          setSubmitError(api.message("attachImageUnsupported"))
          return
        }
        setAttachments((current) =>
          current.length >= limits.maxAttachments
            ? current
            : [
                ...current,
                {
                  id: crypto.randomUUID(),
                  name: fileNameFromUrl(url, "image"),
                  mediaType,
                  kind: "image",
                  bytes: fetched.bytes,
                  previewUrl: url,
                },
              ]
        )
      } catch {
        setSubmitError(api.message("attachImageUnreadable"))
      }
    },
    [api]
  )

  /**
   * Act on a capture the background worker recorded, if there is one.
   *
   * Consumed immediately: leaving it in storage would re-capture on every
   * panel open, which is precisely the "reads the page without being asked"
   * behaviour the design forbids. `isCancelled` is checked after the read and
   * before the request is consumed, so a torn-down effect leaves the request
   * for the next one rather than eating it.
   */
  const consumeCaptureRequest = useCallback(
    async (isCancelled: () => boolean) => {
      const request: CaptureRequest | null = parseCaptureRequest(
        await api.read<unknown>(CAPTURE_REQUEST_KEY)
      )
      if (!request || isCancelled()) return
      const identity = `${request.tabId}:${request.mode}:${request.requestedAt}`
      if (consumedCaptureRef.current === identity) return
      consumedCaptureRef.current = identity
      await api.remove([CAPTURE_REQUEST_KEY])
      if (!isFreshCaptureRequest(request, now())) return
      const scopeFor: Record<CaptureRequest["mode"], CaptureScope> = {
        auto: "auto",
        selection: "auto",
        page: "page",
        article: "article",
        link: "auto",
        image: "auto",
        inspect: "auto",
      }
      const captured = await runCapture(scopeFor[request.mode], request.tabId, {
        ...(request.linkUrl
          ? {
              link: {
                url: request.linkUrl,
                ...(request.linkText ? { text: request.linkText } : {}),
              },
            }
          : {}),
        ...(request.srcUrl ? { image: { url: request.srcUrl } } : {}),
      })
      if (!captured) return
      // The picker starts on the page the gesture named, under its grant.
      if (request.mode === "inspect") await startPickRef.current?.(request.tabId)
      if (request.quickAction)
        setInstruction(quickActionInstruction(request.quickAction, api.message))
      else if (request.instruction) setInstruction(request.instruction)
      if (request.srcUrl) await attachImageFromUrl(request.srcUrl)
    },
    [api, now, runCapture, attachImageFromUrl]
  )

  // Pick up a recorded capture once the panel is connected — and keep picking
  // them up while it stays open. Reading only on mount meant a context-menu
  // click made while the panel was already showing did nothing until the
  // panel was closed and opened again.
  const ready = state.kind === "ready"
  useEffect(() => {
    if (!ready) return
    let cancelled = false
    const isCancelled = () => cancelled
    const pickUp = () => {
      void consumeCaptureRequest(isCancelled).catch(() => undefined)
    }
    pickUp()
    const stop = api.onStorageChange(CAPTURE_REQUEST_KEY, (value) => {
      // The panel's own removal arrives here too, as `null`.
      if (value !== null) pickUp()
    })
    return () => {
      cancelled = true
      stop()
    }
  }, [ready, api, consumeCaptureRequest])

  /** The recent list's first page, filtered by the search when there is one. */
  const listFirstPage = useCallback(async () => {
    const search = queryRef.current.trim()
    return clientRef.current?.list(search ? { query: search } : {})
  }, [])
  const olderCountRef = useRef(0)
  useEffect(() => {
    olderCountRef.current = olderItems.length
  }, [olderItems])

  const refreshRecent = useCallback(async () => {
    const page = await listFirstPage().catch(() => undefined)
    if (!page) return
    setState((current) => (current.kind === "ready" ? { ...current, recent: page.items } : current))
    if (olderCountRef.current === 0) setNextPageToken(page.nextPageToken)
  }, [listFirstPage])

  // The search: a new query starts the list over from its first page.
  useEffect(() => {
    if (state.kind !== "ready") return
    const timer = setTimeout(() => {
      if (queryRef.current === query) return
      queryRef.current = query
      setOlderItems([])
      olderCountRef.current = 0
      setNextPageToken(undefined)
      void refreshRecent()
    }, 300)
    return () => clearTimeout(timer)
  }, [query, state.kind, refreshRecent])

  const loadMore = useCallback(async () => {
    if (!nextPageToken) return
    setLoadingMore(true)
    try {
      const search = queryRef.current.trim()
      const page = await clientRef.current?.list({
        pageToken: nextPageToken,
        ...(search ? { query: search } : {}),
      })
      if (page) {
        setOlderItems((current) => [...current, ...page.items])
        setNextPageToken(page.nextPageToken)
      }
    } catch {
      setSubmitError(api.message("recentLoadFailed"))
    } finally {
      setLoadingMore(false)
    }
  }, [api, nextPageToken])

  // Hold a port to the worker while the panel is open: it stops polling on
  // its alarm and skips notifications the panel is already showing.
  const isReady = state.kind === "ready"
  useEffect(() => {
    if (!isReady) return
    let port: PanelPort | null = null
    try {
      port = api.connectPanel()
    } catch {
      port = null
    }
    portRef.current = port
    return () => {
      port?.disconnect()
      portRef.current = null
    }
  }, [api, isReady])

  // The Host said a submission moved (device socket, via the worker): read
  // the list now rather than at the next tick.
  useEffect(() => {
    if (!isReady) return
    return api.onSessionChange(SESSION_KEYS.statusHint, () => {
      void refreshRecent()
    })
  }, [api, isReady, refreshRecent])

  const firstPage = state.kind === "ready" ? state.recent : EMPTY
  // The polled first page, then the pages loaded past it, without repeats: a
  // new submission shifts the offsets, and a row must not show twice.
  const recent = useMemo(() => {
    const seen = new Set(firstPage.map((item) => item.submissionId))
    return [...firstPage, ...olderItems.filter((item) => !seen.has(item.submissionId))]
  }, [firstPage, olderItems])
  const pollMs = useMemo(() => pollIntervalFor(firstPage, now()), [firstPage, now])

  // Ask why, once per failed submission.
  //
  // The list is thin by design and carries no `errorCode`; `browser_context_get`
  // is the only call that answers it. A refusal to read one is not worth
  // surfacing on its own — the row already says the submission failed, and this
  // is the sentence underneath it.
  useEffect(() => {
    const unexplained = recent.filter(
      (item) =>
        STATUSES_WITH_A_REASON.includes(item.status) &&
        !askedForReasonRef.current.has(item.submissionId)
    )
    if (unexplained.length === 0) return
    let cancelled = false
    for (const item of unexplained) askedForReasonRef.current.add(item.submissionId)
    void Promise.all(
      unexplained.map(async (item) => {
        try {
          const detail = await clientRef.current?.get(item.submissionId)
          return [item.submissionId, detail?.errorCode ?? ""] as const
        } catch {
          // Asked and could not be told. The id stays in the asked set: a row
          // whose detail read fails once will fail the same way every poll.
          return [item.submissionId, ""] as const
        }
      })
    ).then((entries) => {
      if (cancelled) return
      const answered = entries.filter(([, code]) => code.length > 0)
      if (answered.length > 0) {
        setFailureCodes((current) => ({
          ...current,
          ...Object.fromEntries(answered),
        }))
      }
    })
    return () => {
      cancelled = true
    }
  }, [recent])

  // Poll only while the panel is visible. A hidden side panel is one the user
  // is not reading, and a request every three seconds for a list nobody is
  // looking at is a cost with no reader.
  // Refs rather than deps: the poll loop is torn down and rebuilt whenever its
  // dependencies change, and restarting a three-second timer every time the
  // recent list moves would make the interval meaningless.
  const revisionRef = useRef<string | undefined>(undefined)
  const preferredModeRef = useRef<"light" | "dark" | undefined>(undefined)
  const readyRevision = state.kind === "ready" ? state.capabilityRevision : undefined
  const followsSystem = state.kind === "ready" ? state.capability.followsSystem : undefined
  useEffect(() => {
    revisionRef.current = readyRevision
  }, [readyRevision])
  useEffect(() => {
    preferredModeRef.current = preferredModeFor(override, followsSystem, prefersDark())
  }, [override, followsSystem])

  useEffect(() => {
    if (state.kind !== "ready") return
    let timer: ReturnType<typeof setTimeout> | undefined
    let stopped = false
    const tick = async () => {
      if (
        stopped ||
        document.visibilityState !== "visible" ||
        Date.now() < pollNotBeforeRef.current
      ) {
        timer = setTimeout(() => void tick(), pollMs)
        return
      }
      try {
        const page = await listFirstPage()
        if (page && !stopped) {
          setState((current) =>
            current.kind === "ready" ? { ...current, recent: page.items } : current
          )
          if (olderCountRef.current === 0) setNextPageToken(page.nextPageToken)
          // The Host says, in one string, whether anything the capability
          // describes has moved — its theme, its workspaces, its delivery
          // targets. Re-reading the whole capability every poll would send a
          // palette every three seconds for a thing that changes when the user
          // does something.
          if (page.capabilityRevision && page.capabilityRevision !== revisionRef.current) {
            // The ref advances only once the new capability is actually in
            // hand. Marking it seen up front meant a single transient failure
            // — a throw the outer catch swallows, an incompatible answer, a
            // teardown mid-flight — left the panel matching a revision whose
            // content it never received, so no later tick ever retried and the
            // targets and palette stayed stale until the Host moved again for
            // an unrelated reason.
            const refreshed = await clientRef.current?.capability(preferredModeRef.current)
            if (refreshed && isCompatible(refreshed) && !stopped) {
              revisionRef.current = page.capabilityRevision
              applyAppearance(document.documentElement, refreshed.appearance)
              void api.write(STORAGE_KEYS.appearance, refreshed.appearance)
              setState((current) =>
                current.kind === "ready"
                  ? {
                      ...current,
                      capability: refreshed,
                      capabilityRevision: page.capabilityRevision,
                    }
                  : current
              )
            }
          }
        }
      } catch (error) {
        // A failed poll is not a state change: the pairing is still good and
        // the next tick may succeed. Only an explicit refusal demotes us. A
        // Host that said how long to wait is given that long.
        const wait = companionRetryAfterMs(error)
        if (wait !== null) pollNotBeforeRef.current = Date.now() + wait
      }
      timer = setTimeout(() => void tick(), pollMs)
    }
    timer = setTimeout(() => void tick(), pollMs)
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
    }
  }, [state.kind, pollMs, api, listFirstPage])

  /**
   * Show or hide one task's answer, fetching it the first time.
   *
   * Fetched on demand rather than with the list: the list is polled and an
   * answer is the largest thing this contract returns, so pulling every one on
   * every tick would move kilobytes for rows nobody is reading. Re-fetched on
   * every expand, because a running task's answer changes.
   */
  const toggleAnswer = useCallback(
    (submissionId: string) => {
      setExpanded((current) =>
        current.includes(submissionId)
          ? current.filter((id) => id !== submissionId)
          : [...current, submissionId]
      )
      if (expanded.includes(submissionId)) return
      answerFetchedAtRef.current[submissionId] =
        recent.find((item) => item.submissionId === submissionId)?.updatedAt ?? 0
      void clientRef.current
        ?.result(submissionId)
        .then((detail) => {
          setAnswers((current) => ({
            ...current,
            [submissionId]: { text: detail.text, truncated: detail.truncated },
          }))
        })
        .catch(() => {
          // The row stays expanded and shows "no answer yet", which is what an
          // unreadable result and an unwritten one look like from here.
          setAnswers((current) => ({ ...current, [submissionId]: {} }))
        })
    },
    [expanded, recent]
  )

  // Keep an open answer live: when a polled row moves, re-read its answer.
  // A finished row moves once more, to its final answer, and then stops.
  useEffect(() => {
    for (const submissionId of expanded) {
      const row = recent.find((item) => item.submissionId === submissionId)
      if (!row) continue
      const fetchedAt = answerFetchedAtRef.current[submissionId] ?? 0
      if (row.updatedAt <= fetchedAt) continue
      answerFetchedAtRef.current[submissionId] = row.updatedAt
      void clientRef.current
        ?.result(submissionId)
        .then((detail) => {
          setAnswers((current) => ({
            ...current,
            [submissionId]: { text: detail.text, truncated: detail.truncated },
          }))
        })
        .catch(() => undefined)
    }
  }, [expanded, recent])

  /**
   * Stop one task.
   *
   * The Host's refusal codes matter here more than usual: "another device is
   * driving this" is not a failure, it is a different place to press the
   * button, and saying "could not be stopped" would send somebody looking for
   * a fault that is not there.
   */
  const stopTask = useCallback(
    async (submissionId: string) => {
      setStopping(submissionId)
      setSubmitError(null)
      try {
        await clientRef.current?.cancel(submissionId)
        await refreshRecent()
      } catch (error) {
        setSubmitError(stopFailureMessage((error as { code?: string })?.code, api.message))
      } finally {
        setStopping(null)
      }
    },
    [api, refreshRecent]
  )

  const onPair = useCallback(
    async (code: string) => {
      setDisconnected(false)
      setLocalCleared(false)
      setState({ kind: "pairing" })
      const granted = (await api.hasLoopbackPermission()) || (await api.requestLoopbackPermission())
      const outcome = await pairWithHost({
        code,
        extensionOrigin: api.extensionOrigin(),
        hasPermission: granted,
        displayName: navigator.userAgent.includes("Edg/") ? "Edge" : "Chrome",
      })
      if (!outcome.ok) {
        setState({ kind: "unpaired", failure: outcome.failure })
        return
      }
      await api.write(STORAGE_KEYS.pairing, outcome.pairing)
      await connect()
    },
    [api, connect]
  )

  const onSubmit = useCallback(async () => {
    if (state.kind !== "ready" || !state.captured || !workspaceId) return
    const features = state.capability.features ?? []
    const limits = resolveBrowserContextLimits(state.capability.limits)
    // How often each simulated response matched, as of sending: the page
    // kept counting since the panel last asked. Best effort — a page that
    // went away keeps the last count read.
    let sentMocks = mocks
    if (mocks && mocks.tabId === state.captured.tabId) {
      // Nothing else is awaited before the button turns busy, so this read is
      // the one window a second click could start a second submission in.
      if (readingMocksRef.current) return
      readingMocksRef.current = true
      try {
        sentMocks = { ...mocks, hits: await api.setRequestMocks(mocks.tabId, null) }
        setMocks(sentMocks)
      } catch {
        // Unreachable now; the counts read last stand.
      } finally {
        readingMocksRef.current = false
      }
    }
    // The picks and the report ride in the page's selection, exactly as the
    // preview counted them.
    const captured = withInspection(
      withDisplayUrl(state.captured, includeFullUrl),
      inspectionFor(picks, devReport, insights, state.captured.tabId, {
        measurements,
        attachments: features.includes("attachments") ? attachments : [],
        textChanges,
        mocks: sentMocks,
        designDiff,
        compare: compareIncluded,
      }),
      features,
      limits
    )
    const mode: BrowserCaptureMode = captureModeFor(captured, scope, features)
    // Every page the person added, each sent in the mode it was captured for
    // (ADR-0228 §2); the Host fences each one separately.
    const extraContexts: BrowserPageContextV1[] = features.includes("multi-page")
      ? extraPages.map((page) =>
          buildPageContext(withDisplayUrl(page, includeFullUrl), "page", features)
        )
      : []
    const primaryContext = buildPageContext(captured, scope, features)
    const pagesCheck = checkPages([primaryContext, ...extraContexts], limits)
    if (!pagesCheck.ok) {
      setSubmitError(
        pagesCheck.reason === "too_many_pages"
          ? api.message("pagesFull")
          : api.message("pagesOverBudget")
      )
      return
    }
    const sendsAttachments = features.includes("attachments") && attachments.length > 0
    // Recomputed here from the same two helpers the control renders from,
    // rather than read out of state: one rule for "which target is selected"
    // means the value sent is by construction the one on screen.
    const offered = targetsForWorkspace(state.capability.deliveryTargets, workspaceId)
    const chosenTarget = selectedTargetId(offered, preferredTargetId)
    const chosen = offered.find((target) => target.id === chosenTarget)
    const declaredParams = chosen?.params ?? []
    const declaredTemplate = chosen?.kind === "template"
    // The Host renders a template's body and REPLACES whatever instruction
    // arrives, so this value is never read for the turn — but `instruction` is
    // `required` with `minLength: 1` on the wire, so sending "" made every
    // template submission a 422 that never reached the Host at all. The
    // template's own name is non-empty by construction (it is the label the
    // user just picked) and is the honest answer to "what was asked" from a
    // client that cannot see the body.
    const templateInstruction = chosen?.label.trim() || chosenTarget || "template"
    setSubmitting(true)
    setSubmitError(null)
    const draft = {
      workspaceId,
      ...(chosenTarget ? { targetId: chosenTarget } : {}),
      // Only the values the chosen target actually declares. Sending the whole
      // map would carry a previous target's answers along, and the Host drops
      // them anyway — this keeps the request describing what was on screen.
      ...(declaredParams.length > 0
        ? {
            targetParams: Object.fromEntries(
              declaredParams.flatMap((param) => {
                const value = targetParams[param.id]
                return value ? [[param.id, value]] : []
              })
            ),
          }
        : {}),
      // A template supplies the instruction on the Host; the field is not shown
      // for one, so sending its stale contents would be sending something the
      // user is not looking at.
      instruction: declaredTemplate ? templateInstruction : instruction.trim(),
      // An edited title is the person's name for the task; an untouched one
      // is the page's, which the Host already has.
      ...(captured.originalTitle !== undefined &&
      captured.title.trim() &&
      captured.title !== captured.originalTitle
        ? { suggestedTitle: captured.title.trim() }
        : {}),
      context: primaryContext,
      ...(extraContexts.length > 0 ? { additionalContexts: extraContexts } : {}),
      // A conversation that may act in this browser starts from the tab the
      // capture came from (ADR-0228 §6).
      ...(chosen?.kind === "browser-agent" ? { browserAgent: { tabId: captured.tabId } } : {}),
    }
    // Cheap discriminators, not the payload. `readableText` runs to the
    // whole-page ceiling, so hashing the draft serialized hundreds of KB on the
    // main thread on every press — and then `submit` serialized the same object
    // again for the request body, a visible hitch on the click for nothing.
    // What decides "same capture" is the page, the moment it was taken, the
    // mode, the ask and the target; the two content lengths catch a
    // re-extraction of the same URL.
    const fingerprint = JSON.stringify([
      workspaceId,
      // Where it goes is part of what makes this the same submission. Leaving
      // it out would let a retry that changed the destination reuse the first
      // one's id, which the Host refuses — as a mismatch the user cannot see
      // the cause of.
      chosenTarget,
      draft.instruction,
      // The values are part of what makes this the same submission: a retry
      // that changed one and reused the id would ask a different question of
      // the page the first attempt captured.
      JSON.stringify(draft.targetParams ?? {}),
      mode,
      captured.url,
      captured.capturedAt,
      captured.title,
      contextContentBytes(primaryContext),
      extraContexts.map((context) => [
        context.url,
        context.capturedAt,
        contextContentBytes(context),
      ]),
      sendsAttachments
        ? attachments.map((attachment) => [attachment.id, attachment.bytes.byteLength])
        : [],
    ])
    const reuse = pendingSubmissionRef.current?.fingerprint === fingerprint
    const submissionId = reuse
      ? (pendingSubmissionRef.current?.submissionId ?? crypto.randomUUID())
      : crypto.randomUUID()
    // Re-driving a stalled submission. Same submission id, so the Host finds
    // its own row and finishes it in the conversation it already created — but
    // a FRESH idempotency key, because the Host's operation ledger holds a
    // final receipt for the old one and would only replay "the runtime is not
    // there" back at us. The lost-response retry above is the opposite case:
    // no answer ever arrived, so the old key is exactly what should replay.
    const redrive = reuse && stalled?.submissionId === submissionId
    pendingSubmissionRef.current = { fingerprint, submissionId }
    await api.write(STORAGE_KEYS.pendingSubmission, {
      fingerprint,
      submissionId,
    })
    try {
      // Staged first, under this submission id: the Host binds them to the
      // conversation only when the submission lands, and an upload that fails
      // leaves the whole capture on screen to try again.
      const attachmentRefs: BrowserAttachmentRefV1[] = []
      if (sendsAttachments && clientRef.current) {
        const client = clientRef.current
        setUploadProgress(Object.fromEntries(attachments.map((attachment) => [attachment.id, 0])))
        try {
          for (const attachment of attachments) {
            attachmentRefs.push(
              await uploadAttachment(client, submissionId, attachment, {
                maxBytes: limits.attachmentBytes,
                onProgress: (sent, total) =>
                  setUploadProgress((current) => ({
                    ...current,
                    [attachment.id]: total > 0 ? sent / total : 1,
                  })),
              })
            )
          }
        } finally {
          setUploadProgress({})
        }
      }
      const response = await clientRef.current?.submit(
        {
          submissionId,
          ...draft,
          ...(attachmentRefs.length > 0 ? { attachments: attachmentRefs } : {}),
        },
        redrive ? { idempotencyKey: crypto.randomUUID() } : undefined
      )
      if (response?.status === "host_unavailable") {
        // Accepted, recorded, and not started. Everything the user reviewed
        // stays on screen and the id stays pending, so "try again" is the same
        // submission rather than a second task beside an empty one.
        setStalled({ submissionId })
        await refreshRecent()
        return
      }
      setStalled(null)
      pendingSubmissionRef.current = null
      await api.remove([STORAGE_KEYS.pendingSubmission])
      void api.write(STORAGE_KEYS.lastWorkspaceId, workspaceId)
      setInstruction("")
      setExtraPages([])
      setAttachments([])
      setAnnotating(null)
      setDroppedAttachments(0)
      // Sent: the request now lives in the conversation, and the page goes
      // back to what its source says until the agent changes that.
      releasePicks(picks)
      setPicks([])
      setDetachedPicks([])
      releaseMeasurements(measurements, [])
      setMeasurements([])
      setDetachedMeasures([])
      setTextChanges(null)
      setDevReport(null)
      setInsights(NO_INSIGHTS)
      setDesignDiff(null)
      void api.removeSession([SESSION_KEYS.draft]).catch(() => undefined)
      portRef.current?.post({ kind: "refresh-status" })
      setState((current) => (current.kind === "ready" ? { ...current, captured: null } : current))
      // Both, because a submission changes both: the recent list gains a row,
      // and the target catalogue gains the conversation it just started. The
      // catalogue is only re-read here and on connect — it is a small list that
      // changes when the user does something, not on its own.
      const [page, capability] = await Promise.all([
        listFirstPage().catch(() => undefined),
        clientRef.current?.capability(preferredModeRef.current).catch(() => undefined),
      ])
      setState((current) =>
        current.kind === "ready"
          ? {
              ...current,
              ...(page ? { recent: page.items } : {}),
              ...(capability && isCompatible(capability) ? { capability } : {}),
            }
          : current
      )
    } catch (error) {
      if (error instanceof AttachmentUploadError) {
        setSubmitError(api.message("attachUploadFailed", [error.message]))
        return
      }
      const code = (error as { code?: unknown })?.code
      setSubmitError(
        submitFailureMessage(
          typeof code === "string" && code.length > 0 ? code : undefined,
          error instanceof Error ? error.message : String(error),
          api.message
        )
      )
      // The panel offered something the Host no longer has. Re-reading the
      // catalogue lets the workspace and target controls re-derive from what
      // is actually there, instead of inviting the same refusal again.
      if (typeof code === "string" && STALE_CATALOGUE_CODES.includes(code)) {
        const capability = await clientRef.current
          ?.capability(preferredModeRef.current)
          .catch(() => undefined)
        if (capability && isCompatible(capability)) {
          setState((current) => (current.kind === "ready" ? { ...current, capability } : current))
          if (!capability.workspaces.some((workspace) => workspace.id === workspaceId)) {
            setWorkspaceId(
              (
                capability.workspaces.find((workspace) => workspace.isDefault) ??
                capability.workspaces[0]
              )?.id ?? null
            )
          }
        }
      }
    } finally {
      setSubmitting(false)
    }
  }, [
    api,
    attachments,
    compareIncluded,
    devReport,
    extraPages,
    includeFullUrl,
    insights,
    instruction,
    listFirstPage,
    measurements,
    mocks,
    designDiff,
    picks,
    textChanges,
    preferredTargetId,
    refreshRecent,
    releaseMeasurements,
    releasePicks,
    scope,
    stalled,
    state,
    targetParams,
    workspaceId,
  ])

  // Restore the unsent draft once, when the panel first connects (ADR-0228 §8).
  const captured0 = state.kind === "ready" ? state.captured : null
  useEffect(() => {
    if (!isReady || draftRestoredRef.current) return
    draftRestoredRef.current = true
    let cancelled = false
    void api
      .readSession<unknown>(SESSION_KEYS.draft)
      .then((stored) => {
        const draft = parseDraft(stored, now())
        if (cancelled || !draft || isEmptyDraft(draft)) return
        setState((current) =>
          current.kind === "ready" && !current.captured
            ? { ...current, captured: draft.captured }
            : current
        )
        setExtraPages(draft.extraPages)
        setScope(draft.scope)
        setInstruction((current) => current || draft.instruction)
        if (draft.workspaceId) setWorkspaceId(draft.workspaceId)
        if (draft.targetId) setPreferredTargetId(draft.targetId)
        setTargetParams(draft.targetParams)
        setIncludeFullUrl(draft.includeFullUrl)
        setDroppedAttachments(draft.droppedAttachments)
        setPicks(draft.picks)
        setMeasurements(draft.measurements)
        setTextChanges(draft.textChanges)
        setDevReport(draft.devReport)
        setInsights(draft.insights)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [api, isReady, now])

  // Keep the draft as it changes, a moment after the last keystroke.
  useEffect(() => {
    if (!isReady || !draftRestoredRef.current) return
    const timer = setTimeout(() => {
      const draft: PanelDraft = {
        v: 1,
        captured: captured0,
        extraPages,
        scope,
        instruction,
        workspaceId,
        targetId: preferredTargetId,
        targetParams,
        includeFullUrl,
        droppedAttachments: attachments.length,
        picks,
        measurements,
        textChanges,
        devReport,
        insights,
        savedAt: now(),
      }
      if (isEmptyDraft(draft)) void api.removeSession([SESSION_KEYS.draft]).catch(() => undefined)
      else void api.writeSession(SESSION_KEYS.draft, draft).catch(() => undefined)
    }, 400)
    return () => clearTimeout(timer)
  }, [
    api,
    attachments.length,
    captured0,
    devReport,
    extraPages,
    includeFullUrl,
    insights,
    instruction,
    isReady,
    measurements,
    now,
    picks,
    preferredTargetId,
    scope,
    targetParams,
    textChanges,
    workspaceId,
  ])

  // Say so when the captured tab has moved on: the capture describes a page
  // that is no longer the one on screen, and recapturing is one click.
  const capturedTabId = captured0?.tabId
  const capturedRawUrl = captured0?.rawUrl
  useEffect(() => {
    if (capturedTabId === undefined || capturedRawUrl === undefined) return
    let cancelled = false
    const check = async () => {
      const tab = await api.tabById(capturedTabId).catch(() => null)
      if (!cancelled) setStaleTab(!tab || tab.url !== capturedRawUrl)
    }
    void check()
    const timer = setInterval(() => void check(), 2_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [api, capturedTabId, capturedRawUrl])

  /** The tab an attachment action works on: the captured one, else the active one. */
  const attachmentTab = useCallback(async (): Promise<TabRef | null> => {
    return capturedTabId !== undefined ? api.tabById(capturedTabId) : api.activeTab()
  }, [api, capturedTabId])

  const addAttachment = useCallback((attachment: PendingAttachment) => {
    setAttachments((current) => [...current, attachment])
  }, [])

  const sleep = useCallback(
    (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    []
  )

  const onAttach = useCallback(
    async (action: AttachAction) => {
      setSubmitError(null)
      setAttachBusy(action)
      try {
        const tab = await attachmentTab()
        if (!tab) {
          setSubmitError(api.message("captureNoGrant"))
          return
        }
        const limits = resolveBrowserContextLimits(limitsRef.current)
        if (action === "pdf") {
          // The PDF's own address: reading it needs that site, asked for now,
          // inside the click.
          let origin: string
          try {
            origin = `${new URL(tab.url).origin}/*`
          } catch {
            setSubmitError(api.message("attachPdfUnreadable"))
            return
          }
          if (!(await api.requestPermissions({ origins: [origin] }))) {
            setSubmitError(api.message("pagesOriginDenied"))
            return
          }
          const fetched = await api.fetchBytes(tab.url, limits.attachmentBytes)
          if (sniffMediaType(fetched.bytes, fetched.mediaType) !== "application/pdf") {
            setSubmitError(api.message("attachPdfUnreadable"))
            return
          }
          addAttachment({
            id: crypto.randomUUID(),
            name: fileNameFromUrl(tab.url, "document.pdf"),
            mediaType: "application/pdf",
            kind: "pdf",
            bytes: fetched.bytes,
          })
          return
        }
        if (action === "full-page") {
          const shot = await captureFullPage(api, tab, sleep)
          const attachment = screenshotAttachment(
            crypto.randomUUID(),
            shot.base64,
            now(),
            "full-page"
          )
          if (attachment.bytes.byteLength > limits.attachmentBytes) {
            setSubmitError(api.message("attachTooLarge"))
            return
          }
          addAttachment(attachment)
          if (shot.truncated) setSubmitError(api.message("attachFullPageCut"))
          return
        }
        const visible = await captureVisible(api, tab, sleep)
        if (action === "region") {
          setRegionSource(visible)
          return
        }
        const shot = screenshotAttachment(
          crypto.randomUUID(),
          visible.replace(/^data:[^,]*,/, ""),
          now(),
          "visible"
        )
        addAttachment(shot)
        // Mark up the screen: the shot, straight into the markup.
        if (action === "markup") setAnnotating({ id: shot.id, src: visible, shapes: [] })
      } catch (error) {
        setSubmitError(
          error instanceof Error && error.message === "too_large"
            ? api.message("attachTooLarge")
            : api.message("attachFailed")
        )
      } finally {
        setAttachBusy(null)
      }
    },
    [addAttachment, api, attachmentTab, now, sleep]
  )

  const onRegionChosen = useCallback(
    async (rect: { x: number; y: number; width: number; height: number }) => {
      const source = regionSource
      setRegionSource(null)
      if (!source) return
      try {
        const base64 = await api.cropImage(source, rect)
        addAttachment(screenshotAttachment(crypto.randomUUID(), base64, now(), "region"))
      } catch {
        setSubmitError(api.message("attachFailed"))
      }
    },
    [addAttachment, api, now, regionSource]
  )

  /** Open the markup for a screenshot, from the clean shot when it was marked before. */
  const openAnnotator = useCallback((id: string) => {
    const attachment = attachmentsRef.current.find((entry) => entry.id === id)
    if (!attachment?.previewUrl || attachment.kind !== "screenshot") return
    setSubmitError(null)
    setAnnotating({
      id,
      src: attachment.annotation?.original ?? attachment.previewUrl,
      shapes: attachment.annotation?.shapes ?? [],
    })
  }, [])

  /**
   * Burn the marks into the screenshot. The clean shot is kept beside it, so
   * marking up again starts from it, and taking every mark away restores it.
   */
  const onAnnotated = useCallback(
    async (shapes: Shape[]) => {
      const session = annotating
      if (!session) return
      const attachment = attachmentsRef.current.find((entry) => entry.id === session.id)
      if (!attachment) {
        setAnnotating(null)
        return
      }
      const original = session.src.replace(/^data:[^,]*,/, "")
      setAnnotateBusy(true)
      try {
        const base64 = shapes.length > 0 ? await api.annotateImage(session.src, shapes) : original
        const bytes = base64ToBytes(base64)
        const limits = resolveBrowserContextLimits(limitsRef.current)
        if (bytes.byteLength > limits.attachmentBytes) {
          setSubmitError(api.message("attachTooLarge"))
          return
        }
        setAttachments((current) =>
          current.map((entry) => {
            if (entry.id !== attachment.id) return entry
            const { annotation: _previous, ...rest } = entry
            return {
              ...rest,
              bytes,
              previewUrl: `data:image/png;base64,${base64}`,
              ...(shapes.length > 0 ? { annotation: { original: session.src, shapes } } : {}),
            }
          })
        )
        setAnnotating(null)
      } catch {
        setSubmitError(api.message("annotateFailed"))
      } finally {
        setAnnotateBusy(false)
      }
    },
    [annotating, api]
  )

  /**
   * The tab a page tool works on — the captured one, else the one in front —
   * when it is a page the person may hand over at all.
   */
  const toolTab = useCallback(async (): Promise<TabRef | null> => {
    const tab = await attachmentTab()
    if (!tab) {
      setSubmitError(api.message("captureNoGrant"))
      return null
    }
    if (!normalizeCaptureUrl(tab.url).ok) {
      setSubmitError(api.message("captureRestricted"))
      return null
    }
    if (isBlockedUrl(tab.url, preferences.blockedHosts)) {
      setSubmitError(api.message("captureBlocked"))
      return null
    }
    return tab
  }, [api, attachmentTab, preferences.blockedHosts])

  /**
   * A screenshot of one element, cropped from the visible area, as an
   * attachment; its id, or nothing when the Host takes no attachments, there
   * is no room, or the shot failed — a pick is still a pick without one.
   */
  const shootElement = useCallback(
    async (tab: TabRef, box: ElementBox, dpr: number): Promise<string | undefined> => {
      if (!featuresRef.current.includes("attachments")) return undefined
      const limits = resolveBrowserContextLimits(limitsRef.current)
      if (attachmentsRef.current.length >= limits.maxAttachments) return undefined
      try {
        const visible = await captureVisible(api, tab, sleep)
        const base64 = await api.cropImage(visible, elementCrop(box, dpr))
        const attachment = screenshotAttachment(crypto.randomUUID(), base64, now(), "element")
        if (attachment.bytes.byteLength > limits.attachmentBytes) return undefined
        addAttachment(attachment)
        return attachment.id
      } catch {
        return undefined
      }
    },
    [addAttachment, api, now, sleep]
  )

  /**
   * Let the person point at an element (Design Mode, React Grab).
   *
   * The pick belongs to a captured page, so a panel with nothing captured — or
   * a capture of a page the tab has since left — captures first, the way the
   * capture button would. The tab comes to the front for the click, and the
   * element's screenshot is taken the moment it is chosen.
   */
  /**
   * The capture a page tool's result belongs to: the one in the panel when it
   * shows this tab as it is now, otherwise a fresh one of it.
   */
  const ensureCapture = useCallback(
    async (tab: TabRef): Promise<boolean> =>
      Boolean(
        (captured0 && captured0.tabId === tab.id && captured0.rawUrl === tab.url) ||
        (await runCapture("auto", tab.id))
      ),
    [captured0, runCapture]
  )

  /**
   * Add one described element to the picks, with its screenshot; false when
   * it was already there — then what the page says is refreshed and what the
   * person wrote is kept.
   */
  const addPick = useCallback(
    async (tab: TabRef, description: ElementDescription, note = ""): Promise<boolean> => {
      const again = picksRef.current.find(
        (pick) => pick.tabId === tab.id && pick.elementId === description.elementId
      )
      if (again) {
        setPicks((current) =>
          current.map((pick) => (pick === again ? { ...pick, ...description } : pick))
        )
        return false
      }
      const shot = await shootElement(tab, description.box, description.viewport.dpr)
      setPicks((current) => [
        ...current,
        {
          ...description,
          tabId: tab.id,
          pageUrl: tab.url,
          pickedAt: now(),
          note,
          edits: { styles: {} },
          screenshotIds: shot ? [shot] : [],
        },
      ])
      setInstruction((current) =>
        current.trim() ? current : api.message("inspectDefaultInstruction")
      )
      return true
    },
    [api, now, shootElement]
  )

  const startPick = useCallback(
    async (tabId?: number) => {
      setSubmitError(null)
      if (picksRef.current.length >= MAX_PICKS) {
        setSubmitError(api.message("inspectFull"))
        return
      }
      const known = tabId ?? captured0?.tabId
      const tab = known !== undefined ? await api.tabById(known) : await api.activeTab()
      if (!tab) {
        setSubmitError(api.message("captureNoGrant"))
        return
      }
      if (!(await ensureCapture(tab))) return
      setPointing("pick")
      setPickingTab(tab.id)
      try {
        await api.activateTab(tab.id).catch(() => undefined)
        // One element or several — Shift-click, Alt-click for all alike, or
        // a box dragged over the page — added in the order chosen.
        let count = picksRef.current.length
        const picked = await api.pickElements(
          tab.id,
          {
            hint: api.message("inspectPickHint"),
            selected: api.message("inspectPickSelected", ["{n}"]),
            done: api.message("inspectPickDone"),
          },
          MAX_PICKS - count
        )
        if (!picked) return
        for (const description of picked) {
          if (count >= MAX_PICKS) {
            setSubmitError(api.message("inspectFull"))
            return
          }
          if (await addPick(tab, description)) count++
        }
      } catch {
        // `activeTab` lapsed, or the page went away under the pick.
        setSubmitError(api.message("inspectFailed"))
      } finally {
        setPickingTab(null)
      }
    },
    [addPick, api, captured0, ensureCapture]
  )
  useEffect(() => {
    startPickRef.current = startPick
  }, [startPick])

  /** One measurement into the list, for the tab it was taken on. */
  const addMeasurement = useCallback(
    (tab: TabRef, result: NonNullable<MeasureResult>) => {
      const { more: _more, ...measured } = result
      setMeasurements((current) => [
        ...current,
        {
          ...measured,
          id: crypto.randomUUID(),
          tabId: tab.id,
          pageUrl: tab.url,
          measuredAt: now(),
          note: "",
        },
      ])
      setInstruction((current) =>
        current.trim() ? current : api.message("measureDefaultInstruction")
      )
    },
    [api, now]
  )

  /**
   * Let the person measure between elements (VisBug): the first click
   * anchors, the second measures; Shift-click keeps measuring from the same
   * anchor. Belongs to a captured page, like a pick.
   */
  const startMeasure = useCallback(async () => {
    setSubmitError(null)
    if (measurementsRef.current.length >= MAX_MEASUREMENTS) {
      setSubmitError(api.message("measureFull"))
      return
    }
    const known = captured0?.tabId
    const tab = known !== undefined ? await api.tabById(known) : await api.activeTab()
    if (!tab) {
      setSubmitError(api.message("captureNoGrant"))
      return
    }
    if (!(await ensureCapture(tab))) return
    setPointing("measure")
    setPickingTab(tab.id)
    try {
      await api.activateTab(tab.id).catch(() => undefined)
      const hints = {
        hint: api.message("measureHint"),
        anchorHint: api.message("measureAnchorHint"),
      }
      let count = measurementsRef.current.length
      let anchorId: string | undefined
      for (;;) {
        const result = await api.measureElements(tab.id, hints, anchorId)
        if (!result) return
        addMeasurement(tab, result)
        count++
        if (!result.more) return
        if (count >= MAX_MEASUREMENTS) {
          setSubmitError(api.message("measureFull"))
          return
        }
        anchorId = result.from.elementId
      }
    } catch {
      setSubmitError(api.message("measureFailed"))
    } finally {
      setPickingTab(null)
    }
  }, [addMeasurement, api, captured0, ensureCapture])

  /** Draw a measurement on the page again, and take its numbers as they are now. */
  const showMeasurement = useCallback(
    async (id: string) => {
      const measurement = measurementsRef.current.find((entry) => entry.id === id)
      if (!measurement) return
      setMeasureBusy(id)
      const mark = (gone: boolean) =>
        setDetachedMeasures((current) =>
          gone
            ? current.includes(id)
              ? current
              : [...current, id]
            : current.filter((entry) => entry !== id)
        )
      try {
        await api.activateTab(measurement.tabId).catch(() => undefined)
        const fresh = await api.showMeasurement(
          measurement.tabId,
          measurement.from.elementId,
          measurement.to.elementId
        )
        mark(fresh === null)
        if (!fresh) return
        setMeasurements((current) =>
          current.map((entry) =>
            entry.id === id
              ? { ...entry, from: fresh.from, to: fresh.to, measure: fresh.measure }
              : entry
          )
        )
      } catch {
        mark(true)
      } finally {
        setMeasureBusy(null)
      }
    },
    [api]
  )

  const removeMeasurement = useCallback(
    (id: string) => {
      const measurement = measurementsRef.current.find((entry) => entry.id === id)
      if (!measurement) return
      const rest = measurementsRef.current.filter((entry) => entry !== measurement)
      // An element another measurement still measures stays held.
      const stillMeasured = rest.flatMap((entry) =>
        [entry.from, entry.to].map((element) => ({
          tabId: entry.tabId,
          elementId: element.elementId,
        }))
      )
      releaseMeasurements([measurement], [...picksRef.current, ...stillMeasured])
      setMeasurements(rest)
      setDetachedMeasures((current) => current.filter((entry) => entry !== id))
    },
    [releaseMeasurements]
  )

  /**
   * Make the page's words editable where they are (Design Mode). The edits
   * belong to a captured page, like a pick; "Done" reads them back.
   */
  const startTextEditing = useCallback(async () => {
    setSubmitError(null)
    const known = captured0?.tabId
    const tab = known !== undefined ? await api.tabById(known) : await api.activeTab()
    if (!tab) {
      setSubmitError(api.message("captureNoGrant"))
      return
    }
    if (!(await ensureCapture(tab))) return
    try {
      await api.activateTab(tab.id).catch(() => undefined)
      await api.editPageText(tab.id, api.message("textEditHint"))
      setTextEditingTab(tab.id)
    } catch {
      setSubmitError(api.message("textEditFailed"))
    }
  }, [api, captured0, ensureCapture])

  /** Leave editing: keep the edits and read them back, or unwind them all. */
  const stopTextEditing = useCallback(
    async (keep: boolean) => {
      const tabId = textEditingTab
      if (tabId === null) return
      setTextEditingTab(null)
      try {
        const changes = await api.stopEditingPageText(tabId, keep)
        if (!keep || changes.length === 0) return
        setTextChanges({ tabId, changes })
        setInstruction((current) =>
          current.trim() ? current : api.message("textEditDefaultInstruction")
        )
      } catch {
        setSubmitError(api.message("textEditFailed"))
      }
    },
    [api, textEditingTab]
  )

  /**
   * End the pass the panel shows as running. The panel shows it from the
   * moment it asks, before the page has started it; a cancel that arrives in
   * between finds nothing to end, so it asks again until the pass has
   * started and ended, or the panel stopped pointing.
   */
  const cancelPick = useCallback(() => {
    const tabId = pickingTab
    if (tabId === null) return
    void (async () => {
      for (let attempt = 0; attempt < 20; attempt++) {
        const ended = await api.cancelPick(tabId).catch(() => true)
        if (ended || pickingTabRef.current !== tabId) return
        await sleep(100)
      }
    })()
  }, [api, pickingTab, sleep])

  const markDetached = useCallback((elementId: string, detached: boolean) => {
    setDetachedPicks((current) =>
      detached
        ? current.includes(elementId)
          ? current
          : [...current, elementId]
        : current.filter((id) => id !== elementId)
    )
  }, [])

  /** A note or an edit changed; edits preview on the page a moment after the last keystroke. */
  const updatePick = useCallback(
    (elementId: string, next: Pick<PickedElement, "note" | "edits">) => {
      const pick = picksRef.current.find((entry) => entry.elementId === elementId)
      if (!pick) return
      setPicks((current) =>
        current.map((entry) => (entry.elementId === elementId ? { ...entry, ...next } : entry))
      )
      if (JSON.stringify(next.edits) === JSON.stringify(pick.edits)) return
      const timers = previewTimersRef.current
      const pending = timers.get(elementId)
      if (pending) clearTimeout(pending)
      timers.set(
        elementId,
        setTimeout(() => {
          timers.delete(elementId)
          void api
            .previewElementEdits(pick.tabId, elementId, sanitizeEdits(next.edits))
            .then((applied) => markDetached(elementId, !applied))
            .catch(() => markDetached(elementId, true))
        }, 150)
      )
    },
    [api, markDetached]
  )

  const removePick = useCallback(
    (elementId: string) => {
      const pick = picksRef.current.find((entry) => entry.elementId === elementId)
      if (!pick) return
      const measured = measurementsRef.current.some(
        (entry) =>
          entry.tabId === pick.tabId &&
          (entry.from.elementId === elementId || entry.to.elementId === elementId)
      )
      // Still measured: put the page back, but keep the handle the measurement uses.
      if (measured) void api.revertElement(pick.tabId, elementId).catch(() => undefined)
      else releasePicks([pick])
      setPicks((current) => current.filter((entry) => entry.elementId !== elementId))
      setAttachments((current) =>
        current.filter((attachment) => !pick.screenshotIds.includes(attachment.id))
      )
      markDetached(elementId, false)
    },
    [api, markDetached, releasePicks]
  )

  const locatePick = useCallback(
    async (elementId: string, shoot: boolean) => {
      const pick = picksRef.current.find((entry) => entry.elementId === elementId)
      if (!pick) return
      setPickBusy({ elementId, action: shoot ? "shoot" : "locate" })
      try {
        const tab = await api.tabById(pick.tabId)
        if (!tab) {
          markDetached(elementId, true)
          return
        }
        await api.activateTab(tab.id).catch(() => undefined)
        const box = await api.locateElement(tab.id, elementId, !shoot)
        markDetached(elementId, box === null)
        if (!box || !shoot) return
        const shot = await shootElement(tab, box, box.dpr)
        if (!shot) {
          setSubmitError(api.message("attachFailed"))
          return
        }
        setPicks((current) =>
          current.map((entry) =>
            entry.elementId === elementId
              ? { ...entry, screenshotIds: [...entry.screenshotIds, shot] }
              : entry
          )
        )
      } catch {
        markDetached(elementId, true)
      } finally {
        setPickBusy(null)
      }
    },
    [api, markDetached, shootElement]
  )

  /**
   * Resize a pick by its edges and nudge its spacing on the page (VisBug,
   * UiToolbar); what it changed joins the pick's style edits.
   */
  const adjustPick = useCallback(
    async (elementId: string) => {
      const pick = picksRef.current.find((entry) => entry.elementId === elementId)
      if (!pick) return
      setSubmitError(null)
      const tab = await api.tabById(pick.tabId)
      if (!tab) {
        markDetached(elementId, true)
        return
      }
      setPointing("adjust")
      setPickingTab(tab.id)
      setPickBusy({ elementId, action: "adjust" })
      try {
        await api.activateTab(tab.id).catch(() => undefined)
        const changes = await api.adjustElement(tab.id, elementId, api.message("adjustHint"), {
          margin: api.message("adjustMargin"),
          padding: api.message("adjustPadding"),
        })
        const current = picksRef.current.find((entry) => entry.elementId === elementId)
        if (!changes || Object.keys(changes).length === 0 || !current) return
        updatePick(elementId, {
          note: current.note,
          edits: { ...current.edits, styles: { ...current.edits.styles, ...changes } },
        })
      } catch {
        setSubmitError(api.message("adjustFailed"))
      } finally {
        setPickingTab(null)
        setPickBusy(null)
      }
    },
    [api, markDetached, updatePick]
  )

  const finishAdjust = useCallback(() => {
    if (pickingTab !== null) void api.finishAdjust(pickingTab).catch(() => undefined)
  }, [api, pickingTab])

  /** Float the tools on the page (VisBug, UiToolbar), or take them away. */
  const toggleToolbar = useCallback(async () => {
    setSubmitError(null)
    if (toolbarTab !== null) {
      void api.setPageToolbar(toolbarTab, null).catch(() => undefined)
      setToolbarTab(null)
      return
    }
    const tab = await toolTab()
    const state = toolbarStateRef.current
    if (!tab || !state) return
    try {
      await api.activateTab(tab.id).catch(() => undefined)
      if (await api.setPageToolbar(tab.id, state)) setToolbarTab(tab.id)
      else setSubmitError(api.message("toolbarFailed"))
    } catch {
      setSubmitError(api.message("toolbarFailed"))
    }
  }, [api, toolTab, toolbarTab])

  /** Start listening to the tab's console and requests, for a bug report (Jam). */
  const onRecord = useCallback(async () => {
    setSubmitError(null)
    setToolBusy("record")
    try {
      const tab = await toolTab()
      if (!tab) return
      await api.startDevRecording(tab.id)
      setRecording({ tabId: tab.id, since: now() })
    } catch {
      setSubmitError(api.message("devRecordFailed"))
    } finally {
      setToolBusy(null)
    }
  }, [api, now, toolTab])

  /** Read what the console and requests said into a report on the capture. */
  const onAttachReport = useCallback(async () => {
    setSubmitError(null)
    setToolBusy("report")
    try {
      const tab = await toolTab()
      if (!tab || !(await ensureCapture(tab))) return
      const snapshot = await api.readDevSnapshot(tab.id)
      const since = recording?.tabId === tab.id ? recording.since : null
      if (since !== null && !snapshot.recording) {
        // The page reloaded and took the recorder with it.
        setRecording(null)
        setSubmitError(api.message("devRecordingLost"))
      }
      setDevReport(
        buildDevReport(snapshot, {
          tabId: tab.id,
          now: now(),
          includeFullUrl,
          recordingSince: since,
        })
      )
      setInstruction((current) => (current.trim() ? current : api.message("devDefaultInstruction")))
    } catch {
      setSubmitError(api.message("devReportFailed"))
    } finally {
      setToolBusy(null)
    }
  }, [api, ensureCapture, includeFullUrl, now, recording, toolTab])

  /** Lay a design mock over the tab (PerfectPixel). */
  const onOverlayFile = useCallback(
    async (file: File) => {
      setSubmitError(null)
      if (file.size > DESIGN_OVERLAY_MAX_BYTES) {
        setSubmitError(api.message("attachTooLarge"))
        return
      }
      setToolBusy("overlay")
      try {
        const tab = await toolTab()
        if (!tab) return
        const image = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result))
          reader.onerror = () => reject(reader.error)
          reader.readAsDataURL(file)
        })
        const settings: OverlaySettings = {
          name: file.name,
          opacity: overlay?.opacity ?? 0.5,
          x: overlay?.x ?? 0,
          y: overlay?.y ?? 0,
          scale: overlay?.scale ?? 1,
          difference: overlay?.difference ?? false,
          visible: true,
        }
        if (overlay && overlay.tabId !== tab.id)
          void api.setDesignOverlay(overlay.tabId, null).catch(() => undefined)
        const { name: _name, ...state } = settings
        await api.setDesignOverlay(tab.id, { ...state, image })
        overlayImageRef.current = image
        setOverlay({ ...settings, tabId: tab.id })
      } catch {
        setSubmitError(api.message("overlayFailed"))
      } finally {
        setToolBusy(null)
      }
    },
    [api, overlay, toolTab]
  )

  const onOverlayChange = useCallback(
    (next: OverlaySettings) => {
      if (!overlay) return
      setOverlay({ ...next, tabId: overlay.tabId })
      const { name: _name, ...state } = next
      void api.setDesignOverlay(overlay.tabId, { ...state, image: null }).catch(() => {
        // The page reloaded and the mock went with it.
        setOverlay(null)
        setSubmitError(api.message("overlayFailed"))
      })
    },
    [api, overlay]
  )

  const onOverlayRemove = useCallback(() => {
    if (overlay) void api.setDesignOverlay(overlay.tabId, null).catch(() => undefined)
    overlayImageRef.current = null
    setOverlay(null)
  }, [api, overlay])

  const removeDesignDiff = useCallback(() => {
    const attachmentId = designDiff?.attachmentId
    if (attachmentId)
      setAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId))
    setDesignDiff(null)
  }, [designDiff])

  /**
   * Measure the build against the mock (PerfectPixel): the visible page,
   * captured with the overlay hidden for the moment of the shot, compared
   * with the mock where the overlay puts it. The highlighted difference is
   * attached and the numbers are sent.
   */
  const onCompareDesign = useCallback(async () => {
    const mock = overlayImageRef.current
    if (!overlay || !mock) return
    setSubmitError(null)
    setToolBusy("compare")
    const { name, tabId, ...settings } = overlay
    let hidden = false
    try {
      const tab = await api.tabById(tabId)
      if (!tab) {
        setSubmitError(api.message("overlayFailed"))
        return
      }
      if (!(await ensureCapture(tab))) return
      await api.activateTab(tab.id).catch(() => undefined)
      await api.setDesignOverlay(tab.id, { ...settings, image: null, visible: false })
      hidden = true
      const view = await api.readPageView(tab.id)
      const capture = await captureVisible(api, tab, sleep)
      await api.setDesignOverlay(tab.id, { ...settings, image: null })
      hidden = false
      const diff = await api.diffDesign(
        capture,
        mock,
        { x: settings.x, y: settings.y, scale: settings.scale },
        view
      )
      if (!diff) {
        setSubmitError(api.message("compareOutOfView"))
        return
      }
      // The previous comparison's image goes: this one supersedes it.
      const previous = designDiff?.attachmentId
      const others = attachmentsRef.current.filter((attachment) => attachment.id !== previous)
      const limits = resolveBrowserContextLimits(limitsRef.current)
      const attachment = screenshotAttachment(
        crypto.randomUUID(),
        diff.image.slice(diff.image.indexOf(",") + 1),
        now(),
        "design-diff"
      )
      const attach =
        featuresRef.current.includes("attachments") &&
        others.length < limits.maxAttachments &&
        attachment.bytes.byteLength <= limits.attachmentBytes
      setAttachments(attach ? [...others, attachment] : others)
      setDesignDiff({
        ...diff.result,
        tabId: tab.id,
        ranAt: now(),
        mock: name,
        ...(attach ? { attachmentId: attachment.id } : {}),
      })
      setInstruction((current) =>
        current.trim() ? current : api.message("compareDefaultInstruction")
      )
    } catch {
      setSubmitError(api.message("compareFailed"))
    } finally {
      if (hidden)
        void api.setDesignOverlay(tabId, { ...settings, image: null }).catch(() => undefined)
      setToolBusy(null)
    }
  }, [api, designDiff, ensureCapture, now, overlay, sleep])

  /** Open the page at another screen size (Responsive Viewer). */
  const onViewport = useCallback(
    async (presetId: (typeof VIEWPORT_PRESETS)[number]["id"]) => {
      setSubmitError(null)
      const preset = VIEWPORT_PRESETS.find((entry) => entry.id === presetId)
      if (!preset) return
      setToolBusy("viewport")
      try {
        const tab = await toolTab()
        if (!tab) return
        await api.openViewport(tab.url, { width: preset.width, height: preset.height })
      } catch {
        setSubmitError(api.message("viewportFailed"))
      } finally {
        setToolBusy(null)
      }
    },
    [api, toolTab]
  )

  /**
   * Install the rules on the tab (Requestly), replacing what it had: on the
   * tab the rules were made for, or the panel's tab for the first one.
   */
  const applyMocks = useCallback(
    async (rules: RequestMock[]) => {
      setSubmitError(null)
      setToolBusy("mocks")
      try {
        const known = mocks ? await api.tabById(mocks.tabId) : null
        const tab = known ?? (mocks ? null : await toolTab())
        if (!tab) {
          if (mocks) setMocks(null)
          return
        }
        const clean = rules.flatMap((rule) => cleanMock(rule) ?? [])
        // Kept rules stay kept as they change; the last one gone ends that.
        const kept = clean.length > 0 && mocks?.hits?.kept === true
        const hits = await api.setRequestMocks(tab.id, clean, kept)
        if (clean.length === 0 && mocks?.keptUrl)
          await api.keepRequestMocks(mocks.keptUrl, false).catch(() => false)
        setMocks(
          clean.length > 0
            ? { tabId: tab.id, url: tab.url, keptUrl: mocks?.keptUrl ?? null, rules: clean, hits }
            : null
        )
      } catch {
        setSubmitError(api.message("mockFailed"))
      } finally {
        setToolBusy(null)
      }
    },
    [api, mocks, toolTab]
  )

  /**
   * Keep the rules across reloads of the tab, or stop: the site's permission
   * is asked for first, while the click still counts as the person's.
   */
  const keepMocks = useCallback(
    async (keep: boolean) => {
      if (!mocks) return
      setSubmitError(null)
      setToolBusy("mocks")
      try {
        // Stopping releases the site it was kept for, wherever the tab is now.
        const url = keep ? mocks.url : (mocks.keptUrl ?? mocks.url)
        if (!(await api.keepRequestMocks(url, keep))) {
          if (keep) setSubmitError(api.message("mockKeepDenied"))
          return
        }
        const hits = await api.setRequestMocks(mocks.tabId, mocks.rules, keep)
        const keptUrl = keep ? url : null
        setMocks((current) => (current ? { ...current, keptUrl, hits } : current))
      } catch {
        setSubmitError(api.message("mockFailed"))
      } finally {
        setToolBusy(null)
      }
    },
    [api, mocks]
  )

  /** Read the counts and log again in the background; a miss just waits for the next. */
  const pollMocks = useCallback(() => {
    const tabId = mocks?.tabId
    if (tabId === undefined || readingMocksRef.current) return
    void api
      .setRequestMocks(tabId, null)
      .then((hits) =>
        setMocks((current) => (current && current.tabId === tabId ? { ...current, hits } : current))
      )
      .catch(() => undefined)
  }, [api, mocks?.tabId])

  /** How often each rule matched so far — or, after a reload, that none are left. */
  const refreshMocks = useCallback(async () => {
    if (!mocks) return
    setToolBusy("mocks")
    try {
      const hits = await api.setRequestMocks(mocks.tabId, null)
      setMocks((current) => (current ? { ...current, hits } : current))
    } catch {
      setSubmitError(api.message("mockFailed"))
    } finally {
      setToolBusy(null)
    }
  }, [api, mocks])

  /** Run one whole-page check on the tab in the panel. */
  const onRunInsight = useCallback(
    async (kind: InsightKind) => {
      setSubmitError(null)
      setAuditBusy(kind)
      try {
        const tab = await toolTab()
        if (!tab || !(await ensureCapture(tab))) return
        const ranAt = now()
        // Included the first time — running it was the person asking — and
        // left as the person set it when run again.
        const previous = insights[kind]
        const include = previous?.tabId === tab.id ? previous.include : true
        if (kind === "audit") {
          const audit = await api.auditAccessibility(tab.id)
          setInsights((current) => ({
            ...current,
            audit: { ...audit, tabId: tab.id, ranAt, include },
          }))
        } else if (kind === "tokens") {
          const tokens = await api.readDesignTokens(tab.id)
          setInsights((current) => ({
            ...current,
            tokens: { ...tokens, tabId: tab.id, ranAt, include },
          }))
        } else if (kind === "focus") {
          const focus = await api.checkFocus(tab.id)
          setInsights((current) => ({
            ...current,
            focus: { ...focus, tabId: tab.id, ranAt, include },
          }))
          // The check numbers the stops on the page as it runs.
          focusShownRef.current = focus.stops > 0 ? tab.id : null
          setFocusNumbers(focus.stops > 0)
        } else if (kind === "layout") {
          const layout = await api.checkLayout(tab.id)
          setInsights((current) => ({
            ...current,
            layout: { ...layout, tabId: tab.id, ranAt, include },
          }))
        } else if (kind === "seo") {
          const seo = await api.readSeo(tab.id)
          setInsights((current) => ({
            ...current,
            seo: { ...seo, tabId: tab.id, ranAt, include },
          }))
        } else if (kind === "perf") {
          const perf = await api.readPerformance(tab.id)
          setInsights((current) => ({
            ...current,
            perf: { ...perf, tabId: tab.id, ranAt, include },
          }))
        } else {
          const stack = await api.detectStack(tab.id)
          setInsights((current) => ({
            ...current,
            stack: { ...stack, tabId: tab.id, ranAt, include },
          }))
        }
      } catch {
        setSubmitError(api.message("insightFailed"))
      } finally {
        setAuditBusy(null)
      }
    },
    [api, ensureCapture, insights, now, toolTab]
  )

  const onIncludeInsight = useCallback((kind: InsightKind, include: boolean) => {
    setInsights((current) => {
      const entry = current[kind]
      return entry ? { ...current, [kind]: { ...entry, include } } : current
    })
  }, [])

  const auditTabId = insights.audit?.tabId

  /** Bring a finding's element into view, flashing it. */
  /** Flash a check's finding on the page. */
  const showFinding = useCallback(
    async (tabId: number | undefined, elementId: string | undefined) => {
      if (!elementId || tabId === undefined) return
      setIssueBusy(elementId)
      try {
        await api.activateTab(tabId).catch(() => undefined)
        if (!(await api.locateElement(tabId, elementId, true)))
          setSubmitError(api.message("inspectDetached"))
      } catch {
        setSubmitError(api.message("inspectDetached"))
      } finally {
        setIssueBusy(null)
      }
    },
    [api]
  )

  /** Turn a check's finding into a pick, its note saying what was found. */
  const pickFinding = useCallback(
    async (tabId: number | undefined, elementId: string | undefined, note: string) => {
      if (!elementId || tabId === undefined) return
      if (picksRef.current.length >= MAX_PICKS) {
        setSubmitError(api.message("inspectFull"))
        return
      }
      setIssueBusy(elementId)
      try {
        const tab = await api.tabById(tabId)
        if (!tab) {
          setSubmitError(api.message("captureNoGrant"))
          return
        }
        await api.activateTab(tab.id).catch(() => undefined)
        // In view first, so the description's box is the screenshot's.
        await api.locateElement(tab.id, elementId, false)
        const description = await api.describeElement(tab.id, elementId)
        if (!description) {
          setSubmitError(api.message("inspectDetached"))
          return
        }
        await addPick(tab, description, note)
      } catch {
        setSubmitError(api.message("inspectFailed"))
      } finally {
        setIssueBusy(null)
      }
    },
    [addPick, api]
  )
  const layoutTabId = insights.layout?.tabId
  const onShowIssue = (issue: A11yIssue) => showFinding(auditTabId, issue.elementId)
  const onPickIssue = (issue: A11yIssue) =>
    pickFinding(
      auditTabId,
      issue.elementId,
      [ruleTitle(issue.rule, api.message), issue.detail].filter(Boolean).join(" — ")
    )
  const focusTabId = insights.focus?.tabId
  const onShowFocusIssue = (issue: FocusIssue) => showFinding(focusTabId, issue.elementId)
  const onPickFocusIssue = (issue: FocusIssue) =>
    pickFinding(
      focusTabId,
      issue.elementId,
      [focusRuleTitle(issue.rule, api.message), issue.detail].filter(Boolean).join(" — ")
    )
  const onToggleFocusNumbers = (show: boolean) => {
    if (focusTabId === undefined) return
    void api
      .showFocusOrder(focusTabId, show)
      .then((done) => {
        // Hiding always succeeds; showing needs the stops still on the page.
        const shown = show && done
        focusShownRef.current = shown ? focusTabId : null
        setFocusNumbers(shown)
      })
      .catch(() => setFocusNumbers(false))
  }
  const onShowLayoutIssue = (issue: LayoutIssue) => showFinding(layoutTabId, issue.elementId)
  const onPickLayoutIssue = (issue: LayoutIssue) =>
    pickFinding(
      layoutTabId,
      issue.elementId,
      [layoutRuleTitle(issue.rule, api.message), issue.detail].filter(Boolean).join(" — ")
    )

  /**
   * Sample a colour from anywhere on the screen (ColorZilla). The panel's own
   * eyedropper, so no page is touched; the colour joins the history.
   */
  const eyedrop = useCallback(async (): Promise<string | null> => {
    const EyeDropper = (window as unknown as { EyeDropper?: new () => EyeDropperLike }).EyeDropper
    if (!EyeDropper) return null
    try {
      const { sRGBHex } = await new EyeDropper().open()
      const hex = sRGBHex.toLowerCase()
      setPickedColors((current) => [hex, ...current.filter((entry) => entry !== hex)].slice(0, 8))
      return hex
    } catch {
      // Escape, or the window lost focus: no colour, and nothing to say.
      return null
    }
  }, [])

  const onEyedropper = useCallback(async () => {
    setAuditBusy("eyedropper")
    try {
      await eyedrop()
    } finally {
      setAuditBusy(null)
    }
  }, [eyedrop])

  /** Another tab, read whole, for the same submission. */
  const addExtraPage = useCallback(
    async (tab: TabRef) => {
      const outcome = await readPage(tab, "page")
      if (!outcome.ok) throw new Error(outcome.message)
      setExtraPages((current) => [...current, outcome.page])
    },
    [readPage]
  )

  /**
   * Follow a finished or running task up in its own conversation: pick that
   * conversation as the target, capture the page in front if nothing is, and
   * put the cursor in the instruction.
   *
   * The Host offers a conversation as a `session` target minted from its
   * session id (`lib/browser-companion/targets.ts`); a row with no such target
   * — deleted, or past the catalogue's cap — offers no follow-up.
   */
  const sessionTargetFor = useCallback(
    (item: BrowserContextSubmissionSummaryV1) =>
      state.kind === "ready" && item.sessionId
        ? state.capability.deliveryTargets?.find(
            (target) => target.kind === "session" && target.id === `session:${item.sessionId}`
          )
        : undefined,
    [state]
  )

  const onFollowUp = useCallback(
    async (item: BrowserContextSubmissionSummaryV1) => {
      const target = sessionTargetFor(item)
      if (!target) return
      if (target.workspaceId) setWorkspaceId(target.workspaceId)
      setPreferredTargetId(target.id)
      setTargetParams({})
      if (!captured0) await runCapture("auto")
      instructionRef.current?.focus()
    },
    [captured0, runCapture, sessionTargetFor]
  )

  /**
   * Forget this browser entirely.
   *
   * The key goes first. If the two writes are interrupted between them, a
   * missing key with a surviving pairing record reads as unpaired (the panel
   * clears the stale record on next connect), whereas the reverse would leave
   * an orphaned key that nothing can ever use or delete.
   */
  const disconnect = useCallback(async () => {
    setConfirming(null)
    await clearDeviceKey()
    await api.remove(Object.values(STORAGE_KEYS))
    await api.removeSession(Object.values(SESSION_KEYS)).catch(() => undefined)
    clientRef.current = null
    pendingSubmissionRef.current = null
    setStalled(null)
    releasePicks(picksRef.current)
    setPicks([])
    releaseMeasurements(measurementsRef.current, [])
    setMeasurements([])
    setTextChanges(null)
    setDevReport(null)
    setInsights(NO_INSIGHTS)
    setDesignDiff(null)
    // Said on the pairing screen, which is what replaces this one: the key is
    // gone from this browser, and the Host still lists the device until it is
    // revoked there. No call reaches the Host from here — a revoked or
    // unreachable Host must not be able to stop a user forgetting it locally.
    setDisconnected(true)
    setState({ kind: "unpaired" })
  }, [api, releasePicks, releaseMeasurements])

  /**
   * Forget the local conveniences but stay paired.
   *
   * The recent list is the Host's, not ours — it comes back on the next poll.
   * What this clears is the cached appearance and the remembered workspace,
   * which is what somebody handing over a laptop would want gone.
   */
  const clearLocal = useCallback(async () => {
    setConfirming(null)
    await api.remove([STORAGE_KEYS.appearance, STORAGE_KEYS.lastWorkspaceId])
    setLocalCleared(true)
  }, [api])

  /**
   * Apply a new appearance choice, refreshing only what depends on it.
   *
   * The palette is the Host's to build, so the choice is a request for a
   * re-resolved one — and nothing else about the panel changes. The connect
   * path used to depend on the override directly, so this same click re-ran
   * it and threw away the capture on screen.
   */
  const chooseAppearance = useCallback(
    async (next: AppearanceOverride, followsSystem: boolean | undefined) => {
      overrideRef.current = next
      setOverride(next)
      void api.write(STORAGE_KEYS.appearanceOverride, next)
      const client = clientRef.current
      if (!client) return
      try {
        const refreshed = await client.capability(
          preferredModeFor(next, followsSystem, prefersDark())
        )
        // A second choice made while this one was in flight wins.
        if (!isCompatible(refreshed) || overrideRef.current !== next) return
        applyAppearance(document.documentElement, refreshed.appearance)
        void api.write(STORAGE_KEYS.appearance, refreshed.appearance)
        setState((current) =>
          current.kind === "ready" ? { ...current, capability: refreshed } : current
        )
      } catch {
        // The choice is saved and the next connect applies it; an unreachable
        // Host is the poll's to report, not this control's.
      }
    },
    [api]
  )

  // What the floating toolbar shows, for the tab it is on: the tool running,
  // what there is to act on, and how many picks and measurements it has.
  const toolbarPicks = picks.filter((pick) => pick.tabId === toolbarTab)
  const canShot =
    state.kind === "ready" &&
    state.captured !== null &&
    hasFeature(state.capability, "attachments") &&
    attachments.length < resolveBrowserContextLimits(state.capability.limits).maxAttachments
  const toolbarState: ToolbarState = {
    labels: {
      title: api.message("toolbarTitle"),
      pick: api.message("toolbarPick"),
      measure: api.message("toolbarMeasure"),
      adjust: api.message("toolbarAdjust"),
      text: api.message("toolbarText"),
      shot: api.message("toolbarShot"),
      close: api.message("toolbarClose"),
      collapse: api.message("toolbarCollapse"),
      expand: api.message("toolbarExpand"),
      drag: api.message("toolbarDrag"),
      minimap: api.message("toolbarMinimap"),
      minimapHide: api.message("toolbarMinimapHide"),
    },
    active: pickingTab !== null ? pointing : textEditingTab !== null ? "text" : null,
    disabled: [
      ...(toolbarPicks.length === 0 ? (["adjust"] as const) : []),
      ...(canShot ? [] : (["shot"] as const)),
    ],
    counts: {
      pick: toolbarPicks.length,
      measure: measurements.filter((entry) => entry.tabId === toolbarTab).length,
    },
    zoom: toolbarZoom,
    marks: toolbarPicks.map((pick) => pick.elementId),
    snap: preferences.toolbarSnap,
  }
  const toolbarKey = JSON.stringify(toolbarState)
  useEffect(() => {
    toolbarStateRef.current = JSON.parse(toolbarKey) as ToolbarState
  }, [toolbarKey])
  // Redrawn whenever it changes; a tab that went away takes the toolbar with it.
  useEffect(() => {
    if (toolbarTab === null) return
    void api
      .setPageToolbar(toolbarTab, JSON.parse(toolbarKey) as ToolbarState)
      .catch(() => setToolbarTab(null))
  }, [api, toolbarKey, toolbarTab])
  // A button on the page runs the tool as the panel's own button would. A
  // tool already running ends instead (an adjustment kept), so two passes
  // never compete for the page; a second press starts the next one.
  useEffect(() => {
    toolbarActionRef.current = (action, tabId) => {
      if (tabId !== toolbarTabRef.current) return
      if (action === "close") {
        void api.setPageToolbar(tabId, null).catch(() => undefined)
        setToolbarTab(null)
        return
      }
      if (pickingTab !== null) {
        if (pointing === "adjust") finishAdjust()
        else cancelPick()
        return
      }
      switch (action) {
        case "pick":
          void startPick(tabId)
          return
        case "measure":
          void startMeasure()
          return
        case "adjust": {
          const last = picksRef.current.filter((pick) => pick.tabId === tabId).at(-1)
          if (last) void adjustPick(last.elementId)
          return
        }
        case "text":
          void (textEditingTab !== null ? stopTextEditing(true) : startTextEditing())
          return
        case "shot":
          void onAttach("markup")
          return
      }
    }
  })

  if (state.kind === "loading") return <PanelSkeleton label={api.message("loading")} />

  if (state.kind === "storage-error") {
    return (
      <Notice
        testId="panel-storage-error"
        title={api.message("storageError")}
        detail={api.message("storageErrorHint")}
        action={api.message("retry")}
        onAction={() => void connect()}
      />
    )
  }

  if (state.kind === "unpaired" || state.kind === "pairing") {
    return (
      <PairScreen
        api={api}
        busy={state.kind === "pairing"}
        needsPermission={!hasPermission}
        failure={state.kind === "unpaired" ? state.failure : undefined}
        disconnected={disconnected}
        onSubmit={(code) => void onPair(code)}
      />
    )
  }

  if (state.kind === "revoked") {
    return (
      <Notice
        testId="panel-revoked"
        title={api.message("revoked")}
        action={api.message("reconnect")}
        onAction={() => setState({ kind: "unpaired" })}
      />
    )
  }

  if (state.kind === "incompatible") {
    return <Notice testId="panel-incompatible" title={api.message("incompatible")} />
  }

  if (state.kind === "host-offline") {
    return (
      <Notice
        testId="panel-offline"
        title={api.message("hostOffline")}
        detail={api.message("hostOfflineHint")}
        action={api.message("retry")}
        onAction={() => void connect()}
      />
    )
  }

  // Derived, not stored. The address the user is agreeing to is a function of
  // what was captured and whether they asked for the query string back — and
  // re-deriving it beats re-extracting the page, which could silently hand
  // back different text than the one they reviewed.
  const captured = state.captured ? withDisplayUrl(state.captured, includeFullUrl) : null
  const features = state.capability.features ?? []
  const limits = resolveBrowserContextLimits(state.capability.limits)
  // What is sent is the capture with the picks and the report after its
  // selection; the editor edits the person's own text, the preview counts all.
  const inspection = captured
    ? inspectionFor(picks, devReport, insights, captured.tabId, {
        measurements,
        attachments: hasFeature(state.capability, "attachments") ? attachments : [],
        textChanges,
        mocks,
        designDiff,
        compare: compareIncluded,
      })
    : ""
  const sendable = captured ? withInspection(captured, inspection, features, limits) : null
  const editorMode: BrowserCaptureMode = captured
    ? captureModeFor(captured, scope, features)
    : "metadata"
  const mode: BrowserCaptureMode = sendable ? captureModeFor(sendable, scope, features) : "metadata"
  const contextBytes = sendable
    ? contextContentBytes(buildPageContext(sendable, scope, features)) +
      extraPages.reduce(
        (sum, page) =>
          sum +
          contextContentBytes(
            buildPageContext(withDisplayUrl(page, includeFullUrl), "page", features)
          ),
        0
      )
    : 0
  const followUpIds = recent
    .filter((item) => sessionTargetFor(item))
    .map((item) => item.submissionId)
  const conversationTitles = Object.fromEntries(
    recent.flatMap((item) => (item.sessionId ? [[item.sessionId, item.title] as const] : []))
  )

  // Derived at render rather than held in state, so changing the workspace can
  // never leave a target selected that the new workspace does not offer — the
  // Host would refuse that submission, correctly and inexplicably.
  const offeredTargets = targetsForWorkspace(state.capability.deliveryTargets, workspaceId)
  const targetId = selectedTargetId(offeredTargets, preferredTargetId)
  const selectedTarget = offeredTargets.find((target) => target.id === targetId)
  const paramsReady = targetParamsSatisfied(selectedTarget, targetParams)
  // A template supplies the instruction, so the free-text box is not the ask
  // for one — showing both would invite two instructions in one turn.
  const needsInstruction = selectedTarget?.kind !== "template"
  const canSubmit =
    !submitting &&
    attachBusy === null &&
    regionSource === null &&
    Boolean(workspaceId) &&
    paramsReady &&
    (!needsInstruction || Boolean(instruction.trim()))
  const canEyedrop = typeof (window as { EyeDropper?: unknown }).EyeDropper === "function"
  const clearCapture = () => {
    setStalled(null)
    setExtraPages([])
    setAttachments([])
    setDroppedAttachments(0)
    setRegionSource(null)
    setAnnotating(null)
    releasePicks(picks)
    setPicks([])
    setDetachedPicks([])
    releaseMeasurements(measurements, [])
    setMeasurements([])
    setDetachedMeasures([])
    setTextChanges(null)
    setDevReport(null)
    setInsights(NO_INSIGHTS)
    setDesignDiff(null)
    void api.removeSession([SESSION_KEYS.draft]).catch(() => undefined)
    setState((current) => (current.kind === "ready" ? { ...current, captured: null } : current))
  }

  return (
    <div className="flex min-h-screen flex-col gap-3 bg-muted/40 p-3">
      <header className="flex items-center gap-2.5 px-0.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
          <SparklesIcon className="size-4" aria-hidden="true" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm leading-tight font-semibold">{api.message("panelBrand")}</span>
          <span className="truncate text-[11px] text-muted-foreground">
            {api.message("panelTagline")}
          </span>
        </span>
        <span
          className="flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-2 py-0.5 text-[11px] text-muted-foreground"
          title={state.pairing.baseUrl}
          data-testid="panel-paired"
        >
          <span className="size-1.5 rounded-full bg-success" aria-hidden="true" />
          {api.message("panelPaired")}
        </span>
      </header>
      <SiteQuestions api={api} />
      <PanelSection
        icon={ScanTextIcon}
        tone="info"
        level="h1"
        title={api.message("captureTitle")}
        {...(captured
          ? {
              // Captured: capturing again is a small thing at the top, out
              // of the way of reviewing and sending.
              action: (
                <CaptureActions
                  api={api}
                  compact
                  article={hasFeature(state.capability, "article")}
                  onCapture={(scope) => void runCapture(scope)}
                />
              ),
            }
          : { subtitle: api.message("captureSubtitle") })}
      >
        {captured ? (
          <>
            <CapturePreview
              api={api}
              page={sendable ?? captured}
              mode={mode}
              limits={state.capability.limits}
              includeFullUrl={includeFullUrl}
              onToggleFullUrl={setIncludeFullUrl}
            />
            {staleTab ? (
              <Alert data-testid="capture-stale">
                <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
                  <span>{api.message("captureStale")}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void runCapture(scope, captured.tabId)}
                    data-testid="capture-stale-recapture"
                  >
                    {api.message("captureRecapture")}
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}
            {droppedAttachments > 0 ? (
              <p
                className="text-[11px] text-muted-foreground"
                data-testid="draft-dropped-attachments"
              >
                {api.message("draftDroppedAttachments", [String(droppedAttachments)])}
              </p>
            ) : null}
            <CaptureEditor
              api={api}
              page={captured}
              mode={editorMode}
              onChange={(next) =>
                setState((current) =>
                  current.kind === "ready" && current.captured
                    ? {
                        ...current,
                        captured: { ...next, url: current.captured.url },
                      }
                    : current
                )
              }
            />
            <PickedElements
              api={api}
              elements={picks.filter((pick) => pick.tabId === captured.tabId)}
              detached={detachedPicks}
              busy={pickBusy}
              canShoot={
                hasFeature(state.capability, "attachments") &&
                attachments.length < limits.maxAttachments
              }
              preview={inspection}
              onChange={updatePick}
              onRemove={removePick}
              onLocate={(elementId) => void locatePick(elementId, false)}
              onShoot={(elementId) => void locatePick(elementId, true)}
              onAdjust={(elementId) => void adjustPick(elementId)}
              {...(canEyedrop ? { onEyedrop: eyedrop } : {})}
            />
            <PickComparisonCard
              api={api}
              picks={picks.filter((pick) => pick.tabId === captured.tabId)}
              included={compareIncluded}
              onInclude={setCompareIncluded}
            />
            <Measurements
              api={api}
              measurements={measurements.filter((entry) => entry.tabId === captured.tabId)}
              detached={detachedMeasures}
              busy={measureBusy}
              onNote={(id, note) =>
                setMeasurements((current) =>
                  current.map((entry) => (entry.id === id ? { ...entry, note } : entry))
                )
              }
              onShow={(id) => void showMeasurement(id)}
              onRemove={removeMeasurement}
            />
            <TextChanges
              api={api}
              changes={textChanges?.tabId === captured.tabId ? textChanges.changes : []}
              onRemove={(index) =>
                setTextChanges((current) =>
                  current
                    ? { ...current, changes: current.changes.filter((_, at) => at !== index) }
                    : current
                )
              }
            />
            {hasFeature(state.capability, "multi-page") && limits.maxPages > 1 ? (
              <ExtraPages
                api={api}
                pages={extraPages}
                maxExtra={limits.maxPages - 1}
                usedTabIds={[captured.tabId, ...extraPages.map((page) => page.tabId)]}
                totalBytes={contextBytes}
                budgetBytes={limits.totalContextBytes}
                onAdd={addExtraPage}
                onRemove={(index) =>
                  setExtraPages((current) => current.filter((_, at) => at !== index))
                }
              />
            ) : null}
            {hasFeature(state.capability, "attachments") ? (
              regionSource ? (
                <RegionCropper
                  api={api}
                  src={regionSource}
                  onCancel={() => setRegionSource(null)}
                  onConfirm={(rect) => void onRegionChosen(rect)}
                />
              ) : annotating ? (
                <ImageAnnotator
                  // A fresh markup per screenshot, not one carried between them.
                  key={annotating.id}
                  api={api}
                  src={annotating.src}
                  initial={annotating.shapes}
                  saving={annotateBusy}
                  onCancel={() => setAnnotating(null)}
                  onConfirm={(shapes) => void onAnnotated(shapes)}
                />
              ) : (
                <AttachmentsBar
                  api={api}
                  attachments={attachments}
                  max={limits.maxAttachments}
                  canAttachPdf={captured.isPdf === true}
                  busy={attachBusy}
                  progress={uploadProgress}
                  onAttach={(action) => void onAttach(action)}
                  onRemove={(id) =>
                    setAttachments((current) => current.filter((entry) => entry.id !== id))
                  }
                  onAnnotate={openAnnotator}
                />
              )
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="cognia-workspace" className="text-xs text-muted-foreground">
                {api.message("workspaceLabel")}
              </Label>
              <Select value={workspaceId ?? undefined} onValueChange={setWorkspaceId}>
                <SelectTrigger
                  id="cognia-workspace"
                  className="w-full"
                  data-testid="workspace-select"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {state.capability.workspaces.map((workspace) => (
                    // The label is the item's only child on purpose: a nested
                    // element leaves the option with no accessible name, and a
                    // listbox of unnamed options is unusable by keyboard.
                    <SelectItem key={workspace.id} value={workspace.id}>
                      {workspace.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* Only when there is a choice. A Host that offers one target — an
                older one, or a browser that has started nothing yet — would
                otherwise get a dropdown whose every state is the same. */}
            {offeredTargets.length > 1 ? (
              <div className="space-y-1.5">
                <Label htmlFor="cognia-target" className="text-xs text-muted-foreground">
                  {api.message("targetLabel")}
                </Label>
                <Select
                  value={targetId ?? undefined}
                  onValueChange={(next) => {
                    setPreferredTargetId(next)
                    // Rebuilt rather than merged: carrying one template's
                    // answers into another's field of the same name would
                    // silently reuse a value nobody re-read.
                    setTargetParams(
                      initialTargetParams(
                        offeredTargets.find((target) => target.id === next)?.params
                      )
                    )
                  }}
                >
                  <SelectTrigger id="cognia-target" className="w-full" data-testid="target-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {offeredTargets.map((target) => (
                      // The label is the item's only child, as with workspaces:
                      // a nested element leaves the option with no accessible
                      // name and the listbox unusable by keyboard.
                      <SelectItem key={target.id} value={target.id}>
                        {targetLabel(target, api.message)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            {selectedTarget?.params?.length ? (
              <div className="space-y-2" data-testid="target-params">
                <p className="text-xs text-muted-foreground">{api.message("targetParamsTitle")}</p>
                {selectedTarget.params.map((param) => (
                  <div key={param.id} className="space-y-1">
                    <Label
                      htmlFor={`cognia-param-${param.id}`}
                      className="text-xs text-muted-foreground"
                    >
                      {param.label}
                    </Label>
                    {param.kind === "enum" && param.options?.length ? (
                      <Select
                        value={targetParams[param.id] ?? undefined}
                        onValueChange={(next) =>
                          setTargetParams((current) => ({
                            ...current,
                            [param.id]: next,
                          }))
                        }
                      >
                        <SelectTrigger
                          id={`cognia-param-${param.id}`}
                          className="w-full"
                          data-testid={`param-${param.id}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {param.options.map((option) => (
                            <SelectItem key={option} value={option}>
                              {option}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Textarea
                        id={`cognia-param-${param.id}`}
                        rows={param.multiline ? 3 : 1}
                        value={targetParams[param.id] ?? ""}
                        onChange={(event) =>
                          setTargetParams((current) => ({
                            ...current,
                            [param.id]: event.target.value,
                          }))
                        }
                        aria-label={param.label}
                        data-testid={`param-${param.id}`}
                      />
                    )}
                    {param.description ? (
                      <p className="text-[11px] text-muted-foreground">{param.description}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
            {needsInstruction ? (
              <>
                <PromptTools
                  api={api}
                  instruction={instruction}
                  onUse={(text) => setInstruction(text)}
                />
                <Textarea
                  ref={instructionRef}
                  rows={3}
                  className="max-h-48 overflow-y-auto"
                  value={instruction}
                  onChange={(event) => setInstruction(event.target.value)}
                  onKeyDown={(event) => {
                    // Ctrl/⌘+Enter sends, as in every chat box; Enter alone is a line.
                    if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && canSubmit) {
                      event.preventDefault()
                      void onSubmit()
                    }
                  }}
                  placeholder={api.message("instructionPlaceholder")}
                  aria-label={api.message("instructionPlaceholder")}
                  data-testid="instruction"
                />
                <p className="text-[11px] text-muted-foreground">
                  {api.message("submitShortcutHint")}
                </p>
              </>
            ) : null}
            <div className="space-y-1.5">
              <Button
                className="w-full"
                onClick={() => void onSubmit()}
                disabled={!canSubmit}
                data-testid="submit"
              >
                <SendIcon className="size-4" aria-hidden="true" />
                {submitting ? api.message("submitting") : api.message("submit")}
              </Button>
              {/* The other ways out, side by side under the main one. */}
              <div className="grid grid-cols-3 gap-1.5">
                {/* For a coding agent in the editor, or an issue: the same
                  reviewed context, on the person's own clipboard. */}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-auto min-h-12 flex-col gap-1 px-1.5 py-1.5 text-[11px] leading-tight font-normal whitespace-normal"
                  onClick={() =>
                    void copyText(promptForClipboard(sendable ?? captured, instruction, inspection))
                  }
                  data-testid="copy-context"
                >
                  {contextCopied ? (
                    <CheckIcon className="size-3.5 text-success" aria-hidden="true" />
                  ) : (
                    <CopyIcon className="size-3.5" aria-hidden="true" />
                  )}
                  <span>
                    {contextCopied ? api.message("copyContextDone") : api.message("copyContext")}
                  </span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-auto min-h-12 flex-col gap-1 px-1.5 py-1.5 text-[11px] leading-tight font-normal whitespace-normal"
                  onClick={() =>
                    downloadText(
                      exportFileName(captured.title, now()),
                      exportMarkdown(
                        sendable ?? captured,
                        instruction,
                        inspection,
                        attachments.map((attachment) => attachment.name),
                        now()
                      )
                    )
                  }
                  data-testid="export-context"
                >
                  <DownloadIcon className="size-3.5" aria-hidden="true" />
                  <span>{api.message("exportContext")}</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className={cn(
                    "h-auto min-h-12 flex-col gap-1 px-1.5 py-1.5 text-[11px] leading-tight font-normal whitespace-normal",
                    "hover:border-destructive/40 hover:text-destructive"
                  )}
                  onClick={clearCapture}
                  data-testid="clear-capture"
                >
                  <Trash2Icon className="size-3.5" aria-hidden="true" />
                  <span>{api.message("clearCapture")}</span>
                </Button>
              </div>
            </div>
            {stalled ? (
              // Not the error alert: nothing failed. The Host has the capture
              // and is waiting for its runtime, and the remedy is this button.
              <Alert data-testid="submit-stalled">
                <AlertTitle>{api.message("statusHostUnavailable")}</AlertTitle>
                <AlertDescription className="space-y-2">
                  <p>{api.message("reasonNoRuntime")}</p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void onSubmit()}
                    disabled={submitting}
                    data-testid="submit-retry"
                  >
                    {submitting ? api.message("submitting") : api.message("retry")}
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}
          </>
        ) : (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-muted/40 px-4 py-5 text-center">
            <span className="flex size-10 items-center justify-center rounded-full bg-info/12 text-info">
              <MousePointerClickIcon className="size-5" aria-hidden="true" />
            </span>
            <p className="text-xs text-muted-foreground" data-testid="capture-empty">
              {api.message("captureEmpty")}
            </p>
          </div>
        )}
        {/* Always offered, captured or not. Re-capturing is how a user sends
            the whole page after seeing that only their selection was picked
            up, and how they refresh a capture after the page changed under
            them. */}
        {captured ? null : (
          <CaptureActions
            api={api}
            compact={false}
            article={hasFeature(state.capability, "article")}
            onCapture={(scope) => void runCapture(scope)}
          />
        )}
      </PanelSection>

      <PanelSection
        icon={SquareMousePointerIcon}
        tone="success"
        title={api.message("inspectSectionTitle")}
        subtitle={api.message("inspectSectionSubtitle")}
      >
        <div className="grid grid-cols-2 gap-2">
          <ToolTile
            icon={MousePointer2Icon}
            tone="info"
            label={api.message("inspectPick")}
            hint={api.message("inspectTilePickHint")}
            pressed={pickingTab !== null && pointing === "pick"}
            disabled={pickingTab !== null || picks.length >= MAX_PICKS}
            onClick={() => void startPick()}
            testId="pick-element"
          />
          <ToolTile
            icon={RulerIcon}
            tone="warning"
            label={api.message("measureStart")}
            hint={api.message("inspectTileMeasureHint")}
            pressed={pickingTab !== null && pointing === "measure"}
            disabled={pickingTab !== null || measurements.length >= MAX_MEASUREMENTS}
            onClick={() => void startMeasure()}
            testId="measure-element"
          />
          <ToolTile
            icon={PencilLineIcon}
            tone="success"
            label={api.message("textEditStart")}
            hint={api.message("inspectTileTextHint")}
            pressed={textEditingTab !== null}
            disabled={pickingTab !== null || textEditingTab !== null}
            onClick={() => void startTextEditing()}
            testId="text-edit-start"
          />
          <ToolTile
            icon={PanelLeftIcon}
            label={toolbarTab !== null ? api.message("toolbarHide") : api.message("toolbarShow")}
            hint={api.message("toolbarToggleHint")}
            pressed={toolbarTab !== null}
            onClick={() => void toggleToolbar()}
            testId="toolbar-toggle"
          />
        </div>
        {toolbarTab !== null ? (
          <div className="flex items-start justify-between gap-2 rounded-lg bg-muted/50 px-2.5 py-2">
            <Label htmlFor="cognia-toolbar-snap" className="flex-col items-start gap-0.5 text-xs">
              <span>{api.message("toolbarSnapLabel")}</span>
              <span className="font-normal text-muted-foreground">
                {api.message("toolbarSnapHint")}
              </span>
            </Label>
            <Switch
              id="cognia-toolbar-snap"
              checked={preferences.toolbarSnap}
              onCheckedChange={(next) => void updatePreferences({ toolbarSnap: next })}
              data-testid="toolbar-snap"
            />
          </div>
        ) : null}
        {pickingTab !== null ? (
          <ActivityStrip>
            <p
              role="status"
              className="min-w-0 flex-1 text-[11px] leading-snug"
              data-testid="pick-waiting"
            >
              {pointing === "measure"
                ? api.message("measureWaiting")
                : api.message("inspectPicking")}
            </p>
            {pointing === "adjust" ? (
              <Button size="sm" onClick={finishAdjust} data-testid="adjust-done">
                {api.message("adjustDone")}
              </Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={cancelPick} data-testid="pick-cancel">
              {pointing === "measure"
                ? api.message("measureCancel")
                : pointing === "adjust"
                  ? api.message("adjustCancel")
                  : api.message("inspectPickCancel")}
            </Button>
          </ActivityStrip>
        ) : null}
        {textEditingTab !== null ? (
          <ActivityStrip testId="text-editing">
            <p role="status" className="min-w-0 flex-1 text-[11px] leading-snug">
              {api.message("textEditing")}
            </p>
            <Button
              size="sm"
              onClick={() => void stopTextEditing(true)}
              data-testid="text-edit-done"
            >
              {api.message("textEditDone")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void stopTextEditing(false)}
              data-testid="text-edit-undo"
            >
              {api.message("textEditUndo")}
            </Button>
          </ActivityStrip>
        ) : null}
      </PanelSection>
      {submitError ? (
        <Alert variant="destructive" data-testid="submit-error">
          <AlertDescription>{submitError}</AlertDescription>
        </Alert>
      ) : null}

      <CollapsibleCard>
        <PageTools
          api={api}
          // Shown while it is about the page in the panel, or before any capture.
          recordingSince={
            recording && (!captured || recording.tabId === captured.tabId) ? recording.since : null
          }
          report={devReport && captured && devReport.tabId === captured.tabId ? devReport : null}
          overlay={overlay}
          busy={toolBusy}
          onRecord={() => void onRecord()}
          onAttachReport={() => void onAttachReport()}
          onReportChange={(text) =>
            setDevReport((current) => (current ? { ...current, text } : current))
          }
          onRemoveReport={() => setDevReport(null)}
          onOverlayFile={(file) => void onOverlayFile(file)}
          onOverlayChange={onOverlayChange}
          onOverlayRemove={onOverlayRemove}
          onViewport={(preset) => void onViewport(preset)}
          designDiff={
            designDiff && (!captured || designDiff.tabId === captured.tabId) ? designDiff : null
          }
          onCompare={() => void onCompareDesign()}
          onRemoveDiff={removeDesignDiff}
          childrenActive={mocks !== null || designDiff !== null}
        >
          <RequestMocks
            api={api}
            rules={mocks?.rules ?? []}
            hits={mocks?.hits ?? null}
            busy={toolBusy !== null}
            onAdd={(rule) => void applyMocks([...(mocks?.rules ?? []), rule])}
            onRemove={(id) =>
              void applyMocks((mocks?.rules ?? []).filter((rule) => rule.id !== id))
            }
            onToggle={(id, enabled) =>
              void applyMocks(
                (mocks?.rules ?? []).map((rule) => (rule.id === id ? { ...rule, enabled } : rule))
              )
            }
            onClear={() => void applyMocks([])}
            onRefresh={() =>
              void (mocks?.hits && !mocks.hits.installed ? applyMocks(mocks.rules) : refreshMocks())
            }
            onPoll={pollMocks}
            canKeep={/^https?:/.test(mocks?.url ?? "")}
            onKeep={(keep) => void keepMocks(keep)}
          />
        </PageTools>
      </CollapsibleCard>

      <CollapsibleCard>
        <PageAudit
          api={api}
          insights={captured ? insightsForTab(insights, captured.tabId) : NO_INSIGHTS}
          busy={auditBusy}
          issueBusy={issueBusy}
          pickedIds={picks.map((pick) => pick.elementId)}
          canPick={picks.length < MAX_PICKS}
          pickedColors={pickedColors}
          canEyedrop={canEyedrop}
          onRun={(kind) => void onRunInsight(kind)}
          onInclude={onIncludeInsight}
          onShowIssue={(issue) => void onShowIssue(issue)}
          onPickIssue={(issue) => void onPickIssue(issue)}
          onShowLayoutIssue={(issue) => void onShowLayoutIssue(issue)}
          onPickLayoutIssue={(issue) => void onPickLayoutIssue(issue)}
          focusNumbers={focusNumbers}
          onToggleFocusNumbers={onToggleFocusNumbers}
          onShowFocusIssue={(issue) => void onShowFocusIssue(issue)}
          onPickFocusIssue={(issue) => void onPickFocusIssue(issue)}
          onEyedropper={() => void onEyedropper()}
        />
      </CollapsibleCard>

      <PanelSection
        icon={HistoryIcon}
        title={api.message("recentTitle")}
        subtitle={api.message("recentSubtitle")}
      >
        <RecentList
          api={api}
          items={recent}
          failureCodes={failureCodes}
          answers={answers}
          expanded={expanded}
          onToggleAnswer={toggleAnswer}
          onStop={(submissionId) => void stopTask(submissionId)}
          stopping={stopping}
          {...(hasFeature(state.capability, "list-paging")
            ? {
                query,
                onQueryChange: setQuery,
                hasMore: Boolean(nextPageToken),
                onLoadMore: () => void loadMore(),
                loadingMore,
              }
            : {})}
          followUpIds={followUpIds}
          onFollowUp={(item) => void onFollowUp(item)}
        />
      </PanelSection>

      <PanelSection
        icon={Settings2Icon}
        title={api.message("settingsTitle")}
        subtitle={api.message("settingsSubtitle")}
      >
        <p className="font-mono text-[11px] text-muted-foreground" data-testid="diagnostics">
          {api.message("diagnostics")}: {state.pairing.baseUrl}
        </p>
        <ExtensionSettings api={api} />
        {hasFeature(state.capability, "browser-agent") ? (
          <div className="space-y-1 border-t border-border pt-2">
            <h3 className="text-xs font-semibold">{api.message("agentTitle")}</h3>
            <AgentSettings
              api={api}
              driveAllowed={state.capability.driveAllowed === true}
              conversationTitles={conversationTitles}
            />
          </div>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor="cognia-appearance" className="text-xs text-muted-foreground">
            {api.message("appearanceLabel")}
          </Label>
          <Select
            value={override}
            onValueChange={(next) => {
              if (!isAppearanceOverride(next)) return
              void chooseAppearance(next, state.capability.followsSystem)
            }}
          >
            <SelectTrigger
              id="cognia-appearance"
              className="w-full"
              data-testid="appearance-select"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {APPEARANCE_OVERRIDES.map((option) => (
                <SelectItem key={option} value={option}>
                  {appearanceOverrideMessage(option, api.message)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setLocalCleared(false)
              setConfirming("disconnect")
            }}
            aria-expanded={confirming === "disconnect"}
            data-testid="disconnect"
          >
            {api.message("disconnect")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setLocalCleared(false)
              setConfirming("clear-local")
            }}
            aria-expanded={confirming === "clear-local"}
            data-testid="clear-local"
          >
            {api.message("clearLocal")}
          </Button>
        </div>
        {/* Inline rather than a modal: the panel is 320px wide, and a dialog
            over it would cover the very settings the question is about. Both
            actions are one click from irreversible — disconnecting destroys the
            only copy of this browser's key — so each asks once, in words that
            say what will and will not go. */}
        {confirming === "disconnect" ? (
          <ConfirmAction
            testId="confirm-disconnect"
            title={api.message("disconnectConfirmTitle")}
            detail={api.message("disconnectConfirmDetail")}
            confirmLabel={api.message("disconnect")}
            cancelLabel={api.message("cancel")}
            onConfirm={() => void disconnect()}
            onCancel={() => setConfirming(null)}
          />
        ) : null}
        {confirming === "clear-local" ? (
          <ConfirmAction
            testId="confirm-clear-local"
            title={api.message("clearLocalConfirmTitle")}
            detail={api.message("clearLocalConfirmDetail")}
            confirmLabel={api.message("clearLocal")}
            cancelLabel={api.message("cancel")}
            onConfirm={() => void clearLocal()}
            onCancel={() => setConfirming(null)}
          />
        ) : null}
        {localCleared ? (
          <p
            role="status"
            className="text-[11px] text-muted-foreground"
            data-testid="clear-local-done"
          >
            {api.message("clearLocalDone")}
          </p>
        ) : null}
      </PanelSection>
    </div>
  )
}

const EMPTY: BrowserContextSubmissionSummaryV1[] = []

/**
 * Capture this page, the whole page, or its article: big buttons before
 * anything is captured, small icon buttons in the card's heading after.
 */
function CaptureActions({
  api,
  compact,
  article,
  onCapture,
}: {
  api: BrowserApi
  compact: boolean
  article: boolean
  onCapture: (scope: "auto" | "page" | "article") => void
}) {
  const actions = [
    {
      scope: "auto" as const,
      testId: "capture-now",
      label: compact ? api.message("captureRecapture") : api.message("captureNow"),
      icon: compact ? RefreshCwIcon : CameraIcon,
    },
    {
      scope: "page" as const,
      testId: "capture-whole-page",
      label: api.message("captureWholePage"),
      icon: ScanLineIcon,
    },
    ...(article
      ? [
          {
            scope: "article" as const,
            testId: "capture-article",
            label: api.message("captureArticle"),
            icon: FileTextIcon,
          },
        ]
      : []),
  ]
  if (compact)
    return (
      <div className="flex shrink-0 items-center gap-0.5">
        {actions.map(({ scope, testId, label, icon: Icon }) => (
          <Button
            key={scope}
            variant="ghost"
            size="icon-sm"
            className="size-7 text-muted-foreground hover:text-foreground"
            title={label}
            onClick={() => onCapture(scope)}
            data-testid={testId}
          >
            <Icon className="size-3.5" aria-hidden="true" />
            <span className="sr-only">{label}</span>
          </Button>
        ))}
      </div>
    )
  return (
    <div className="grid grid-cols-2 gap-2">
      {actions.map(({ scope, testId, label, icon: Icon }, index) => (
        <Button
          key={scope}
          variant={index === 0 ? "default" : "outline"}
          size="sm"
          className={index === 0 || actions.length === 2 ? "col-span-2" : undefined}
          onClick={() => onCapture(scope)}
          data-testid={testId}
        >
          <Icon className="size-3.5" aria-hidden="true" />
          {label}
        </Button>
      ))}
    </div>
  )
}

/**
 * The inspection Markdown for one captured tab: its picks and measurements,
 * the notes on marked-up screenshots, its report and checks.
 */
/** The simulated responses installed on a tab, and how often each has matched. */
interface MocksState {
  tabId: number
  /** The page the tab was on when the rules last changed, for keeping them across reloads. */
  url: string
  /** The page whose site keeps them across reloads; null when they end with the page. */
  keptUrl: string | null
  rules: RequestMock[]
  hits: MockHits | null
}

function inspectionFor(
  picks: readonly PickedElement[],
  report: DevReport | null,
  insights: PageInsights,
  tabId: number,
  {
    measurements = [],
    attachments = [],
    textChanges = null,
    mocks = null,
    designDiff = null,
    compare = false,
  }: {
    measurements?: readonly Measurement[]
    attachments?: readonly PendingAttachment[]
    textChanges?: { tabId: number; changes: TextChange[] } | null
    mocks?: MocksState | null
    designDiff?: DesignDiff | null
    /** Send how the tab's picks differ, as the person asked. */
    compare?: boolean
  } = {}
): string {
  const { context, reports } = insightSections(insights, tabId)
  const elements = picks.filter((pick) => pick.tabId === tabId)
  const comparison = compare ? comparePicks(elements) : null
  return inspectionMarkdown({
    context,
    elements,
    reports: [
      comparison ? comparisonMarkdown(comparison) : null,
      measurementsMarkdown(measurements.filter((entry) => entry.tabId === tabId)),
      textChanges?.tabId === tabId ? textChangesMarkdown(textChanges.changes) : null,
      designDiff?.tabId === tabId ? designDiffMarkdown(designDiff) : null,
      annotationsMarkdown(
        attachments.map((attachment) => ({
          name: attachment.name,
          shapes: attachment.annotation?.shapes ?? [],
        }))
      ),
      // Before the report, so its staged failures are read as staged.
      mocks?.tabId === tabId ? mocksMarkdown(mocks.rules, mocks.hits) : null,
      report?.tabId === tabId ? report.text : null,
      ...reports,
    ],
  })
}

/**
 * Save text as a file through the page's own download, which needs no
 * permission: the person clicked, and the file goes where their downloads go.
 */
function downloadText(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }))
  const link = document.createElement("a")
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** The browser's screen eyedropper, where it has one. */
interface EyeDropperLike {
  open(): Promise<{ sRGBHex: string }>
}

/**
 * Whether this browser's system theme is dark.
 *
 * Guarded because `matchMedia` is absent in a jsdom test and, historically, in
 * some extension contexts. Defaulting to `false` there means "no preference
 * expressed", which leaves the Host's own setting standing rather than forcing
 * a mode nobody asked for.
 */
function prefersDark(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
    : false
}

/**
 * The address as it will actually be sent.
 *
 * Derived at render rather than stored, so toggling "include the full address"
 * cannot drift from what was captured — and re-deriving beats re-extracting,
 * which could silently hand back different page text than the one the user
 * reviewed. A capture that no longer normalizes keeps the URL it was captured
 * with; the submit path re-checks the scheme anyway.
 */
function withDisplayUrl(page: CapturedPage, includeFullUrl: boolean): CapturedPage {
  const decision = normalizeCaptureUrl(page.rawUrl, includeFullUrl)
  return decision.ok ? { ...page, url: decision.url } : page
}

function Notice({
  testId,
  title,
  detail,
  action,
  onAction,
}: {
  testId: string
  title: string
  detail?: string
  action?: string
  onAction?: () => void
}) {
  return (
    <div className="space-y-2 p-4" data-testid={testId}>
      <Alert>
        <AlertTitle>{title}</AlertTitle>
        {detail ? <AlertDescription>{detail}</AlertDescription> : null}
      </Alert>
      {action && onAction ? (
        <Button variant="outline" onClick={onAction}>
          {action}
        </Button>
      ) : null}
    </div>
  )
}

/**
 * An inline "are you sure", for a setting that cannot be taken back.
 *
 * `role="alertdialog"` so assistive technology announces it as a question
 * that needs an answer, and focus moves to the safe choice: an accidental
 * Enter keeps things as they were.
 */
function ConfirmAction({
  testId,
  title,
  detail,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: {
  testId: string
  title: string
  detail: string
  confirmLabel: string
  cancelLabel: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const cancelRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    cancelRef.current?.focus()
  }, [])
  return (
    <div
      role="alertdialog"
      aria-labelledby={`${testId}-title`}
      aria-describedby={`${testId}-detail`}
      className="space-y-2 rounded-control border border-destructive/40 bg-destructive/5 p-2.5"
      data-testid={testId}
    >
      <p id={`${testId}-title`} className="text-xs font-medium">
        {title}
      </p>
      <p id={`${testId}-detail`} className="text-[11px] text-muted-foreground">
        {detail}
      </p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button ref={cancelRef} variant="ghost" size="sm" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={onConfirm}
          data-testid={`${testId}-confirm`}
        >
          {confirmLabel}
        </Button>
      </div>
    </div>
  )
}

/**
 * The shape of the ready panel, while storage and the Host are being asked.
 *
 * An empty box read as "the extension is broken" for however long the Host
 * took to answer. The blocks mirror what replaces them — a heading, the
 * capture prompt, its two buttons, the recent list — so nothing jumps when the
 * real content lands. The pulse is `motion-safe` only: a reduced-motion
 * preference gets still placeholders.
 */
function PanelSkeleton({ label }: { label: string }) {
  const block = "animate-none motion-safe:animate-pulse"
  return (
    <div
      className="flex flex-col gap-4 p-3"
      role="status"
      aria-busy="true"
      aria-label={label}
      data-testid="panel-loading"
    >
      <div className="space-y-2">
        <Skeleton className={`${block} h-4 w-28`} />
        <Skeleton className={`${block} h-3 w-full`} />
        <Skeleton className={`${block} h-3 w-4/5`} />
        <div className="flex gap-2 pt-1">
          <Skeleton className={`${block} h-8 w-28`} />
          <Skeleton className={`${block} h-8 w-32`} />
        </div>
      </div>
      <div className="space-y-2">
        <Skeleton className={`${block} h-3 w-16`} />
        <Skeleton className={`${block} h-14 w-full`} />
        <Skeleton className={`${block} h-14 w-full`} />
      </div>
      <span className="sr-only">{label}</span>
    </div>
  )
}
