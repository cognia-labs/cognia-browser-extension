/**
 * The extension APIs this side panel uses, as one injectable surface.
 *
 * Two reasons it is not `import { browser } from "wxt/browser"` at every call
 * site. The first is testing: root Jest collects this workspace's suites, and a
 * WXT virtual module does not resolve there — an unresolvable import kills the
 * whole suite silently rather than failing one test. The second is that a
 * narrow, hand-written surface is a readable statement of what the extension
 * can actually do; `chrome.*` in scattered call sites is not.
 *
 * Nothing under `src/lib` or `src/components` imports `wxt/browser` or
 * `#imports`. The entrypoints under `src/app` do, and pass the real thing in.
 */

import type { BrowserTranscriptV1 } from "@cognia/companion-client"
import type { SiteAnswer } from "./agent/site-permissions"
import type { PageCapture, PageCaptureOptions } from "./capture/page-capture"
import type { DesignOverlayState, PageView } from "./inspect/design-overlay"
import type { ToolbarAction, ToolbarState } from "./inspect/page-toolbar"
import type { DesignDiff } from "./inspect/design-diff"
import type { DevSnapshot } from "./inspect/dev-report"
import type { A11yAudit } from "./inspect/a11y-audit"
import type { DesignTokens } from "./inspect/design-tokens"
import type { ElementBox, ElementDescription, ElementEdits } from "./inspect/element-context"
import type { MeasureResult } from "./inspect/measure"
import type { Shape } from "./panel/annotations"
import type { PagePerformance } from "./inspect/page-performance"
import type { SeoReport } from "./inspect/seo-check"
import type { LayoutCheck } from "./inspect/layout-check"
import type { FocusCheck } from "./inspect/focus-order"
import type { TextChange } from "./inspect/text-edits"
import type { AdjustResult } from "./inspect/element-picker"
import type { MockHits, RequestMock } from "./inspect/request-mocks"
import type { AdjustSpacing } from "./inspect/adjust"
import type { DetectedStack } from "./inspect/tech-stack"

export interface TabRef {
  id: number
  url: string
  title: string
  /** The window the tab is in; a visible-area capture is per window. */
  windowId?: number
}

/** Optional permissions the panel asks for inside the person's click. */
export interface PermissionRequest {
  permissions?: ("tabs" | "notifications" | "downloads" | "cookies")[]
  origins?: string[]
}

/** A scroll position and the page's size, for a full-page screenshot. */
export interface ScrollMetrics {
  scrollHeight: number
  viewportHeight: number
  viewportWidth: number
  scrollY: number
  dpr: number
}

/** The port the side panel holds open to the worker while it is open. */
export const PANEL_PORT = "cognia-panel"

/** The open port to the service worker; closing the panel closes it. */
export interface PanelPort {
  post(message: { kind: "refresh-status" }): void
  disconnect(): void
}

export interface ExtractionResult {
  title: string
  url: string
  selection: string | null
  readableText: string | null
  readableCharacterCount: number
}

export interface BrowserApi {
  /** The active tab, or `null` when there is none we may touch. */
  activeTab(): Promise<TabRef | null>
  /**
   * One tab by id, or `null` when it is gone.
   *
   * Separate from {@link activeTab} because a capture the background worker
   * recorded names the tab the user gestured on, and by the time the panel
   * opens the active tab may be a different one — or the panel itself.
   */
  tabById(id: number): Promise<TabRef | null>
  capturePage(tabId: number, options: PageCaptureOptions): Promise<PageCapture>
  /** MAIN world; resolves unavailable/not_a_video off YouTube. */
  captureTranscript(tabId: number, preferredLanguage: string): Promise<BrowserTranscriptV1>
  /** Read a value from `chrome.storage.local`. */
  read<T>(key: string): Promise<T | null>
  /** Write a value to `chrome.storage.local`. */
  write(key: string, value: unknown): Promise<void>
  /** Remove keys from `chrome.storage.local`. */
  remove(keys: string[]): Promise<void>
  /**
   * Be told when one `chrome.storage.local` key changes, for as long as the
   * returned function has not been called.
   *
   * The listener receives the new value, or `null` when the key was removed.
   * It exists for the capture request: the background worker writes one when
   * the user picks a context-menu entry, and a panel that is ALREADY open has
   * no mount to read it on — reading only on mount left those gestures
   * waiting until the panel happened to be reopened.
   */
  onStorageChange(key: string, listener: (value: unknown) => void): () => void
  /** Whether the loopback host permission has been granted. */
  hasLoopbackPermission(): Promise<boolean>
  /** Ask for the loopback host permission. Must run in a user gesture. */
  requestLoopbackPermission(): Promise<boolean>
  /** This extension's own origin, e.g. `chrome-extension://<id>`. */
  extensionOrigin(): string
  /** Open a URL in a new tab. */
  openUrl(url: string): Promise<void>
  /** A localized message from `_locales`. */
  message(key: string, substitutions?: string[]): string

