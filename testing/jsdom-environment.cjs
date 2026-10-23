const { TestEnvironment } = require("jest-environment-jsdom")

module.exports = class BrowserTestEnvironment extends TestEnvironment {
  constructor(config, context) {
    super(config, context)
    // Retain native web primitives instead of replacing transport behavior with mocks.
    for (const key of [
      "fetch",
      "Request",
      "Response",
      "Headers",
      "TextEncoder",
      "TextDecoder",
      "structuredClone",
      "ReadableStream",
      "WritableStream",
      "TransformStream",
    ]) {
      this.global[key] = globalThis[key]
    }
  }
}
