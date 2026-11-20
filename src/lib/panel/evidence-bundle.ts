/**
 * An evidence bundle: the exported Markdown and the attachments the person
 * chose, in one archive that opens offline (report item 05).
 *
 * The Markdown export alone names its screenshots without carrying them, so
 * whoever receives it cannot see what the notes point at. The bundle packs
 * the chosen files beside it under `attachments/` and links them relatively.
 * Only what is chosen goes in, as shown: a marked-up screenshot is packed with
 * its marks, never the clean shot kept for re-editing.
 */
import type { BrowserCaptureMode } from "@cognia/companion-client"

import { exportFileName, exportMarkdown, type BundledFile } from "../inspect/inspect-markdown"
import type { CapturedPage } from "../panel-state"
import { safeEntryName, zipStore, type ZipEntry } from "./zip"

export interface BundleAttachment {
  id: string
  name: string
  mediaType: string
  bytes: Uint8Array
}

export interface EvidenceBundleInput {
  page: CapturedPage
  instruction: string
  inspection: string
  mode: BrowserCaptureMode
  extraPages: readonly CapturedPage[]
  /** Every attachment on screen; only those in `chosen` are packed. */
  attachments: readonly BundleAttachment[]
  chosen: ReadonlySet<string>
  now: number
}

/** Paths under `attachments/`, one per file, never two the same. */
function paths(attachments: readonly BundleAttachment[]): string[] {
  const used = new Set<string>()
  return attachments.map((attachment) => {
    const safe = safeEntryName(attachment.name).replace(/\//g, "_")
    const dot = safe.lastIndexOf(".")
    const [stem, ext] = dot > 0 ? [safe.slice(0, dot), safe.slice(dot)] : [safe, ""]
    let candidate = safe
    for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${stem}-${n}${ext}`
    used.add(candidate.toLowerCase())
    return `attachments/${candidate}`
  })
}

export function evidenceBundle(input: EvidenceBundleInput): { name: string; bytes: Uint8Array } {
  const packed = input.attachments.filter((attachment) => input.chosen.has(attachment.id))
  const where = paths(packed)
  const bundled: BundledFile[] = packed.map((attachment, index) => ({
    name: attachment.name,
    path: where[index]!,
    image: attachment.mediaType.startsWith("image/"),
  }))
  const markdownName = exportFileName(input.page.title, input.now)
  const markdown = exportMarkdown(
    input.page,
    input.instruction,
    input.inspection,
    input.attachments.map((attachment) => attachment.name),
    input.now,
    input.mode,
    input.extraPages,
    bundled
  )
  const entries: ZipEntry[] = [
    { name: markdownName, bytes: new TextEncoder().encode(markdown) },
    ...packed.map((attachment, index) => ({ name: where[index]!, bytes: attachment.bytes })),
  ]
  return {
    name: markdownName.replace(/\.md$/, ".zip"),
    bytes: zipStore(entries, new Date(input.now)),
  }
}
