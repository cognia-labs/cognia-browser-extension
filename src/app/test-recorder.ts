// Injected by the worker into a tab that is recording for a test, in the
// isolated world, on every load until the recording stops
// (`recordings/recorder.ts`). The worker then calls the starter it leaves.
import { defineUnlistedScript } from "wxt/utils/define-unlisted-script"

import { installTestRecorder } from "@ext/src/lib/recordings/recorder"

export default defineUnlistedScript(() => {
  globalThis.__cogniaStartTestRecorder = (synthetic) => {
    installTestRecorder({
      win: window,
      send: (step) => void chrome.runtime.sendMessage({ kind: "cognia-recording-step", step }),
      stop: () => void chrome.runtime.sendMessage({ kind: "cognia-recording-stop" }),
      labels: {
        recording: chrome.i18n.getMessage("recorderBadgeRecording"),
        check: chrome.i18n.getMessage("recorderBadgeCheck"),
        checking: chrome.i18n.getMessage("recorderBadgeChecking"),
        cancel: chrome.i18n.getMessage("recorderBadgeCancel"),
        stop: chrome.i18n.getMessage("recorderBadgeStop"),
      },
      ...(synthetic ? { trusted: () => true } : {}),
    })
    return true
  }
})
