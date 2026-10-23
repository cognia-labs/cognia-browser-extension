import { BROWSER_CONTEXT_LIMITS, utf8ByteLength } from "@cognia/companion-client"

import type { CapturedPage } from "../panel-state"
import type { PickedElement } from "./element-context"
import {
  elementMarkdown,
  exportFileName,
  exportMarkdown,
  formatLocation,
  inspectionMarkdown,
  promptForClipboard,
  withInspection,
} from "./inspect-markdown"

const PICK: PickedElement = {
  elementId: "e1",
  selector: "main > button.primary",
  tag: "button",
  label: "button.primary",
  role: "button",
  name: "Save changes",
  text: "Save changes",
  textEditable: true,
  attributes: { class: "primary", type: "submit" },
  box: { x: 10, y: 20, width: 120, height: 36 },
  viewport: { width: 1280, height: 800, dpr: 2, scrollX: 0, scrollY: 0 },
  styles: { padding: "8px 16px", "background-color": "rgb(229, 231, 235)" },
  parent: { label: "main", styles: { display: "flex", gap: "16px" } },
  outline: 'button.primary "Save changes"',
  sourceHints: [{ file: "src/Save.tsx", line: 3 }],
  framework: {
    framework: "react",
    components: [
      { name: "SaveButton", source: { file: "/src/Form.tsx", line: 9 } },
      { name: "Form" },
    ],
    source: { file: "/src/SaveButton.tsx", line: 12, column: 5, approximate: true },
  },
  tabId: 1,
  pageUrl: "https://a.test/",
  pickedAt: 1,
  note: "Make it the primary action",
  edits: { styles: { "background-color": "#2563eb", padding: "8px 16px" }, text: "Save" },
  screenshotIds: ["s1"],
}

const PAGE: CapturedPage = {
  tabId: 1,
  title: "A",
  url: "https://a.test/",
  rawUrl: "https://a.test/",
  selection: null,
  readableText: null,
  capturedAt: 1,
  strippedQuery: false,
}

const LIMITS = { ...BROWSER_CONTEXT_LIMITS }

describe("elementMarkdown", () => {
  it("leads with what finds the element in the source, then the request", () => {
    const text = elementMarkdown(PICK, 0)
    expect(text).toContain('### 1. `button.primary` — "Save changes"')
    expect(text).toContain("- Selector: `main > button.primary`")
    expect(text).toContain("- Components (React, nearest first): `SaveButton` → `Form`")
    expect(text).toContain("- Written at: `/src/SaveButton.tsx:12:5` (approximate)")
    expect(text).toContain("- `SaveButton` rendered at: `/src/Form.tsx:9`")
    expect(text).toContain("- Source hints: `src/Save.tsx:3`")
    expect(text).toContain("- Box: 120×36 at (10, 20) in a 1280×800 viewport @2x")
    expect(text).toContain("- Screenshot: attached")
    expect(text).toContain("**Requested:** Make it the primary action")
    // Only what changed, with what it replaces.
    expect(text).toContain("  background-color: #2563eb; /* was rgb(229, 231, 235) */")
    expect(text).not.toContain("  padding: 8px 16px;")
    expect(text).toContain('**Text change:** "Save changes" → "Save"')
    expect(text).toContain("Parent `main`: display: flex; gap: 16px")
    expect(text).toContain('Attributes: type="submit"')
  })

  it("formats a location with or without its position", () => {
    expect(formatLocation({ file: "a.ts" })).toBe("a.ts")
    expect(formatLocation({ file: "a.ts", line: 2 })).toBe("a.ts:2")
  })
})

describe("inspectionMarkdown", () => {
  it("is empty with nothing picked or reported", () => {
    expect(inspectionMarkdown({})).toBe("")
    expect(inspectionMarkdown({ context: [null, " "], reports: [undefined] })).toBe("")
  })

  it("frames with the context, then the picks, then the reports", () => {
    const text = inspectionMarkdown({
      context: ["## Tech stack"],
      elements: [PICK],
      reports: ["## Console and network", null, "## Accessibility check (0 findings)"],
    })
    const order = [
      "## Tech stack",
      "## Picked elements (1)",
      "## Console and network",
      "## Accessibility",
    ]
    const positions = order.map((heading) => text.indexOf(heading))
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })
})

