/** @jest-environment <rootDir>/testing/jsdom-environment.cjs */
// `disconnect` clears the device key, which lives in IndexedDB — absent from
// jsdom, so without this the button throws instead of unpairing.
import "fake-indexeddb/auto"

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"

import type {
  BrowserCompanionCapabilityV1,
  BrowserContextSubmissionSummaryV1,
} from "@cognia/companion-client"

import type { BrowserApi } from "@ext/src/lib/browser-api"
import type { DevSnapshot } from "@ext/src/lib/inspect/dev-report"
import type { ElementDescription } from "@ext/src/lib/inspect/element-context"
import { measureBoxes, type MeasureResult } from "@ext/src/lib/inspect/measure"
import { STORAGE_KEYS } from "@ext/src/lib/browser-api"
import { CAPTURE_REQUEST_KEY } from "@ext/src/lib/capture/capture-request"
import { SidePanel } from "./side-panel"

const CAPABILITY: BrowserCompanionCapabilityV1 = {
  schemaVersion: 1,
  limits: {
    instructionBytes: 8192,
    selectionBytes: 32768,
    readableTextBytes: 131072,
    requestBytes: 196608,
  },
  supportedCaptureModes: ["metadata", "selection", "readable-page"],
  workspaces: [
    { id: "ws-default", label: "Default", isDefault: true },
    { id: "ws-other", label: "Other", isDefault: false },
  ],
  deliveryTargets: [
    { id: "chat:new", kind: "chat", label: "New task", isDefault: true },
    {
      id: "session:session-1",
      kind: "session",
      label: "A guide",
      isDefault: false,
      workspaceId: "ws-default",
    },
    {
      id: "template:tpl-1",
      kind: "template",
      label: "Summarize",
      isDefault: false,
      params: [
        {
          id: "tone",
          label: "Tone",
          required: true,
          kind: "string",
          defaultValue: "terse",
        },
        {
          id: "length",
          label: "Length",
          required: false,
          kind: "enum",
          options: ["short", "long"],
        },
      ],
    },
  ],
  appearance: {
    mode: "light",
    cssVars: { "--background": "oklch(1 0 0)" },
    radiusBaseRem: 0.625,
    pillRadiusPx: 9999,
    density: "comfortable",
  },
}

interface Harness {
  api: BrowserApi
  store: Map<string, unknown>
  submitAttempts: unknown[]
  submitted: unknown[]
  recent: BrowserContextSubmissionSummaryV1[]
  /** `browser_context_get` answers, by submission id. */
  details: Map<string, { errorCode?: string }>
  detailReads: string[]
  /** The `preferredMode` each `capability()` call carried, in order. */
  capabilityCalls: (string | undefined)[]
  /** `browser_context_result` answers, by submission id. */
  answers: Map<string, { text?: string; truncated?: boolean }>
  resultReads: string[]
  cancelled: string[]
  cancelError?: unknown
  /** What `list()` reports as the Host's capability revision. */
  capabilityRevision?: string
  invalidations: string[]
  capabilityError?: unknown
  submitError?: unknown
  /** What `submit()` answers with, when it answers. */
  submitStatus?: "queued" | "host_unavailable"
  /** The options each `submit()` call carried, in order. */
  submitOptions: ({ idempotencyKey?: string } | undefined)[]
  /** `onStorageChange` listeners, by key. */
  storageListeners: Map<string, Set<(value: unknown) => void>>
  /** `chrome.storage.session`, and its listeners. */
  sessionStore: Map<string, unknown>
  sessionListeners: Map<string, Set<(value: unknown) => void>>
  /** Optional permissions and origins granted so far. */
  granted: Set<string>
  /** Whether a permission request is answered yes. */
  grantRequests: boolean
  permissionRequests: string[][]
  /** Messages posted on the panel's port to the worker. */
  portMessages: unknown[]
  portOpen: boolean
  siteAnswers: [string, string][]
  forgottenDecisions: string[]
  openedUrls: string[]
  /** The options each `list()` call carried, and what later pages answer. */
  listCalls: unknown[]
  nextPageToken?: string
  olderPage: BrowserContextSubmissionSummaryV1[]
  /** Upload calls, in order, as `command:arg`. */
  uploads: string[]
  /** What the element picker answers next; `null` is a cancelled pick. */
  pickResult: ElementDescription | null
  /** Picker and recorder calls, in order, as `command:arg`. */
  inspectCalls: string[]
  /** Each previewed edit, as `[elementId, edits]`. */
  previews: [string, unknown][]
  /** Whether a preview finds its element. */
  previewFinds: boolean
  devSnapshot: DevSnapshot
  overlayStates: unknown[]
  viewports: [string, { width: number; height: number }][]
  /** What the page checks answer. */
  audit: Awaited<ReturnType<BrowserApi["auditAccessibility"]>>
  tokens: Awaited<ReturnType<BrowserApi["readDesignTokens"]>>
  stack: Awaited<ReturnType<BrowserApi["detectStack"]>>
  /** What describing a held element answers, by element id. */
  described: Map<string, ElementDescription>
  /** Picks answered in turn before `pickResult`, for a Shift-click run. */
  pickQueue: (ElementDescription & { more?: boolean })[]
  /** Measurements answered in turn; an empty queue is a cancelled one. */
  measureQueue: NonNullable<MeasureResult>[]
  /** What showing a measurement again answers. */
  shownMeasure: MeasureResult
  /** Each annotate call's shapes. */
  annotated: unknown[]
  /** What the performance read answers. */
  perf: Awaited<ReturnType<BrowserApi["readPerformance"]>>
  /** What the SEO read answers. */
  seo: Awaited<ReturnType<BrowserApi["readSeo"]>>
  /** What the layout check answers. */
  layout: Awaited<ReturnType<BrowserApi["checkLayout"]>>
  /** What an adjustment answers, once finished; held until then. */
  adjusted: Awaited<ReturnType<BrowserApi["adjustElement"]>>
  /** Ends the adjustment in progress with what it answers. */
  endAdjust: ((result: Awaited<ReturnType<BrowserApi["adjustElement"]>>) => void) | null
  /** Each set of simulated responses installed; `null` for a read. */
  mockCalls: (Parameters<BrowserApi["setRequestMocks"]>[1] | null)[]
  /** What reading the simulated responses answers. */
  mockHits: Awaited<ReturnType<BrowserApi["setRequestMocks"]>>
  /** Each ask to keep simulated responses across reloads, or stop. */
  keepCalls: [string, boolean][]
  /** Whether the site's permission is granted when asked. */
  keepAllowed: boolean
  /** What the focus check answers. */
  focus: Awaited<ReturnType<BrowserApi["checkFocus"]>>
  /** What comparing with the mock answers; each call's overlay geometry. */
  diff: Awaited<ReturnType<BrowserApi["diffDesign"]>>
  diffCalls: unknown[]
  /** Each floating-toolbar state drawn, `null` when it was taken away. */
  toolbarStates: (Parameters<BrowserApi["setPageToolbar"]>[1] | null)[]
  /** Presses a floating-toolbar button, as the page would report it. */
  pressToolbar: ((action: string, tabId: number) => void) | null
  /** The browser zoom a tab reports, and how a change in it reaches the panel. */
  zoom: number
  zoomTab: ((tabId: number, zoom: number) => void) | null
  /** What leaving text editing answers, when the edits are kept. */
  textEdits: Awaited<ReturnType<BrowserApi["stopEditingPageText"]>>
}

const DESCRIPTION: ElementDescription = {
  elementId: "el-1",
  selector: "main > button.primary",
  tag: "button",
  label: "button.primary",
  role: "button",
  name: "Save changes",
  text: "Save changes",
  textEditable: true,
  attributes: { class: "primary", type: "submit" },
  box: { x: 10, y: 20, width: 120, height: 36 },
  viewport: { width: 1280, height: 800, dpr: 2, scrollX: 0, scrollY: 0 },
  styles: { display: "inline-flex", "font-size": "14px", "background-color": "rgb(229, 231, 235)" },
  parent: { label: "main", styles: { display: "flex", gap: "16px" } },
  outline: 'button.primary "Save changes"',
  sourceHints: [],
  framework: {
    framework: "react",
    components: [
      { name: "SaveButton", source: { file: "/src/SaveButton.tsx", line: 4 } },
      { name: "SettingsForm" },
    ],
    source: { file: "/src/SaveButton.tsx", line: 12, column: 5 },
  },
}

function harness(overrides: Partial<Harness> = {}): Harness & { makeClient: never } {
  const store = new Map<string, unknown>(overrides.store ?? [])
  const state: Harness = {
    submitAttempts: [],
    submitted: [],
    recent: [],
    details: new Map(),
    detailReads: [],
    capabilityCalls: [],
    answers: new Map(),
    resultReads: [],
    cancelled: [],
    invalidations: [],
    submitOptions: [],
    storageListeners: new Map(),
    sessionStore: new Map(),
    sessionListeners: new Map(),
    granted: new Set(),
    grantRequests: true,
    permissionRequests: [],
    portMessages: [],
    portOpen: false,
    siteAnswers: [],
    forgottenDecisions: [],
    openedUrls: [],
    listCalls: [],
    olderPage: [],
    uploads: [],
    pickResult: DESCRIPTION,
    inspectCalls: [],
    previews: [],
    adjusted: { width: "160px", padding: "8px 16px" },
    endAdjust: null,
    mockCalls: [],
    mockHits: { installed: true, kept: false, hits: {}, log: [] },
    keepCalls: [],
    keepAllowed: true,
    focus: {
      stops: 14,
      issues: [
        { rule: "unreachable-control", elementId: "el-8", selector: "#card", label: "div#card" },
      ],
      truncated: false,
    },
    diff: {
      image: "data:image/png;base64,iVBORw0KGgo=",
      result: {
        area: { x: 0, y: 0, width: 1280, height: 800 },
        compared: 1_024_000,
        mismatched: 51_200,
        regions: [{ x: 32, y: 96, width: 320, height: 48 }],
      },
    },
    diffCalls: [],
    toolbarStates: [],
    pressToolbar: null,
    zoom: 1,
    zoomTab: null,
    previewFinds: true,
    devSnapshot: {
      recording: true,
      console: [{ level: "error", text: "TypeError: x is undefined", ts: 1_000 }],
      network: [
        {
          url: "https://example.com/api/save?token=secret",
          method: "POST",
          status: 500,
          ok: false,
          durationMs: 12,
          ts: 1_000,
        },
      ],
      resources: [],
      environment: {
        userAgent: "Chrome",
        language: "en",
        viewport: { width: 1280, height: 800, dpr: 2 },
        readyState: "complete",
      },
    },
    overlayStates: [],
    viewports: [],
    audit: {
      issues: [
        {
          rule: "color-contrast",
          impact: "serious",
          elementId: "el-9",
          selector: "p.muted",
          label: "p.muted",
          detail: "2.10:1, needs 4.5:1 (#aaaaaa on #ffffff)",
        },
        { rule: "html-lang", impact: "serious" },
      ],
      checked: 40,
      truncated: false,
    },
    tokens: {
      colors: [{ hex: "#2563eb", count: 4, uses: ["background"] }],
      fonts: [{ value: "Inter", count: 9 }],
      type: [
        {
          family: "Inter",
          size: "14px",
          weight: "400",
          lineHeight: "20px",
          count: 9,
          sample: "Hi",
        },
      ],
      spacing: [{ value: "8px", count: 5 }],
      radii: [{ value: "6px", count: 2 }],
      shadows: [],
      variables: [{ name: "--brand", value: "#2563eb" }],
      breakpoints: ["768px"],
      scanned: 40,
    },
    stack: {
      entries: [
        { name: "React", category: "framework", version: "19.1.0" },
        { name: "Tailwind CSS", category: "styling" },
      ],
      development: true,
    },
    described: new Map(),
    pickQueue: [],
    measureQueue: [],
    shownMeasure: null,
    annotated: [],
    perf: {
      navigation: {
        type: "navigate",
        ttfb: 200,
        fcp: 700,
        domContentLoaded: 900,
        load: 1_500,
        transferBytes: 8_000,
      },
      lcp: { ms: 4_800, element: "img.hero" },
      cls: 0.01,
      interaction: null,
      longTasks: { count: 0, blockingMs: 0 },
      scripts: [],
      resources: {
        count: 10,
        bytes: 400_000,
        byType: [],
        largest: [],
        slowest: [],
        renderBlocking: [],
        thirdParty: [],
      },
      images: { oversized: [], unsized: 0 },
      dom: { elements: 300, depth: 9 },
    },
    seo: {
      url: "https://example.com/a",
      title: "A page",
      description: null,
      canonical: null,
      robots: null,
      lang: "en",
      viewport: "width=device-width",
      social: [],
      structuredData: [],
      alternates: [],
      headings: [{ level: 1, text: "A page" }],
      counts: {
        h1: 1,
        images: 0,
        imagesWithoutAlt: 0,
        links: 3,
        internalLinks: 3,
        nofollowLinks: 0,
        linksWithoutText: 0,
        words: 120,
      },
      issues: [{ rule: "description-missing", severity: "warning" }],
    },
    layout: {
      viewport: { width: 390, height: 844 },
      pageWidth: 600,
      issues: [
        {
          rule: "horizontal-overflow",
          elementId: "el-7",
          selector: "#wide",
          label: "div#wide",
          detail: "extends 210px past the 390px viewport",
        },
      ],
      checked: 30,
      truncated: false,
    },
    textEdits: [
      {
        selector: "#title",
        label: "h1#title",
        before: "Pricing plans",
        after: "Plans and pricing",
      },
      { label: "p.note", before: "Old note", after: "" },
    ],
    ...overrides,
    // After the spread, not before: `overrides` carries its own `store`, and
    // letting it win here would leave the harness reading one Map while the
    // api wrote to another.
    store,
    api: {
      activeTab: async () => ({
        id: 1,
        url: "https://example.com/a?x=1",
        title: "A page",
        windowId: 1,
      }),
      tabById: async (id) => ({
        id,
        url: `https://example.com/tab-${id}`,
        title: `Tab ${id}`,
        windowId: 1,
      }),
      capturePage: async () => ({
        title: "A page",
        url: "https://example.com/a?x=1",
        selection: {
          text: "the selected sentence",
          markdown: "the selected sentence",
        },
        readableText: null,
        readableCharacterCount: 0,
        article: null,
        metadata: {},
        isPdf: false,
      }),
      captureTranscript: async () => ({
        status: "unavailable",
        reason: "not_a_video",
      }),
      read: async (key) => (store.get(key) ?? null) as never,
      // Writes and removals notify `onStorageChange` listeners the way
      // `chrome.storage.onChanged` does, so a test can play the background
      // worker recording a capture while the panel is already open.
      write: async (key, value) => {
        store.set(key, value)
        for (const listener of state.storageListeners.get(key) ?? []) listener(value)
      },
      remove: async (keys) => {
        for (const key of keys) {
          store.delete(key)
          for (const listener of state.storageListeners.get(key) ?? []) listener(null)
        }
      },
      onStorageChange: (key, listener) => {
        const listeners = state.storageListeners.get(key) ?? new Set()
        listeners.add(listener)
        state.storageListeners.set(key, listeners)
        return () => listeners.delete(listener)
      },
      hasLoopbackPermission: async () => true,
      requestLoopbackPermission: async () => true,
      extensionOrigin: () => "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
      openUrl: async (url) => {
        state.openedUrls.push(url)
      },
      message: (key) => key,
      readSession: async (key) => (state.sessionStore.get(key) ?? null) as never,
      writeSession: async (key, value) => {
        state.sessionStore.set(key, value)
        for (const listener of state.sessionListeners.get(key) ?? []) listener(value)
      },
      removeSession: async (keys) => {
        for (const key of keys) {
          state.sessionStore.delete(key)
          for (const listener of state.sessionListeners.get(key) ?? []) listener(null)
        }
      },
      onSessionChange: (key, listener) => {
        const listeners = state.sessionListeners.get(key) ?? new Set()
        listeners.add(listener)
        state.sessionListeners.set(key, listeners)
        return () => listeners.delete(listener)
      },
      hasPermissions: async (request) =>
        [...(request.permissions ?? []), ...(request.origins ?? [])].every((entry) =>
          state.granted.has(entry)
        ),
      requestPermissions: async (request) => {
        const entries = [...(request.permissions ?? []), ...(request.origins ?? [])]
        state.permissionRequests.push(entries)
        if (!state.grantRequests) return false
        for (const entry of entries) state.granted.add(entry)
        return true
      },
      removePermissions: async (request) => {
        for (const entry of [...(request.permissions ?? []), ...(request.origins ?? [])])
          state.granted.delete(entry)
        return true
      },
      listTabs: async () => [
        {
          id: 1,
          url: "https://example.com/a?x=1",
          title: "A page",
          windowId: 1,
        },
        { id: 2, url: "https://other.test/b", title: "B page", windowId: 1 },
        { id: 3, url: "chrome://settings", title: "Settings", windowId: 1 },
      ],
      captureVisible: async () => "data:image/png;base64,iVBORw0KGgo=",
      activateTab: async () => undefined,
      scrollMetrics: async () => ({
        scrollHeight: 1000,
        viewportHeight: 1000,
        viewportWidth: 800,
        scrollY: 0,
        dpr: 1,
      }),
      scrollTo: async (_tab, y) => y,
      cropImage: async () => "Y3JvcA==",
      annotateImage: async (_dataUrl, shapes) => {
        state.annotated.push(shapes)
        return "bWFya2Vk"
      },
      stitchImages: async () => "c3RpdGNo",
      fetchBytes: async () => ({
        bytes: new Uint8Array([1, 2, 3]),
        mediaType: "image/png",
      }),
      connectPanel: () => {
        state.portOpen = true
        return {
          post: (message) => {
            state.portMessages.push(message)
          },
          disconnect: () => {
            state.portOpen = false
          },
        }
      },
      answerSiteQuestion: async (id, answer) => {
        state.siteAnswers.push([id, answer])
      },
      forgetSiteDecision: async (origin) => {
        state.forgottenDecisions.push(origin)
      },
      pickElement: async (tabId) => {
        state.inspectCalls.push(`pick:${tabId}`)
        return state.pickQueue.shift() ?? state.pickResult
      },
      // The old Shift-click queue, read as one pass that chose several.
      pickElements: async (tabId, _labels, max) => {
        const chosen = []
        for (;;) {
          state.inspectCalls.push(`pick:${tabId}`)
          const next = state.pickQueue.shift() ?? state.pickResult
          if (!next) break
          const { more, ...description } = next as typeof next & { more?: boolean }
          chosen.push(description)
          if (!more || chosen.length >= max) break
        }
        return chosen.length > 0 ? chosen : null
      },
      measureElements: async (tabId, _hints, anchorId) => {
        state.inspectCalls.push(`measure:${tabId}:${anchorId ?? ""}`)
        return state.measureQueue.shift() ?? null
      },
      showMeasurement: async (_tabId, fromId, toId) => {
        state.inspectCalls.push(`show-measure:${fromId}:${toId}`)
        return state.shownMeasure
      },
      describeElement: async (_tabId, elementId) => {
        state.inspectCalls.push(`describe:${elementId}`)
        return state.described.get(elementId) ?? null
      },
      auditAccessibility: async (tabId) => {
        state.inspectCalls.push(`audit:${tabId}`)
        return state.audit
      },
      readDesignTokens: async (tabId) => {
        state.inspectCalls.push(`tokens:${tabId}`)
        return state.tokens
      },
      detectStack: async (tabId) => {
        state.inspectCalls.push(`stack:${tabId}`)
        return state.stack
      },
      editPageText: async (tabId) => {
        state.inspectCalls.push(`edit-text:${tabId}`)
        return true
      },
      stopEditingPageText: async (tabId, keep) => {
        state.inspectCalls.push(`stop-text:${tabId}:${keep}`)
        return keep ? state.textEdits : []
      },
      readSeo: async (tabId) => {
        state.inspectCalls.push(`seo:${tabId}`)
        return state.seo
      },
      setPageToolbar: async (_tabId, toolbar) => {
        state.toolbarStates.push(toolbar)
        return true
      },
      hidePageChrome: async () => undefined,
      readTabZoom: async () => state.zoom,
      onTabZoom: (listener) => {
        state.zoomTab = listener
        return () => {
          state.zoomTab = null
        }
      },
      onToolbarAction: (listener) => {
        state.pressToolbar = listener as (action: string, tabId: number) => void
        return () => {
          state.pressToolbar = null
        }
      },
      checkFocus: async (tabId) => {
        state.inspectCalls.push(`focus:${tabId}`)
        return state.focus
      },
      showFocusOrder: async (tabId, show) => {
        state.inspectCalls.push(`focus-numbers:${tabId}:${show}`)
        return true
      },
      readPageView: async () => ({ scrollX: 0, scrollY: 0, width: 1280, height: 800 }),
      diffDesign: async (capture, mock, overlay, view) => {
        state.diffCalls.push({ capture, mock: mock.slice(0, 22), overlay, view })
        return state.diff
      },
      checkLayout: async (tabId) => {
        state.inspectCalls.push(`layout:${tabId}`)
        return state.layout
      },
      readPerformance: async (tabId) => {
        state.inspectCalls.push(`perf:${tabId}`)
        return state.perf
      },
      adjustElement: async (_tabId, elementId) => {
        state.inspectCalls.push(`adjust:${elementId}`)
        return new Promise((resolve) => {
          state.endAdjust = resolve
        })
      },
      finishAdjust: async (tabId) => {
        state.inspectCalls.push(`finish-adjust:${tabId}`)
        state.endAdjust?.(state.adjusted)
      },
      setRequestMocks: async (_tabId, mocks, keep = false) => {
        state.mockCalls.push(mocks)
        if (mocks === null) return state.mockHits
        state.mockHits = {
          installed: mocks.length > 0,
          kept: keep && mocks.length > 0,
          hits: {},
          log: [],
        }
        return state.mockHits
      },
      keepRequestMocks: async (url, keep) => {
        state.keepCalls.push([url, keep])
        return state.keepAllowed
      },
      cancelPick: async (tabId) => {
        state.endAdjust?.(null)
        state.inspectCalls.push(`cancel:${tabId}`)
        return true
      },
      previewElementEdits: async (_tabId, elementId, edits) => {
        state.previews.push([elementId, edits])
        return state.previewFinds
      },
      revertElement: async (_tabId, elementId) => {
        state.inspectCalls.push(`revert:${elementId}`)
        return true
      },
      locateElement: async (_tabId, elementId, flash) => {
        state.inspectCalls.push(`locate:${elementId}:${flash}`)
        return state.previewFinds ? { x: 10, y: 20, width: 120, height: 36, dpr: 2 } : null
      },
      releaseElements: async (_tabId, elementIds) => {
        state.inspectCalls.push(`release:${(elementIds ?? []).join(",")}`)
      },
      startDevRecording: async (tabId) => {
        state.inspectCalls.push(`record:${tabId}`)
      },
      isDevRecording: async () => true,
      readDevSnapshot: async (tabId) => {
        state.inspectCalls.push(`snapshot:${tabId}`)
        return state.devSnapshot
      },
      setDesignOverlay: async (_tabId, overlay) => {
        state.overlayStates.push(overlay)
      },
      openViewport: async (url, size) => {
        state.viewports.push([url, size])
      },
      ...overrides.api,
    },
  }
  return state as never
}

