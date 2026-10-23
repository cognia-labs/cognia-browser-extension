/**
 * The unsent draft (ADR-0228 §8).
 *
 * Closing the panel used to throw away a capture and a half-written
 * instruction. The draft keeps them in `chrome.storage.session` — memory only,
 * cleared when the browser exits, never written to the profile — so reopening
 * the panel picks up where the person left off. Attachments are not kept: they
 * run to megabytes, the session area is small, and a screenshot is a moment
 * that re-taking represents better than restoring. The draft says how many
 * there were, so the panel can say so.
 */
import type { DevReport } from "../inspect/dev-report"
import type { PickedElement } from "../inspect/element-context"
import { MAX_PICKS } from "../inspect/inspect-markdown"
import { NO_INSIGHTS, insightsForTab, parseInsights, type PageInsights } from "../inspect/insights"
import { MAX_MEASUREMENTS, parseMeasurement, type Measurement } from "../inspect/measure"
import { parseTextChanges, type TextChange } from "../inspect/text-edits"
import { sanitizeEdits } from "../inspect/style-edits"
import type { CapturedPage, CaptureScope } from "../panel-state"

export interface PanelDraft {
  v: 1
  captured: CapturedPage | null
  /** Other tabs added to the submission (ADR-0228 §2). */
  extraPages: CapturedPage[]
  scope: CaptureScope
  instruction: string
  workspaceId: string | null
  targetId: string | null
  targetParams: Record<string, string>
  includeFullUrl: boolean
  /** Attachments on screen when saved, which the draft does not carry. */
  droppedAttachments: number
  /** Elements picked on the captured page, with the person's notes and edits. */
  picks: PickedElement[]
  /** Distances measured on the captured page, with the person's notes. */
  measurements: Measurement[]
  /** Words the person edited on the captured page. */
  textChanges: { tabId: number; changes: TextChange[] } | null
  /** The console and network report, as the person left it. */
  devReport: DevReport | null
  /** Accessibility, design-token and stack checks run on the captured page. */
  insights: PageInsights
  savedAt: number
}

/** A draft older than this is a different afternoon's work; it is not restored. */
export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isText(value: unknown): value is { text: string; truncated: boolean } {
  return isRecord(value) && typeof value.text === "string" && typeof value.truncated === "boolean"
}

/** Whether a stored value is a page this build can show; anything else is dropped. */
export function isCapturedPage(value: unknown): value is CapturedPage {
  if (!isRecord(value)) return false
  return (
    typeof value.tabId === "number" &&
    typeof value.title === "string" &&
    typeof value.url === "string" &&
    typeof value.rawUrl === "string" &&
    typeof value.capturedAt === "number" &&
    typeof value.strippedQuery === "boolean" &&
    (value.selection === null || isText(value.selection)) &&
    (value.readableText === null || isText(value.readableText)) &&
    (value.article === undefined || value.article === null || isText(value.article))
  )
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string")
}

function isBox(value: unknown): boolean {
  return (
    isRecord(value) && ["x", "y", "width", "height"].every((key) => typeof value[key] === "number")
  )
}

/**
 * A stored pick this build can show, with its screenshots dropped — the draft
 * keeps no attachment — and its edits re-checked as if just typed.
 */
export function parsePick(value: unknown): PickedElement | null {
  if (!isRecord(value)) return null
  if (
    typeof value.elementId !== "string" ||
    typeof value.tabId !== "number" ||
    typeof value.pageUrl !== "string" ||
    typeof value.pickedAt !== "number" ||
    typeof value.selector !== "string" ||
    typeof value.tag !== "string" ||
    typeof value.label !== "string" ||
    typeof value.text !== "string" ||
    typeof value.note !== "string" ||
    typeof value.outline !== "string" ||
    !isBox(value.box) ||
    !isRecord(value.viewport) ||
    !isStringRecord(value.styles) ||
    !isStringRecord(value.attributes) ||
    !Array.isArray(value.sourceHints) ||
    !isRecord(value.edits) ||
    !isStringRecord(value.edits.styles)
  ) {
    return null
  }
  const edits = sanitizeEdits({
    styles: value.edits.styles,
    ...(typeof value.edits.text === "string" ? { text: value.edits.text } : {}),
  })
  const { html: _html, contrast: _contrast, ...rest } = value as unknown as PickedElement
  const contrast = value.contrast
  const keepContrast =
    isRecord(contrast) &&
    typeof contrast.ratio === "number" &&
    typeof contrast.foreground === "string" &&
    typeof contrast.background === "string" &&
    typeof contrast.aa === "boolean" &&
    typeof contrast.aaa === "boolean" &&
    typeof contrast.large === "boolean" &&
    (contrast.suggestion === undefined || typeof contrast.suggestion === "string")
  return {
    ...rest,
    ...(keepContrast
      ? { contrast: contrast as unknown as NonNullable<PickedElement["contrast"]> }
      : {}),
    ...(typeof value.html === "string" ? { html: value.html.slice(0, 4_000) } : {}),
    textEditable: value.textEditable === true,
    edits,
    screenshotIds: [],
  }
}