  /** `chrome.storage.session` — memory only (ADR-0228 §8). */
  readSession<T>(key: string): Promise<T | null>
  writeSession(key: string, value: unknown): Promise<void>
  removeSession(keys: string[]): Promise<void>
  onSessionChange(key: string, listener: (value: unknown) => void): () => void

  hasPermissions(request: PermissionRequest): Promise<boolean>
  /** Must run inside a user gesture. */
  requestPermissions(request: PermissionRequest): Promise<boolean>
  removePermissions(request: PermissionRequest): Promise<boolean>

  /** The tabs of the panel's window. Needs the optional `tabs` permission. */
  listTabs(): Promise<TabRef[]>
  /** The visible area of a window's active tab, as a PNG data URL. */
  captureVisible(windowId: number): Promise<string>
  /** Make a tab the active one in its window. */
  activateTab(tabId: number): Promise<void>
  scrollMetrics(tabId: number): Promise<ScrollMetrics>
  /** Scroll to `y`; answers where the page actually landed. */
  scrollTo(tabId: number, y: number): Promise<number>
  /** Crop a capture, in device pixels; base64 PNG without the prefix. */
  cropImage(
    dataUrl: string,
    rect: { x: number; y: number; width: number; height: number }
  ): Promise<string>
  /** Stack captures top to bottom, keeping the bottom `heights[i]` rows of each. */
  stitchImages(dataUrls: string[], width: number, heights: number[]): Promise<string>
  /** Draw marks onto a capture at its full size; base64 PNG without the prefix. */
  annotateImage(dataUrl: string, shapes: readonly Shape[]): Promise<string>
  /** Fetch a URL's bytes from the extension (needs its origin granted). */
  fetchBytes(url: string, maxBytes: number): Promise<{ bytes: Uint8Array; mediaType: string }>

  /** Hold a port to the worker while the panel is open. */
  connectPanel(): PanelPort
  /** Answer a pending site question (ADR-0228 §7), inside the person's click. */
  answerSiteQuestion(questionId: string, answer: SiteAnswer): Promise<void>
  /** Forget a standing site decision. */
  forgetSiteDecision(origin: string): Promise<void>

  // ── Inspecting the page (element picker, bug context, design checks) ──
  //
  // All of it runs on the tab the person is working in, under the same
  // `activeTab` grant as a capture, injected per use (`lib/inspect/`).