function clientFactory(state: Harness, capability: BrowserCompanionCapabilityV1 = CAPABILITY) {
  return () => ({
    capability: async (preferredMode?: "light" | "dark") => {
      state.capabilityCalls.push(preferredMode)
      if (state.capabilityError) throw state.capabilityError
      // The Host re-resolves its palette in the mode it was asked for. Faking
      // that here rather than echoing the request back is what lets a test tell
      // "the panel asked" from "the panel repainted".
      return preferredMode
        ? {
            ...capability,
            appearance: { ...capability.appearance, mode: preferredMode },
          }
        : capability
    },
    submit: async (request: unknown, options?: { idempotencyKey?: string }) => {
      state.submitAttempts.push(request)
      state.submitOptions.push(options)
      if (state.submitError) throw state.submitError
      state.submitted.push(request)
      return {
        submissionId: "sub-1",
        sessionId: "session-1",
        acceptedAt: 1,
        status: state.submitStatus ?? ("queued" as const),
        deepLink: "cognia://session/session-1",
      }
    },
    list: async (options: { pageToken?: string; query?: string } = {}) => {
      state.listCalls.push(options)
      if (options.pageToken) return { items: state.olderPage }
      return {
        items: state.recent,
        ...(state.nextPageToken ? { nextPageToken: state.nextPageToken } : {}),
        ...(state.capabilityRevision ? { capabilityRevision: state.capabilityRevision } : {}),
      }
    },
    uploadInit: async (request: { name: string; size: number }) => {
      state.uploads.push(`init:${request.name}`)
      return {
        uploadId: `u-${request.name}`,
        chunkSize: 1024 * 1024,
        receivedBytes: 0,
      }
    },
    uploadChunk: async (request: { uploadId: string; offset: number; dataBase64: string }) => {
      state.uploads.push(`chunk:${request.uploadId}`)
      return {
        receivedBytes: request.offset + atob(request.dataBase64).length,
      }
    },
    uploadCommit: async (uploadId: string) => {
      state.uploads.push(`commit:${uploadId}`)
      return { attachmentId: `att-${uploadId}` }
    },
    uploadAbort: async (uploadId: string) => {
      state.uploads.push(`abort:${uploadId}`)
    },
    result: async (submissionId: string) => {
      state.resultReads.push(submissionId)
      const answer = state.answers.get(submissionId)
      if (!answer) throw new Error("submission_not_found")
      return {
        submissionId,
        sessionId: "session-1",
        status: "completed" as const,
        updatedAt: 1,
        deepLink: "cognia://session/session-1",
        ...answer,
      }
    },
    cancel: async (submissionId: string) => {
      state.cancelled.push(submissionId)
      if (state.cancelError) throw state.cancelError
      return {
        submissionId,
        sessionId: "session-1",
        status: "cancelled" as const,
        updatedAt: 1,
        deepLink: "cognia://session/session-1",
      }
    },
    get: async (submissionId: string) => {
      state.detailReads.push(submissionId)
      const detail = state.details.get(submissionId)
      if (!detail) throw new Error("submission_not_found")
      return {
        submissionId,
        sessionId: "session-1",
        status: "failed" as const,
        updatedAt: 1,
        deepLink: "cognia://session/session-1",
        ...detail,
      }
    },
    invalidate: () => {
      state.invalidations.push("invalidated")
    },
  })
}

const PAIRING = {
  baseUrl: "http://127.0.0.1:27891",
  tenantId: "tenant-a",
  deviceId: "browser-a",
  extensionOrigin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
  pairedAt: 1,
}

jest.mock("@ext/src/lib/client", () => {
  const actual = jest.requireActual("@ext/src/lib/client")
  return {
    ...actual,
    restoreSigner: async () => ({
      deviceId: "browser-a",
      sign: async () => new Uint8Array(),
    }),
  }
})

function renderPanel(state: Harness, capability: BrowserCompanionCapabilityV1 = CAPABILITY) {
  return render(
    <SidePanel
      api={state.api}
      makeClient={clientFactory(state, capability) as never}
      now={() => 1_000}
    />
  )
}

describe("SidePanel", () => {
  it("asks to pair when this browser has no pairing", async () => {
    const state = harness()
    renderPanel(state)
    await screen.findByText("pairTitle")
  })

  it("shows the capture screen once paired", async () => {
    const state = harness({
      store: new Map([[STORAGE_KEYS.pairing, PAIRING]]) as never,
    })
    renderPanel(state)
    await screen.findByText("captureTitle")
    // Nothing is captured on open: the panel is visible constantly, and
    // reading the page just because it is there is the behaviour the design
    // forbids.
    await screen.findByTestId("capture-empty")
  })

  it("distinguishes a revoked device from an unreachable Host", async () => {
    const revoked = harness({
      store: new Map([[STORAGE_KEYS.pairing, PAIRING]]) as never,
      capabilityError: Object.assign(new Error("gone"), {
        code: "device_unavailable",
      }),
    })
    const { unmount } = renderPanel(revoked)
    await screen.findByTestId("panel-revoked")
    unmount()

    const offline = harness({
      store: new Map([[STORAGE_KEYS.pairing, PAIRING]]) as never,
      capabilityError: new Error("fetch failed"),
    })
    renderPanel(offline)
    await screen.findByTestId("panel-offline")
  })

  it("refuses a Host whose schema this build does not implement", async () => {
    const state = harness({
      store: new Map([[STORAGE_KEYS.pairing, PAIRING]]) as never,
    })
    const factory = () => ({
      ...clientFactory(state)(),
      capability: async () => ({ ...CAPABILITY, schemaVersion: 99 }),
    })
    render(<SidePanel api={state.api} makeClient={factory as never} now={() => 1_000} />)
    await screen.findByTestId("panel-incompatible")
  })

  it("applies and caches the Host's appearance", async () => {
    // Cached so a panel reopened offline still looks like the app instead of
    // flashing the fallback palette and then correcting itself.
    const state = harness({
      store: new Map([[STORAGE_KEYS.pairing, PAIRING]]) as never,
    })
    renderPanel(state)
    await screen.findByText("captureTitle")
    await waitFor(() => expect(state.store.get(STORAGE_KEYS.appearance)).toBeDefined())
    expect(document.documentElement.style.getPropertyValue("--background")).toBe("oklch(1 0 0)")
  })

  it("shows the recent list, and offers to continue rather than to approve", async () => {
    const state = harness({
      store: new Map([[STORAGE_KEYS.pairing, PAIRING]]) as never,
      recent: [
        {
          submissionId: "sub-1",
          sessionId: "session-1",
          title: "Pricing research",
          sourceHost: "example.com",
          captureMode: "selection",
          status: "needs_input",
          submittedAt: 1,
          updatedAt: 2,
          deepLink: "cognia://session/session-1",
        },
      ],
    })
    renderPanel(state)
    await screen.findByTestId("recent-list")
    expect(screen.getByText("Pricing research")).toBeInTheDocument()
    // The panel cannot answer a prompt (ADR-0154 §1), so it never renders
    // something that looks like it could.
    await screen.findByText("continueInCognia")
    expect(screen.queryByText(/approve/i)).toBeNull()
  })
})

