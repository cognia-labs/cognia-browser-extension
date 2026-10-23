import assert from "node:assert/strict"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { auditStandalone } from "./check-standalone.mjs"

test("install and build inputs belong to this checkout and vendor bytes match their provenance", async () => {
  assert.deepEqual(await auditStandalone(fileURLToPath(new URL("../", import.meta.url))), [])
})
