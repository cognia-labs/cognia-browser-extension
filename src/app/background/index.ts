// The real module rather than WXT's `#imports` virtual one. `#imports` only
// resolves through the generated `.wxt/` declarations, which this workspace
// excludes from its compile roots; importing the source of the one helper
// actually used keeps `tsc` honest without widening what it compiles.
import { defineBackground } from "wxt/utils/define-background"

import { isAgentControlMessage, isAgentOpenTabMessage } from "@ext/src/lib/agent/agent-runtime"
import {
  chromeStorageArea,
  createChromeAgentBrowser,
} from "@ext/src/lib/agent/chrome-agent-browser"
import type { SocketLike } from "@ext/src/lib/agent/socket-client"
import {
  PENDING_SITE_QUESTIONS_KEY,
  isAgentPermissionMessage,
} from "@ext/src/lib/agent/site-permissions"
import { AGENT_SESSIONS_KEY } from "@ext/src/lib/agent/sessions"
import { BADGE_COLORS } from "@ext/src/lib/background/status-tracker"
import { createChromeNetworkRulesBrowser } from "@ext/src/lib/network-rules/chrome-network-rules"
import { isPageRulesMessage } from "@ext/src/lib/network-rules/page"
import { isRuleCommandMessage } from "@ext/src/lib/network-rules/store"
import { createChromeRecordingBrowser } from "@ext/src/lib/recordings/chrome-recordings"
import {
  isRecordingAskMessage,
  isRecordingCommandMessage,
  isRecordingStepMessage,
  isRecordingStopMessage,
} from "@ext/src/lib/recordings/controller"
import { PANEL_PORT, createWorker } from "@ext/src/lib/background/worker"
import {
  CAPTURE_MENU_IDS,
  CAPTURE_REQUEST_KEY,
  QUICK_ACTIONS,
  QUICK_ACTION_LABEL_KEYS,
  captureRequestForCommand,
  captureRequestForMenu,
  captureRequestForOmnibox,
  quickActionMenuId,
  shouldOfferCaptureMenu,
  type CaptureRequest,
} from "@ext/src/lib/capture/capture-request"
import { createHostClient, restoreSigner } from "@ext/src/lib/client"
import { isBlockedUrl, parsePreferences } from "@ext/src/lib/preferences"
import { STORAGE_KEYS } from "@ext/src/lib/browser-api"

/**
 * The service worker (ADR-0228 §4–7).
 *
 * Every listener is registered synchronously at the top of this function —
 * MV3 only delivers the event that woke a worker to listeners that exist by
 * the end of its first turn — and each awaits `ready`, the rebuild of what
 * the worker keeps from `chrome.storage`. The logic lives in
 * `lib/background/worker.ts`; this file only adapts `chrome.*` to it.
 *
 * What crosses to the panel for a capture is still a small record (a tab id,
 * a mode, a right-clicked link or image, a quick action), never page content:
 * the panel extracts, because `activeTab` belongs to the gesture and the
 * person reviews the result before anything is sent.
 */