function parseReport(value: unknown): DevReport | null {
  if (!isRecord(value) || typeof value.text !== "string" || typeof value.tabId !== "number")
    return null
  const counts = isRecord(value.counts) ? value.counts : {}
  const count = (key: string) => (typeof counts[key] === "number" ? (counts[key] as number) : 0)
  return {
    tabId: value.tabId,
    capturedAt: typeof value.capturedAt === "number" ? value.capturedAt : 0,
    counts: {
      errors: count("errors"),
      warnings: count("warnings"),
      failedRequests: count("failedRequests"),
      steps: count("steps"),
    },
    text: value.text,
  }
}

export function parseDraft(value: unknown, now: number): PanelDraft | null {
  if (!isRecord(value) || value.v !== 1 || typeof value.savedAt !== "number") return null
  if (now - value.savedAt > DRAFT_TTL_MS || value.savedAt > now + 60_000) return null
  const captured =
    value.captured === null ? null : isCapturedPage(value.captured) ? value.captured : undefined
  if (captured === undefined) return null
  const scope: CaptureScope =
    value.scope === "page" || value.scope === "article" ? value.scope : "auto"
  const targetParams = isRecord(value.targetParams)
    ? Object.fromEntries(
        Object.entries(value.targetParams).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string"
        )
      )
    : {}
  return {
    v: 1,
    captured,
    extraPages: Array.isArray(value.extraPages) ? value.extraPages.filter(isCapturedPage) : [],
    scope,
    instruction: typeof value.instruction === "string" ? value.instruction : "",
    workspaceId: typeof value.workspaceId === "string" ? value.workspaceId : null,
    targetId: typeof value.targetId === "string" ? value.targetId : null,
    targetParams,
    includeFullUrl: value.includeFullUrl === true,
    droppedAttachments:
      typeof value.droppedAttachments === "number" && value.droppedAttachments > 0
        ? Math.floor(value.droppedAttachments)
        : 0,
    // Only picks of the page the draft captured: one of another page cannot be
    // sent with it.
    picks:
      captured && Array.isArray(value.picks)
        ? value.picks
            .map(parsePick)
            .filter((pick): pick is PickedElement => pick?.tabId === captured.tabId)
            .slice(0, MAX_PICKS)
        : [],
    measurements:
      captured && Array.isArray(value.measurements)
        ? value.measurements
            .map(parseMeasurement)
            .filter(
              (measurement): measurement is Measurement => measurement?.tabId === captured.tabId
            )
            .slice(0, MAX_MEASUREMENTS)
        : [],
    textChanges: (() => {
      const stored = isRecord(value.textChanges) ? value.textChanges : null
      if (!captured || stored?.tabId !== captured.tabId) return null
      const changes = parseTextChanges(stored.changes)
      return changes.length > 0 ? { tabId: captured.tabId, changes } : null
    })(),
    devReport: captured ? parseReport(value.devReport) : null,
    insights: captured
      ? insightsForTab(parseInsights(value.insights), captured.tabId)
      : NO_INSIGHTS,
    savedAt: value.savedAt,
  }
}

/** Nothing worth keeping: no capture, no other page, no words. */
export function isEmptyDraft(
  draft: Pick<PanelDraft, "captured" | "extraPages" | "instruction">
): boolean {
  return draft.captured === null && draft.extraPages.length === 0 && draft.instruction.trim() === ""
}