describe("elementMarkdown — props", () => {
  it("adds the nearest component's props", () => {
    const text = elementMarkdown(
      {
        ...PICK,
        framework: {
          ...PICK.framework!,
          props: { component: "SaveButton", json: '{\n  "variant": "primary"\n}' },
        },
      },
      0
    )
    expect(text).toContain("Props of `SaveButton`:")
    expect(text).toContain('"variant": "primary"')
  })

  it("adds the component's state, saying hooks come in call order", () => {
    const withState = (json: string) =>
      elementMarkdown(
        { ...PICK, framework: { ...PICK.framework!, state: { component: "Cart", json } } },
        0
      )
    expect(withState("[\n  2\n]")).toContain(
      "State of `Cart` (state hooks in call order):\n\n```json\n[\n  2\n]\n```"
    )
    expect(withState('{ "tab": "billing" }')).toContain("State of `Cart`:\n")
  })
})

describe("promptForClipboard", () => {
  it("puts the page, the ask and the context together", () => {
    expect(
      promptForClipboard({ title: "A", url: "https://a.test/" }, " Fix it ", "## Picked")
    ).toBe("# A\n\nhttps://a.test/\n\nFix it\n\n## Picked")
    expect(promptForClipboard({ title: "", url: "https://a.test/" }, "", "")).toBe(
      "# https://a.test/\n\nhttps://a.test/"
    )
  })
})

describe("contrast and export", () => {
  it("says how a pick's text stands out, and what would pass", () => {
    const text = elementMarkdown(
      {
        ...PICK,
        contrast: {
          ratio: 2.32,
          foreground: "#aaaaaa",
          background: "#ffffff",
          large: false,
          aa: false,
          aaa: false,
          suggestion: "#757575",
        },
      },
      0
    )
    expect(text).toContain(
      "- Contrast: 2.32:1 (#aaaaaa on #ffffff), fails AA for normal text; #757575 would pass AA"
    )
    expect(
      elementMarkdown(
        {
          ...PICK,
          contrast: {
            ratio: 5.1,
            foreground: "#555555",
            background: "#ffffff",
            large: false,
            aa: true,
            aaa: false,
          },
        },
        0
      )
    ).toContain("- Contrast: 5.10:1 (#555555 on #ffffff), passes AA, not AAA")
  })

  it("exports the prompt as a file, naming the attachments that go separately", () => {
    const now = Date.UTC(2026, 9, 23, 14, 5)
    const text = exportMarkdown(
      { title: "Pricing", url: "https://a.test/" },
      "Fix it",
      "## Picked",
      ["shot.png"],
      now
    )
    expect(text).toBe(
      [
        "# Pricing",
        "",
        "https://a.test/",
        "",
        "Fix it",
        "",
        "## Picked",
        "",
        "---",
        "",
        "Exported from Cognia Browser Companion on 2026-10-23 14:05 UTC.",
        "",
        "Attachments (1), not included in this file:",
        "",
        "- shot.png",
        "",
      ].join("\n")
    )
    expect(exportFileName("Pricing plans — Example!", now)).toBe(
      "cognia-pricing-plans-example-2026-10-23.md"
    )
    expect(exportFileName("价格 方案", now)).toBe("cognia-价格-方案-2026-10-23.md")
    expect(exportFileName("", now)).toBe("cognia-page-2026-10-23.md")
  })
})

describe("withInspection", () => {
  it("makes a selection of an otherwise metadata-only capture", () => {
    const page = withInspection(PAGE, "## Picked", ["markdown-selection"], LIMITS)
    expect(page.selection).toEqual({ text: "## Picked", markdown: "## Picked", truncated: false })
    expect(withInspection(PAGE, "", ["markdown-selection"], LIMITS)).toBe(PAGE)
  })

  it("keeps the person's selection first, and sends plain text to a Host without Markdown", () => {
    const selected: CapturedPage = {
      ...PAGE,
      selection: { text: "chosen", markdown: "**chosen**", truncated: false },
    }
    expect(withInspection(selected, "## Picked", ["markdown-selection"], LIMITS).selection).toEqual(
      {
        text: "chosen\n\n## Picked",
        markdown: "**chosen**\n\n## Picked",
        truncated: false,
      }
    )
    expect(withInspection(selected, "## Picked", [], LIMITS).selection).toEqual({
      text: "chosen\n\n## Picked",
      truncated: false,
    })
  })

  it("cuts to the selection ceiling and says so", () => {
    const limits = { ...LIMITS, selectionBytes: 64 }
    const page = withInspection(PAGE, "界".repeat(100), ["markdown-selection"], limits)
    expect(utf8ByteLength(page.selection!.markdown!)).toBeLessThanOrEqual(64)
    expect(page.selection?.truncated).toBe(true)
  })
})
