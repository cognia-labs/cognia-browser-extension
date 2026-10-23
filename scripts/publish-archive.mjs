import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFile, readdir } from "node:fs/promises"
import { basename, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export async function resolveReleaseCommit(api, repository, tag) {
  if (!/^v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(tag))
    throw new Error("Invalid version tag")
  let object = (await api(`/repos/${repository}/git/ref/tags/${encodeURIComponent(tag)}`)).object
  const seen = new Set()
  while (object.type === "tag") {
    if (seen.has(object.sha) || seen.size >= 8) throw new Error("Invalid annotated tag chain")
    seen.add(object.sha)
    object = (await api(`/repos/${repository}/git/tags/${object.sha}`)).object
  }
  if (object.type !== "commit" || !/^[a-f0-9]{40}$/.test(object.sha))
    throw new Error("Tag does not resolve to a commit")
  return object.sha
}

export async function publishArchive({ api, repository, tag, version, commit, archive, bytes }) {
  if (tag !== `v${version}` || !/^[a-f0-9]{40}$/.test(commit))
    throw new Error("Release version or tested commit mismatch")
  const assertTag = async () => {
    if ((await resolveReleaseCommit(api, repository, tag)) !== commit)
      throw new Error("Remote tag differs from the tested commit")
  }
  await assertTag()
  const name = basename(archive)
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`
  let release = await api(`/repos/${repository}/releases/tags/${encodeURIComponent(tag)}`, {
    missing: true,
  })
  // The tag endpoint excludes drafts, including ones left after a lost upload response.
  if (!release) {
    for (let page = 1; ; page++) {
      const candidates = await api(`/repos/${repository}/releases?per_page=100&page=${page}`)
      release = candidates.find((candidate) => candidate.tag_name === tag)
      if (release || candidates.length < 100) break
    }
  }
  if (release) {
    const asset = release.assets.find((entry) => entry.name === name)
    if (asset) {
      const existingDigest =
        asset.digest ??
        `sha256:${createHash("sha256")
          .update(await api(`/repos/${repository}/releases/assets/${asset.id}`, { binary: true }))
          .digest("hex")}`
      if (existingDigest !== digest)
        throw new Error(
          "Published archive has different bytes; preserve it and publish a new version"
        )
      await assertTag()
      if (release.draft) {
        await api(`/repos/${repository}/releases/${release.id}`, {
          method: "PATCH",
          json: { draft: false },
        })
        await assertTag()
        return "published"
      }
      return "unchanged"
    }
  }
  if (release && !release.draft)
    throw new Error(
      "Published release has no matching archive; preserve it and publish a new version"
    )
  await assertTag()
  if (!release)
    release = await api(`/repos/${repository}/releases`, {
      method: "POST",
      json: {
        tag_name: tag,
        target_commitish: commit,
        name: tag,
        draft: true,
        generate_release_notes: true,
        prerelease: version.startsWith("0.") || version.includes("-"),
      },
    })
  await assertTag()
  const upload = new URL(release.upload_url.replace("{?name,label}", ""))
  upload.searchParams.set("name", name)
  await api(upload.href, { method: "POST", bytes })
  await assertTag()
  await api(`/repos/${repository}/releases/${release.id}`, {
    method: "PATCH",
    json: { draft: false },
  })
  await assertTag()
  return "uploaded"
}

export function githubApi(token) {
  return async (path, options = {}) => {
    const url = new URL(path, "https://api.github.com")
    if (
      !["api.github.com", "uploads.github.com"].includes(url.hostname) ||
      url.protocol !== "https:"
    )
      throw new Error("Unexpected GitHub API host")
    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: options.binary ? "application/octet-stream" : "application/vnd.github+json",
        ...(options.bytes
          ? { "Content-Type": "application/zip" }
          : options.json
            ? { "Content-Type": "application/json" }
            : {}),
      },
      body: options.bytes ?? (options.json ? JSON.stringify(options.json) : undefined),
    })
    if (response.status === 404 && options.missing) return null
    if (!response.ok) throw new Error(`GitHub API request failed: HTTP ${response.status}`)
    return options.binary ? Buffer.from(await response.arrayBuffer()) : response.json()
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const pkg = JSON.parse(await readFile("package.json", "utf8"))
  const tag = process.env.RELEASE_TAG
  const repository = process.env.GITHUB_REPOSITORY
  if (!process.env.GH_TOKEN || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? ""))
    throw new Error("GitHub release credentials and repository are required")
  const names = (await readdir("build")).filter((name) =>
    name.endsWith(`-${pkg.version}-chrome.zip`)
  )
  if (names.length !== 1) throw new Error("Expected exactly one checked archive for this version")
  const archive = resolve("build", names[0])
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  console.log(
    await publishArchive({
      api: githubApi(process.env.GH_TOKEN),
      repository,
      tag,
      version: pkg.version,
      commit,
      archive,
      bytes: await readFile(archive),
    })
  )
}
