import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { join, relative, win32 } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { auditStandalone, within } from "./check-standalone.mjs"

const root = fileURLToPath(new URL("../", import.meta.url))
async function fixture(run) {
  await mkdir(join(root, ".cache"), { recursive: true })
  const temporary = await mkdtemp(join(root, ".cache/standalone-test-"))
  const checkout = join(temporary, "checkout")
  await mkdir(checkout)
  for (const name of [
    "package.json",
    "wxt.config.ts",
    "tsconfig.json",
    "src/styles/tokens.css",
    "provenance/source.json",
  ]) {
    await mkdir(join(checkout, name, ".."), { recursive: true })
    await cp(join(root, name), join(checkout, name))
  }
  await cp(join(root, "vendor"), join(checkout, "vendor"), { recursive: true })
  const json = async (name, change) => {
    const path = join(checkout, name)
    const value = JSON.parse(await readFile(path, "utf8"))
    change(value)
    await writeFile(path, JSON.stringify(value))
  }
  try {
    await run({ checkout, temporary, json })
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

test("install and build inputs belong to this checkout and vendor bytes match their provenance", async () => {
  assert.deepEqual(await auditStandalone(root), [])
})

test("local dependency paths cannot escape through absolute, normalized or symlink paths", async () => {
  await fixture(async ({ checkout, temporary, json }) => {
    for (const value of [
      "file:/outside/product",
      "file:vendor/../../../product",
      "link:../product",
    ]) {
      await json("package.json", (p) => {
        p.dependencies.escape = value
      })
      assert.match(
        (await auditStandalone(checkout)).join("\n"),
        /outside|parent workspace|escape/,
        value
      )
    }
    await mkdir(join(temporary, "external"))
    await symlink(join(temporary, "external"), join(checkout, "vendor/escape"))
    await json("package.json", (p) => {
      p.dependencies.escape = "file:vendor/escape"
    })
    assert.match((await auditStandalone(checkout)).join("\n"), /outside|escape/)
  })
})

test("nested vendor manifests cannot reintroduce parent dependencies", async () => {
  await fixture(async ({ checkout, json }) => {
    await json("vendor/plugin-ui/package.json", (p) => {
      p.dependencies.escape = "file:../../../product"
    })
    assert.match((await auditStandalone(checkout)).join("\n"), /outside|parent workspace|escape/)
  })
})

test("empty provenance cannot disable verification", async () => {
  await fixture(async ({ checkout, json }) => {
    await json("provenance/source.json", (p) => {
      p.files = {}
    })
    assert.match((await auditStandalone(checkout)).join("\n"), /provenance|inventory|pinned/)
  })
})

test("unlisted vendor files are rejected", async () => {
  await fixture(async ({ checkout }) => {
    await writeFile(
      join(checkout, "vendor/companion-client/src/new-runtime.ts"),
      "export const drift = 1"
    )
    assert.match((await auditStandalone(checkout)).join("\n"), /new-runtime.ts/)
  })
})

test("Windows containment rejects lexical and realpath traversal", () => {
  assert.equal(within("C:/checkout", "C:/outside/product", win32), false)
  assert.equal(within("C:/checkout", "C:/checkout/vendor/client", win32), true)
})

test("Jest discovers the complete suite when a consumer checkout is inside an ancestor cache or build directory", async () => {
  await fixture(async ({ checkout, temporary }) => {
    // Match the product CI checkout shape while retaining the installed runner.
    const nested = join(temporary, "build", "consumer")
    await mkdir(join(temporary, "build"))
    await cp(checkout, nested, { recursive: true })
    for (const name of ["jest.config.mjs", "src", "testing"])
      await cp(join(root, name), join(nested, name), { recursive: true })
    await symlink(join(root, "node_modules"), join(nested, "node_modules"), "junction")
    const runner = createRequire(import.meta.url).resolve("jest/bin/jest")
    const discover = (cwd) =>
      JSON.parse(
        execFileSync(
          process.execPath,
          [runner, "--listTests", "--json", "--runInBand", "--no-cache", "--watchman=false"],
          { cwd, encoding: "utf8", env: { ...process.env, CI: "true" } }
        )
      )
        .map((name) => relative(cwd, name).replaceAll("\\", "/"))
        .sort()
    const expected = execFileSync("git", ["ls-files", "-z", "--", "src", "vendor", "testing"], {
      cwd: root,
      encoding: "utf8",
    })
      .split("\0")
      .filter((name) => /\.test\.tsx?$/.test(name))
      .sort()
    assert.ok(expected.length > 0)
    assert.deepEqual(discover(nested), expected)
  })
})
