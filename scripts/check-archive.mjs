import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFile, readdir, stat } from "node:fs/promises"
import { join } from "node:path"

const pkg = JSON.parse(await readFile("package.json", "utf8"))
const archives = (await readdir("build")).filter((name) =>
  name.endsWith(`-${pkg.version}-chrome.zip`)
)
assert.equal(
  archives.length,
  1,
  "Build exactly one archive for the current Chrome version with pnpm zip"
)
const archive = join("build", archives[0])
const build = "build/chrome-mv3"
const entries = execFileSync("unzip", ["-Z1", archive], { encoding: "utf8" })
  .trim()
  .split("\n")
  .filter((name) => !name.endsWith("/"))
const built = []
for (const name of await readdir(build, { recursive: true })) {
  if ((await stat(join(build, name))).isFile()) built.push(name.replaceAll("\\", "/"))
}
assert.deepEqual(
  entries.toSorted(),
  built.toSorted(),
  "Archive must contain exactly the packaged build files"
)
for (const name of entries) {
  assert.ok(!name.startsWith("/") && !name.split("/").includes(".."), "Unsafe archive path")
  const bytes = execFileSync("unzip", ["-p", archive, name], {
    maxBuffer: 16 * 1024 * 1024,
  })
  assert.deepEqual(
    bytes,
    await readFile(join(build, name)),
    `Archive differs from packaged build: ${name}`
  )
}
for (const name of ["LICENSE.txt", "NOTICE.txt", "THIRD_PARTY_NOTICES.txt", "SOURCE.txt"]) {
  assert.ok(entries.includes(name), `Archive is missing required notice: ${name}`)
  assert.ok(
    (await readFile(join(build, name), "utf8")).trim().length > 0,
    `Empty archive notice: ${name}`
  )
}
assert.match(
  await readFile(join(build, "SOURCE.txt"), "utf8"),
  /https:\/\/github\.com\/cognia-labs\/cognia-browser-extension\/tree\/[a-f0-9]{40}/
)
const manifest = JSON.parse(await readFile(join(build, "manifest.json"), "utf8"))
assert.equal(manifest.version, pkg.version)
assert.equal(manifest.manifest_version, 3)
console.log(`Verified ${entries.length} archive files against the Chrome MV3 build`)