export default defineBackground(() => {
  const local = chromeStorageArea("local")
  const session = chromeStorageArea("session")
  const worker = createWorker({
    local,
    session,
    loadClient: async (pairing) => {
      const signer = await restoreSigner(pairing)
      return signer ? createHostClient({ pairing, signer }) : null
    },
    browser: createChromeAgentBrowser(),
    networkRulesBrowser: createChromeNetworkRulesBrowser(),
    recordingBrowser: createChromeRecordingBrowser(),
    createSocket: (url) => new WebSocket(url) as unknown as SocketLike,
    setBadge: async (badge) => {
      await chrome.action.setBadgeText({ text: badge.text })
      if (badge.text)
        await chrome.action.setBadgeBackgroundColor({
          color: BADGE_COLORS[badge.tone],
        })
    },
    canNotify: () => chrome.permissions.contains({ permissions: ["notifications"] }),
    notify: async (id, title, message) => {
      await chrome.notifications.create(id, {
        type: "basic",
        iconUrl: chrome.runtime.getURL("/icon-128.png"),
        title,
        message,
        priority: 1,
      })
    },
    ensureAlarm: async (name, periodInMinutes) => {
      if (!(await chrome.alarms.get(name))) await chrome.alarms.create(name, { periodInMinutes })
    },
    clearAlarm: async (name) => {
      await chrome.alarms.clear(name)
    },
    extensionVersion: chrome.runtime.getManifest().version,
    panelUrl: chrome.runtime.getURL("/sidepanel.html"),
    message: (key, substitutions) => chrome.i18n.getMessage(key, substitutions) || key,
    now: () => Date.now(),
    random: () => Math.random(),
    newId: () => crypto.randomUUID(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    setInterval: (callback, ms) => setInterval(callback, ms),
    clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
  })
  const ready = worker.start().catch(() => undefined)

  // Opening on the action click is what makes `chrome.sidePanel.open()`'s
  // user-gesture requirement somebody else's problem: Chrome treats the click
  // itself as the gesture.
  void chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined)

  /**
   * Record a capture for the panel and open it. `open` must run in the
   * gesture's own turn — an `await` before it would lose the gesture — so the
   * write and the open start together.
   */
  function requestCapture(request: CaptureRequest, windowId: number | undefined, url: string) {
    void (async () => {
      const preferences = parsePreferences(await local.get(STORAGE_KEYS.preferences))
      // A blocked site opens the panel, which says why, but records nothing.
      if (isBlockedUrl(url, preferences.blockedHosts)) return
      await chrome.storage.local.set({ [CAPTURE_REQUEST_KEY]: request })
    })()
    if (windowId !== undefined) void chrome.sidePanel?.open({ windowId }).catch(() => undefined)
  }

  chrome.runtime.onInstalled.addListener(() => {
    // Recreated on every install/update rather than guarded: `contextMenus`
    // entries do not survive an update, and a duplicate-id create throws.
    void chrome.contextMenus?.removeAll().then(() => {
      const web = ["http://*/*", "https://*/*"]
      type Contexts = NonNullable<chrome.contextMenus.CreateProperties["contexts"]>
      const menu = (id: string, key: string, contexts: string[], parentId?: string) =>
        chrome.contextMenus.create({
          id,
          title: chrome.i18n.getMessage(key),
          contexts: contexts as unknown as Contexts,
          documentUrlPatterns: web,
          ...(parentId ? { parentId } : {}),
        })
      menu(CAPTURE_MENU_IDS.selection, "contextMenuSelection", ["selection"])
      menu(CAPTURE_MENU_IDS.page, "contextMenuPage", ["page"])
      menu(CAPTURE_MENU_IDS.article, "contextMenuArticle", ["page"])
      menu(CAPTURE_MENU_IDS.link, "contextMenuLink", ["link"])
      menu(CAPTURE_MENU_IDS.image, "contextMenuImage", ["image"])
      menu(CAPTURE_MENU_IDS.inspect, "contextMenuInspect", ["page", "link", "image", "selection"])
      menu(CAPTURE_MENU_IDS.quick, "contextMenuQuick", ["page", "selection"])
      for (const action of QUICK_ACTIONS) {
        menu(
          quickActionMenuId(action),
          QUICK_ACTION_LABEL_KEYS[action],
          ["page", "selection"],
          CAPTURE_MENU_IDS.quick
        )
      }
    })
  })

  chrome.contextMenus?.onClicked.addListener((info, tab) => {
    if (!tab?.id || !shouldOfferCaptureMenu(tab.url ?? "")) return
    const request = captureRequestForMenu(
      {
        menuItemId: info.menuItemId,
        ...(info.linkUrl ? { linkUrl: info.linkUrl } : {}),
        ...(info.srcUrl ? { srcUrl: info.srcUrl } : {}),
        ...(info.selectionText ? { selectionText: info.selectionText } : {}),
      },
      tab.id,
      Date.now()
    )
    if (request) requestCapture(request, tab.windowId, tab.url ?? "")
  })

  chrome.commands?.onCommand.addListener((command, tab) => {
    // The tab arrives with the command on current Chrome; the query covers
    // the versions where it does not.
    const run = (target: chrome.tabs.Tab | undefined) => {
      if (!target?.id || !shouldOfferCaptureMenu(target.url ?? "")) return
      const request = captureRequestForCommand(command, target.id, Date.now())
      if (request) requestCapture(request, target.windowId, target.url ?? "")
    }
    if (tab) run(tab)
    else void chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => run(tabs[0]))
  })

  chrome.omnibox?.setDefaultSuggestion({
    description: chrome.i18n.getMessage("omniboxSuggestion"),
  })
  chrome.omnibox?.onInputEntered.addListener((text) => {
    void chrome.tabs.query({ active: true, lastFocusedWindow: true }).then((tabs) => {
      const tab = tabs[0]
      if (!tab?.id || !shouldOfferCaptureMenu(tab.url ?? "")) return
      const request = captureRequestForOmnibox(text, tab.id, Date.now())
      if (request) requestCapture(request, tab.windowId, tab.url ?? "")
    })
  })

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== PANEL_PORT) return
    // Only this extension's own pages can connect: `externally_connectable`
    // is not declared, and content scripts are never given this port name.
    if (port.sender?.id !== chrome.runtime.id || port.sender.tab) return
    void ready.then(() => worker.panelOpened())
    port.onDisconnect.addListener(() => {
      void ready.then(() => worker.panelClosed())
    })
    port.onMessage.addListener((message: unknown) => {
      if (
        message &&
        typeof message === "object" &&
        (message as { kind?: unknown }).kind === "refresh-status"
      ) {
        void ready.then(() => worker.refreshNow())
      }
    })
  })

  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return false
    if (isAgentPermissionMessage(message)) {
      void ready
        .then(() => worker.onPermissionMessage(message, sender.url))
        .then(sendResponse, () => sendResponse(false))
      return true
    }
    if (isAgentControlMessage(message)) {
      void ready
        .then(() => worker.runtime.control(message, sender.tab?.id))
        .then(sendResponse, () => sendResponse(false))
      return true
    }
    if (isRuleCommandMessage(message)) {
      void ready
        .then(() => worker.onNetworkRuleCommand(message.command, sender.url))
        .then(sendResponse, () => sendResponse(false))
      return true
    }
    if (isRecordingCommandMessage(message)) {
      void ready
        .then(() => worker.onRecordingCommand(message.command, sender.url))
        .then(sendResponse, () => sendResponse(false))
      return true
    }
    // The registered recorder at `document_start`: is this tab recording?
    if (isRecordingAskMessage(message)) {
      if (sender.tab?.id === undefined || sender.frameId !== 0) return false
      void ready
        .then(() => worker.recordings.askFor(sender.tab?.id))
        .then(sendResponse, () => sendResponse(null))
      return true
    }
    // The recorder, from inside the tab it records; the worker checks the tab is recording.
    if (isRecordingStepMessage(message) || isRecordingStopMessage(message)) {
      if (sender.tab?.id === undefined || sender.frameId !== 0) return false
      const tabId = sender.tab.id
      void ready
        .then(async () => {
          if (isRecordingStepMessage(message)) await worker.recordings.step(tabId, message.step)
          else await worker.recordings.stopTab(tabId)
        })
        .then(
          () => sendResponse(true),
          () => sendResponse(false)
        )
      return true
    }
    // Only this extension's loader, inside a tab, asks; the page itself cannot.
    if (isPageRulesMessage(message)) {
      if (sender.tab?.id === undefined || sender.frameId !== 0) return false
      void ready
        .then(() => worker.pageRules(sender.tab?.id, sender.url))
        .then(sendResponse, () => sendResponse([]))
      return true
    }
    if (isAgentOpenTabMessage(message)) {
      void ready
        .then(() => worker.runtime.openTab(message, sender.tab?.id))
        .then(sendResponse, () => sendResponse(false))
      return true
    }
    return false
  })

  // A grant the rules were waiting for, or one taken back in chrome://extensions.
  const resyncRules = () => void ready.then(() => worker.networkRules.sync()).catch(() => undefined)
  chrome.permissions.onAdded.addListener(resyncRules)
  chrome.permissions.onRemoved.addListener(resyncRules)

  chrome.alarms.onAlarm.addListener((alarm) => {
    void ready.then(() => worker.onAlarm(alarm.name))
  })

  chrome.tabs.onRemoved.addListener((tabId) => {
    void ready.then(() => worker.runtime.tabRemoved(tabId))
    void ready.then(() => worker.recordings.stopTab(tabId)).catch(() => undefined)
  })

  // A recording tab loaded a page: the recorder goes back in. A
  // conversation's tab with request rules that reached a new site: the gate
  // follows it, and the rules go into the page.
  chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
    const complete = change.status === "complete"
    if (complete) void ready.then(() => worker.recordings.tabLoaded(tabId)).catch(() => undefined)
    if (complete || change.url)
      void ready
        .then(() => worker.networkRules.tabUpdated(tabId, change.url ?? tab.url, complete))
        .catch(() => undefined)
  })

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local") {
      for (const key of [STORAGE_KEYS.pairing, STORAGE_KEYS.preferences, STORAGE_KEYS.localMode]) {
        if (Object.hasOwn(changes, key)) {
          void ready.then(() => worker.onLocalChange(key, changes[key]?.newValue ?? null))
        }
      }
    } else if (areaName === "session") {
      if (Object.hasOwn(changes, PENDING_SITE_QUESTIONS_KEY))
        void ready.then(() => worker.onQuestionsChange())
      if (Object.hasOwn(changes, AGENT_SESSIONS_KEY))
        void ready.then(() =>
          worker.onSessionsChange((changes[AGENT_SESSIONS_KEY]?.newValue ?? null) as never)
        )
    }
  })

  chrome.notifications?.onClicked.addListener((id) => {
    if (!worker.notificationTarget(id)) return
    void chrome.notifications.clear(id)
    // The panel is where both kinds are answered: the task's row, or the
    // site question. A notification click is not a gesture that may open a
    // side panel on every Chrome; a refusal leaves the badge to say so.
    void chrome.windows.getLastFocused().then((window) => {
      if (window.id !== undefined)
        void chrome.sidePanel?.open({ windowId: window.id }).catch(() => undefined)
    })
  })
})
