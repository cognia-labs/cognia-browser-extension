/**
 * Picks and a bug report as the context an agent reads.
 *
 * The wire contract has one place for "what the person pointed at": the
 * page's selection, which the Host fences and renders as Markdown. A pick is
 * that, made precise, so the inspection travels there — after whatever text
 * the person selected, inside the same per-page byte ceiling, cut and marked
 * truncated the way any selection is. The section headings are fixed English:
 * they are structure for the agent, like a transcript's `[mm:ss]`, while the
 * person's own words (the note, the instruction) stay in their language.
 */
import {
  clipToBytes,
  type BrowserCompanionFeature,
  type BrowserContextLimits,
} from "@cognia/companion-client"

import type { CapturedPage } from "../panel-state"
import type { PickedElement, SourceLocation } from "./element-context"
import { styleChanges } from "./style-edits"

/** More picks than this is a page, not a pointer. */
export const MAX_PICKS = 8

export function formatLocation(location: SourceLocation): string {
  const position = [location.line, location.column].filter((part) => part !== undefined)
  return `${location.file}${position.length > 0 ? `:${position.join(":")}` : ""}`
}

function code(value: string): string {
  const fence = value.includes("`") ? "``" : "`"
  return `${fence}${value}${fence}`
}

const FRAMEWORK_NAMES = {
  react: "React",
  vue: "Vue",
  svelte: "Svelte",
  angular: "Angular",
} as const

/** One pick, as a Markdown section. */
export function elementMarkdown(element: PickedElement, index: number): string {
  const lines: string[] = []
  const name = element.name ?? (element.text ? element.text.slice(0, 80) : "")
  lines.push(`### ${index + 1}. ${code(element.label)}${name ? ` — "${name}"` : ""}`, "")
  lines.push(`- Selector: ${code(element.selector)}`)
  if (element.role) lines.push(`- Role: ${element.role}${element.name ? ` "${element.name}"` : ""}`)
  const framework = element.framework
  if (framework && framework.components.length > 0) {
    lines.push(
      `- Components (${FRAMEWORK_NAMES[framework.framework]}, nearest first): ${framework.components
        .map((frame) => code(frame.name))
        .join(" → ")}`
    )
  } else if (framework) {
    lines.push(`- Framework: ${FRAMEWORK_NAMES[framework.framework]}`)
  }
  if (framework?.source) {
    lines.push(
      `- Written at: ${code(formatLocation(framework.source))}${framework.source.approximate ? " (approximate)" : ""}`
    )
  }
  const located = (framework?.components ?? []).filter((frame) => frame.source).slice(0, 3)
  for (const frame of located) {
    lines.push(
      `- ${code(frame.name)} rendered at: ${code(formatLocation(frame.source!))}${frame.source!.approximate ? " (approximate)" : ""}`
    )
  }
  if (element.sourceHints.length > 0) {
    lines.push(
      `- Source hints: ${element.sourceHints.map((hint) => code(formatLocation(hint))).join(", ")}`
    )
  }
  const { box, viewport } = element
  lines.push(
    `- Box: ${box.width}×${box.height} at (${box.x}, ${box.y}) in a ${viewport.width}×${viewport.height} viewport @${viewport.dpr}x`
  )
  if (element.contrast) {
    const contrast = element.contrast
    const verdict = contrast.aaa
      ? "passes AAA"
      : contrast.aa
        ? "passes AA, not AAA"
        : `fails AA for ${contrast.large ? "large" : "normal"} text`
    lines.push(
      `- Contrast: ${contrast.ratio.toFixed(2)}:1 (${contrast.foreground} on ${contrast.background}), ${verdict}${
        contrast.suggestion ? `; ${contrast.suggestion} would pass AA` : ""
      }`
    )
  }
  const shots = element.screenshotIds.length
  if (shots === 1) lines.push("- Screenshot: attached")
  else if (shots > 1)
    lines.push(`- Screenshots: ${shots} attached, the last taken with the style changes previewed`)
  if (element.text && element.text !== element.name) lines.push(`- Text: "${element.text}"`)
  if (element.note.trim()) lines.push("", `**Requested:** ${element.note.trim()}`)

  const changes = styleChanges(element.styles, element.edits.styles)
  if (changes.length > 0) {
    lines.push(
      "",
      "**Style changes, previewed on the page:**",
      "",
      "```css",
      `${element.selector} {`
    )
    for (const change of changes) {
      lines.push(
        `  ${change.property}: ${change.to};${change.from ? ` /* was ${change.from} */` : ""}`
      )
    }
    lines.push("}", "```")
  }
  if (element.edits.text !== undefined && element.edits.text !== element.text) {
    lines.push("", `**Text change:** "${element.text}" → "${element.edits.text}"`)
  }

  const computed = Object.entries(element.styles)
  if (computed.length > 0) {
    lines.push("", "Computed styles:", "", "```css")
    for (const [property, value] of computed) lines.push(`${property}: ${value};`)
    lines.push("```")
  }
  if (element.parent) {
    const layout = Object.entries(element.parent.styles)
      .map(([property, value]) => `${property}: ${value}`)
      .join("; ")
    lines.push("", `Parent ${code(element.parent.label)}${layout ? `: ${layout}` : ""}`)
  }
  const attributes = Object.entries(element.attributes).filter(([key]) => key !== "class")
  if (attributes.length > 0) {
    lines.push("", `Attributes: ${attributes.map(([key, value]) => `${key}="${value}"`).join(" ")}`)
  }
  if (framework?.props) {
    lines.push(
      "",
      `Props of ${code(framework.props.component)}:`,
      "",
      "```json",
      framework.props.json,
      "```"
    )
  }
  if (framework?.state) {
    const hooks = framework.framework === "react" && framework.state.json.startsWith("[")
    lines.push(
      "",
      `State of ${code(framework.state.component)}${hooks ? " (state hooks in call order)" : ""}:`,
      "",
      "```json",
      framework.state.json,
      "```"
    )
  }
  // The markup says all the outline does, and how it is written.
  if (element.html) lines.push("", "Markup (cleaned):", "", "```html", element.html, "```")
  else if (element.outline) lines.push("", "Structure:", "", "```text", element.outline, "```")
  return lines.join("\n")
}

