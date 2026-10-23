import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { buildNotices } from "./build-notices.mjs"

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), "cognia-notices-"))
  const dependency = join(root, "dependency")
  await mkdir(dependency)
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      version: "0.1.1",
      repository: { url: "https://github.com/cognia-labs/cognia-browser-extension.git" },
    })
  )
  await writeFile(join(root, "LICENSE"), "Project license")
  await writeFile(join(root, "NOTICE"), "Project attribution")
  await writeFile(join(dependency, "LICENSE"), "React copyright and MIT permission")
  await writeFile(
    join(dependency, "package.json"),
    JSON.stringify({ name: "react", version: "19.3.1" })
  )
  const css = join(root, "tailwind")
  await mkdir(css)
  await writeFile(
    join(css, "package.json"),
    JSON.stringify({ name: "tailwindcss", version: "4.3.3" })
  )
  await writeFile(join(css, "LICENSE"), "Tailwind MIT permission")
  const report = {
    css: [{ name: "tailwindcss", versions: ["4.3.3"], paths: [css], license: "MIT" }],
    MIT: [{ name: "react", versions: ["19.3.1"], paths: [dependency], license: "MIT" }],
  }
  try {
    await run({ root, dependency, report })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test("installable output retains project and runtime dependency notices plus exact source commit", async () => {
  await fixture(async ({ root, report }) => {
    const names = await buildNotices(root, report, "a".repeat(40))
    assert.equal(names.length, 4)
    assert.equal(await readFile(join(root, "public/LICENSE.txt"), "utf8"), "Project license")
    assert.match(
      await readFile(join(root, "public/THIRD_PARTY_NOTICES.txt"), "utf8"),
      /React copyright and MIT permission/
    )
    assert.match(
      await readFile(join(root, "public/THIRD_PARTY_NOTICES.txt"), "utf8"),
      /Tailwind MIT permission/
    )
    assert.match(
      await readFile(join(root, "public/SOURCE.txt"), "utf8"),
      /tree\/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/
    )
  })
})

test("missing upstream notices fail until an explicit version-specific fallback exists", async () => {
  await fixture(async ({ root, dependency, report }) => {
    await rm(join(dependency, "LICENSE"))
    await assert.rejects(
      buildNotices(root, report, "a".repeat(40)),
      /Missing license notice: react@19.3.1/
    )
    await mkdir(join(root, "licenses"))
    await writeFile(join(root, "licenses/react-19.3.1.txt"), "Pinned upstream notice")
    await buildNotices(root, report, "a".repeat(40))
    assert.match(
      await readFile(join(root, "public/THIRD_PARTY_NOTICES.txt"), "utf8"),
      /Pinned upstream notice/
    )
  })
})

test("every installed version needs its own notice", async () => {
  await fixture(async ({ root, report }) => {
    const other = join(root, "react-other")
    await mkdir(other)
    await writeFile(
      join(other, "package.json"),
      JSON.stringify({ name: "react", version: "20.0.0" })
    )
    report.MIT[0].paths.push(other)
    report.MIT[0].versions.push("20.0.0")
    await assert.rejects(
      buildNotices(root, report, "a".repeat(40)),
      /Missing license notice: react@20.0.0/
    )
  })
})

test("blank installed notices and exact-version fallbacks fail closed", async () => {
  await fixture(async ({ root, dependency, report }) => {
    await writeFile(join(dependency, "LICENSE"), " \n\t")
    await assert.rejects(
      buildNotices(root, report, "a".repeat(40)),
      /Missing license notice: react@19.3.1/
    )
    await mkdir(join(root, "licenses"))
    await writeFile(join(root, "licenses/react-19.3.1.txt"), " \n\t")
    await assert.rejects(
      buildNotices(root, report, "a".repeat(40)),
      /Missing license notice: react@19.3.1/
    )
  })
})
