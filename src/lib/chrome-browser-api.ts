/**
 * The real `chrome.*` implementation of {@link BrowserApi}.
 *
 * The only module in the extension that touches the extension APIs directly,
 * which is what makes the rest of it testable and what makes the permission
 * surface readable: everything the extension can do to the browser is one
 * file's worth of calls.
 *
 * `chrome.*` rather than WXT's `browser` wrapper. The extension ships to
 * Chrome and Edge only, and the wrapper re-types `i18n.getMessage` and
 * `runtime.getURL` into signatures generated from `_locales`, which is a build
 * step this module has no reason to depend on.
 */
import { chromeStorageArea } from "./agent/chrome-agent-browser"
import type { AgentPermissionMessage } from "./agent/site-permissions"
import { blobToBase64, browserImageDeps, browserImageOps, dataUrlToBlob } from "./agent/image-ops"
import { pageScrollMetrics, pageScrollTo } from "./agent/page-functions"
import { PANEL_PORT, type BrowserApi, type PermissionRequest, type TabRef } from "./browser-api"
import { isYouTubeWatchUrl, readYouTubeTranscript } from "./capture/youtube-transcript"
import { pageDesignOverlay, pageViewAfterPaint } from "./inspect/design-overlay"
import { isToolbarMessage, pageToolbar, pageToolbarHidden } from "./inspect/page-toolbar"
import { compareWithMock, type PixelCanvas } from "./inspect/design-diff"
import { mainDevRecording, mainDevSnapshot } from "./inspect/dev-report"
import { PICK_TIMEOUT_MS } from "./inspect/element-context"
import { mainFrameworkSource } from "./inspect/framework-source"
import type { PickResult } from "./inspect/element-picker"
import { mainPagePerformance } from "./inspect/page-performance"
import { mainRequestMocks } from "./inspect/request-mocks"
import { mainTechStack } from "./inspect/tech-stack"
import { renderAnnotated } from "./panel/annotations"

const PICKER_FILE = "/element-picker.js"
const DEV_HOOKS_FILE = "/dev-hooks.js"
/** Puts a tab's kept simulated requests back as it loads (`app/request-mocks.ts`). */
const MOCKS_FILE = "/request-mocks.js"
const MOCKS_SCRIPT_ID = "cognia-request-mocks"

/** The one host permission this extension ever asks for. */
const LOOPBACK_ORIGIN = "http://127.0.0.1/*"

function tabRef(tab: chrome.tabs.Tab | null | undefined): TabRef | null {
  if (!tab?.id || !tab.url) return null
  return {
    id: tab.id,
    url: tab.url,
    title: tab.title ?? "",
    windowId: tab.windowId,
  }
}

function permissions(request: PermissionRequest): chrome.permissions.Permissions {
  return {
    ...(request.permissions
      ? {
          permissions: request.permissions as chrome.permissions.Permissions["permissions"],
        }
      : {}),
    ...(request.origins ? { origins: request.origins } : {}),
  }
}

