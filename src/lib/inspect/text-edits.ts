/**
 * Edit the page's words where they are (Design Mode), and read back what
 * changed as before → after, for the agent to make in the source.
 *
 * The page goes into `document.designMode`, so every word can be clicked and
 * typed over the way the person would in a document. Before that, the text
 * is noted per unit — the paragraph, heading, list item, button or link it
 * sits in — and the changes are read by comparing each unit's text then and
 * now. A unit inside another that also changed is reported once, at the
 * innermost unit, so a fixed word in a link is not also a change to its
 * paragraph.
 *
 * Undoing is the browser's own: the editing undo stack, unwound while the
 * page is still editable. Form fields and our own overlay are never units.
 */
import { elementLabel, uniqueSelector } from "./element-context"

export interface TextChange {
  /** Where the unit is now; absent for one the person deleted. */
  selector?: string
  label: string
  before: string
  after: string
}

export interface TextEditSession {
  /** What changed so far. */
  changes(): TextChange[]
  /** Leave editing; `keep` false unwinds every edit first. */
  stop(keep: boolean): TextChange[]
}

/** Elements a sentence lives in, whose text is reported as one. */
const UNIT_SELECTOR =
  "p, h1, h2, h3, h4, h5, h6, li, td, th, dt, dd, blockquote, figcaption, caption, label, button, a, summary, legend"
const SKIPPED = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "TEXTAREA", "SELECT", "OPTION"])
export const MAX_TEXT_CHANGES = 30
const MAX_CHANGE_TEXT = 300
const MAX_UNDO = 1_000

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function clip(value: string): string {
  return value.length > MAX_CHANGE_TEXT ? `${value.slice(0, MAX_CHANGE_TEXT - 1)}…` : value
}

function unitOf(node: Node, body: HTMLElement): Element | null {
  const parent = node.parentElement
  if (!parent) return null
  if (parent.closest("[data-cognia-chrome]")) return null
  for (
    let element: Element | null = parent;
    element && element !== body;
    element = element.parentElement
  )
    if (SKIPPED.has(element.tagName)) return null
  return parent.closest(UNIT_SELECTOR) ?? parent
}

/** Every unit holding visible-looking text, with its text now. */
function units(doc: Document): Map<Element, string> {
  const found = new Map<Element, string>()
  const body = doc.body
  if (!body) return found
  const walker = doc.createTreeWalker(body, 4 /* NodeFilter.SHOW_TEXT */)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!collapse(node.nodeValue ?? "")) continue
    const unit = unitOf(node, body)
    if (unit && !found.has(unit)) found.set(unit, collapse(unit.textContent ?? ""))
  }
  return found
}

export function startTextEditing(doc: Document): TextEditSession {
  const before = units(doc)
  const labels = new Map([...before.keys()].map((unit) => [unit, elementLabel(unit)]))
  doc.designMode = "on"
  let open = true

  const changes = (): TextChange[] => {
    const now = units(doc)
    const changed: { unit: Element; change: TextChange }[] = []
    for (const [unit, text] of before) {
      const current = unit.isConnected ? collapse(unit.textContent ?? "") : ""
      if (current === text) continue
      changed.push({
        unit,
        change: {
          ...(unit.isConnected ? { selector: uniqueSelector(unit) } : {}),
          label: labels.get(unit) ?? elementLabel(unit),
          before: clip(text),
          after: clip(current),
        },
      })
    }
    for (const [unit, text] of now) {
      if (before.has(unit)) continue
      changed.push({
        unit,
        change: {
          selector: uniqueSelector(unit),
          label: elementLabel(unit),
          before: "",
          after: clip(text),
        },
      })
    }
    // A unit whose change is only that of units inside it is not a change of
    // its own: with their edits put into its old text, it reads as it does now.
    const own = changed.filter(({ unit, change }) => {
      if (!unit.isConnected) return true
      const inner = changed.filter((other) => other.unit !== unit && unit.contains(other.unit))
      if (inner.length === 0) return true
      let explained = before.get(unit) ?? ""
      for (const { change: part } of inner)
        explained = part.before ? explained.replace(part.before, part.after) : explained
      return collapse(explained) !== change.after
    })
    return own.slice(0, MAX_TEXT_CHANGES).map(({ change }) => change)
  }

  return {
    changes,
    stop(keep) {
      if (!open) return keep ? changes() : []
      const result = keep ? changes() : []
      if (!keep) {
        try {
          for (let step = 0; step < MAX_UNDO && doc.execCommand("undo"); step++);
        } catch {
          // No editing undo in this browser: the words stay as typed.
        }
      }
      doc.designMode = "off"
      open = false
      return result
    },
  }
}

export function textChangesMarkdown(changes: readonly TextChange[]): string {
  if (changes.length === 0) return ""
  const lines = [
    `## Text changes (${changes.length})`,
    "",
    "Copy the person edited on the page itself. Make the same changes in the source; selectors match the page as edited.",
  ]
  changes.forEach((change, index) => {
    const where = change.selector ? `\`${change.selector}\`` : `\`${change.label}\` (deleted)`
    lines.push(
      "",
      `${index + 1}. ${where}`,
      `   - Before: ${change.before ? `"${change.before}"` : "(new text)"}`,
      `   - After: ${change.after ? `"${change.after}"` : "(removed)"}`
    )
  })
  return lines.join("\n")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Stored text changes this build can show, from an unsent draft. */
export function parseTextChanges(value: unknown): TextChange[] {
  if (!Array.isArray(value)) return []
  return value
    .filter(
      (item): item is TextChange =>
        isRecord(item) &&
        typeof item.label === "string" &&
        typeof item.before === "string" &&
        typeof item.after === "string" &&
        (item.selector === undefined || typeof item.selector === "string")
    )
    .slice(0, MAX_TEXT_CHANGES)
    .map((item) => ({
      ...(item.selector !== undefined ? { selector: item.selector } : {}),
      label: item.label,
      before: clip(item.before),
      after: clip(item.after),
    }))
}
