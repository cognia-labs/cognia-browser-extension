// Injected into a tab's MAIN world when the person records console and
// network for a bug report: the agent's page hooks, without the dialog
// handling a person's own clicks must not meet (`page-hooks.ts`), and the
// recorder of what the person does to reproduce the bug.
import { defineUnlistedScript } from "wxt/utils/define-unlisted-script"

import { installPageHooks } from "@ext/src/lib/agent/page-hooks"
import { installInteractionRecorder } from "@ext/src/lib/inspect/interaction-recorder"

export default defineUnlistedScript(() => {
  installPageHooks(window as unknown as Parameters<typeof installPageHooks>[0], undefined, {
    interceptDialogs: false,
  })
  installInteractionRecorder(window)
})
