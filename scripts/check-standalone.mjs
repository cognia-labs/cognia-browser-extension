import { createHash } from "node:crypto"
import { readFile, readdir, realpath } from "node:fs/promises"
import path, { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export const within = (root, target, paths = path) => {
  const rel = paths.relative(root, target)
  return rel !== ".." && !rel.startsWith(`..${paths.sep}`) && !paths.isAbsolute(rel)
}
const sections = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]
const required = [
  "vendor/companion-client/package.json",
  "vendor/companion-client/src/browser-agent-protocol.json",
  "vendor/plugin-ui/package.json",
  "vendor/overlay/overlay.injected.js",
]

export async function auditStandalone(root) {
  root = await realpath(root)
  const issues = []
  const vendorFiles = []
  async function walk(directory) {
    for (const entry of await readdir(resolve(root, directory), { withFileTypes: true })) {
      const name = `${directory}/${entry.name}`
      if (entry.isSymbolicLink()) issues.push(`${name} is an unpinned vendor symlink`)
      else if (entry.isDirectory()) await walk(name)
      else if (entry.isFile()) vendorFiles.push(name)
    }
  }
  await walk("vendor")
  for (const name of [
    "package.json",
    ...vendorFiles.filter((name) => name.endsWith("/package.json")),
  ]) {
    const pkg = JSON.parse(await readFile(resolve(root, name), "utf8"))
    for (const section of sections) {
      for (const [dependency, version] of Object.entries(pkg[section] ?? {})) {
        if (/^(workspace:|link:)/.test(version)) {
          issues.push(`${name}: ${dependency} depends on a parent workspace or link`)
        } else if (version.startsWith("file:")) {
          const target = resolve(root, name, "..", version.slice(5))
          if (!within(root, target))
            issues.push(`${name}: ${dependency} escapes outside the repository`)
          else {
            try {
              if (!within(root, await realpath(target)))
                issues.push(`${name}: ${dependency} resolves outside the repository`)
            } catch {
              issues.push(`${name}: ${dependency} has a missing local dependency`)
            }
          }
        }
      }
    }
  }
  for (const name of ["wxt.config.ts", "tsconfig.json", "src/styles/tokens.css"]) {
    const text = await readFile(resolve(root, name), "utf8")
    if (/\.\.\/(?:packages|lib|tsconfig\.json)/.test(text))
      issues.push(`${name} reaches outside the repository`)
  }
  const source = JSON.parse(await readFile(resolve(root, "provenance/source.json"), "utf8"))
  if (
    source.schemaVersion !== 1 ||
    !/^[a-f0-9]{40}$/.test(source.sourceRevision ?? "") ||
    !source.files ||
    Array.isArray(source.files) ||
    typeof source.files !== "object"
  ) {
    issues.push("Invalid provenance schema")
    return issues
  }
  const pinned = Object.keys(source.files).filter((name) => name.startsWith("vendor/"))
  for (const name of required)
    if (!pinned.includes(name)) issues.push(`Required provenance input missing: ${name}`)
  for (const name of new Set([...vendorFiles, ...pinned])) {
    if (!vendorFiles.includes(name) || !pinned.includes(name)) {
      issues.push(`Vendor provenance inventory mismatch: ${name}`)
      continue
    }
    const record = source.files[name]
    if (
      !record ||
      !/^[a-f0-9]{64}$/.test(record.sha256 ?? "") ||
      typeof record.source !== "string"
    ) {
      issues.push(`Invalid provenance record: ${name}`)
      continue
    }
    const bytes = await readFile(join(root, name))
    if (createHash("sha256").update(bytes).digest("hex") !== record.sha256)
      issues.push(`${name} differs from the pinned product snapshot`)
  }
  return issues
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const issues = await auditStandalone(process.cwd())
  for (const issue of issues) console.error(issue)
  if (issues.length) process.exitCode = 1
  else console.log("Standalone configuration and vendor hashes verified")
}
