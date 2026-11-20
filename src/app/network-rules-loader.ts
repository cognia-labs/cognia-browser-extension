// The gate's partner in the isolated world: asks the worker for this tab's
// request rules and hands them to the page (`network-rules/page.ts`).
import { defineUnlistedScript } from "wxt/utils/define-unlisted-script"

import { isolatedRuleLoader } from "@ext/src/lib/network-rules/page"

export default defineUnlistedScript(() => {
  isolatedRuleLoader(() => chrome.runtime.sendMessage({ kind: "cognia-network-rules-for-page" }))
})
