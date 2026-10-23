// Injected into a tab's isolated world when the person picks an element in
// the panel. The real module rather than WXT's `#imports`, like the others.
import { defineUnlistedScript } from "wxt/utils/define-unlisted-script"

import { installElementPicker } from "@ext/src/lib/inspect/element-picker"

export default defineUnlistedScript(() => {
  installElementPicker(window)
})
