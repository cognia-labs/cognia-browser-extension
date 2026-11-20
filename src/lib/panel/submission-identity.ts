/**
 * Which submission a press of Send is: the same one again, or a new one.
 *
 * A response that never arrived leaves the Host possibly holding the request.
 * Sending exactly that request again must reuse its submission id — the id is
 * the default `Idempotency-Key`, so the Host replays its receipt instead of
 * starting a second task — and sending anything else must not, or the Host is
 * asked to treat a different request as a replay of the first.
 *
 * "Exactly that request" is decided by a digest of what is sent: the request
 * body as serialized, and each attachment's bytes, name and type. Lengths are
 * not enough — `Alpha` and `Bravo` are the same length — and the request itself
 * is not kept: what survives in `chrome.storage.local` is the digest, the id
 * and when it was written, never the instruction, the page or its address.
 */
import { sha256Hex } from "../attachment-upload"

export interface PendingSubmission {
  /** SHA-256 of the request and its attachments, hex. */
  digest: string
  submissionId: string
  savedAt: number
}

/** A lost response older than this is not retried under the same id. */
export const PENDING_SUBMISSION_TTL_MS = 24 * 60 * 60 * 1000

export interface DigestAttachment {
  name: string
  mediaType: string
  kind: string
  bytes: Uint8Array
}

/** The digest of one request: its body and every attachment, in order. */
export async function submissionDigest(
  request: unknown,
  attachments: readonly DigestAttachment[]
): Promise<string> {
  const parts: string[] = [JSON.stringify(request)]
  for (const attachment of attachments) {
    parts.push(
      JSON.stringify([
        attachment.name,
        attachment.mediaType,
        attachment.kind,
        attachment.bytes.byteLength,
        await sha256Hex(attachment.bytes),
      ])
    )
  }
  return sha256Hex(new TextEncoder().encode(parts.join("\n")))
}

/**
 * The pending record as stored, when it is one this build wrote and still
 * current. Anything else — including the earlier record that kept the
 * instruction, title and address in plain text — is not reused.
 */
export function parsePendingSubmission(value: unknown, now: number): PendingSubmission | null {
  if (!value || typeof value !== "object") return null
  const record = value as Record<string, unknown>
  if (
    typeof record.digest !== "string" ||
    !/^[0-9a-f]{64}$/.test(record.digest) ||
    typeof record.submissionId !== "string" ||
    record.submissionId.length === 0 ||
    typeof record.savedAt !== "number"
  )
    return null
  if (now - record.savedAt > PENDING_SUBMISSION_TTL_MS || record.savedAt > now + 60_000) return null
  return { digest: record.digest, submissionId: record.submissionId, savedAt: record.savedAt }
}
