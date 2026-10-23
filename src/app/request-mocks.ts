// Registered for a site, in the MAIN world at `document_start`, once the
// person keeps a tab's simulated requests across reloads: puts the tab's kept
// rules back before the page's own scripts run (`request-mocks.ts`). A tab
// with nothing kept is left as it is.
import { defineUnlistedScript } from "wxt/utils/define-unlisted-script"

import { restoreKeptMocks } from "@ext/src/lib/inspect/request-mocks"

export default defineUnlistedScript(() => {
  restoreKeptMocks()
})
