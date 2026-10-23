import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

export async function auditStandalone(root) {
  const issues = []
  const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"))
  for (const section of ["dependencies", "devDependencies"]) {
    for (const [name, version] of Object.entries(pkg[section] ?? {})) {
      if (/^(workspace:|link:|file:\.\.)/.test(version))
        issues.push(`${name} depends on a parent workspace`)
    }
  }
  for (const name of ["wxt.config.ts", "tsconfig.json", "src/styles/tokens.css"]) {
    const text = await readFile(resolve(root, name), "utf8")
    if (/\.\.\/(?:packages|lib|tsconfig\.json)/.test(text))
      issues.push(`${name} reaches outside the repository`)
  }
  const source = JSON.parse(await readFile(resolve(root, "provenance/source.json"), "utf8"))
  for (const [name, record] of Object.entries(source.files)) {
    if (!name.startsWith("vendor/")) continue
    const bytes = await readFile(resolve(root, name))
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
