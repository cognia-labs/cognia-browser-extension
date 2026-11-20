import type { CapturedPage } from "../panel-state"
import { evidenceBundle } from "./evidence-bundle"
import { readStoredZip } from "./zip"

const PAGE: CapturedPage = {
  tabId: 1,
  title: "Pricing plans",
  url: "https://shop.test/pricing",
  rawUrl: "https://shop.test/pricing?ref=mail",
  selection: { text: "the plan table", truncated: false },
  readableText: null,
  capturedAt: Date.UTC(2026, 10, 19, 9, 0),
  strippedQuery: true,
}

const file = (id: string, name: string, mediaType: string, bytes: number[]) => ({
  id,
  name,
  mediaType,
  bytes: new Uint8Array(bytes),
})

describe("evidenceBundle", () => {
  it("packs the Markdown and only the chosen files, linked relatively", () => {
    const bundle = evidenceBundle({
      page: PAGE,
      instruction: "Why is the table cut off?",
      inspection: "## Screenshot annotations\n\n- `shot.png`: 1 numbered marker",
      mode: "selection",
      extraPages: [],
      attachments: [
        file("a", "shot.png", "image/png", [1, 2, 3]),
        file("b", "shot.png", "image/png", [4, 5]),
        file("c", "private.pdf", "application/pdf", [9]),
      ],
      chosen: new Set(["a", "b"]),
      now: Date.UTC(2026, 10, 19, 9, 5),
    })
    expect(bundle.name).toBe("cognia-pricing-plans-2026-11-19.zip")
    const entries = readStoredZip(bundle.bytes)
    expect(entries.map((entry) => entry.name)).toEqual([
      "cognia-pricing-plans-2026-11-19.md",
      "attachments/shot.png",
      "attachments/shot-2.png",
    ])
    expect([...entries[2]!.bytes]).toEqual([4, 5])
    const markdown = new TextDecoder().decode(entries[0]!.bytes)
    expect(markdown).toContain("Why is the table cut off?")
    expect(markdown).toContain("the plan table")
    expect(markdown).toContain("1 numbered marker")
    expect(markdown).toContain("Page captured on 2026-11-19 09:00 UTC.")
    expect(markdown).toContain("![shot.png](<attachments/shot.png>)")
    expect(markdown).toContain("![shot.png](<attachments/shot-2.png>)")
    // Left out means left out: named as left out, never packed.
    expect(markdown).toContain("1 other attachment(s) were left out of this archive.")
    expect(markdown).not.toContain("private.pdf")
    expect(entries.some((entry) => entry.name.includes("private"))).toBe(false)
  })
})
