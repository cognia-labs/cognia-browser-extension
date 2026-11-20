// The recorder for a tab that is recording for a test, in the isolated world
// (`recordings/recorder.ts`). Registered at `document_start` for the sites
// being recorded, it starts held — listening at once, sending nothing — and
// asks the worker whether this tab is one of them: confirmed, it sends what
// it held; otherwise it goes without a trace. Put in by the worker after a
// load, it is started (or confirmed) by the worker instead.
import { defineUnlistedScript } from "wxt/utils/define-unlisted-script"

import { installTestRecorder } from "@ext/src/lib/recordings/recorder"

export default defineUnlistedScript(() => {
  const install = (synthetic: boolean, held: boolean) =>
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
      held,
      ...(synthetic ? { trusted: () => true } : {}),
    })
  // The worker knows the tab records: a held recorder it finds is confirmed.
  globalThis.__cogniaStartTestRecorder = (synthetic) => {
    install(synthetic, false).confirm(synthetic)
    return true
  }
  const recorder = install(false, true)
  void chrome.runtime.sendMessage({ kind: "cognia-recording-ask" }).then(
    (answer: { synthetic?: unknown } | null) => {
      if (answer && typeof answer === "object") recorder.confirm(answer.synthetic === true)
      else recorder.discard()
    },
    () => recorder.discard()
  )
})
