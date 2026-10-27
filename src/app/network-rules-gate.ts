// Registered for the sites whose request rules the page must run, in the MAIN
// world at `document_start`: holds the page's requests until the loader hands
// over this tab's rules (`network-rules/page.ts`).
import { defineUnlistedScript } from "wxt/utils/define-unlisted-script"

import { mainRuleGate } from "@ext/src/lib/network-rules/page"

export default defineUnlistedScript(() => {
  mainRuleGate()
})