export function createChromeBrowserApi(): BrowserApi {
  const session = chromeStorageArea("session")
  // One writer owns agent state; a panel must not overwrite a newer pause
  // with its own read-modify-write of a stale session map.
  const mutatePermission = async (message: AgentPermissionMessage): Promise<void> => {
    if ((await chrome.runtime.sendMessage(message)) !== true)
      throw new Error("browser_permission_request_failed")
  }
  const image = browserImageOps()

  /** The picker, injected once per document; the file guards its own reinstall. */
  const injectPicker = (tabId: number) =>
    chrome.scripting.executeScript({ target: { tabId }, files: [PICKER_FILE] })

  /**
   * Add what the page's framework says to a stamped description, read in the
   * MAIN world. A page whose main world cannot be read still has its pick.
   */
  async function withFramework(tabId: number, picked: NonNullable<PickResult>) {
    const { probeToken, ...description } = picked
    try {
      const [framework] = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: mainFrameworkSource,
        args: [probeToken],
      })
      return framework?.result ? { ...description, framework: framework.result } : description
    } catch {
      return description
    } finally {
      // The read removes its own stamp; this is for a read that never ran.
      await chrome.scripting
        .executeScript({
          target: { tabId },
          func: (token: string) =>
            document
              .querySelector(`[data-cognia-probe="${token.replace(/["\\]/g, "")}"]`)
              ?.removeAttribute("data-cognia-probe"),
          args: [probeToken],
        })
        .catch(() => undefined)
    }
  }

  return {
    async activeTab(): Promise<TabRef | null> {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      })
      return tabRef(tab)
    },

    async tabById(id): Promise<TabRef | null> {
      // `chrome.tabs.get` rejects rather than resolving null for a tab that
      // has closed, and a closed tab is an ordinary outcome here: the request
      // may have been recorded up to a minute ago.
      return tabRef(await chrome.tabs.get(id).catch(() => null))
    },

    async capturePage(tabId, options) {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["/page-capture.js"],
      })
      const [injected] = await chrome.scripting.executeScript({
        target: { tabId },
        func: (opts) => globalThis.__cogniaPageCapture?.capture(opts),
        args: [options],
      })
      if (!injected?.result) throw new Error("the page could not be read")
      return injected.result
    },

    async captureTranscript(tabId, preferredLanguage) {
      const tab = await chrome.tabs.get(tabId)
      if (!isYouTubeWatchUrl(tab.url ?? "")) return { status: "unavailable", reason: "not_a_video" }
      const [injected] = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: readYouTubeTranscript,
        args: [preferredLanguage],
      })
      return injected?.result ?? { status: "unavailable", reason: "fetch_failed" }
    },

    async read<T>(key: string): Promise<T | null> {
      const stored = await chrome.storage.local.get(key)
      return (stored[key] as T | undefined) ?? null
    },

    async write(key, value) {
      await chrome.storage.local.set({ [key]: value })
    },

    async remove(keys) {
      await chrome.storage.local.remove(keys)
    },

    onStorageChange(key, listener) {
      // `chrome.storage.onChanged` fires for every area; only `local` is ours.
      // `newValue` is absent on a removal, which the contract reports as null
      // rather than `undefined` so a listener has one "gone" to check for.
      const handler = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
        if (areaName !== "local" || !Object.hasOwn(changes, key)) return
        listener(changes[key]?.newValue ?? null)
      }
      chrome.storage.onChanged.addListener(handler)
      return () => chrome.storage.onChanged.removeListener(handler)
    },

    async hasLoopbackPermission() {
      return chrome.permissions.contains({ origins: [LOOPBACK_ORIGIN] })
    },

    async requestLoopbackPermission() {
      // Must be called inside a user gesture; Chrome rejects it otherwise.
      // The panel only ever calls this from the pairing button's handler.
      return chrome.permissions.request({ origins: [LOOPBACK_ORIGIN] })
    },

    extensionOrigin() {
      // Trailing slash trimmed off `getURL("/")`, NOT `new URL(...).origin`.
      // `chrome-extension:` is not a special scheme in the URL Standard, so a
      // URL built from it has an *opaque* origin and `.origin` serializes to
      // the string `"null"`. Chrome's own page context happens to report a
      // tuple origin, but the URL API is the spec's and would have handed the
      // Host the literal text "null" to store and compare against.
      return chrome.runtime.getURL("/").replace(/\/+$/, "")
    },

    async openUrl(url) {
      await chrome.tabs.create({ url })
    },

    message(key, substitutions) {
      return chrome.i18n.getMessage(key, substitutions)
    },

    readSession: (key) => session.get(key),
    writeSession: (key, value) => session.set(key, value),
    async removeSession(keys) {
      await chrome.storage.session.remove(keys)
    },
    onSessionChange: (key, listener) => session.onChange(key, listener),

    hasPermissions: (request) => chrome.permissions.contains(permissions(request)),
    requestPermissions: (request) => chrome.permissions.request(permissions(request)),
    removePermissions: (request) => chrome.permissions.remove(permissions(request)),

    async listTabs() {
      const tabs = await chrome.tabs.query({ currentWindow: true })
      return tabs.map(tabRef).filter((tab): tab is TabRef => tab !== null)
    },

    captureVisible: (windowId) => chrome.tabs.captureVisibleTab(windowId, { format: "png" }),

    async activateTab(tabId) {
      await chrome.tabs.update(tabId, { active: true })
    },

    async scrollMetrics(tabId) {
      const [injected] = await chrome.scripting.executeScript({
        target: { tabId },
        func: pageScrollMetrics,
      })
      if (!injected?.result) throw new Error("the page could not be measured")
      return injected.result
    },

    async scrollTo(tabId, y) {
      const [injected] = await chrome.scripting.executeScript({
        target: { tabId },
        func: pageScrollTo,
        args: [y],
      })
      return typeof injected?.result === "number" ? injected.result : y
    },

    cropImage: (dataUrl, rect) => image.crop(dataUrl, rect),
    annotateImage: (dataUrl, shapes) => renderAnnotated(browserImageDeps(), dataUrl, shapes),

    diffDesign: (capture, mock, overlay, view) =>
      compareWithMock(
        {
          decode: (dataUrl) => createImageBitmap(dataUrlToBlob(dataUrl)),
          canvas: (width, height) => new OffscreenCanvas(width, height) as unknown as PixelCanvas,
          toDataUrl: async (blob) => `data:image/png;base64,${await blobToBase64(blob)}`,
        },
        { capture, mock, overlay, view }
      ),

    async setPageToolbar(tabId, state) {
      const [injected] = await chrome.scripting.executeScript({
        target: { tabId },
        func: pageToolbar,
        args: [state],
      })
      return injected?.result === true
    },

    async hidePageChrome(tabId, hidden) {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: pageToolbarHidden,
        args: [hidden],
      })
    },

    onToolbarAction(listener) {
      // Only this extension's own injected toolbar reaches here: no
      // `externally_connectable`, and pages cannot message an extension.
      const onMessage = (message: unknown, sender: chrome.runtime.MessageSender) => {
        if (sender.id !== chrome.runtime.id || sender.tab?.id === undefined) return false
        if (isToolbarMessage(message)) listener(message.action, sender.tab.id)
        return false
      }
      chrome.runtime.onMessage.addListener(onMessage)
      return () => chrome.runtime.onMessage.removeListener(onMessage)
    },

    readTabZoom: (tabId) =>
      chrome.tabs.getZoom(tabId).then(
        (zoom) => (Number.isFinite(zoom) && zoom > 0 ? zoom : 1),
        () => 1
      ),

    onTabZoom(listener) {
      const onZoom = (change: chrome.tabs.OnZoomChangeInfo) =>
        listener(change.tabId, change.newZoomFactor)
      chrome.tabs.onZoomChange.addListener(onZoom)
      return () => chrome.tabs.onZoomChange.removeListener(onZoom)
    },

    async readPageView(tabId) {
      const [injected] = await chrome.scripting.executeScript({
        target: { tabId },
        func: pageViewAfterPaint,
      })
      if (!injected?.result) throw new Error("the page could not be measured")
      return injected.result
    },
    stitchImages: (dataUrls, width, heights) => image.stitch(dataUrls, width, heights),

    async fetchBytes(url, maxBytes) {
      // `omit`: the bytes are the page's resource, not a request made as the
      // person; their cookies have no business riding along.
      const response = await fetch(url, {
        credentials: "omit",
        redirect: "follow",
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const declared = Number(response.headers.get("content-length") ?? "0")
      if (declared > maxBytes) throw new Error("too_large")
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes.byteLength > maxBytes) throw new Error("too_large")
      const mediaType =
        (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? ""
      return { bytes, mediaType }
    },

    connectPanel() {
      const port = chrome.runtime.connect({ name: PANEL_PORT })
      return {
        post: (message) => port.postMessage(message),
        disconnect: () => port.disconnect(),
      }
    },

    answerSiteQuestion: (questionId, answer) =>
      mutatePermission({
        kind: "cognia-agent-permission",
        action: "answer",
        questionId,
        answer,
      }),
    forgetSiteDecision: (origin) =>
      mutatePermission({
        kind: "cognia-agent-permission",
        action: "forget",
        origin,
      }),

    async pickElement(tabId, hint) {
      await injectPicker(tabId)
      const [injected] = await chrome.scripting.executeScript({
        target: { tabId },
        func: (text: string, timeoutMs: number) =>
          globalThis.__cogniaPicker?.pick({ hint: text, timeoutMs }) ?? null,
        args: [hint, PICK_TIMEOUT_MS],
      })
      const picked = injected?.result
      return picked ? withFramework(tabId, picked) : null
    },

    async pickElements(tabId, labels, max) {
      await injectPicker(tabId)
      const [injected] = await chrome.scripting.executeScript({
        target: { tabId },
        func: (
          text: { hint: string; selected: string; done: string },
          timeoutMs: number,
          room: number
        ) =>
          globalThis.__cogniaPicker?.pickMany({
            hint: text.hint,
            selectedHint: text.selected,
            doneLabel: text.done,
            timeoutMs,
            max: room,
          }) ?? null,
        args: [labels, PICK_TIMEOUT_MS, max],
      })
      const picked = injected?.result
      if (!picked) return null
      // One main-world read at a time: each takes its own element's stamp.
      const described = []
      for (const one of picked) described.push(await withFramework(tabId, one))
      return described
    },

    async measureElements(tabId, { hint, anchorHint }, anchorId) {
      await injectPicker(tabId)
      const [injected] = await chrome.scripting.executeScript({
        target: { tabId },
        func: (first: string, second: string, timeoutMs: number, anchor: string | null) =>
          globalThis.__cogniaPicker?.measure({
            hint: first,
            anchorHint: second,
            timeoutMs,
            ...(anchor ? { anchorId: anchor } : {}),
          }) ?? null,
        args: [hint, anchorHint, PICK_TIMEOUT_MS, anchorId ?? null],
      })
      return injected?.result ?? null
    },

    async showMeasurement(tabId, fromId, toId) {
      const [injected] = await chrome.scripting.executeScript({
        target: { tabId },
        func: (from: string, to: string) =>
          globalThis.__cogniaPicker?.showMeasurement(from, to) ?? null,
        args: [fromId, toId],
      })
      return injected?.result ?? null
    },

    async describeElement(tabId, elementId) {
      const [injected] = await chrome.scripting.executeScript({
        target: { tabId },
        func: (id: string) => globalThis.__cogniaPicker?.describe(id) ?? null,
        args: [elementId],
      })
      const picked = injected?.result
      return picked ? withFramework(tabId, picked) : null
    },

    async auditAccessibility(tabId) {
      await injectPicker(tabId)
      const [injected] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => globalThis.__cogniaPicker?.audit() ?? null,
      })
      if (!injected?.result) throw new Error("the page could not be checked")
      return injected.result
    },

    async readDesignTokens(tabId) {
      await injectPicker(tabId)
      const [injected] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => globalThis.__cogniaPicker?.tokens() ?? null,
      })
      if (!injected?.result) throw new Error("the page could not be read")
      return injected.result
    },

    async detectStack(tabId) {
      const [injected] = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: mainTechStack,
      })
      if (!injected?.result) throw new Error("the page could not be read")
      return injected.result
    },

    async editPageText(tabId, hint) {
      await injectPicker(tabId)
      const [injected] = await chrome.scripting.executeScript({
        target: { tabId },
        func: (text: string) => globalThis.__cogniaPicker?.editText(text) ?? false,
        args: [hint],
      })
      return injected?.result === true
    },

    async stopEditingPageText(tabId, keep) {
      const [injected] = await chrome.scripting.executeScript({
        target: { tabId },
        func: (kept: boolean) => globalThis.__cogniaPicker?.stopEditingText(kept) ?? [],
        args: [keep],
      })
      return injected?.result ?? []
    },

    async checkLayout(tabId) {
      await injectPicker(tabId)
      const [injected] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => globalThis.__cogniaPicker?.layout() ?? null,
      })
      if (!injected?.result) throw new Error("the page could not be checked")
      return injected.result
    },

    async checkFocus(tabId) {
      await injectPicker(tabId)
      const [injected] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => globalThis.__cogniaPicker?.focusOrder() ?? null,
      })
      if (!injected?.result) throw new Error("the page could not be checked")
      return injected.result
    },

    async showFocusOrder(tabId, show) {
      const [injected] = await chrome.scripting.executeScript({
        target: { tabId },
        func: (on: boolean) => globalThis.__cogniaPicker?.showFocusOrder(on) ?? false,
        args: [show],
      })
      return injected?.result === true
    },

    async readSeo(tabId) {
      await injectPicker(tabId)
      const [injected] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => globalThis.__cogniaPicker?.seo() ?? null,
      })
      if (!injected?.result) throw new Error("the page could not be read")
      return injected.result
    },

    async readPerformance(tabId) {
      const [injected] = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: mainPagePerformance,
      })
      if (!injected?.result) throw new Error("the page could not be read")
      return injected.result
    },

    async adjustElement(tabId, elementId, hint, labels) {
      await injectPicker(tabId)
      const [injected] = await chrome.scripting.executeScript({
        target: { tabId },
        func: (id: string, text: string, names: typeof labels, timeoutMs: number) =>
          globalThis.__cogniaPicker?.adjust({
            elementId: id,
            hint: text,
            labels: names,
            timeoutMs,
          }) ?? null,
        args: [elementId, hint, labels, PICK_TIMEOUT_MS],
      })
      return injected?.result ?? null
    },

    async finishAdjust(tabId) {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: () => globalThis.__cogniaPicker?.finishAdjust() ?? false,
      })
    },

    async setRequestMocks(tabId, mocks, keep = false) {
      const [injected] = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: mainRequestMocks,
        args: [mocks, keep],
      })
      if (!injected?.result) throw new Error("the page's requests could not be reached")
      return injected.result
    },

    async keepRequestMocks(url, keep) {
      let pattern: string
      try {
        const parsed = new URL(url)
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false
        pattern = `${parsed.protocol}//${parsed.hostname}/*`
      } catch {
        return false
      }
      // First, while the click that asked still counts as the person's.
      if (keep && !(await chrome.permissions.request({ origins: [pattern] }))) return false
      const [registered] = await chrome.scripting.getRegisteredContentScripts({
        ids: [MOCKS_SCRIPT_ID],
      })
      const before = registered?.matches ?? []
      const matches = keep
        ? [...new Set([...before, pattern])]
        : before.filter((entry) => entry !== pattern)
      if (registered && matches.length === 0)
        await chrome.scripting.unregisterContentScripts({ ids: [MOCKS_SCRIPT_ID] })
      else if (registered)
        await chrome.scripting.updateContentScripts([
          { id: MOCKS_SCRIPT_ID, matches, js: [MOCKS_FILE.slice(1)] },
        ])
      else if (matches.length > 0)
        await chrome.scripting.registerContentScripts([
          {
            id: MOCKS_SCRIPT_ID,
            matches,
            js: [MOCKS_FILE.slice(1)],
            runAt: "document_start",
            world: "MAIN",
            allFrames: false,
            persistAcrossSessions: false,
          },
        ])
      return true
    },

    async cancelPick(tabId) {
      const [injected] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => globalThis.__cogniaPicker?.cancel() ?? false,
      })
      return injected?.result === true
    },

    async previewElementEdits(tabId, elementId, edits) {
      const [injected] = await chrome.scripting.executeScript({
        target: { tabId },
        func: (id: string, next: typeof edits) =>
          globalThis.__cogniaPicker?.apply(id, next) ?? false,
        args: [elementId, edits],
      })
      return injected?.result === true
    },

    async revertElement(tabId, elementId) {
      const [injected] = await chrome.scripting.executeScript({
        target: { tabId },
        func: (id: string) => globalThis.__cogniaPicker?.revert(id) ?? false,
        args: [elementId],
      })
      return injected?.result === true
    },

    async locateElement(tabId, elementId, flash) {
      const [injected] = await chrome.scripting.executeScript({
        target: { tabId },
        func: (id: string, show: boolean) => globalThis.__cogniaPicker?.locate(id, show) ?? null,
        args: [elementId, flash],
      })
      return injected?.result ?? null
    },

    async releaseElements(tabId, elementIds) {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: (ids: string[] | null) => {
          globalThis.__cogniaPicker?.release(ids ?? undefined)
          return true
        },
        args: [elementIds ?? null],
      })
    },

    async startDevRecording(tabId) {
      await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        files: [DEV_HOOKS_FILE],
      })
    },

    async isDevRecording(tabId) {
      const [injected] = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: mainDevRecording,
      })
      return injected?.result === true
    },

    async readDevSnapshot(tabId) {
      const [injected] = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: mainDevSnapshot,
      })
      if (!injected?.result) throw new Error("the page could not be read")
      return injected.result
    },

    async setDesignOverlay(tabId, state) {
      const [injected] = await chrome.scripting.executeScript({
        target: { tabId },
        func: pageDesignOverlay,
        args: [state],
      })
      if (injected?.result !== true) throw new Error("the overlay could not be shown")
    },

    async openViewport(url, size) {
      // The size asked for is the page's, not the window's: open at it, read
      // what the tab actually got, and grow the window by the difference — the
      // frame around a viewport differs by platform, zoom and window type.
      const created = await chrome.windows.create({
        url,
        type: "popup",
        width: size.width,
        height: size.height,
        focused: true,
      })
      const tab = created?.tabs?.[0]
      if (created?.id === undefined || tab?.id === undefined) return
      const measured = await chrome.tabs.get(tab.id).catch(() => null)
      const width = measured?.width
      const height = measured?.height
      if (!width || !height) return
      await chrome.windows
        .update(created.id, {
          width: size.width + (size.width - width),
          height: size.height + (size.height - height),
        })
        .catch(() => undefined)
    },
  }
}
