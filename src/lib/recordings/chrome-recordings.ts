/**
 * `chrome.*` behind {@link RecordingBrowser}; the decisions are in
 * `controller.ts`, under Jest.
 */
import type { RecordingBrowser } from "./controller"
import { stopTestRecorder } from "./recorder"

export const RECORDER_FILE = "/test-recorder.js"
const RECORDER_SCRIPT_ID = "cognia-test-recorder"

export function createChromeRecordingBrowser(): RecordingBrowser {
  return {
    async tabInfo(tabId) {
      const tab = await chrome.tabs.get(tabId).catch(() => null)
      return tab?.url ? { url: tab.url, title: tab.title ?? "" } : null
    },
    async injectRecorder(tabId, { synthetic }) {
      await chrome.scripting.executeScript({ target: { tabId }, files: [RECORDER_FILE] })
      await chrome.scripting.executeScript({
        target: { tabId },
        func: (synthetic: boolean) => globalThis.__cogniaStartTestRecorder?.(synthetic) ?? false,
        args: [synthetic],
      })
    },
    hasOrigin: (pattern) => chrome.permissions.contains({ origins: [pattern] }),
    async setRecorderScripts(matches) {
      const registered = await chrome.scripting.getRegisteredContentScripts({
        ids: [RECORDER_SCRIPT_ID],
      })
      if (registered.length > 0)
        await chrome.scripting.unregisterContentScripts({ ids: [RECORDER_SCRIPT_ID] })
      if (matches.length === 0) return
      // Not kept across a restart: the recordings it serves are memory-only.
      await chrome.scripting.registerContentScripts([
        {
          id: RECORDER_SCRIPT_ID,
          matches,
          js: [RECORDER_FILE.slice(1)],
          runAt: "document_start",
          world: "ISOLATED",
          allFrames: false,
          persistAcrossSessions: false,
        },
      ])
    },
    async removeRecorder(tabId) {
      const [injected] = await chrome.scripting.executeScript({
        target: { tabId },
        func: stopTestRecorder,
      })
      // Plain data from the page's world; the controller cleans every step.
      return Array.isArray(injected?.result) ? (injected.result as unknown[]) : []
    },
  }
}