  /**
   * Let the person pick an element in the tab, and describe it — with the
   * framework's component names and source positions when the page's own
   * world records them. `null` when they cancel or the pick times out.
   */
  pickElement(
    tabId: number,
    hint: string
  ): Promise<(ElementDescription & { more?: boolean }) | null>
  /**
   * Let the person choose one element or several in the tab (click, Shift-
   * click, Alt-click for all alike, or a box dragged over the page) and
   * describe each, framework names included, in the order chosen. `null`
   * when they cancel.
   */
  pickElements(
    tabId: number,
    labels: { hint: string; selected: string; done: string },
    max: number
  ): Promise<ElementDescription[] | null>
  /** Describe an element the picker already holds — an audit finding — like a pick. */
  describeElement(tabId: number, elementId: string): Promise<ElementDescription | null>
  /** Run the accessibility checks in the tab. */
  auditAccessibility(tabId: number): Promise<Pick<A11yAudit, "issues" | "checked" | "truncated">>
  /** Count the colours, type, spacing and variables the tab's page uses. */
  readDesignTokens(tabId: number): Promise<Omit<DesignTokens, "tabId" | "ranAt">>
  /** What the tab's page is built with (MAIN world). */
  detectStack(tabId: number): Promise<DetectedStack>
  /** Look for layout bugs in the tab at its viewport; findings are held like picks. */
  checkLayout(tabId: number): Promise<Omit<LayoutCheck, "tabId" | "ranAt">>
  /** Check the tab's keyboard Tab order, numbering its stops on the page; findings are held like picks. */
  checkFocus(tabId: number): Promise<Omit<FocusCheck, "tabId" | "ranAt">>
  /** Number the last Tab order checked on the page again, or take the numbers away. */
  showFocusOrder(tabId: number, show: boolean): Promise<boolean>
  /** How the tab's page presents itself to search engines and link previews. */
  readSeo(tabId: number): Promise<Omit<SeoReport, "tabId" | "ranAt">>
  /** How this visit to the tab's page loaded and responded, from its performance timeline (MAIN world). */
  readPerformance(tabId: number): Promise<Omit<PagePerformance, "tabId" | "ranAt">>
  /**
   * Let the person measure between two elements in the tab — from `anchorId`,
   * a measured element the picker holds, when given. `null` when they cancel
   * or the measurement times out. Ended by {@link cancelPick} like a pick.
   */
  measureElements(
    tabId: number,
    hints: { hint: string; anchorHint: string },
    anchorId?: string
  ): Promise<MeasureResult>
  /** Show a measurement on the page again, measured as it is laid out now; null when either element left. */
  showMeasurement(tabId: number, fromId: string, toId: string): Promise<MeasureResult>
  /** Make the tab's words editable in place (Design Mode); false when they already are. */
  editPageText(tabId: number, hint: string): Promise<boolean>
  /** Leave text editing in the tab, keeping or unwinding the edits; what changed, when kept. */
  stopEditingPageText(tabId: number, keep: boolean): Promise<TextChange[]>
  /**
   * Let the person resize a picked element by its edges and nudge its
   * spacing with the arrow keys; the style edits it made, or `null` when they
   * cancel. Ended by {@link cancelPick} (put back) or {@link finishAdjust} (kept).
   */
  adjustElement(
    tabId: number,
    elementId: string,
    hint: string,
    labels: Record<AdjustSpacing, string>
  ): Promise<AdjustResult>
  /** Finish an adjustment in progress, keeping it. */
  finishAdjust(tabId: number): Promise<void>
  /**
   * Install the tab's simulated responses, replacing any before (MAIN world);
   * `[]` clears them, `null` only reads how often each has matched.
   */
  setRequestMocks(tabId: number, mocks: RequestMock[] | null, keep?: boolean): Promise<MockHits>
  /**
   * Keep simulated requests across reloads on the site `url` is on — asking
   * for that site's optional permission, and registering the script that puts
   * a tab's kept rules back as it loads — or stop. False when refused or the
   * page is not a web page.
   */
  keepRequestMocks(url: string, keep: boolean): Promise<boolean>
  /**
   * End a pick, measurement or adjustment in progress; false when none was
   * running on the page yet.
   */
  cancelPick(tabId: number): Promise<boolean>
  /** Preview edits on a picked element; false when it is no longer on the page. */
  previewElementEdits(tabId: number, elementId: string, edits: ElementEdits): Promise<boolean>
  /** Put a picked element back as the page had it. */
  revertElement(tabId: number, elementId: string): Promise<boolean>
  /**
   * Scroll a picked element into view — flashing it, unless it is about to be
   * screenshotted — and answer its box afterwards, or null when it is gone.
   */
  locateElement(
    tabId: number,
    elementId: string,
    flash: boolean
  ): Promise<(ElementBox & { dpr: number }) | null>
  /** Revert and forget picks — all of the document's when no ids are given. */
  releaseElements(tabId: number, elementIds?: string[]): Promise<void>
  /** Start listening to the tab's console and requests (MAIN world). */
  startDevRecording(tabId: number): Promise<void>
  /** Whether the tab's current document is being listened to. */
  isDevRecording(tabId: number): Promise<boolean>
  /** What the tab's console and requests said, without draining them. */
  readDevSnapshot(tabId: number): Promise<DevSnapshot>
  /** Show, update or remove a design mock over the tab. */
  setDesignOverlay(tabId: number, state: DesignOverlayState | null): Promise<void>
  /** Show, update or take away the floating toolbar on the tab. */
  setPageToolbar(tabId: number, state: ToolbarState | null): Promise<boolean>
  /** Hide the extension's floating chrome on the tab for a screenshot, or show it again. */
  hidePageChrome(tabId: number, hidden: boolean): Promise<void>
  /** Listen for the floating toolbar's buttons, with the tab they were pressed on. */
  onToolbarAction(listener: (action: ToolbarAction, tabId: number) => void): () => void
  /** The tab's browser zoom, 1 at 100%; 1 when it cannot be read. */
  readTabZoom(tabId: number): Promise<number>
  /** Listen for a tab's browser zoom changing. */
  onTabZoom(listener: (tabId: number, zoom: number) => void): () => void
  /** Where the tab is scrolled and how big its window is, after the next paint. */
  readPageView(tabId: number): Promise<PageView>
  /**
   * Compare a visible-area capture with the design mock where the overlay
   * puts it; the highlighted difference as a PNG data URL, and the numbers.
   * `null` when the mock is not in view.
   */
  diffDesign(
    capture: string,
    mock: string,
    overlay: { x: number; y: number; scale: number },
    view: PageView
  ): Promise<{ image: string; result: Omit<DesignDiff, "tabId" | "ranAt" | "mock"> } | null>
  /** Open an address in a window whose viewport is this size, for a responsive check. */
  openViewport(url: string, size: { width: number; height: number }): Promise<void>
}

