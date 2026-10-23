import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"
import { publishArchive, resolveReleaseCommit } from "./publish-archive.mjs"

const commit = "a".repeat(40),
  branch = "b".repeat(40)
const bytes = Buffer.from("tested archive")
const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`
function fixture({
  asset,
  tagged = commit,
  annotated = false,
  uploadFailure = false,
  moveAfterRead = false,
  moveDuringUpload = false,
  draft = false,
  absent = false,
} = {}) {
  const requests = []
  const release = {
    id: 1,
    draft,
    tag_name: "v0.1.1",
    assets: asset ? [asset] : [],
    upload_url: "https://uploads.github.com/repos/cognia-labs/test/releases/1/assets{?name,label}",
  }
  const api = async (path, options = {}) => {
    requests.push({ path, ...options })
    if (path.includes("/git/ref/tags/"))
      return {
        object: { type: annotated ? "tag" : "commit", sha: annotated ? "c".repeat(40) : tagged },
      }
    if (path.includes("/git/tags/")) return { object: { type: "commit", sha: tagged } }
    if (path.includes("/releases/tags/")) {
      if (moveAfterRead) tagged = branch
      return absent || release.draft ? null : release
    }
    if (path.includes("/releases?")) return absent ? [] : [release]
    if (path.endsWith("/releases") && options.method === "POST") {
      release.draft = options.json.draft
      return release
    }
    if (path.endsWith("/releases/1") && options.method === "PATCH") {
      release.draft = options.json.draft
      return release
    }
    if (path.includes("uploads.github.com")) {
      if (moveDuringUpload) tagged = branch
      if (uploadFailure) throw new Error("network failure")
      return { id: 2 }
    }
    throw new Error(`Unexpected request ${path}`)
  }
  return { api, requests, release }
}
const publish = (api, overrides = {}) =>
  publishArchive({
    api,
    repository: "cognia-labs/test",
    tag: "v0.1.1",
    version: "0.1.1",
    commit,
    archive: "test-0.1.1-chrome.zip",
    bytes,
    ...overrides,
  })

test("a branch with the version's name cannot substitute for its exact annotated tag", async () => {
  const { api, requests } = fixture({ annotated: true })
  assert.equal(await resolveReleaseCommit(api, "cognia-labs/test", "v0.1.1"), commit)
  await assert.rejects(publish(api, { commit: branch }), /tested commit/)
  assert.ok(requests.every((request) => !request.path.includes("/git/ref/heads/")))
  assert.ok(requests.every((request) => request.method !== "POST"))
})

test("an identical already-published archive is a read-only success", async () => {
  const { api, requests } = fixture({ asset: { name: "test-0.1.1-chrome.zip", digest } })
  assert.equal(await publish(api), "unchanged")
  assert.ok(requests.every((request) => !request.method))
})

test("different published bytes are preserved rather than clobbered", async () => {
  const { api, requests } = fixture({
    asset: { name: "test-0.1.1-chrome.zip", digest: "sha256:different" },
  })
  await assert.rejects(publish(api), /different bytes/)
  assert.ok(requests.every((request) => !request.method))
})

test("failed uploads never delete an existing release or asset", async () => {
  const { api, requests } = fixture({ uploadFailure: true, draft: true })
  await assert.rejects(publish(api), /network failure/)
  assert.ok(requests.every((request) => request.method !== "DELETE"))
})

test("a moved tag is rejected again immediately before publication", async () => {
  const { api, requests } = fixture({ moveAfterRead: true, draft: true })
  await assert.rejects(publish(api), /tested commit/)
  assert.ok(requests.every((request) => !request.method))
})

test("new releases stay draft until upload and tag verification both succeed", async () => {
  const { api, requests, release } = fixture({ absent: true })
  assert.equal(await publish(api), "uploaded")
  const creation = requests.find(
    (request) => request.path.endsWith("/releases") && request.method === "POST"
  )
  assert.equal(creation.json.draft, true)
  assert.equal(creation.json.target_commitish, commit)
  assert.equal(release.draft, false)
  assert.ok(
    requests.findIndex((request) => request.path.includes("uploads.github.com")) <
      requests.findIndex((request) => request.method === "PATCH")
  )
})

test("tag movement during upload leaves the new release unpublished", async () => {
  const { api, requests, release } = fixture({ absent: true, moveDuringUpload: true })
  await assert.rejects(publish(api), /tested commit/)
  assert.equal(release.draft, true)
  assert.ok(requests.every((request) => request.method !== "PATCH"))
})

test("a draft left by an interrupted upload is resumed without creating another release", async () => {
  const { api, requests, release } = fixture({
    draft: true,
    asset: { name: "test-0.1.1-chrome.zip", digest },
  })
  assert.equal(await publish(api), "published")
  assert.equal(release.draft, false)
  assert.ok(requests.some((request) => request.path.includes("/releases?")))
  assert.ok(requests.every((request) => request.method !== "POST"))
})

test("draft lookup paginates and refuses to replace an interrupted archive with different bytes", async () => {
  const { api, requests } = fixture({
    draft: true,
    asset: { name: "test-0.1.1-chrome.zip", digest: "sha256:other" },
  })
  const paginated = async (path, options) =>
    path.endsWith("per_page=100&page=1")
      ? Array.from({ length: 100 }, () => ({ tag_name: "v0.0.1" }))
      : api(path, options)
  await assert.rejects(publish(paginated), /different bytes/)
  assert.ok(requests.some((request) => request.path.endsWith("page=2")))
  assert.ok(requests.every((request) => !request.method))
})
