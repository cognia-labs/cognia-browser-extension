// The recorder for a tab that is recording for a test, in the isolated world
// (`recordings/recorder.ts`). Registered at `document_start` for the sites
// being recorded, it asks the worker whether this tab is one of them; put in
// by the worker after a load, it is started by the worker instead.
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
  void chrome.runtime.sendMessage({ kind: "cognia-recording-ask" }).then(
    (answer: { synthetic?: unknown } | null) => {
      if (answer && typeof answer === "object")
        globalThis.__cogniaStartTestRecorder?.(answer.synthetic === true)
    },
    () => undefined
  )
})
