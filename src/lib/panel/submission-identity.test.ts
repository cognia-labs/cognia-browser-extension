import {
  PENDING_SUBMISSION_TTL_MS,
  parsePendingSubmission,
  submissionDigest,
} from "./submission-identity"

const shot = (bytes: number[], name = "shot.png") => ({
  name,
  mediaType: "image/png",
  kind: "screenshot",
  bytes: new Uint8Array(bytes),
})

describe("submissionDigest", () => {
  it("tells apart requests of the same length, and matches the same request", async () => {
    const alpha = await submissionDigest({ instruction: "Alpha" }, [])
    const bravo = await submissionDigest({ instruction: "Bravo" }, [])
    expect(alpha).toMatch(/^[0-9a-f]{64}$/)
    expect(bravo).not.toBe(alpha)
    expect(await submissionDigest({ instruction: "Alpha" }, [])).toBe(alpha)
  })

  it("covers the attachments' bytes, not only their size and id", async () => {
    const one = await submissionDigest({ instruction: "x" }, [shot([1, 2, 3])])
    const swapped = await submissionDigest({ instruction: "x" }, [shot([3, 2, 1])])
    const renamed = await submissionDigest({ instruction: "x" }, [shot([1, 2, 3], "other.png")])
    expect(swapped).not.toBe(one)
    expect(renamed).not.toBe(one)
  })
})

describe("parsePendingSubmission", () => {
  const digest = "a".repeat(64)

  it("keeps a current record of the digest, the id and when it was written", () => {
    expect(parsePendingSubmission({ digest, submissionId: "s", savedAt: 10 }, 20)).toEqual({
      digest,
      submissionId: "s",
      savedAt: 10,
    })
  })

  it("refuses the earlier plain-text record, a stale one and anything malformed", () => {
    expect(
      parsePendingSubmission({ fingerprint: '["ws","Summarize"]', submissionId: "s" }, 0)
    ).toBeNull()
    expect(
      parsePendingSubmission(
        { digest, submissionId: "s", savedAt: 0 },
        PENDING_SUBMISSION_TTL_MS + 1
      )
    ).toBeNull()
    expect(parsePendingSubmission({ digest: "zz", submissionId: "s", savedAt: 0 }, 0)).toBeNull()
    expect(parsePendingSubmission({ digest, submissionId: "", savedAt: 0 }, 0)).toBeNull()
    expect(parsePendingSubmission(null, 0)).toBeNull()
  })
})