describe("SidePanel capture and settings", () => {
  it("offers a capture button, because opening the panel captures nothing", async () => {
    // The panel is visible constantly; reading the page just because it is
    // there is the behaviour the design forbids. So the user asks.
    const state = harness({
      store: new Map([[STORAGE_KEYS.pairing, PAIRING]]) as never,
    })
    renderPanel(state)
    await screen.findByTestId("capture-now")
    await screen.findByTestId("capture-whole-page")
  })

  it("captures the selection when asked, and previews it before sending", async () => {
    const state = harness({
      store: new Map([[STORAGE_KEYS.pairing, PAIRING]]) as never,
    })
    renderPanel(state)
    fireEvent.click(await screen.findByTestId("capture-now"))
    await screen.findByTestId("capture-preview")
    // The address the user is agreeing to, with the query string gone.
    expect(screen.getByTestId("capture-url")).toHaveTextContent("https://example.com/a")
    expect(screen.getByTestId("capture-url")).not.toHaveTextContent("x=1")
  })

  it("explains a missing activeTab grant instead of failing silently", async () => {
    // Switching tabs with the panel open is the ordinary way to arrive here.
    const state = harness({
      store: new Map([[STORAGE_KEYS.pairing, PAIRING]]) as never,
      api: {
        capturePage: async () => {
          throw new Error("Cannot access contents of the page")
        },
      } as never,
    })
    renderPanel(state)
    fireEvent.click(await screen.findByTestId("capture-now"))
    await waitFor(() =>
      expect(screen.getByTestId("submit-error")).toHaveTextContent("captureNoGrant")
    )
  })

  it("refuses to capture a page that is not http(s)", async () => {
    const state = harness({
      store: new Map([[STORAGE_KEYS.pairing, PAIRING]]) as never,
      api: {
        activeTab: async () => ({
          id: 1,
          url: "chrome://settings",
          title: "Settings",
        }),
      } as never,
    })
    renderPanel(state)
    fireEvent.click(await screen.findByTestId("capture-now"))
    await waitFor(() =>
      expect(screen.getByTestId("submit-error")).toHaveTextContent("captureRestricted")
    )
    expect(screen.queryByTestId("capture-preview")).toBeNull()
  })

  it("submits the captured page and clears the draft", async () => {
    const state = harness({
      store: new Map([[STORAGE_KEYS.pairing, PAIRING]]) as never,
    })
    renderPanel(state)
    fireEvent.click(await screen.findByTestId("capture-now"))
    await screen.findByTestId("capture-preview")
    fireEvent.change(screen.getByTestId("instruction"), {
      target: { value: "Summarise the pricing" },
    })
    fireEvent.click(screen.getByTestId("submit"))

    await waitFor(() => expect(state.submitted).toHaveLength(1))
    const request = state.submitted[0] as Record<string, unknown>
    expect(request.instruction).toBe("Summarise the pricing")
    expect(request.workspaceId).toBe("ws-default")
    // Cleared afterwards: a preview left on screen after a successful submit
    // invites the user to send the same page twice.
    await waitFor(() => expect(screen.queryByTestId("capture-preview")).toBeNull())
  })

  it("submits the same URL shown after the full-address toggle changes", async () => {
    const state = harness({
      store: new Map([[STORAGE_KEYS.pairing, PAIRING]]) as never,
    })
    renderPanel(state)
    fireEvent.click(await screen.findByTestId("capture-now"))
    await screen.findByTestId("capture-preview")
    fireEvent.click(screen.getByTestId("capture-full-url"))
    expect(screen.getByTestId("capture-url")).toHaveTextContent("https://example.com/a?x=1")
    fireEvent.change(screen.getByTestId("instruction"), {
      target: { value: "Go" },
    })
    fireEvent.click(screen.getByTestId("submit"))

    await waitFor(() => expect(state.submitted).toHaveLength(1))
    expect((state.submitted[0] as { context: { url: string } }).context.url).toBe(
      "https://example.com/a?x=1"
    )
  })

  it("reuses the submission id when the user retries the same draft", async () => {
    const state = harness({
      store: new Map([[STORAGE_KEYS.pairing, PAIRING]]) as never,
      submitError: new Error("response lost"),
    })
    renderPanel(state)
    fireEvent.click(await screen.findByTestId("capture-now"))
    await screen.findByTestId("capture-preview")
    fireEvent.change(screen.getByTestId("instruction"), {
      target: { value: "Go" },
    })
    fireEvent.click(screen.getByTestId("submit"))
    await waitFor(() => expect(state.submitAttempts).toHaveLength(1))

    state.submitError = undefined
    fireEvent.click(screen.getByTestId("submit"))
    await waitFor(() => expect(state.submitAttempts).toHaveLength(2))
    expect(
      state.submitAttempts.map((attempt) => (attempt as { submissionId: string }).submissionId)
    ).toEqual([
      (state.submitAttempts[0] as { submissionId: string }).submissionId,
      (state.submitAttempts[0] as { submissionId: string }).submissionId,
    ])
  })

  it("keeps the retry id after the panel is closed and reopened", async () => {
    // The ref this used to live in dies with the panel, so the one case it
    // existed for — the panel closing mid-submit — was the one it could not
    // cover, and reopening minted a second id for the same capture.
    const state = harness({
      store: new Map([[STORAGE_KEYS.pairing, PAIRING]]) as never,
      submitError: new Error("response lost"),
    })
    const first = renderPanel(state)
    fireEvent.click(await screen.findByTestId("capture-now"))
    await screen.findByTestId("capture-preview")
    fireEvent.change(screen.getByTestId("instruction"), {
      target: { value: "Go" },
    })
    fireEvent.click(screen.getByTestId("submit"))
    await waitFor(() => expect(state.submitAttempts).toHaveLength(1))
    const original = (state.submitAttempts[0] as { submissionId: string }).submissionId
    expect(state.store.get(STORAGE_KEYS.pendingSubmission)).toMatchObject({
      submissionId: original,
    })

    first.unmount()
    state.submitError = undefined
    renderPanel(state)
    fireEvent.click(await screen.findByTestId("capture-now"))
    await screen.findByTestId("capture-preview")
    fireEvent.change(screen.getByTestId("instruction"), {
      target: { value: "Go" },
    })
    fireEvent.click(screen.getByTestId("submit"))
    await waitFor(() => expect(state.submitAttempts).toHaveLength(2))

    expect((state.submitAttempts[1] as { submissionId: string }).submissionId).toBe(original)
    // And a landed submission stops being pending, or the next unrelated
    // capture would inherit this one's id.
    await waitFor(() => expect(state.store.has(STORAGE_KEYS.pendingSubmission)).toBe(false))
  })

  it("sends the delivery target the user chose", async () => {
    const state = harness({
      store: new Map([[STORAGE_KEYS.pairing, PAIRING]]) as never,
    })
    renderPanel(state)
    fireEvent.click(await screen.findByTestId("capture-now"))
    await screen.findByTestId("capture-preview")
    fireEvent.change(screen.getByTestId("instruction"), {
      target: { value: "Go" },
    })

    // Radix renders its listbox on open; the trigger is what a person clicks.
    fireEvent.click(screen.getByTestId("target-select"))
    fireEvent.click(await screen.findByRole("option", { name: "A guide" }))
    fireEvent.click(screen.getByTestId("submit"))

    await waitFor(() => expect(state.submitted).toHaveLength(1))
    expect(state.submitted[0]).toMatchObject({ targetId: "session:session-1" })
  })

  it("defaults to a new task, and says so in this browser's language", async () => {
    const state = harness({
      store: new Map([[STORAGE_KEYS.pairing, PAIRING]]) as never,
    })
    renderPanel(state)
    fireEvent.click(await screen.findByTestId("capture-now"))
    await screen.findByTestId("capture-preview")
    // The Host sends an English fallback for this one because it cannot know
    // the browser's UI language; the panel renders its own string.
    expect(screen.getByTestId("target-select")).toHaveTextContent("targetNewTask")

    fireEvent.change(screen.getByTestId("instruction"), {
      target: { value: "Go" },
    })
    fireEvent.click(screen.getByTestId("submit"))
    await waitFor(() => expect(state.submitted).toHaveLength(1))
    expect(state.submitted[0]).toMatchObject({ targetId: "chat:new" })
  })

  it("offers no target control when the Host offers no choice", async () => {
    // An older Host, or a browser that has started nothing yet. A dropdown
    // whose every state is the same is not a control.
    const state = harness({
      store: new Map([[STORAGE_KEYS.pairing, PAIRING]]) as never,
    })
    renderPanel(state, { ...CAPABILITY, deliveryTargets: undefined })
    fireEvent.click(await screen.findByTestId("capture-now"))
    await screen.findByTestId("capture-preview")
    expect(screen.queryByTestId("target-select")).toBeNull()

    fireEvent.change(screen.getByTestId("instruction"), {
      target: { value: "Go" },
    })
    fireEvent.click(screen.getByTestId("submit"))
    await waitFor(() => expect(state.submitted).toHaveLength(1))
    expect(state.submitted[0]).not.toHaveProperty("targetId")
  })

  it("hides a target that does not belong to the chosen workspace", async () => {
    const state = harness({
      store: new Map([[STORAGE_KEYS.pairing, PAIRING]]) as never,
    })
    renderPanel(state)
    fireEvent.click(await screen.findByTestId("capture-now"))
    await screen.findByTestId("capture-preview")

    fireEvent.click(screen.getByTestId("workspace-select"))
    fireEvent.click(await screen.findByRole("option", { name: "Other" }))

    // The session lives in ws-default and is gone; the new task and the
    // template stay, because neither belongs to a workspace — one is created in
    // whichever is chosen, the other says how to start a task rather than
    // where.
    fireEvent.click(screen.getByTestId("target-select"))
    await waitFor(() => expect(screen.queryByRole("option", { name: "A guide" })).toBeNull())
    expect(screen.getByRole("option", { name: "targetNewTask" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "Summarize" })).toBeInTheDocument()
  })

  it("asks for a template's values instead of an instruction", async () => {
    // A template supplies the instruction on the Host, so showing the free-text
    // box as well would invite two instructions in one turn.
    const state = harness({
      store: new Map([[STORAGE_KEYS.pairing, PAIRING]]) as never,
    })
    renderPanel(state)
    fireEvent.click(await screen.findByTestId("capture-now"))
    await screen.findByTestId("capture-preview")

    fireEvent.click(screen.getByTestId("target-select"))
    fireEvent.click(await screen.findByRole("option", { name: "Summarize" }))

    await screen.findByTestId("target-params")
    expect(screen.queryByTestId("instruction")).toBeNull()
    // Prefilled from what the Host resolved — the declared default, or the
    // value this template was last used with.
    expect(screen.getByTestId("param-tone")).toHaveValue("terse")

    fireEvent.click(screen.getByTestId("submit"))
    await waitFor(() => expect(state.submitted).toHaveLength(1))
    // Non-empty, because `instruction` is `required` with `minLength: 1` on the
    // wire: an empty string is refused by the request schema before the Host
    // ever sees it, which made every template submission impossible. The Host
    // replaces this with the rendered body, so the name is only what a client
    // that cannot read the body can honestly say was asked.
    expect(state.submitted[0]).toMatchObject({
      targetId: "template:tpl-1",
      targetParams: { tone: "terse" },
      instruction: "Summarize",
    })
  })

  it("will not submit a template with a required value left empty", async () => {
    const state = harness({
      store: new Map([[STORAGE_KEYS.pairing, PAIRING]]) as never,
    })
    renderPanel(state)
    fireEvent.click(await screen.findByTestId("capture-now"))
    await screen.findByTestId("capture-preview")
    fireEvent.click(screen.getByTestId("target-select"))
    fireEvent.click(await screen.findByRole("option", { name: "Summarize" }))
    await screen.findByTestId("target-params")

    fireEvent.change(screen.getByTestId("param-tone"), {
      target: { value: "  " },
    })
    // A disabled button beats a refusal after the round trip. The Host checks
    // this too — that is what makes it safe; this is what makes it visible.
    await waitFor(() => expect(screen.getByTestId("submit")).toBeDisabled())
  })

  it("does not carry one template's answers into another target", async () => {
    const state = harness({
      store: new Map([[STORAGE_KEYS.pairing, PAIRING]]) as never,
    })
    renderPanel(state)
    fireEvent.click(await screen.findByTestId("capture-now"))
    await screen.findByTestId("capture-preview")
    fireEvent.click(screen.getByTestId("target-select"))
    fireEvent.click(await screen.findByRole("option", { name: "Summarize" }))
    await screen.findByTestId("target-params")

    fireEvent.click(screen.getByTestId("target-select"))
    fireEvent.click(await screen.findByRole("option", { name: "targetNewTask" }))
    await waitFor(() => expect(screen.queryByTestId("target-params")).toBeNull())

    fireEvent.change(screen.getByTestId("instruction"), {
      target: { value: "Go" },
    })
    fireEvent.click(screen.getByTestId("submit"))
    await waitFor(() => expect(state.submitted).toHaveLength(1))
    expect(state.submitted[0]).not.toHaveProperty("targetParams")
  })

  it("explains a failed submission with the reason the Host recorded", async () => {
    const state = harness({
      store: new Map([[STORAGE_KEYS.pairing, PAIRING]]) as never,
      recent: [
        {
          submissionId: "sub-1",
          sessionId: "session-1",
          title: "A guide",
          sourceHost: "example.com",
          captureMode: "selection",
          status: "host_unavailable",
          submittedAt: 1,
          updatedAt: 2,
          deepLink: "cognia://session/session-1",
        },
      ],
      details: new Map([["sub-1", { errorCode: "runtime_target_unavailable" }]]),
    })
    renderPanel(state)
    // The summary carries no `errorCode`; the single read is what answers it.
    await screen.findByTestId("recent-reason-sub-1")
    expect(screen.getByTestId("recent-reason-sub-1")).toHaveTextContent("reasonNoRuntime")
    expect(state.detailReads).toEqual(["sub-1"])
  })

  it("does not ask for a reason a running submission cannot have", async () => {
    const state = harness({
      store: new Map([[STORAGE_KEYS.pairing, PAIRING]]) as never,
      recent: [
        {
          submissionId: "sub-1",
          sessionId: "session-1",
          title: "A guide",
          sourceHost: "example.com",
          captureMode: "selection",
          status: "running",
          submittedAt: 1,
          updatedAt: 2,
          deepLink: "cognia://session/session-1",
        },
      ],
    })
    renderPanel(state)
    await screen.findByTestId("recent-list")
    expect(state.detailReads).toEqual([])
  })

  it("asks the Host to repaint rather than flipping the class itself", async () => {
    // The panel can toggle `.dark`, but the custom properties underneath it are
    // a palette only the Host can build — a locally-flipped class would paint a
    // light layout in dark colours. So the override is a request, not an act.
    const state = harness({
      store: new Map([[STORAGE_KEYS.pairing, PAIRING]]) as never,
    })
    renderPanel(state)
    await screen.findByTestId("appearance-select")
    expect(state.capabilityCalls).toEqual([undefined])

    fireEvent.click(screen.getByTestId("appearance-select"))
    fireEvent.click(await screen.findByRole("option", { name: "appearanceDark" }))

    await waitFor(() => expect(state.capabilityCalls).toContain("dark"))
    // And it is remembered, so reopening the panel does not revert to the
    // Host's mode and repaint under the user.
    await waitFor(() => expect(state.store.get(STORAGE_KEYS.appearanceOverride)).toBe("dark"))
  })

  it("asks again with its own system theme when the Host follows the system", async () => {
    // The Host has no way to see this browser's `prefers-color-scheme`, so it
    // says `followsSystem` and lets the panel answer. Before this it resolved
    // `system` to dark for everyone.
    const state = harness({
      store: new Map([[STORAGE_KEYS.pairing, PAIRING]]) as never,
    })
    // The exact bug: a Host in system mode resolves to dark on its own, and the
    // browser it is painting is on a light system.
    renderPanel(state, {
      ...CAPABILITY,
      followsSystem: true,
      appearance: { ...CAPABILITY.appearance, mode: "dark" },
    })
    await screen.findByTestId("capture-empty")
    await waitFor(() => expect(state.capabilityCalls).toEqual([undefined, "light"]))
  })

  it("does not ask again when the system already agrees with the Host", async () => {
    // `followsSystem` is not on its own a reason for a second round trip. Only
    // a disagreement is.
    const state = harness({
      store: new Map([[STORAGE_KEYS.pairing, PAIRING]]) as never,
    })
    renderPanel(state, { ...CAPABILITY, followsSystem: true })
    await screen.findByTestId("capture-empty")
    expect(state.capabilityCalls).toEqual([undefined])
  })

  it("does not ask twice when the Host has a mode of its own", async () => {
    const state = harness({
      store: new Map([[STORAGE_KEYS.pairing, PAIRING]]) as never,
    })
    renderPanel(state)
    await screen.findByTestId("capture-empty")
    expect(state.capabilityCalls).toEqual([undefined])
  })

  it("repaints when the Host's theme changes under an open panel", async () => {
    // The capability is read on connect and never again; the poll reads the
    // list. One string on the list is what tells an already-open panel that
    // anything the capability describes has moved.
    const state = harness({
      store: new Map([[STORAGE_KEYS.pairing, PAIRING]]) as never,
      capabilityRevision: "rev-1",
      // A running task, so the panel polls at its active rate rather than
      // backing off to the fifteen seconds it uses for a settled history.
      recent: [
        {
          submissionId: "sub-1",
          sessionId: "session-1",
          title: "A guide",
          sourceHost: "example.com",
          captureMode: "selection",
          status: "running",
          submittedAt: 1,
          updatedAt: 2,
          deepLink: "cognia://session/session-1",
        },
      ],
    })
    renderPanel(state)
    await screen.findByTestId("recent-list")
    expect(state.capabilityCalls).toEqual([undefined])

    state.capabilityRevision = "rev-2"
    await waitFor(() => expect(state.capabilityCalls).toHaveLength(2), {
      timeout: 10_000,
    })
    // And once. A revision it has already acted on must not re-read on every
    // later poll.
    await new Promise((resolve) => setTimeout(resolve, 4_000))
    expect(state.capabilityCalls).toHaveLength(2)
  }, 20_000)

  const RUNNING_ROW = {
    submissionId: "sub-1",
    sessionId: "session-1",
    title: "A guide",
    sourceHost: "example.com",
    captureMode: "selection" as const,
    status: "running" as const,
    submittedAt: 1,
    updatedAt: 2,
    deepLink: "cognia://session/session-1",
  }

  it("fetches an answer only when the user asks to see it", async () => {
    // An answer is the largest thing this contract returns and the list is
    // polled, so pulling every one on every tick would move kilobytes for rows
    // nobody is reading.
    const state = harness({
      store: new Map([[STORAGE_KEYS.pairing, PAIRING]]) as never,
      recent: [{ ...RUNNING_ROW, status: "completed" }],
      answers: new Map([["sub-1", { text: "The team plan is $20.", truncated: false }]]),
    })
    renderPanel(state)
    await screen.findByTestId("recent-list")
    expect(state.resultReads).toEqual([])

    fireEvent.click(screen.getByTestId("recent-answer-toggle-sub-1"))
    await screen.findByText("The team plan is $20.")
    expect(state.resultReads).toEqual(["sub-1"])

    fireEvent.click(screen.getByTestId("recent-answer-toggle-sub-1"))
    await waitFor(() => expect(screen.queryByTestId("recent-answer-sub-1")).toBeNull())
  })

  it("says an answer is missing rather than showing an empty one", async () => {
    const state = harness({
      store: new Map([[STORAGE_KEYS.pairing, PAIRING]]) as never,
      recent: [RUNNING_ROW],
    })
    renderPanel(state)
    await screen.findByTestId("recent-list")
    fireEvent.click(screen.getByTestId("recent-answer-toggle-sub-1"))
    await screen.findByText("resultPending")
  })

  it("stops a running task and refreshes the list", async () => {
    const state = harness({
      store: new Map([[STORAGE_KEYS.pairing, PAIRING]]) as never,
      recent: [RUNNING_ROW],
    })
    renderPanel(state)
    await screen.findByTestId("recent-list")
    fireEvent.click(screen.getByTestId("recent-stop-sub-1"))
    await waitFor(() => expect(state.cancelled).toEqual(["sub-1"]))
  })

  it("offers no stop on a task that has already finished", async () => {
    const state = harness({
      store: new Map([[STORAGE_KEYS.pairing, PAIRING]]) as never,
      recent: [{ ...RUNNING_ROW, status: "completed" }],
    })
    renderPanel(state)
    await screen.findByTestId("recent-list")
    expect(screen.queryByTestId("recent-stop-sub-1")).toBeNull()
  })

  it("says who is driving rather than reporting a failure", async () => {
    // `turn.abort` needs live control, so the Host refuses while the desktop
    // holds the lease. "Could not be stopped" would send somebody looking for
    // a fault that is not there.
    const state = harness({
      store: new Map([[STORAGE_KEYS.pairing, PAIRING]]) as never,
      recent: [RUNNING_ROW],
      cancelError: Object.assign(new Error("busy"), {
        code: "session_driven_elsewhere",
      }),
    })
    renderPanel(state)
    await screen.findByTestId("recent-list")
    fireEvent.click(screen.getByTestId("recent-stop-sub-1"))
    await screen.findByText("stopDrivenElsewhere")
  })

  it("drops the cached token when the device turns out to be revoked", async () => {
    // The token is dead and its refresh will be refused too. Leaving it in the
    // session cache makes the next reconnect replay it once and report an
    // authentication failure rather than "reconnect".
    const state = harness({
      store: new Map([[STORAGE_KEYS.pairing, PAIRING]]) as never,
      capabilityError: Object.assign(new Error("gone"), {
        code: "device_unavailable",
      }),
    })
    renderPanel(state)
    await screen.findByTestId("panel-revoked")
    expect(state.invalidations).toEqual(["invalidated"])
  })

  it("shows a recoverable error when extension storage cannot be read", async () => {
    const state = harness({
      api: {
        read: async () => Promise.reject(new Error("storage unavailable")),
      } as never,
    })
    renderPanel(state)
    expect(await screen.findByTestId("panel-storage-error")).toBeInTheDocument()
  })

  it("will not submit without an instruction", async () => {
    const state = harness({
      store: new Map([[STORAGE_KEYS.pairing, PAIRING]]) as never,
    })
    renderPanel(state)
    fireEvent.click(await screen.findByTestId("capture-now"))
    await screen.findByTestId("capture-preview")
    expect(screen.getByTestId("submit")).toBeDisabled()
  })

  it("remembers the chosen workspace for next time", async () => {
    const state = harness({
      store: new Map([[STORAGE_KEYS.pairing, PAIRING]]) as never,
    })
    renderPanel(state)
    fireEvent.click(await screen.findByTestId("capture-now"))
    await screen.findByTestId("capture-preview")
    fireEvent.change(screen.getByTestId("instruction"), {
      target: { value: "Go" },
    })
    fireEvent.click(screen.getByTestId("submit"))
    await waitFor(() => expect(state.store.get(STORAGE_KEYS.lastWorkspaceId)).toBe("ws-default"))
  })

  it("names the Host it is talking to", async () => {
    const state = harness({
      store: new Map([[STORAGE_KEYS.pairing, PAIRING]]) as never,
    })
    renderPanel(state)
    expect(await screen.findByTestId("diagnostics")).toHaveTextContent("http://127.0.0.1:27891")
  })

  it("forgets everything on disconnect, once confirmed", async () => {
    const state = harness({
      store: new Map([[STORAGE_KEYS.pairing, PAIRING]]) as never,
    })
    renderPanel(state)
    fireEvent.click(await screen.findByTestId("disconnect"))
    fireEvent.click(await screen.findByTestId("confirm-disconnect-confirm"))
    await screen.findByText("pairTitle")
    expect(state.store.get(STORAGE_KEYS.pairing)).toBeUndefined()
    // And says what it did — and that the Host still lists this browser until
    // it is revoked there, which no call from here can do.
    expect(screen.getByTestId("pair-disconnected")).toHaveTextContent("disconnectDoneHint")
  })

  it("asks before disconnecting, and a cancel keeps the pairing", async () => {
    // Disconnecting destroys the only copy of this browser's key. One stray
    // click used to do it with no question and no trace.
    const state = harness({
      store: new Map([[STORAGE_KEYS.pairing, PAIRING]]) as never,
    })
    renderPanel(state)
    fireEvent.click(await screen.findByTestId("disconnect"))
    const confirm = await screen.findByTestId("confirm-disconnect")
    expect(confirm).toHaveAttribute("role", "alertdialog")
    expect(state.store.get(STORAGE_KEYS.pairing)).toBeDefined()

    fireEvent.click(screen.getByRole("button", { name: "cancel" }))
    expect(screen.queryByTestId("confirm-disconnect")).toBeNull()
    expect(state.store.get(STORAGE_KEYS.pairing)).toBeDefined()
    expect(screen.getByTestId("diagnostics")).toBeInTheDocument()
  })

  it("clears the local conveniences without unpairing", async () => {
    // The recent list is the Host's and comes back on the next poll; what goes
    // is the cached appearance and the remembered workspace.
    const state = harness({
      store: new Map([[STORAGE_KEYS.pairing, PAIRING]]) as never,
    })
    renderPanel(state)
    await screen.findByTestId("clear-local")
    await waitFor(() => expect(state.store.get(STORAGE_KEYS.appearance)).toBeDefined())
    fireEvent.click(screen.getByTestId("clear-local"))
    // Nothing goes until the question is answered.
    await screen.findByTestId("confirm-clear-local")
    expect(state.store.get(STORAGE_KEYS.appearance)).toBeDefined()
    fireEvent.click(screen.getByTestId("confirm-clear-local-confirm"))
    await waitFor(() => expect(state.store.get(STORAGE_KEYS.appearance)).toBeUndefined())
    expect(state.store.get(STORAGE_KEYS.pairing)).toBeDefined()
    // And it says it happened; a silent click reads as a button that did nothing.
    expect(await screen.findByTestId("clear-local-done")).toHaveTextContent("clearLocalDone")
  })

  it("captures the tab the gesture named, not whichever is active now", async () => {
    // The background worker records a tab id precisely because the two moments
    // are not the same one: a context-menu click happens in the worker, which
    // opens a panel that may be starting from nothing, and by the time it
    // mounts the active tab can be a different page — or, when the panel is
    // rendered as a tab, the panel itself. Re-querying the active tab throws
    // away the only record of what the user pointed at.
    const state = harness({
      store: new Map<string, unknown>([
        [STORAGE_KEYS.pairing, PAIRING],
        [CAPTURE_REQUEST_KEY, { tabId: 42, mode: "selection", requestedAt: 1_000 }],
      ]) as never,
      api: {
        activeTab: async () => ({
          id: 1,
          url: "https://elsewhere.example/",
          title: "Elsewhere",
        }),
      } as never,
    })
    renderPanel(state)

    expect(await screen.findByTestId("capture-url")).toHaveTextContent("https://example.com/tab-42")
    // And consumed, so reopening the panel does not re-read a page nobody
    // asked about a second time.
    await waitFor(() => expect(state.store.get(CAPTURE_REQUEST_KEY)).toBeUndefined())
  })

  it("says so when the recorded tab has closed", async () => {
    const state = harness({
      store: new Map<string, unknown>([
        [STORAGE_KEYS.pairing, PAIRING],
        [CAPTURE_REQUEST_KEY, { tabId: 42, mode: "page", requestedAt: 1_000 }],
      ]) as never,
      api: { tabById: async () => null } as never,
    })
    renderPanel(state)
    expect(await screen.findByTestId("submit-error")).toBeInTheDocument()
  })
})

