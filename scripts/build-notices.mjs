import { execFileSync } from "node:child_process"
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export async function buildNotices(root, report, revision, dirty = false) {
  if (!/^[a-f0-9]{40}$/.test(revision))
    throw new Error("Source commit is required for archive attribution")
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"))
  const notices = new Map()
  const dependencies = Object.values(report)
    .flat()
    .filter((entry) => !entry.name.startsWith("@cognia/"))
  for (const entry of dependencies) {
    for (const directory of entry.paths) {
      const installed = JSON.parse(await readFile(join(directory, "package.json"), "utf8"))
      const files = (await readdir(directory))
        .filter((name) => /^(license|licence|notice|copying)([.-]|$)/i.test(name))
        .sort()
      const texts = []
      for (const file of files) {
        const text = await readFile(join(directory, file), "utf8")
        if (text.trim()) texts.push(text)
      }
      if (!texts.length) {
        try {
          const text = await readFile(
            join(root, "licenses", `${entry.name}-${installed.version}.txt`),
            "utf8"
          )
          if (!text.trim()) throw new Error("Empty license notice")
          texts.push(text)
        } catch {
          throw new Error(`Missing license notice: ${entry.name}@${installed.version}`)
        }
      }
      const key = `${entry.name}@${installed.version} — ${entry.license}`
      const previous = notices.get(key) ?? new Set()
      for (const text of texts) previous.add(text)
      notices.set(key, previous)
    }
  }
  for (const name of ["react", "tailwindcss"])
    if (!dependencies.some((entry) => entry.name === name))
      throw new Error(`Shipped dependency license inventory is incomplete: ${name}`)
  const rendered = [...notices.keys()]
    .sort()
    .map((key) => `${key}\n${[...notices.get(key)].join("\n")}`)
  const repository = pkg.repository.url.replace(/\.git$/, "")
  const files = {
    "LICENSE.txt": await readFile(join(root, "LICENSE"), "utf8"),
    "NOTICE.txt": await readFile(join(root, "NOTICE"), "utf8"),
    "THIRD_PARTY_NOTICES.txt": `Runtime dependency notices from the frozen installation.\n\n${rendered.join("\n\n--------------------\n\n")}\n`,
    "SOURCE.txt": `Cognia Browser Companion ${pkg.version}\nCorresponding source: ${repository}/tree/${revision}\nSource archive: ${repository}/archive/${revision}.tar.gz\nSource state: ${dirty ? "local working changes" : "committed checkout"}\nBuild: pnpm install --frozen-lockfile && pnpm build\n`,
  }
  await mkdir(join(root, "public"), { recursive: true })
  for (const [name, content] of Object.entries(files))
    await writeFile(join(root, "public", name), content)
  return Object.keys(files)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.cwd()
  const report = JSON.parse(
    execFileSync("pnpm", ["licenses", "list", "--prod", "--json"], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    })
  )
  // Tailwind is a build dependency whose stylesheet is shipped to users.
  const tailwind = resolve(root, "node_modules/tailwindcss")
  const css = JSON.parse(await readFile(join(tailwind, "package.json"), "utf8"))
  report.shippedCss = [
    { name: css.name, versions: [css.version], paths: [tailwind], license: css.license },
  ]
  const revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  const dirty = Boolean(execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim())
  console.log(
    `Prepared ${(await buildNotices(root, report, revision, dirty)).length} archive notice files`
  )
}