/**
 * The keys this extension stores, and the fact that none of them is content.
 *
 * `chrome.storage.local` is not a vault: it is readable by anything that can
 * read the profile directory. So it holds the public half of the pairing (the
 * base URL, the tenant, the device id), the appearance the Host last sent, the
 * person's preferences and the instructions they chose to save. The private key
 * lives in IndexedDB as a non-extractable `CryptoKey`; access tokens live in
 * memory; captured page text lives in the panel's React state and, for an
 * unsent draft, in `chrome.storage.session` ({@link SESSION_KEYS}) — never here.
 */
export const STORAGE_KEYS = {
  /** `{ baseUrl, tenantId, deviceId, extensionOrigin, pairedAt }`. */
  pairing: "cognia.pairing.v1",
  /** The Host's last-sent appearance, so the first paint is not wrong. */
  appearance: "cognia.appearance.v1",
  /** The workspace the user last aimed a submission at. */
  lastWorkspaceId: "cognia.workspace.v1",
  /** A submission whose response never arrived, awaiting a safe retry. */
  pendingSubmission: "cognia.pending.v1",
  /** `follow-host` | `light` | `dark` — how the panel is themed. */
  appearanceOverride: "cognia.appearanceOverride.v1",
  /** Notifications, agent mode and sites never to capture (`preferences.ts`). */
  preferences: "cognia.preferences.v1",
  /** The person's saved instructions — their own text, not page content. */
  savedPrompts: "cognia.savedPrompts.v1",
} as const

/**
 * Keys in `chrome.storage.session`: memory only, gone when the browser exits
 * and never written to the profile (ADR-0228 §8). The unsent draft is the one
 * place captured page content is kept outside the panel's React state, and
 * this is why it may be.
 */
export const SESSION_KEYS = {
  /** The unsent capture and its instruction (`drafts.ts`). */
  draft: "cognia.draft.v1",
  /** The device socket's state, written by the worker for the panel. */
  socketState: "cognia.socketState.v1",
  /** When the Host last said a submission moved; the panel refreshes on change. */
  statusHint: "cognia.statusHint.v1",
} as const

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS]