describe("SidePanel resilience", () => {
  function capturedAndDescribed(state: Harness) {
    return (async () => {
      renderPanel(state)
      fireEvent.click(await screen.findByTestId("capture-now"))
      await screen.findByTestId("capture-preview")
      fireEvent.change(screen.getByTestId("instruction"), {
        target: { value: "Go" },
      })
    })()
  }

  it("shows the shape of the panel while it connects, not an empty box", async () => {
    let release: (value: unknown) => void = () => undefined
    const gate = new Promise((resolve) => {
      release = resolve
    })
    const state = harness({
      api: {
        read: async () => {
          await gate
          return null
        },
      } as never,
    })
    renderPanel(state)
    const loading = screen.getByTestId("panel-loading")
    expect(loading).toHaveAttribute("role", "status")
    expect(loading).toHaveAttribute("aria-busy", "true")
    expect(loading).toHaveAttribute("aria-label", "loading")
    // Motion only for those who have not asked for less of it.
    expect(loading.querySelector("[data-slot=skeleton]")?.className).toContain(
      "motion-safe:animate-pulse"
    )
    release(null)
    await screen.findByText("pairTitle")
  })

  it("keeps the capture and the submission id when the Host has no runtime yet", async () => {
    // `host_unavailable` is an answer, not a success: the Host recorded the
    // capture and could not start it. Clearing the preview told the user it
    // had started and threw away what they would need to try again.
    const state = harness({
      store: new Map([[STORAGE_KEYS.pairing, PAIRING]]) as never,
      submitStatus: "host_unavailable",
    })
    await capturedAndDescribed(state)
    fireEvent.click(screen.getByTestId("submit"))

    expect(await screen.findByTestId("submit-stalled")).toHaveTextContent("reasonNoRuntime")
    expect(screen.getByTestId("capture-preview")).toBeInTheDocument()
    expect(screen.getByTestId("instruction")).toHaveValue("Go")
    const first = (state.submitAttempts[0] as { submissionId: string }).submissionId
    expect(state.store.get(STORAGE_KEYS.pendingSubmission)).toMatchObject({
      submissionId: first,
    })
    expect(screen.queryByTestId("submit-error")).toBeNull()
  })

  it("retries a stalled submission under the same id, with a fresh idempotency key", async () => {
    // Same id, so the Host finds its own row and finishes it in the
    // conversation it already created. A fresh key, because the Host's ledger
    // holds the first answer as final and would only replay it.
    const state = harness({
      store: new Map([[STORAGE_KEYS.pairing, PAIRING]]) as never,
      submitStatus: "host_unavailable",
    })
    await capturedAndDescribed(state)
    fireEvent.click(screen.getByTestId("submit"))
    await screen.findByTestId("submit-stalled")

    state.submitStatus = "queued"
    fireEvent.click(screen.getByTestId("submit-retry"))
    await waitFor(() => expect(state.submitAttempts).toHaveLength(2))

    const ids = state.submitAttempts.map(
      (attempt) => (attempt as { submissionId: string }).submissionId
    )
    expect(ids[1]).toBe(ids[0])
    expect(state.submitOptions[0]).toBeUndefined()
    expect(state.submitOptions[1]?.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/)
    expect(state.submitOptions[1]?.idempotencyKey).not.toBe(ids[0])
    // Once it lands, the capture and the pending id go, as for any submission.
    await waitFor(() => expect(screen.queryByTestId("capture-preview")).toBeNull())
    expect(screen.queryByTestId("submit-stalled")).toBeNull()
    await waitFor(() => expect(state.store.has(STORAGE_KEYS.pendingSubmission)).toBe(false))
  })

  it("does not present a fresh key for an ordinary lost-response retry", async () => {
    // No answer arrived, so replaying the first receipt is exactly right.
    const state = harness({
      store: new Map([[STORAGE_KEYS.pairing, PAIRING]]) as never,
      submitError: new Error("response lost"),
    })
    await capturedAndDescribed(state)
    fireEvent.click(screen.getByTestId("submit"))
    await waitFor(() => expect(state.submitAttempts).toHaveLength(1))
    state.submitError = undefined
    fireEvent.click(screen.getByTestId("submit"))
    await waitFor(() => expect(state.submitAttempts).toHaveLength(2))
    expect(state.submitOptions).toEqual([undefined, undefined])
  })

  it("explains a refusal in words rather than the Host's code", async () => {
    const state = harness({
      store: new Map([[STORAGE_KEYS.pairing, PAIRING]]) as never,
      submitError: Object.assign(new Error("these values are required: tone"), {
        code: "target_params_missing",
      }),
    })
    await capturedAndDescribed(state)
    fireEvent.click(screen.getByTestId("submit"))
    expect(await screen.findByTestId("submit-error")).toHaveTextContent("submitParamsMissing")
    // The capture survives a refusal; the user fixes the value and sends again.
    expect(screen.getByTestId("capture-preview")).toBeInTheDocument()
  })

  it("re-reads the catalogue when the Host no longer has what was offered", async () => {
    const state = harness({
      store: new Map([[STORAGE_KEYS.pairing, PAIRING]]) as never,
      submitError: Object.assign(new Error("gone"), { code: "unknown_target" }),
    })
    await capturedAndDescribed(state)
    const before = state.capabilityCalls.length
    fireEvent.click(screen.getByTestId("submit"))
    expect(await screen.findByTestId("submit-error")).toHaveTextContent("submitUnknownTarget")
    await waitFor(() => expect(state.capabilityCalls.length).toBe(before + 1))
  })

  it("does not re-read the catalogue for a refusal a fresh one cannot fix", async () => {
    const state = harness({
      store: new Map([[STORAGE_KEYS.pairing, PAIRING]]) as never,
      submitError: Object.assign(new Error("too big"), {
        code: "payload_too_large",
      }),
    })
    await capturedAndDescribed(state)
    const before = state.capabilityCalls.length
    fireEvent.click(screen.getByTestId("submit"))
    expect(await screen.findByTestId("submit-error")).toHaveTextContent("submitTooLarge")
    expect(state.capabilityCalls.length).toBe(before)
  })

  it("picks up a capture recorded while the panel is already open", async () => {
    // The context menu writes a request; a panel that is already showing has
    // no mount left to read it on.
    const state = harness({
      store: new Map([[STORAGE_KEYS.pairing, PAIRING]]) as never,
    })
    renderPanel(state)
    await screen.findByTestId("capture-empty")

    await state.api.write(CAPTURE_REQUEST_KEY, {
      tabId: 7,
      mode: "selection",
      requestedAt: 1_000,
    })

    expect(await screen.findByTestId("capture-url")).toHaveTextContent("https://example.com/tab-7")
    await waitFor(() => expect(state.store.get(CAPTURE_REQUEST_KEY)).toBeUndefined())
  })

  it("stops listening for capture requests once it is gone", async () => {
    const state = harness({
      store: new Map([[STORAGE_KEYS.pairing, PAIRING]]) as never,
    })
    const view = renderPanel(state)
    await screen.findByTestId("capture-empty")
    expect(state.storageListeners.get(CAPTURE_REQUEST_KEY)?.size).toBe(1)
    view.unmount()
    expect(state.storageListeners.get(CAPTURE_REQUEST_KEY)?.size ?? 0).toBe(0)
  })

  it("keeps the capture when the appearance changes", async () => {
    // The connect path used to depend on the appearance choice, so picking one
    // reconnected the panel and replaced the page being described.
    const state = harness({
      store: new Map([[STORAGE_KEYS.pairing, PAIRING]]) as never,
    })
    await capturedAndDescribed(state)

    fireEvent.click(screen.getByTestId("appearance-select"))
    fireEvent.click(await screen.findByRole("option", { name: "appearanceDark" }))
    await waitFor(() => expect(state.capabilityCalls).toContain("dark"))

    expect(screen.getByTestId("capture-preview")).toBeInTheDocument()
    expect(screen.getByTestId("instruction")).toHaveValue("Go")
    expect(document.documentElement.classList.contains("dark")).toBe(true)
  })

  it("asks for the stored appearance on its very first capability call", async () => {
    const state = harness({
      store: new Map<string, unknown>([
        [STORAGE_KEYS.pairing, PAIRING],
        [STORAGE_KEYS.appearanceOverride, "light"],
      ]) as never,
    })
    renderPanel(state)
    await screen.findByTestId("capture-empty")
    expect(state.capabilityCalls).toEqual(["light"])
  })

  it("clips a capture to the Host's own ceiling without splitting a character", async () => {
    const state = harness({
      store: new Map([[STORAGE_KEYS.pairing, PAIRING]]) as never,
      api: {
        capturePage: async () => ({
          title: "A page",
          url: "https://example.com/a",
          // Three bytes of ASCII, then an emoji: a five-byte ceiling lands
          // inside the surrogate pair.
          selection: { text: "abc😀def", markdown: "abc😀def" },
          readableText: null,
          readableCharacterCount: 0,
          article: null,
          metadata: {},
          isPdf: false,
        }),
      } as never,
    })
    renderPanel(state, {
      ...CAPABILITY,
      limits: { ...CAPABILITY.limits, selectionBytes: 5 },
    })
    fireEvent.click(await screen.findByTestId("capture-now"))
    await screen.findByTestId("capture-preview")
    fireEvent.change(screen.getByTestId("instruction"), {
      target: { value: "Go" },
    })
    fireEvent.click(screen.getByTestId("submit"))
    await waitFor(() => expect(state.submitted).toHaveLength(1))
    const selection = (state.submitted[0] as { context: { selection: unknown } }).context.selection
    expect(selection).toEqual({ text: "abc", truncated: true })
  })
})