/** Picks and the bug report together, or "" when there is neither. */
export function inspectionMarkdown({
  context = [],
  elements = [],
  reports = [],
}: {
  /** What frames the rest — the tech stack — first. */
  context?: readonly (string | null | undefined)[]
  elements?: readonly PickedElement[]
  /** Findings and reports, after the picks. */
  reports?: readonly (string | null | undefined)[]
}): string {
  const sections: string[] = []
  for (const text of context) if (text?.trim()) sections.push(text.trim())
  if (elements.length > 0) {
    sections.push(
      [
        `## Picked elements (${elements.length})`,
        "",
        "Elements the person picked on this page. Selectors match the live page; component names and source positions are what the page's development tooling reported.",
        "",
        elements.map((element, index) => elementMarkdown(element, index)).join("\n\n"),
      ].join("\n")
    )
  }
  for (const text of reports) if (text?.trim()) sections.push(text.trim())
  return sections.join("\n\n")
}

/**
 * Everything the panel would send, as one prompt for another tool — a coding
 * agent in the editor, an issue tracker. Local to the person's clipboard; the
 * Host is not involved.
 */
export function promptForClipboard(
  page: { title: string; url: string },
  instruction: string,
  inspection: string
): string {
  return [
    `# ${page.title || page.url}`,
    "",
    page.url,
    ...(instruction.trim() ? ["", instruction.trim()] : []),
    ...(inspection ? ["", inspection] : []),
  ].join("\n")
}

/**
 * Everything the panel would send, as a Markdown file for an issue tracker
 * or a pull request (Jam's share link, without a server): the prompt, when it
 * was written, and the attachments by name — they go along as files of their
 * own, not inside the text.
 */
export function exportMarkdown(
  page: { title: string; url: string },
  instruction: string,
  inspection: string,
  attachments: readonly string[],
  now: number
): string {
  const lines = [
    promptForClipboard(page, instruction, inspection),
    "",
    "---",
    "",
    `Exported from Cognia Browser Companion on ${new Date(now).toISOString().slice(0, 16).replace("T", " ")} UTC.`,
  ]
  if (attachments.length > 0)
    lines.push(
      "",
      `Attachments (${attachments.length}), not included in this file:`,
      "",
      ...attachments.map((name) => `- ${name}`)
    )
  return `${lines.join("\n")}\n`
}

/** `cognia-pricing-plans-2026-10-23.md`: the page's title, made a file name. */
export function exportFileName(title: string, now: number): string {
  const slug = title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "")
  return `cognia-${slug || "page"}-${new Date(now).toISOString().slice(0, 10)}.md`
}

/**
 * The page with the inspection after its selection, within the selection's
 * ceiling. The person's own selection keeps its place at the top; whatever
 * does not fit is cut from the end, and the cut is said.
 */
export function withInspection(
  page: CapturedPage,
  inspection: string,
  features: readonly BrowserCompanionFeature[],
  limits: Required<BrowserContextLimits>
): CapturedPage {
  if (!inspection) return page
  const markdown = features.includes("markdown-selection")
  const ownText = page.selection?.text ?? ""
  const ownMarkdown = page.selection?.markdown ?? ownText
  const join = (own: string) => (own ? `${own}\n\n${inspection}` : inspection)
  const text = clipToBytes(join(ownText), limits.selectionBytes)
  const rich = markdown ? clipToBytes(join(ownMarkdown), limits.selectionBytes) : null
  return {
    ...page,
    selection: {
      text: text.text,
      truncated: Boolean(page.selection?.truncated) || text.truncated,
      ...(rich ? { markdown: rich.text } : {}),
    },
  }
}
