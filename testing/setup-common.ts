import { webcrypto } from "node:crypto"
import { TextDecoder, TextEncoder } from "node:util"

if (typeof globalThis.TextEncoder === "undefined")
  Object.assign(globalThis, { TextEncoder, TextDecoder })
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    writable: true,
    value: {
      subtle: webcrypto.subtle,
      getRandomValues: webcrypto.getRandomValues.bind(webcrypto),
      randomUUID: webcrypto.randomUUID.bind(webcrypto),
    },
  })
}