describe("SidePanel — ADR-0228", () => {
  const FEATURED: BrowserCompanionCapabilityV1 = {
    ...CAPABILITY,
    limits: {
      ...CAPABILITY.limits,
      requestBytes: 655360,
      articleBytes: 131072,
      transcriptBytes: 131072,
      maxPages: 3,
      totalContextBytes: 524288,
      maxAttachments: 2,
      attachmentBytes: 1024 * 1024,
    },
    supportedCaptureModes: ["metadata", "selection", "readable-page", "article"],
    features: [
      "article",
      "markdown-selection",
      "metadata",
      "transcript",
      "link-image",
      "multi-page",
      "attachments",
      "list-paging",
      "device-socket",
      "browser-agent",
    ],
    deliveryTargets: [
      ...(CAPABILITY.deliveryTargets ?? []),
      {
        id: "browser-agent:new",
        kind: "browser-agent",
        label: "Agent",
        isDefault: false,
      },
    ],
    driveAllowed: true,
  }

  const RICH_CAPTURE = {
    title: "A page",
    url: "https://example.com/a",
    selection: { text: "plain", markdown: "**plain**" },
    readableText: "all the words",
    readableCharacterCount: 13,
    article: { markdown: "# Heading\n\nbody", characterCount: 15 },
    metadata: { byline: "Ann" },
    isPdf: false,
  }

  function paired(overrides: Partial<Harness> = {}) {
    return harness({
      store: new Map([[STORAGE_KEYS.pairing, PAIRING]]) as never,
      ...overrides,
      api: { capturePage: async () => RICH_CAPTURE, ...overrides.api } as never,
    })
  }

  async function captureAndAsk(
    kind: "capture-now" | "capture-article" = "capture-now",
    text = "Go"
  ) {
    fireEvent.click(await screen.findByTestId(kind))
    await screen.findByTestId("capture-preview")
    fireEvent.change(screen.getByTestId("instruction"), {
      target: { value: text },
    })
  }

  it("sends the article, Markdown selection and metadata to a Host that reads them", async () => {
    const state = paired()
    renderPanel(state, FEATURED)
    await captureAndAsk("capture-article")
    fireEvent.click(screen.getByTestId("submit"))
    await waitFor(() => expect(state.submitted).toHaveLength(1))
    expect((state.submitted[0] as { context: unknown }).context).toMatchObject({
      captureMode: "article",
      selection: { text: "**plain**", format: "markdown" },
      article: { text: "# Heading\n\nbody", format: "markdown" },
      metadata: { byline: "Ann" },
    })
  })

  it("keeps the old shape for a Host that lists no features", async () => {
    const state = paired()
    renderPanel(state)
    expect(screen.queryByTestId("capture-article")).toBeNull()
    await captureAndAsk()
    fireEvent.click(screen.getByTestId("submit"))
    await waitFor(() => expect(state.submitted).toHaveLength(1))
    const context = (state.submitted[0] as { context: Record<string, unknown> }).context
    expect(context.selection).toEqual({ text: "plain", truncated: false })
    expect(context.metadata).toBeUndefined()
    expect(screen.queryByTestId("attachments-bar")).toBeNull()
    expect(screen.queryByTestId("extra-pages")).toBeNull()
  })

  it("sends an edited title as the suggested one", async () => {
    const state = paired()
    renderPanel(state, FEATURED)
    await captureAndAsk()
    fireEvent.change(screen.getByTestId("capture-title-input"), {
      target: { value: "My title" },
    })
    fireEvent.click(screen.getByTestId("submit"))
    await waitFor(() => expect(state.submitted).toHaveLength(1))
    expect(state.submitted[0]).toMatchObject({
      suggestedTitle: "My title",
      context: { title: "My title" },
    })
  })

  it("adds another tab as a second page", async () => {
    const state = paired()
    renderPanel(state, FEATURED)
    await captureAndAsk()
    fireEvent.click(screen.getByTestId("extra-pages-add"))
    fireEvent.click(await screen.findByTestId("extra-pages-tab-2"))
    await screen.findByTestId("extra-page-0")
    expect(state.permissionRequests).toEqual([["tabs"], ["https://other.test/*"]])
    fireEvent.click(screen.getByTestId("submit"))
    await waitFor(() => expect(state.submitted).toHaveLength(1))
    const additional = (state.submitted[0] as { additionalContexts: { captureMode: string }[] })
      .additionalContexts
    expect(additional).toHaveLength(1)
    expect(additional[0]).toMatchObject({ captureMode: "readable-page" })
  })

  it("uploads a screenshot under the submission and sends its ref", async () => {
    const state = paired()
    renderPanel(state, FEATURED)
    await captureAndAsk()
    fireEvent.click(screen.getByTestId("attach-visible"))
    await screen.findByTestId(/^attachment-remove-/)
    fireEvent.click(screen.getByTestId("submit"))
    await waitFor(() => expect(state.submitted).toHaveLength(1))
    const submitted = state.submitted[0] as {
      submissionId: string
      attachments: { kind: string }[]
    }
    expect(submitted.attachments).toEqual([
      { attachmentId: expect.stringMatching(/^att-/), kind: "screenshot" },
    ])
    expect(state.uploads[0]).toMatch(/^init:screenshot-visible-/)
    expect(state.uploads.at(-1)).toMatch(/^commit:/)
  })

  it("restores the unsent draft, keeps it current, and clears it on send", async () => {
    const draft = {
      v: 1,
      captured: {
        tabId: 1,
        title: "Draft page",
        url: "https://example.com/a",
        rawUrl: "https://example.com/a?x=1",
        selection: { text: "kept", truncated: false },
        readableText: null,
        capturedAt: 900,
        strippedQuery: true,
      },
      extraPages: [],
      scope: "auto",
      instruction: "half written",
      workspaceId: "ws-default",
      targetId: "browser-agent:new",
      targetParams: {},
      includeFullUrl: false,
      droppedAttachments: 2,
      savedAt: 950,
    }
    const state = paired({
      sessionStore: new Map([["cognia.draft.v1", draft]]),
    })
    renderPanel(state, FEATURED)
    expect(await screen.findByTestId("draft-dropped-attachments")).toBeInTheDocument()
    expect(screen.getByTestId("instruction")).toHaveValue("half written")
    fireEvent.change(screen.getByTestId("instruction"), {
      target: { value: "now finished" },
    })
    await waitFor(() =>
      expect(
        (state.sessionStore.get("cognia.draft.v1") as { instruction: string }).instruction
      ).toBe("now finished")
    )
    fireEvent.click(screen.getByTestId("submit"))
    await waitFor(() => expect(state.submitted).toHaveLength(1))
    // The draft named the agent target: the conversation starts from its tab.
    expect(state.submitted[0]).toMatchObject({
      targetId: "browser-agent:new",
      browserAgent: { tabId: 1 },
    })
    await waitFor(() => expect(state.sessionStore.has("cognia.draft.v1")).toBe(false))
    expect(state.portMessages).toContainEqual({ kind: "refresh-status" })
  })

  it("holds a port to the worker while open, and refreshes on its hint", async () => {
    const state = paired()
    const view = renderPanel(state, FEATURED)
    await screen.findByTestId("capture-empty")
    expect(state.portOpen).toBe(true)
    const before = state.listCalls.length
    await state.api.writeSession("cognia.statusHint.v1", 5)
    await waitFor(() => expect(state.listCalls.length).toBeGreaterThan(before))
    view.unmount()
    expect(state.portOpen).toBe(false)
  })

  it("acts on a quick action and a right-clicked link recorded by the worker", async () => {
    const state = paired({
      store: new Map<string, unknown>([
        [STORAGE_KEYS.pairing, PAIRING],
        [
          CAPTURE_REQUEST_KEY,
          {
            tabId: 4,
            mode: "link",
            requestedAt: 990,
            linkUrl: "https://b.test/x",
            quickAction: "summarize",
          },
        ],
      ]) as never,
    })
    renderPanel(state, FEATURED)
    await screen.findByTestId("capture-link")
    expect(screen.getByTestId("instruction")).toHaveValue("quickPromptSummarize")
    fireEvent.click(screen.getByTestId("submit"))
    await waitFor(() => expect(state.submitted).toHaveLength(1))
    expect((state.submitted[0] as { context: unknown }).context).toMatchObject({
      link: { url: "https://b.test/x" },
    })
  })

  it("refuses to capture a site the person blocked", async () => {
    const state = paired({
      store: new Map<string, unknown>([
        [STORAGE_KEYS.pairing, PAIRING],
        [STORAGE_KEYS.preferences, { blockedHosts: ["example.com"] }],
      ]) as never,
    })
    renderPanel(state, FEATURED)
    await screen.findByTestId("extension-settings")
    await waitFor(() => expect(screen.getByTestId("blocked-hosts")).toBeInTheDocument())
    fireEvent.click(screen.getByTestId("capture-now"))
    expect(await screen.findByTestId("submit-error")).toHaveTextContent("captureBlocked")
  })

  it("searches the list and loads another page", async () => {
    const state = paired({
      nextPageToken: "20",
      recent: [
        {
          submissionId: "sub-1",
          sessionId: "session-1",
          title: "First",
          sourceHost: "example.com",
          captureMode: "selection",
          status: "completed",
          submittedAt: 1,
          updatedAt: 2,
          deepLink: "cognia://session/session-1",
        },
      ],
      olderPage: [
        {
          submissionId: "sub-0",
          title: "Older",
          sourceHost: "example.com",
          captureMode: "metadata",
          status: "completed",
          submittedAt: 0,
          updatedAt: 0,
          deepLink: "cognia://session/x",
        },
      ],
    })
    renderPanel(state, FEATURED)
    fireEvent.click(await screen.findByTestId("recent-load-more"))
    expect(await screen.findByText("Older")).toBeInTheDocument()
    fireEvent.change(screen.getByTestId("recent-search"), {
      target: { value: "first" },
    })
    await waitFor(() => expect(state.listCalls).toContainEqual({ query: "first" }))
    expect(state.listCalls).toContainEqual({ pageToken: "20" })
  })

  it("follows a task up in its own conversation", async () => {
    const state = paired({
      recent: [
        {
          submissionId: "sub-1",
          sessionId: "session-1",
          title: "A guide",
          sourceHost: "example.com",
          captureMode: "selection",
          status: "completed",
          submittedAt: 1,
          updatedAt: 2,
          deepLink: "cognia://session/session-1",
        },
      ],
    })
    renderPanel(state, FEATURED)
    fireEvent.click(await screen.findByTestId("recent-follow-up-sub-1"))
    await screen.findByTestId("capture-preview")
    fireEvent.change(screen.getByTestId("instruction"), {
      target: { value: "And then?" },
    })
    fireEvent.click(screen.getByTestId("submit"))
    await waitFor(() => expect(state.submitted).toHaveLength(1))
    expect(state.submitted[0]).toMatchObject({ targetId: "session:session-1" })
  })

  it("sends with Ctrl/⌘+Enter", async () => {
    const state = paired()
    renderPanel(state, FEATURED)
    await captureAndAsk()
    fireEvent.keyDown(screen.getByTestId("instruction"), {
      key: "Enter",
      metaKey: true,
    })
    await waitFor(() => expect(state.submitted).toHaveLength(1))
  })

  it("says so when the captured tab has moved on", async () => {
    let url = "https://example.com/a?x=1"
    const state = paired({
      api: {
        tabById: async (id: number) => ({
          id,
          url,
          title: "A page",
          windowId: 1,
        }),
        activeTab: async () => ({ id: 1, url, title: "A page", windowId: 1 }),
      } as never,
    })
    renderPanel(state, FEATURED)
    await captureAndAsk()
    expect(screen.queryByTestId("capture-stale")).toBeNull()
    url = "https://example.com/elsewhere"
    expect(await screen.findByTestId("capture-stale", {}, { timeout: 3_000 })).toBeInTheDocument()
  })

  it("shows a pending site question above everything", async () => {
    const state = paired({
      sessionStore: new Map([
        [
          "cognia.agent.siteQuestions.v1",
          [
            {
              id: "q1",
              session: "s",
              origin: "https://shop.test",
              operation: "act",
              askedAt: 1,
            },
          ],
        ],
      ]),
    })
    renderPanel(state, FEATURED)
    fireEvent.click(await screen.findByTestId("site-allow-always-q1"))
    await waitFor(() => expect(state.siteAnswers).toEqual([["q1", "always"]]))
  })

  describe("inspecting the page", () => {
    type Sent = {
      instruction: string
      context: { captureMode: string; selection?: { text: string; format?: string } }
      attachments?: { kind: string }[]
    }

    it("picks an element, shoots it, and sends what finds it in the source", async () => {
      const state = paired()
      renderPanel(state, FEATURED)
      // Nothing captured yet: the pick captures the page it belongs to first.
      fireEvent.click(await screen.findByTestId("pick-element"))
      expect(await screen.findByTestId("pick-0")).toBeInTheDocument()
      expect(state.inspectCalls).toContain("pick:1")
      expect(screen.getByTestId("pick-components-0")).toHaveTextContent("SaveButton ← SettingsForm")
      expect(screen.getByTestId("instruction")).toHaveValue("inspectDefaultInstruction")
      expect(screen.getByAltText(/^screenshot-element-/)).toBeInTheDocument()

      fireEvent.change(screen.getByTestId("pick-note-0"), { target: { value: "Make it primary" } })
      fireEvent.click(screen.getByTestId("submit"))
      await waitFor(() => expect(state.submitted).toHaveLength(1))
      const sent = state.submitted[0] as Sent
      expect(sent.context.captureMode).toBe("selection")
      expect(sent.context.selection?.format).toBe("markdown")
      const text = sent.context.selection?.text ?? ""
      // The person's own selection keeps its place at the top.
      expect(text.startsWith("**plain**\n\n## Picked elements (1)")).toBe(true)
      expect(text).toContain("- Selector: `main > button.primary`")
      expect(text).toContain("`SaveButton` → `SettingsForm`")
      expect(text).toContain("- Written at: `/src/SaveButton.tsx:12:5`")
      expect(text).toContain("**Requested:** Make it primary")
      expect(text).toContain("- Screenshot: attached")
      expect(sent.attachments).toEqual([{ attachmentId: expect.any(String), kind: "screenshot" }])
      expect(state.uploads[0]).toMatch(/^init:screenshot-element-/)
      // Sent: the picks are gone from the panel and put back on the page.
      await waitFor(() => expect(screen.queryByTestId("pick-0")).toBeNull())
      expect(state.inspectCalls).toContain("release:el-1")
    })

    it("previews style edits on the page and sends them as the change asked for", async () => {
      const state = paired()
      renderPanel(state, FEATURED)
      await captureAndAsk()
      fireEvent.click(screen.getByTestId("pick-element"))
      await screen.findByTestId("pick-0")
      fireEvent.click(screen.getByTestId("pick-styles-toggle-0"))
      fireEvent.change(screen.getByTestId("style-font-size"), { target: { value: "18px" } })
      fireEvent.change(screen.getByTestId("pick-text-0"), { target: { value: "Save" } })
      await waitFor(() =>
        expect(state.previews.at(-1)).toEqual([
          "el-1",
          { styles: { "font-size": "18px" }, text: "Save" },
        ])
      )
      fireEvent.click(screen.getByTestId("submit"))
      await waitFor(() => expect(state.submitted).toHaveLength(1))
      const text = (state.submitted[0] as Sent).context.selection?.text ?? ""
      expect(text).toContain("  font-size: 18px; /* was 14px */")
      expect(text).toContain('**Text change:** "Save changes" → "Save"')
      // The person's instruction is theirs; a pick does not overwrite it.
      expect((state.submitted[0] as Sent).instruction).toBe("Go")
    })

    it("says so when an edited element has left the page", async () => {
      const state = paired({ previewFinds: false })
      renderPanel(state, FEATURED)
      fireEvent.click(await screen.findByTestId("pick-element"))
      await screen.findByTestId("pick-0")
      fireEvent.change(screen.getByTestId("pick-text-0"), { target: { value: "Gone" } })
      expect(await screen.findByTestId("pick-detached-0")).toBeInTheDocument()
    })

    it("puts the page back and drops the screenshot when a pick is removed", async () => {
      const state = paired()
      renderPanel(state, FEATURED)
      fireEvent.click(await screen.findByTestId("pick-element"))
      await screen.findByTestId("pick-0")
      expect(screen.getAllByTestId(/^attachment-remove-/)).toHaveLength(1)
      fireEvent.click(screen.getByTestId("pick-remove-0"))
      expect(screen.queryByTestId("pick-0")).toBeNull()
      expect(screen.queryAllByTestId(/^attachment-remove-/)).toHaveLength(0)
      expect(state.inspectCalls).toContain("release:el-1")
    })

    it("adds nothing for a cancelled pick, and re-shoots an element on request", async () => {
      const state = paired({ pickResult: null })
      renderPanel(state, FEATURED)
      fireEvent.click(await screen.findByTestId("pick-element"))
      await waitFor(() => expect(state.inspectCalls).toContain("pick:1"))
      await screen.findByTestId("capture-preview")
      expect(screen.queryByTestId("picked-elements")).toBeNull()

      state.pickResult = DESCRIPTION
      fireEvent.click(screen.getByTestId("pick-element"))
      await screen.findByTestId("pick-0")
      fireEvent.click(screen.getByTestId("pick-shoot-0"))
      await waitFor(() => expect(screen.getAllByTestId(/^attachment-remove-/)).toHaveLength(2))
      expect(state.inspectCalls).toContain("locate:el-1:false")
      // Two attachments is this Host's ceiling: no third shot is offered.
      expect(screen.getByTestId("pick-shoot-0")).toBeDisabled()
    })

    it("starts the picker on the tab the context menu named", async () => {
      const state = paired({
        store: new Map<string, unknown>([
          [STORAGE_KEYS.pairing, PAIRING],
          [CAPTURE_REQUEST_KEY, { tabId: 4, mode: "inspect", requestedAt: 990 }],
        ]) as never,
      })
      renderPanel(state, FEATURED)
      expect(await screen.findByTestId("pick-0")).toBeInTheDocument()
      expect(state.inspectCalls).toContain("pick:4")
    })

    it("attaches what the console and requests said, without their query strings", async () => {
      const state = paired()
      renderPanel(state, FEATURED)
      fireEvent.click(await screen.findByTestId("page-tools-toggle"))
      fireEvent.click(screen.getByTestId("dev-record"))
      expect(await screen.findByTestId("dev-recording")).toBeInTheDocument()
      expect(state.inspectCalls).toContain("record:1")
      fireEvent.click(screen.getByTestId("dev-attach"))
      expect(await screen.findByTestId("dev-report")).toBeInTheDocument()
      expect(screen.getByText("devReportErrors")).toBeInTheDocument()
      expect(screen.getByTestId("instruction")).toHaveValue("devDefaultInstruction")
      fireEvent.click(screen.getByTestId("submit"))
      await waitFor(() => expect(state.submitted).toHaveLength(1))
      const text = (state.submitted[0] as Sent).context.selection?.text ?? ""
      expect(text).toContain("## Console and network")
      expect(text).toContain("[error] TypeError: x is undefined")
      expect(text).toContain("`POST https://example.com/api/save` → 500")
      expect(text).not.toContain("token=secret")
    })

    it("tells the steps the person took first in the report", async () => {
      const state = paired()
      state.devSnapshot = {
        ...state.devSnapshot,
        steps: [
          { ts: 1_200, kind: "click", selector: "#save", label: "button#save", detail: "Save" },
          { ts: 1_900, kind: "key", selector: "#email", detail: "Enter" },
        ],
      }
      renderPanel(state, FEATURED)
      fireEvent.click(await screen.findByTestId("page-tools-toggle"))
      fireEvent.click(screen.getByTestId("dev-record"))
      await screen.findByTestId("dev-recording")
      fireEvent.click(screen.getByTestId("dev-attach"))
      expect(await screen.findByTestId("dev-report-steps")).toHaveTextContent("devReportSteps")
      expect((screen.getByTestId("dev-report-text") as HTMLTextAreaElement).value).toContain(
        '1. +0.0s Clicked `#save` "Save"\n2. +0.7s Pressed Enter in `#email`'
      )
      fireEvent.click(screen.getByTestId("submit"))
      await waitFor(() => expect(state.submitted).toHaveLength(1))
      const text = (state.submitted[0] as Sent).context.selection?.text ?? ""
      expect(text.indexOf("### Steps to reproduce (2)")).toBeLessThan(
        text.indexOf("### Console errors and warnings")
      )
    })

    it("measures this visit's performance and sends it while included", async () => {
      const state = paired()
      renderPanel(state, FEATURED)
      fireEvent.click(await screen.findByTestId("page-audit-toggle"))
      fireEvent.click(screen.getByTestId("insight-run-perf"))
      expect(await screen.findByTestId("perf-vital-lcp")).toHaveTextContent("4.80 s")
      expect(state.inspectCalls).toContain("perf:1")
      fireEvent.change(screen.getByTestId("instruction"), { target: { value: "Speed it up" } })
      fireEvent.click(screen.getByTestId("submit"))
      await waitFor(() => expect(state.submitted).toHaveLength(1))
      const text = (state.submitted[0] as Sent).context.selection?.text ?? ""
      expect(text).toContain("## Performance (this visit)")
      expect(text).toContain("- Largest contentful paint: 4.80 s (poor) — `img.hero`")
    })

    it("edits the page's words in place and sends what changed, minus what was left out", async () => {
      const state = paired()
      renderPanel(state, FEATURED)
      fireEvent.click(await screen.findByTestId("text-edit-start"))
      expect(await screen.findByTestId("text-editing")).toBeInTheDocument()
      expect(state.inspectCalls).toContain("edit-text:1")
      // Its tile shows it running, and cannot start it twice.
      expect(screen.getByTestId("text-edit-start")).toBeDisabled()
      expect(screen.getByTestId("text-edit-start")).toHaveAttribute("aria-pressed", "true")
      fireEvent.click(screen.getByTestId("text-edit-done"))
      expect(await screen.findByTestId("text-change-1")).toHaveTextContent("Old note")
      expect(state.inspectCalls).toContain("stop-text:1:true")
      expect(screen.getByTestId("instruction")).toHaveValue("textEditDefaultInstruction")
      fireEvent.click(screen.getByTestId("text-change-remove-1"))
      expect(screen.queryByTestId("text-change-1")).toBeNull()
      fireEvent.click(screen.getByTestId("submit"))
      await waitFor(() => expect(state.submitted).toHaveLength(1))
      const text = (state.submitted[0] as Sent).context.selection?.text ?? ""
      expect(text).toContain("## Text changes (1)")
      expect(text).toContain('   - Before: "Pricing plans"\n   - After: "Plans and pricing"')
      expect(text).not.toContain("Old note")
      await waitFor(() => expect(screen.queryByTestId("text-changes")).toBeNull())
    })

    it("unwinds every edit on request, and leaves the page editable no longer when closed", async () => {
      const state = paired()
      const { unmount } = renderPanel(state, FEATURED)
      fireEvent.click(await screen.findByTestId("text-edit-start"))
      await screen.findByTestId("text-editing")
      fireEvent.click(screen.getByTestId("text-edit-undo"))
      await waitFor(() => expect(state.inspectCalls).toContain("stop-text:1:false"))
      expect(screen.queryByTestId("text-changes")).toBeNull()
      fireEvent.click(await screen.findByTestId("text-edit-start"))
      await screen.findByTestId("text-editing")
      unmount()
      expect(state.inspectCalls.at(-1)).toBe("stop-text:1:true")
    })

    it("checks SEO and sends the findings while included", async () => {
      const state = paired()
      renderPanel(state, FEATURED)
      fireEvent.click(await screen.findByTestId("page-audit-toggle"))
      fireEvent.click(screen.getByTestId("insight-run-seo"))
      expect(await screen.findByTestId("seo-result")).toBeInTheDocument()
      expect(state.inspectCalls).toContain("seo:1")
      fireEvent.change(screen.getByTestId("instruction"), { target: { value: "Fix the SEO" } })
      fireEvent.click(screen.getByTestId("submit"))
      await waitFor(() => expect(state.submitted).toHaveLength(1))
      const text = (state.submitted[0] as Sent).context.selection?.text ?? ""
      expect(text).toContain("## SEO and link previews")
      expect(text).toContain("- [warning] No meta description")
    })

    it("checks the layout and turns a finding into a pick", async () => {
      const state = paired()
      state.described.set("el-7", {
        ...DESCRIPTION,
        elementId: "el-7",
        selector: "#wide",
        label: "div#wide",
      })
      renderPanel(state, FEATURED)
      fireEvent.click(await screen.findByTestId("page-audit-toggle"))
      fireEvent.click(screen.getByTestId("insight-run-layout"))
      expect(await screen.findByTestId("layout-result")).toBeInTheDocument()
      expect(state.inspectCalls).toContain("layout:1")
      fireEvent.click(screen.getByTestId("layout-show-0"))
      await waitFor(() => expect(state.inspectCalls).toContain("locate:el-7:true"))
      fireEvent.click(screen.getByTestId("layout-pick-0"))
      expect(await screen.findByTestId("pick-0")).toBeInTheDocument()
      expect(state.inspectCalls).toContain("describe:el-7")
      expect(screen.getByTestId("pick-note-0")).toHaveValue(
        "layoutRuleOverflow — extends 210px past the 390px viewport"
      )
      expect(screen.getByTestId("layout-pick-0")).toBeDisabled()
      fireEvent.click(screen.getByTestId("submit"))
      await waitFor(() => expect(state.submitted).toHaveLength(1))
      const text = (state.submitted[0] as Sent).context.selection?.text ?? ""
      expect(text).toContain("## Layout check (1 findings)")
      expect(text).toContain("the page is 600px wide, so it scrolls sideways")
    })

    it("saves the reviewed context as a Markdown file", async () => {
      const blobs: Blob[] = []
      const createObjectURL = jest.fn((blob: Blob) => {
        blobs.push(blob)
        return "blob:cognia/1"
      })
      const revokeObjectURL = jest.fn()
      Object.assign(URL, { createObjectURL, revokeObjectURL })
      const names: string[] = []
      const click = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
        this: HTMLAnchorElement
      ) {
        names.push(this.download)
      })
      try {
        const state = paired()
        renderPanel(state, FEATURED)
        fireEvent.click(await screen.findByTestId("pick-element"))
        await screen.findByTestId("pick-0")
        fireEvent.change(screen.getByTestId("instruction"), { target: { value: "Tighten this" } })
        fireEvent.click(screen.getByTestId("export-context"))
        expect(names).toEqual([expect.stringMatching(/^cognia-.+-\d{4}-\d{2}-\d{2}\.md$/)])
        expect(blobs[0]?.type).toBe("text/markdown;charset=utf-8")
        // jsdom's Blob has no `text()`; its FileReader reads it.
        const text = await new Promise<string>((resolve) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result))
          reader.readAsText(blobs[0]!)
        })
        expect(text).toContain("Tighten this")
        expect(text).toContain("https://example.com/tab-1")
        expect(text).toContain("## Picked elements (1)")
        await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith("blob:cognia/1"))
      } finally {
        click.mockRestore()
      }
    })

    it("adjusts a pick on the page and sends what changed as its style edits", async () => {
      const state = paired()
      renderPanel(state, FEATURED)
      fireEvent.click(await screen.findByTestId("pick-element"))
      await screen.findByTestId("pick-0")
      fireEvent.click(screen.getByTestId("pick-adjust-0"))
      // Adjusting: kept from the panel, or put back.
      fireEvent.click(await screen.findByTestId("adjust-done"))
      expect(screen.getByTestId("pick-cancel")).toHaveTextContent("adjustCancel")
      await waitFor(() => expect(screen.queryByTestId("adjust-done")).toBeNull())
      expect(state.inspectCalls).toEqual(expect.arrayContaining(["adjust:el-1", "finish-adjust:1"]))
      await waitFor(() =>
        expect(state.previews.at(-1)).toEqual([
          "el-1",
          { styles: { width: "160px", padding: "8px 16px" } },
        ])
      )
      fireEvent.click(screen.getByTestId("submit"))
      await waitFor(() => expect(state.submitted).toHaveLength(1))
      const text = (state.submitted[0] as Sent).context.selection?.text ?? ""
      expect(text).toContain("  width: 160px;")
      expect(text).toContain("  padding: 8px 16px;")
    })

    it("leaves a pick's edits alone when the adjustment is undone", async () => {
      const state = paired()
      renderPanel(state, FEATURED)
      fireEvent.click(await screen.findByTestId("pick-element"))
      await screen.findByTestId("pick-0")
      fireEvent.click(screen.getByTestId("pick-adjust-0"))
      await screen.findByTestId("adjust-done")
      fireEvent.click(screen.getByTestId("pick-cancel"))
      await waitFor(() => expect(screen.queryByTestId("adjust-done")).toBeNull())
      expect(state.previews).toEqual([])
    })

    it("simulates a failing request, says so in what is sent, and clears it on close", async () => {
      const state = paired()
      const { unmount } = renderPanel(state, FEATURED)
      fireEvent.click(await screen.findByTestId("page-tools-toggle"))
      fireEvent.change(screen.getByTestId("mock-match"), { target: { value: "/api/orders" } })
      fireEvent.click(screen.getByTestId("mock-add"))
      expect(await screen.findByTestId("mock-rule-0")).toHaveTextContent("mockRuleFail")
      expect(state.mockCalls).toEqual([
        [expect.objectContaining({ match: "/api/orders", action: "fail", method: "" })],
      ])
      state.mockHits = {
        installed: true,
        kept: false,
        hits: {
          [state.mockCalls[0]![0]!.id]: { count: 2, lastUrl: "https://example.com/api/orders" },
        },
        log: [],
      }
      fireEvent.click(screen.getByTestId("mock-refresh"))
      // The harness's messages are bare keys; the last URL matched is the badge's title.
      await waitFor(() =>
        expect(screen.getByTestId("mock-hits-0")).toHaveAttribute(
          "title",
          "https://example.com/api/orders"
        )
      )
      fireEvent.click(screen.getByTestId("capture-now"))
      await screen.findByTestId("capture-preview")
      fireEvent.change(screen.getByTestId("instruction"), {
        target: { value: "Handle the outage" },
      })
      fireEvent.click(screen.getByTestId("submit"))
      await waitFor(() => expect(state.submitted).toHaveLength(1))
      const text = (state.submitted[0] as Sent).context.selection?.text ?? ""
      expect(text).toContain("## Simulated requests (1)")
      expect(text).toContain("- Any method `/api/orders` → network error — matched 2 times")
      // Read again as it was sent: the page kept counting.
      expect(state.mockCalls.at(-1)).toBeNull()
      // Still on the page after sending: they are a tool, not part of the capture.
      expect(screen.getByTestId("mock-rule-0")).toBeInTheDocument()
      unmount()
      expect(state.mockCalls.at(-1)).toEqual([])
    })

    it("says when the page reloaded under its rules, and applies them again", async () => {
      const state = paired()
      renderPanel(state, FEATURED)
      fireEvent.click(await screen.findByTestId("page-tools-toggle"))
      fireEvent.change(screen.getByTestId("mock-match"), { target: { value: "/api" } })
      fireEvent.click(screen.getByTestId("mock-add"))
      await screen.findByTestId("mock-rule-0")
      state.mockHits = { installed: false, kept: false, hits: {}, log: [] }
      fireEvent.click(screen.getByTestId("mock-refresh"))
      expect(await screen.findByTestId("mock-lost")).toBeInTheDocument()
      fireEvent.click(screen.getByTestId("mock-refresh"))
      await waitFor(() => expect(screen.queryByTestId("mock-lost")).toBeNull())
      expect(state.mockCalls.at(-1)).toEqual([expect.objectContaining({ match: "/api" })])
      fireEvent.click(screen.getByTestId("mock-clear"))
      await waitFor(() => expect(screen.queryByTestId("mock-rule-0")).toBeNull())
      expect(state.mockCalls.at(-1)).toEqual([])
    })

    it("keeps simulated requests across reloads, pauses one, and stops keeping when cleared", async () => {
      const state = paired()
      renderPanel(state, FEATURED)
      fireEvent.click(await screen.findByTestId("page-tools-toggle"))
      fireEvent.change(screen.getByTestId("mock-match"), { target: { value: "/api" } })
      fireEvent.click(screen.getByTestId("mock-add"))
      await screen.findByTestId("mock-rule-0")
      expect(screen.getByTestId("mock-keep")).not.toBeChecked()
      fireEvent.click(screen.getByTestId("mock-keep"))
      await waitFor(() => expect(screen.getByTestId("mock-keep")).toBeChecked())
      const url = state.keepCalls[0]![0]
      expect(state.keepCalls).toEqual([[url, true]])
      expect(url).toMatch(/^https?:/)
      // Paused, and still kept.
      fireEvent.click(screen.getByTestId("mock-toggle-0"))
      await waitFor(() =>
        expect(state.mockCalls.at(-1)).toEqual([expect.objectContaining({ enabled: false })])
      )
      expect(state.mockHits.kept).toBe(true)
      expect(screen.getByTestId("mock-toggle-0")).toHaveAccessibleName("mockResume")
      fireEvent.click(screen.getByTestId("mock-clear"))
      await waitFor(() => expect(screen.queryByTestId("mock-rule-0")).toBeNull())
      expect(state.keepCalls.at(-1)).toEqual([url, false])
    })

    it("stops keeping simulated requests when the panel closes", async () => {
      const state = paired()
      const { unmount } = renderPanel(state, FEATURED)
      fireEvent.click(await screen.findByTestId("page-tools-toggle"))
      fireEvent.change(screen.getByTestId("mock-match"), { target: { value: "/api" } })
      fireEvent.click(screen.getByTestId("mock-add"))
      await screen.findByTestId("mock-rule-0")
      fireEvent.click(screen.getByTestId("mock-keep"))
      await waitFor(() => expect(screen.getByTestId("mock-keep")).toBeChecked())
      unmount()
      expect(state.mockCalls.at(-1)).toEqual([])
      expect(state.keepCalls.at(-1)).toEqual([state.keepCalls[0]![0], false])
    })

    it("says so when the site's permission to keep them is refused", async () => {
      const state = paired()
      state.keepAllowed = false
      renderPanel(state, FEATURED)
      fireEvent.click(await screen.findByTestId("page-tools-toggle"))
      fireEvent.change(screen.getByTestId("mock-match"), { target: { value: "/api" } })
      fireEvent.click(screen.getByTestId("mock-add"))
      await screen.findByTestId("mock-rule-0")
      const installs = state.mockCalls.length
      fireEvent.click(screen.getByTestId("mock-keep"))
      expect(await screen.findByText("mockKeepDenied")).toBeInTheDocument()
      expect(screen.getByTestId("mock-keep")).not.toBeChecked()
      expect(state.mockCalls).toHaveLength(installs)
    })

    it("checks the keyboard focus order, numbers it on the page, and takes the numbers off when sent", async () => {
      const state = paired()
      state.described.set("el-8", {
        ...DESCRIPTION,
        elementId: "el-8",
        selector: "#card",
        label: "div#card",
      })
      renderPanel(state, FEATURED)
      fireEvent.click(await screen.findByTestId("page-audit-toggle"))
      fireEvent.click(screen.getByTestId("insight-run-focus"))
      expect(await screen.findByTestId("focus-result")).toBeInTheDocument()
      expect(state.inspectCalls).toContain("focus:1")
      fireEvent.click(screen.getByTestId("focus-numbers"))
      await waitFor(() => expect(state.inspectCalls).toContain("focus-numbers:1:false"))
      expect(await screen.findByText("focusShowNumbers")).toBeInTheDocument()
      fireEvent.click(screen.getByTestId("focus-numbers"))
      await waitFor(() => expect(state.inspectCalls).toContain("focus-numbers:1:true"))
      fireEvent.click(screen.getByTestId("focus-pick-0"))
      expect(await screen.findByTestId("pick-0")).toBeInTheDocument()
      expect(screen.getByTestId("pick-note-0")).toHaveValue("focusRuleUnreachable")
      fireEvent.click(screen.getByTestId("submit"))
      await waitFor(() => expect(state.submitted).toHaveLength(1))
      const text = (state.submitted[0] as Sent).context.selection?.text ?? ""
      expect(text).toContain("## Keyboard focus check (1 findings)")
      expect(text).toContain("Tab moves through 14 stops on this page.")
      // Sent with the check: the numbers come off the page.
      await waitFor(() => expect(state.inspectCalls.at(-1)).toBe("focus-numbers:1:false"))
    })

    it("compares the page with the mock, attaching the difference and sending the numbers", async () => {
      const state = paired()
      renderPanel(state, FEATURED)
      fireEvent.click(await screen.findByTestId("page-tools-toggle"))
      const file = new File([new Uint8Array([137, 80, 78, 71])], "home.png", { type: "image/png" })
      fireEvent.change(screen.getByTestId("overlay-file"), { target: { files: [file] } })
      await screen.findByTestId("overlay-controls")
      fireEvent.click(screen.getByTestId("overlay-compare"))
      expect(await screen.findByTestId("design-diff")).toBeInTheDocument()
      expect(screen.getByTestId("design-diff-share")).toHaveTextContent("5.0%")
      // Hidden for the shot, and back after it.
      const visibility = state.overlayStates.map(
        (entry) => (entry as { visible?: boolean } | null)?.visible
      )
      expect(visibility.slice(-2)).toEqual([false, true])
      expect(state.diffCalls).toEqual([
        {
          capture: "data:image/png;base64,iVBORw0KGgo=",
          mock: "data:image/png;base64,",
          overlay: { x: 0, y: 0, scale: 1 },
          view: { scrollX: 0, scrollY: 0, width: 1280, height: 800 },
        },
      ])
      expect(screen.getByTestId("instruction")).toHaveValue("compareDefaultInstruction")
      await screen.findByTestId(/^attachment-remove-/)
      // Compared again: the new difference replaces the old one.
      fireEvent.click(screen.getByTestId("overlay-compare"))
      await waitFor(() => expect(state.diffCalls).toHaveLength(2))
      await waitFor(() => expect(screen.getAllByTestId(/^attachment-remove-/)).toHaveLength(1))
      fireEvent.click(screen.getByTestId("submit"))
      await waitFor(() => expect(state.submitted).toHaveLength(1))
      const text = (state.submitted[0] as Sent).context.selection?.text ?? ""
      expect(text).toContain("## Design comparison")
      expect(text).toContain("`home.png`")
      expect(text).toContain("1. 320×48 at (32, 96)")
      expect(state.uploads[0]).toMatch(/^init:screenshot-design-diff-/)
      await waitFor(() => expect(screen.queryByTestId("design-diff")).toBeNull())
    })

    it("says so when the mock is out of view, and leaves it showing", async () => {
      const state = paired({ diff: null })
      renderPanel(state, FEATURED)
      fireEvent.click(await screen.findByTestId("page-tools-toggle"))
      const file = new File([new Uint8Array([137, 80, 78, 71])], "home.png", { type: "image/png" })
      fireEvent.change(screen.getByTestId("overlay-file"), { target: { files: [file] } })
      await screen.findByTestId("overlay-controls")
      fireEvent.click(screen.getByTestId("overlay-compare"))
      expect(await screen.findByText("compareOutOfView")).toBeInTheDocument()
      expect((state.overlayStates.at(-1) as { visible: boolean }).visible).toBe(true)
      expect(screen.queryByTestId("design-diff")).toBeNull()
    })

    it("floats its tools on the page and runs them from there, until it closes", async () => {
      const state = paired({
        pickQueue: [{ ...DESCRIPTION }],
        zoom: 1.25,
      })
      const { unmount } = renderPanel(state, FEATURED)
      fireEvent.click(await screen.findByTestId("toolbar-toggle"))
      await waitFor(() => expect(state.toolbarStates.at(-1)).toMatchObject({ zoom: 1.25 }))
      expect(state.toolbarStates.at(-1)).toMatchObject({
        active: null,
        disabled: ["adjust", "shot"],
        counts: { pick: 0, measure: 0 },
        labels: { pick: "toolbarPick", close: "toolbarClose", minimap: "toolbarMinimap" },
        marks: [],
      })
      // The tab zooms: the toolbar hears, another tab's zoom it does not.
      act(() => state.zoomTab?.(99, 3))
      act(() => state.zoomTab?.(1, 2))
      await waitFor(() => expect(state.toolbarStates.at(-1)).toMatchObject({ zoom: 2 }))
      expect(screen.getByTestId("toolbar-toggle")).toHaveTextContent("toolbarHide")
      // Pressed on another tab: not this toolbar's.
      state.pressToolbar?.("pick", 99)
      expect(state.inspectCalls.some((call) => call.startsWith("pick:"))).toBe(false)
      state.pressToolbar?.("pick", 1)
      expect(await screen.findByTestId("pick-0")).toBeInTheDocument()
      await waitFor(() =>
        expect(state.toolbarStates.at(-1)).toMatchObject({
          active: null,
          disabled: [],
          counts: { pick: 1, measure: 0 },
          marks: ["el-1"],
        })
      )
      // Adjusting from the page, and ending it from there too.
      state.pressToolbar?.("adjust", 1)
      await waitFor(() => expect(state.inspectCalls).toContain("adjust:el-1"))
      await waitFor(() => expect(state.toolbarStates.at(-1)).toMatchObject({ active: "adjust" }))
      state.pressToolbar?.("text", 1)
      await waitFor(() => expect(state.inspectCalls).toContain("finish-adjust:1"))
      expect(state.inspectCalls).not.toContain("edit-text:1")
      await waitFor(() => expect(state.toolbarStates.at(-1)).toMatchObject({ active: null }))
      state.pressToolbar?.("text", 1)
      await waitFor(() => expect(state.inspectCalls).toContain("edit-text:1"))
      await waitFor(() => expect(state.toolbarStates.at(-1)).toMatchObject({ active: "text" }))
      state.pressToolbar?.("close", 1)
      await waitFor(() => expect(state.toolbarStates.at(-1)).toBeNull())
      expect(screen.getByTestId("toolbar-toggle")).toHaveTextContent("toolbarShow")
      fireEvent.click(screen.getByTestId("toolbar-toggle"))
      await waitFor(() => expect(state.toolbarStates.at(-1)).not.toBeNull())
      unmount()
      expect(state.toolbarStates.at(-1)).toBeNull()
    })

    it("offers snapping for the floating toolbar while it is shown, and remembers the choice", async () => {
      const state = paired()
      renderPanel(state, FEATURED)
      await screen.findByTestId("toolbar-toggle")
      expect(screen.queryByTestId("toolbar-snap")).toBeNull()
      fireEvent.click(screen.getByTestId("toolbar-toggle"))
      await waitFor(() => expect(state.toolbarStates.at(-1)).toMatchObject({ snap: false }))
      fireEvent.click(screen.getByTestId("toolbar-snap"))
      await waitFor(() =>
        expect(state.store.get(STORAGE_KEYS.preferences)).toMatchObject({ toolbarSnap: true })
      )
      await waitFor(() => expect(state.toolbarStates.at(-1)).toMatchObject({ snap: true }))
      expect(screen.getByTestId("toolbar-snap")).toHaveAttribute("aria-checked", "true")
    })

    it("copies a pick as its markup and CSS, with the previewed edit", async () => {
      const writeText = jest.fn(async () => undefined)
      Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
      const state = paired({
        pickResult: { ...DESCRIPTION, html: '<button class="primary">Save changes</button>' },
      })
      renderPanel(state, FEATURED)
      fireEvent.click(await screen.findByTestId("pick-element"))
      await screen.findByTestId("pick-0")
      fireEvent.click(screen.getByTestId("pick-styles-toggle-0"))
      fireEvent.change(screen.getByTestId("style-font-size"), { target: { value: "18px" } })
      fireEvent.click(screen.getByTestId("pick-copy-code-0"))
      await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
      const copied = (writeText.mock.calls[0] as unknown as [string])[0]
      expect(copied).toContain('<button class="primary">Save changes</button>')
      expect(copied).toContain("font-size: 18px;")
      // And the markup goes with the pick, in place of the outline it supersedes.
      fireEvent.click(screen.getByTestId("submit"))
      await waitFor(() => expect(state.submitted).toHaveLength(1))
      const text = (state.submitted[0] as Sent).context.selection?.text ?? ""
      expect(text).toContain("Markup (cleaned):")
      expect(text).not.toContain("Structure:")
    })

    it("lays a design mock over the page, adjusts it, and takes it away", async () => {
      const state = paired()
      const { unmount } = renderPanel(state, FEATURED)
      fireEvent.click(await screen.findByTestId("page-tools-toggle"))
      const file = new File([new Uint8Array([137, 80, 78, 71])], "home.png", { type: "image/png" })
      fireEvent.change(screen.getByTestId("overlay-file"), { target: { files: [file] } })
      expect(await screen.findByTestId("overlay-controls")).toBeInTheDocument()
      expect(state.overlayStates[0]).toMatchObject({
        image: expect.stringMatching(/^data:image\/png;base64,/),
        opacity: 0.5,
        visible: true,
      })
      fireEvent.click(screen.getByTestId("overlay-difference"))
      expect(state.overlayStates.at(-1)).toMatchObject({ image: null, difference: true })
      unmount()
      // Its controls are gone with the panel, so the mock goes too.
      expect(state.overlayStates.at(-1)).toBeNull()
    })

    it("opens the page at a screen size", async () => {
      const state = paired()
      renderPanel(state, FEATURED)
      fireEvent.click(await screen.findByTestId("page-tools-toggle"))
      fireEvent.click(screen.getByTestId("viewport-mobile"))
      await waitFor(() =>
        expect(state.viewports).toEqual([
          ["https://example.com/a?x=1", { width: 390, height: 844 }],
        ])
      )
    })

    it("checks accessibility and turns a finding into a pick that says what was found", async () => {
      const state = paired()
      state.described.set("el-9", {
        ...DESCRIPTION,
        elementId: "el-9",
        selector: "p.muted",
        label: "p.muted",
      })
      renderPanel(state, FEATURED)
      fireEvent.click(await screen.findByTestId("page-audit-toggle"))
      fireEvent.click(screen.getByTestId("insight-run-audit"))
      expect(await screen.findByTestId("a11y-result")).toBeInTheDocument()
      expect(state.inspectCalls).toContain("audit:1")
      fireEvent.click(screen.getByTestId("a11y-pick-0"))
      expect(await screen.findByTestId("pick-0")).toBeInTheDocument()
      expect(state.inspectCalls).toEqual(
        expect.arrayContaining(["locate:el-9:false", "describe:el-9"])
      )
      expect(screen.getByTestId("pick-note-0")).toHaveValue(
        "accessRuleContrast — 2.10:1, needs 4.5:1 (#aaaaaa on #ffffff)"
      )
      expect(screen.getByTestId("a11y-pick-0")).toBeDisabled()
      fireEvent.click(screen.getByTestId("submit"))
      await waitFor(() => expect(state.submitted).toHaveLength(1))
      const text = (state.submitted[0] as Sent).context.selection?.text ?? ""
      expect(text).toContain("## Picked elements (1)")
      expect(text).toContain("## Accessibility check (2 findings)")
      expect(text).toContain("- [serious] Text contrast is below WCAG AA — `p.muted`")
      // Sent: the checks are spent with the submission.
      await waitFor(() => expect(screen.queryByTestId("a11y-result")).toBeNull())
    })

    it("frames the submission with the stack, and leaves out what the person excluded", async () => {
      const state = paired()
      renderPanel(state, FEATURED)
      fireEvent.click(await screen.findByTestId("page-audit-toggle"))
      fireEvent.click(screen.getByTestId("insight-run-stack"))
      expect(await screen.findByTestId("stack-result")).toHaveTextContent("React19.1.0")
      fireEvent.click(screen.getByTestId("insight-run-tokens"))
      expect(await screen.findByTestId("tokens-result")).toBeInTheDocument()
      fireEvent.click(screen.getByTestId("insight-include-tokens"))
      fireEvent.change(screen.getByTestId("instruction"), { target: { value: "Restyle" } })
      fireEvent.click(screen.getByTestId("submit"))
      await waitFor(() => expect(state.submitted).toHaveLength(1))
      const text = (state.submitted[0] as Sent).context.selection?.text ?? ""
      expect(text.startsWith("**plain**\n\n## Tech stack")).toBe(true)
      expect(text).toContain("- Framework: React 19.1.0")
      expect(text).not.toContain("Design tokens")
    })

    it("keeps picking while the person Shift-clicks", async () => {
      const state = paired({
        pickQueue: [
          { ...DESCRIPTION, more: true },
          { ...DESCRIPTION, elementId: "el-2", selector: "#two", label: "div#two" },
        ],
      })
      renderPanel(state, FEATURED)
      fireEvent.click(await screen.findByTestId("pick-element"))
      expect(await screen.findByTestId("pick-1")).toBeInTheDocument()
      expect(state.inspectCalls.filter((call) => call.startsWith("pick:"))).toHaveLength(2)
      expect(screen.getByTestId("pick-1")).toHaveTextContent("div#two")
    })

    it("chooses several in one pass, and compares them when asked", async () => {
      const writeText = jest.fn(async () => undefined)
      Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
      const state = paired({
        pickQueue: [
          { ...DESCRIPTION, styles: { "font-size": "14px" }, more: true },
          {
            ...DESCRIPTION,
            elementId: "el-2",
            selector: "#two",
            label: "div#two",
            styles: { "font-size": "16px" },
          },
        ],
      })
      renderPanel(state, FEATURED)
      fireEvent.click(await screen.findByTestId("pick-element"))
      expect(await screen.findByTestId("pick-compare")).toBeInTheDocument()
      expect(screen.getByTestId("pick-compare-row-0")).toHaveTextContent("font-size")
      // Not sent until asked for.
      fireEvent.click(screen.getByTestId("copy-context"))
      await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
      expect((writeText.mock.calls[0] as unknown as [string])[0]).not.toContain(
        "How the picks differ"
      )
      fireEvent.click(screen.getByTestId("pick-compare-include"))
      fireEvent.click(screen.getByTestId("copy-context"))
      await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2))
      const text = (writeText.mock.calls[1] as unknown as [string])[0]
      expect(text).toContain("## How the picks differ (1 property)")
      expect(text).toContain("| font-size | `14px` | `16px` |")
    })

    it("copies the reviewed context as one prompt for another tool", async () => {
      const writeText = jest.fn(async () => undefined)
      Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
      const state = paired()
      renderPanel(state, FEATURED)
      fireEvent.click(await screen.findByTestId("pick-element"))
      await screen.findByTestId("pick-0")
      fireEvent.click(screen.getByTestId("copy-context"))
      await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
      const text = (writeText.mock.calls[0] as unknown as [string])[0]
      expect(
        text.startsWith("# A page\n\nhttps://example.com/tab-1\n\ninspectDefaultInstruction")
      ).toBe(true)
      expect(text).toContain("## Picked elements (1)")
      expect(await screen.findByText("copyContextDone")).toBeInTheDocument()
      expect(state.submitted).toHaveLength(0)
    })

    it("samples colours from the screen where the browser has an eyedropper", async () => {
      const win = window as unknown as { EyeDropper?: unknown }
      win.EyeDropper = class {
        async open() {
          return { sRGBHex: "#FF0000" }
        }
      }
      try {
        const state = paired()
        renderPanel(state, FEATURED)
        fireEvent.click(await screen.findByTestId("page-audit-toggle"))
        fireEvent.click(screen.getByTestId("eyedropper"))
        expect(await screen.findByTestId("eyedropper-colors")).toHaveTextContent("#ff0000")
      } finally {
        delete win.EyeDropper
      }
    })

    const SAVE = {
      elementId: "el-1",
      selector: "#save",
      label: "button#save",
      box: { x: 0, y: 0, width: 120, height: 36 },
    }
    const CARD = {
      elementId: "el-2",
      selector: "#card",
      label: "div#card",
      box: { x: 0, y: 48, width: 300, height: 120 },
    }
    const TITLE = {
      elementId: "el-3",
      selector: "h2",
      label: "h2",
      box: { x: 2, y: 52, width: 100, height: 20 },
    }
    const measured = (from: typeof SAVE, to: typeof SAVE, more?: boolean) => ({
      from,
      to,
      measure: measureBoxes(from.box, to.box),
      ...(more ? { more } : {}),
    })

    it("measures between elements, keeps measuring from the anchor on Shift, and sends the numbers", async () => {
      const state = paired({
        measureQueue: [measured(SAVE, CARD, true), measured(SAVE, TITLE)],
      })
      renderPanel(state, FEATURED)
      fireEvent.click(await screen.findByTestId("measure-element"))
      expect(await screen.findByTestId("measure-1")).toBeInTheDocument()
      // The second pass measures from where the first began.
      expect(state.inspectCalls.filter((call) => call.startsWith("measure:"))).toEqual([
        "measure:1:",
        "measure:1:el-1",
      ])
      expect(screen.getByTestId("measure-distances-0")).toHaveTextContent("↕ 12px")
      expect(screen.getByTestId("measure-near-1")).toBeInTheDocument()
      expect(screen.getByTestId("instruction")).toHaveValue("measureDefaultInstruction")
      fireEvent.change(screen.getByTestId("measure-note-0"), { target: { value: "Make it 16px" } })
      fireEvent.click(screen.getByTestId("submit"))
      await waitFor(() => expect(state.submitted).toHaveLength(1))
      const text = (state.submitted[0] as Sent).context.selection?.text ?? ""
      expect(text).toContain("## Measurements (2)")
      expect(text).toContain("1. `div#card` is 12px below `button#save`")
      expect(text).toContain("   - **Requested:** Make it 16px")
      // Sent: the measured elements are forgotten on the page.
      await waitFor(() => expect(state.inspectCalls).toContain("release:el-1,el-2,el-3"))
      expect(screen.queryByTestId("measurements")).toBeNull()
    })

    it("re-measures on Show, and keeps a removed measurement's element while a pick holds it", async () => {
      const state = paired({
        pickResult: { ...DESCRIPTION, elementId: "el-1" },
        measureQueue: [measured(SAVE, CARD)],
        shownMeasure: measured(SAVE, { ...CARD, box: { ...CARD.box, y: 52 } }),
      })
      renderPanel(state, FEATURED)
      fireEvent.click(await screen.findByTestId("pick-element"))
      await screen.findByTestId("pick-0")
      fireEvent.click(screen.getByTestId("measure-element"))
      await screen.findByTestId("measure-0")
      fireEvent.click(screen.getByTestId("measure-show-0"))
      await waitFor(() =>
        expect(screen.getByTestId("measure-distances-0")).toHaveTextContent("↕ 16px")
      )
      expect(state.inspectCalls).toContain("show-measure:el-1:el-2")
      fireEvent.click(screen.getByTestId("measure-remove-0"))
      expect(screen.queryByTestId("measure-0")).toBeNull()
      expect(state.inspectCalls).toContain("release:el-2")
      expect(state.inspectCalls).not.toContain("release:el-1,el-2")
      // A cancelled measurement adds nothing.
      fireEvent.click(screen.getByTestId("measure-element"))
      await waitFor(() => expect(screen.getByTestId("measure-element")).toBeEnabled())
      expect(screen.queryByTestId("measurements")).toBeNull()
    })

    it("says a measured element left the page", async () => {
      const state = paired({ measureQueue: [measured(SAVE, CARD)] })
      renderPanel(state, FEATURED)
      fireEvent.click(await screen.findByTestId("measure-element"))
      await screen.findByTestId("measure-0")
      fireEvent.click(screen.getByTestId("measure-show-0"))
      expect(await screen.findByTestId("measure-detached-0")).toBeInTheDocument()
    })

    function sized(element: HTMLElement) {
      element.getBoundingClientRect = () =>
        ({
          left: 0,
          top: 0,
          width: 200,
          height: 100,
          right: 200,
          bottom: 100,
          x: 0,
          y: 0,
        }) as DOMRect
    }

    it("marks up the screen with numbered notes, and sends the marks with the shot", async () => {
      const state = paired()
      renderPanel(state, FEATURED)
      await captureAndAsk()
      fireEvent.click(screen.getByTestId("attach-markup"))
      const surface = await screen.findByTestId("annotate-surface")
      sized(surface)
      // A box, then a numbered marker with its note.
      fireEvent.pointerDown(surface, { clientX: 10, clientY: 10, pointerId: 1 })
      fireEvent.pointerMove(surface, { clientX: 100, clientY: 60, pointerId: 1 })
      fireEvent.pointerUp(surface, { pointerId: 1 })
      fireEvent.click(screen.getByTestId("annotate-tool-marker"))
      fireEvent.pointerDown(surface, { clientX: 50, clientY: 50, pointerId: 1 })
      fireEvent.pointerUp(surface, { pointerId: 1 })
      fireEvent.change(screen.getByTestId("annotate-note-1"), { target: { value: "Too tight" } })
      fireEvent.click(screen.getByTestId("annotate-confirm"))
      expect(await screen.findByTestId(/^attachment-marked-/)).toBeInTheDocument()
      expect(state.annotated).toEqual([
        [
          expect.objectContaining({
            kind: "box",
            from: { x: 0.05, y: 0.1 },
            to: { x: 0.5, y: 0.6 },
          }),
          expect.objectContaining({
            kind: "marker",
            n: 1,
            note: "Too tight",
            at: { x: 0.25, y: 0.5 },
          }),
        ],
      ])
      fireEvent.click(screen.getByTestId("submit"))
      await waitFor(() => expect(state.submitted).toHaveLength(1))
      const text = (state.submitted[0] as Sent).context.selection?.text ?? ""
      expect(text).toContain("## Screenshot annotations")
      expect(text).toMatch(/- `screenshot-visible-[^`]+\.png`: 1 box, 1 numbered marker/)
      expect(text).toContain("  1. Too tight")
      expect((state.submitted[0] as { attachments: unknown[] }).attachments).toHaveLength(1)
    })

    it("marks up again from the clean shot, and taking every mark away restores it", async () => {
      const state = paired()
      renderPanel(state, FEATURED)
      await captureAndAsk()
      fireEvent.click(screen.getByTestId("attach-visible"))
      const annotate = await screen.findByTestId(/^attachment-annotate-/)
      fireEvent.click(annotate)
      const surface = await screen.findByTestId("annotate-surface")
      sized(surface)
      fireEvent.click(screen.getByTestId("annotate-tool-arrow"))
      fireEvent.pointerDown(surface, { clientX: 10, clientY: 10, pointerId: 1 })
      fireEvent.pointerMove(surface, { clientX: 150, clientY: 80, pointerId: 1 })
      fireEvent.pointerUp(surface, { pointerId: 1 })
      fireEvent.click(screen.getByTestId("annotate-confirm"))
      await screen.findByTestId(/^attachment-marked-/)
      fireEvent.click(screen.getByTestId(/^attachment-annotate-/))
      expect(await screen.findByTestId("annotate-shape-0")).toBeInTheDocument()
      // Opened from the shot as taken, not the one with the arrow burned in.
      expect(
        screen.getByTestId("annotate-surface").querySelector("img")?.getAttribute("src")
      ).not.toContain("bWFya2Vk")
      fireEvent.click(screen.getByTestId("annotate-clear"))
      fireEvent.click(screen.getByTestId("annotate-confirm"))
      await waitFor(() => expect(screen.queryByTestId(/^attachment-marked-/)).toBeNull())
      expect(state.annotated).toHaveLength(1)
      expect(screen.queryByTestId("annotator")).toBeNull()
    })

    it("refuses the tools on a page the person blocked", async () => {
      const state = paired({
        store: new Map<string, unknown>([
          [STORAGE_KEYS.pairing, PAIRING],
          [STORAGE_KEYS.preferences, { blockedHosts: ["example.com"] }],
        ]) as never,
      })
      renderPanel(state, FEATURED)
      fireEvent.click(await screen.findByTestId("page-tools-toggle"))
      fireEvent.click(screen.getByTestId("dev-record"))
      expect(await screen.findByTestId("submit-error")).toHaveTextContent("captureBlocked")
      expect(state.inspectCalls).not.toContain("record:1")
    })
  })
})
