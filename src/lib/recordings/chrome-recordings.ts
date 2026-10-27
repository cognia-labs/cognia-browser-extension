/**
 * `chrome.*` behind {@link RecordingBrowser}; the decisions are in
 * `controller.ts`, under Jest.
 */
import type { RecordingBrowser } from "./controller"
import { stopTestRecorder } from "./recorder"

export const RECORDER_FILE = "/test-recorder.js"

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
    async removeRecorder(tabId) {
      await chrome.scripting.executeScript({ target: { tabId }, func: stopTestRecorder })
    },
  }
}
