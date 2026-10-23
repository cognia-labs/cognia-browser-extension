import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const checker = fileURLToPath(new URL("./check-archive.mjs", import.meta.url))
async function fixture(run, omitNotice = false) {
  const root = await mkdtemp(join(tmpdir(), "cognia-archive-"))
  const build = join(root, "build/chrome-mv3")
  await mkdir(build, { recursive: true })
  await writeFile(join(root, "package.json"), JSON.stringify({ version: "0.1.1" }))
  await writeFile(
    join(build, "manifest.json"),
    JSON.stringify({ version: "0.1.1", manifest_version: 3 })
  )
  await writeFile(join(build, "background.js"), "tested code")
  for (const name of ["LICENSE.txt", "NOTICE.txt", "THIRD_PARTY_NOTICES.txt", "SOURCE.txt"]) {
    if (omitNotice && name === "NOTICE.txt") continue
    await writeFile(
      join(build, name),
      name === "SOURCE.txt"
        ? `https://github.com/cognia-labs/cognia-browser-extension/tree/${"a".repeat(40)}`
        : "Attribution"
    )
  }
  execFileSync("zip", ["-q", "-r", join(root, "build/test-0.1.1-chrome.zip"), "."], { cwd: build })
  const check = () =>
    execFileSync(process.execPath, [checker], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
  try {
    await run({ build, check })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test("a complete installable archive matches the fixed build", async () => {
  await fixture(async ({ check }) => {
    assert.match(check(), /Verified 6 archive files/)
  })
})

test("matching build and zip bytes cannot hide a missing project notice", async () => {
  await fixture(async ({ check }) => {
    assert.throws(check, (error) => error.stderr.includes("missing required notice: NOTICE.txt"))
  }, true)
})

test("build mutation after packaging is refused", async () => {
  await fixture(async ({ build, check }) => {
    await writeFile(join(build, "background.js"), "untested replacement")
    assert.throws(check, (error) => error.stderr.includes("Archive differs from packaged build"))
  })
})
