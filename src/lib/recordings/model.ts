/**
 * Recorded steps, the raw material of an end-to-end test (ADR-0242,
 * `recording-v1`).
 *
 * Unlike the steps of a bug report (`interaction-recorder.ts`), a recording
 * keeps what was typed: a test has to type it again. It never keeps the value
 * of a secret field — a password, a one-time code, a card number — which a
 * test reads from its environment instead. Everything in a recording comes
 * from the page, so whoever reads it (a person, or an agent writing the test)
 * treats it as data.
 *
 * The worker is the only writer. Recordings live in `chrome.storage.local`,
 * the person's own and an agent's alike, newest first.
 */

export const STEP_ACTIONS = [
  "navigate",
  "click",
  "double_click",
  "hover",
  "fill",
  "select",
  "press_key",
  "scroll",
  "assert",
] as const
export type StepAction = (typeof STEP_ACTIONS)[number]

export const ASSERTION_KINDS = ["visible", "text", "value", "count", "url"] as const
export type AssertionKind = (typeof ASSERTION_KINDS)[number]

export interface RecordedStep {
  action: StepAction
  /** Locators best first, as Playwright expressions: `getByRole("button", { name: "Save" })`. */
  target?: { locators: string[]; role?: string; name?: string }
  /** Typed text, a chosen option, a key chord, `checked`/`unchecked`. Never for a secret. */
  value?: string
  /** A secret field: what was typed is not here. */
  secret?: boolean
  url?: string
  assertion?: { kind: AssertionKind; expected?: string | number }
  at: number
}

export interface Recording {
  id: string
  title: string
  url: string
  startedAt: number
  stoppedAt?: number
  /** Recorded in an agent's tab rather than by the person. */
  byAgent: boolean
  /** The conversation that recorded it, for an agent's. */
  sessionId?: string
  /** Whether agents may read it: the person's choice for their own. */
  shared: boolean
  steps: RecordedStep[]
}

export interface RecordingSummary {
  id: string
  title: string
  url: string
  startedAt: number
  stoppedAt?: number
  stepCount: number
  byAgent: boolean
  shared: boolean
}

export const RECORDINGS_KEY = "cognia.recordings.v1"
/** Which tab is recording into which recording: memory only, like the conversations. */
export const ACTIVE_RECORDINGS_KEY = "cognia.recordings.active.v1"

export const MAX_RECORDINGS = 30
export const MAX_STEPS = 500
const MAX_VALUE = 2_000
const MAX_LOCATORS = 5

/** A JSON string literal, as the recorder writes every argument. */
const STRING = String.raw`"(?:[^"\\]|\\.)*"`
const LOCATOR = new RegExp(
  String.raw`^(?:getByTestId|getByLabel|getByPlaceholder|getByText|locator)\(${STRING}\)$|` +
    String.raw`^getByRole\("[a-z]+"(?:, \{ name: ${STRING}(?:, exact: true)? \})?\)$`
)

/**
 * Whether a locator is one the recorder builds. They become code in a
 * generated test, so nothing else — however it got into storage — is kept.
 */
export function isLocator(value: string): boolean {
  if (!LOCATOR.test(value)) return false
  // Every quoted argument must be a real JSON string, not just look like one.
  for (const match of value.matchAll(new RegExp(STRING, "g"))) {
    try {
      JSON.parse(match[0])
    } catch {
      return false
    }
  }
  return true
}

function text(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.length > 0 ? value.slice(0, max) : undefined
}

/** A step as the recorder sent it or storage kept it; null if it is not one. */
export function cleanStep(input: unknown): RecordedStep | null {
  if (!input || typeof input !== "object") return null
  const record = input as Record<string, unknown>
  const action = record.action as StepAction
  if (!(STEP_ACTIONS as readonly unknown[]).includes(action)) return null
  const at = Number(record.at)
  const rawTarget = record.target as Record<string, unknown> | undefined
  const locators = Array.isArray(rawTarget?.locators)
    ? rawTarget.locators
        .filter(
          (locator): locator is string =>
            typeof locator === "string" && locator.length <= 500 && isLocator(locator)
        )
        .slice(0, MAX_LOCATORS)
    : []
  const needsTarget = action !== "navigate" && action !== "scroll" && action !== "press_key"
  const assertion = record.assertion as Record<string, unknown> | undefined
  const kind = assertion?.kind as AssertionKind
  if (action === "assert" && !(ASSERTION_KINDS as readonly unknown[]).includes(kind)) return null
  if (needsTarget && locators.length === 0 && !(action === "assert" && kind === "url")) return null
  const secret = record.secret === true
  const url = text(record.url, MAX_VALUE)
  if (action === "navigate" && !url) return null
  const expected = assertion?.expected
  return {
    action,
    ...(locators.length > 0
      ? {
          target: {
            locators,
            ...(text(rawTarget?.role, 40) ? { role: text(rawTarget?.role, 40) } : {}),
            ...(text(rawTarget?.name, 200) ? { name: text(rawTarget?.name, 200) } : {}),
          },
        }
      : {}),
    ...(!secret && text(record.value, MAX_VALUE) !== undefined
      ? { value: text(record.value, MAX_VALUE) }
      : {}),
    ...(secret ? { secret: true } : {}),
    ...(url ? { url } : {}),
    ...(action === "assert"
      ? {
          assertion: {
            kind,
            ...(typeof expected === "number" && Number.isFinite(expected)
              ? { expected }
              : typeof expected === "string"
                ? { expected: expected.slice(0, MAX_VALUE) }
                : {}),
          },
        }
      : {}),
    at: Number.isFinite(at) ? at : 0,
  }
}

function cleanRecording(input: unknown): Recording | null {
  if (!input || typeof input !== "object") return null
  const record = input as Record<string, unknown>
  if (typeof record.id !== "string" || !record.id) return null
  const steps = (Array.isArray(record.steps) ? record.steps : [])
    .map(cleanStep)
    .filter((step): step is RecordedStep => step !== null)
    .slice(0, MAX_STEPS)
  const stoppedAt = Number(record.stoppedAt)
  return {
    id: record.id.slice(0, 64),
    title: text(record.title, 200) ?? "",
    url: text(record.url, MAX_VALUE) ?? "",
    startedAt: Number(record.startedAt) || 0,
    ...(Number.isFinite(stoppedAt) && stoppedAt > 0 ? { stoppedAt } : {}),
    byAgent: record.byAgent === true,
    ...(typeof record.sessionId === "string" ? { sessionId: record.sessionId } : {}),
    shared: record.shared !== false,
    steps,
  }
}

export function parseRecordings(value: unknown): Recording[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const recordings: Recording[] = []
  for (const entry of value) {
    const recording = cleanRecording(entry)
    if (!recording || seen.has(recording.id)) continue
    seen.add(recording.id)
    recordings.push(recording)
    if (recordings.length === MAX_RECORDINGS) break
  }
  return recordings
}

export function summaryOf(recording: Recording): RecordingSummary {
  return {
    id: recording.id,
    title: recording.title,
    url: recording.url,
    startedAt: recording.startedAt,
    ...(recording.stoppedAt ? { stoppedAt: recording.stoppedAt } : {}),
    stepCount: recording.steps.length,
    byAgent: recording.byAgent,
    shared: recording.shared,
  }
}

/**
 * Append a step, folding what a person does into what a test means: typing
 * into the same field again replaces the earlier fill, and a second click on
 * the same element right after the first is a double click.
 */
export function appendStep(steps: readonly RecordedStep[], step: RecordedStep): RecordedStep[] {
  const last = steps.at(-1)
  const same = (a?: RecordedStep["target"], b?: RecordedStep["target"]) =>
    !!a && !!b && a.locators[0] === b.locators[0]
  if (last && step.action === "fill" && last.action === "fill" && same(last.target, step.target))
    return [...steps.slice(0, -1), step]
  if (
    last &&
    step.action === "double_click" &&
    last.action === "click" &&
    same(last.target, step.target)
  ) {
    const before = steps.at(-2)
    const drop = before && before.action === "click" && same(before.target, step.target) ? 2 : 1
    return [...steps.slice(0, -drop), step]
  }
  // The load a click caused is not a step of its own: it is checked, not done.
  if (step.action === "navigate" && steps.length > 0) {
    // The same address again (a reload, or the recorder put back) says nothing new.
    const known = [...steps]
      .reverse()
      .find((entry) => entry.url !== undefined || entry.assertion?.kind === "url")
    const previous = known?.url ?? known?.assertion?.expected
    if (previous === step.url) return [...steps]
    const check: RecordedStep = {
      action: "assert",
      assertion: { kind: "url", ...(step.url ? { expected: step.url } : {}) },
      at: step.at,
    }
    return [...steps, check].slice(0, MAX_STEPS)
  }
  return [...steps, step].slice(0, MAX_STEPS)
}

/** A JavaScript string literal: what a page wrote never escapes into code. */
const literal = (value: string) => JSON.stringify(value)

/** `E2E_PASSWORD`, from what the field is called. */
export function secretName(step: RecordedStep, index: number): string {
  const from = (step.target?.name ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, "_")
  const name = from.replace(/^_+|_+$/g, "").slice(0, 40)
  return `E2E_${name || `SECRET_${index + 1}`}`
}

function locatorCode(step: RecordedStep): string {
  const best = step.target?.locators[0] ?? "locator('body')"
  return `page.${best}`
}

const KEYS: Record<string, string> = { " ": "Space" }

/**
 * A Playwright test from a recording, to refine rather than to run unread:
 * it follows the best locator each step had, and says where a secret comes
 * from. Locators are built by the recorder from a fixed vocabulary; every
 * value the page or the person supplied is a quoted literal.
 */
export function toPlaywright(recording: Recording): string {
  const lines: string[] = []
  const secrets = new Map<number, string>()
  recording.steps.forEach((step, index) => {
    if (step.secret) secrets.set(index, secretName(step, index))
  })
  let opened = false
  for (const [index, step] of recording.steps.entries()) {
    const at = locatorCode(step)
    switch (step.action) {
      case "navigate":
        lines.push(`  await page.goto(${literal(step.url ?? recording.url)})`)
        opened = true
        break
      case "click":
        if (step.value === "checked") lines.push(`  await ${at}.check()`)
        else if (step.value === "unchecked") lines.push(`  await ${at}.uncheck()`)
        else lines.push(`  await ${at}.click()`)
        break
      case "double_click":
        lines.push(`  await ${at}.dblclick()`)
        break
      case "hover":
        lines.push(`  await ${at}.hover()`)
        break
      case "fill":
        lines.push(
          step.secret
            ? `  await ${at}.fill(process.env.${secrets.get(index)} ?? "")`
            : `  await ${at}.fill(${literal(step.value ?? "")})`
        )
        break
      case "select":
        lines.push(`  await ${at}.selectOption(${literal(step.value ?? "")})`)
        break
      case "press_key": {
        const key = KEYS[step.value ?? ""] ?? step.value ?? "Enter"
        lines.push(
          step.target
            ? `  await ${at}.press(${literal(key)})`
            : `  await page.keyboard.press(${literal(key)})`
        )
        break
      }
      case "scroll":
        lines.push(`  await page.mouse.wheel(0, ${Number(step.value) || 0})`)
        break
      case "assert": {
        const expected = step.assertion?.expected
        switch (step.assertion?.kind) {
          case "url":
            lines.push(`  await expect(page).toHaveURL(${literal(String(expected ?? ""))})`)
            break
          case "text":
            lines.push(`  await expect(${at}).toContainText(${literal(String(expected ?? ""))})`)
            break
          case "value":
            lines.push(`  await expect(${at}).toHaveValue(${literal(String(expected ?? ""))})`)
            break
          case "count":
            lines.push(`  await expect(${at}).toHaveCount(${Number(expected) || 0})`)
            break
          default:
            lines.push(`  await expect(${at}).toBeVisible()`)
        }
        break
      }
    }
  }
  if (!opened && recording.url) lines.unshift(`  await page.goto(${literal(recording.url)})`)
  const header = [
    'import { expect, test } from "@playwright/test"',
    "",
    ...(secrets.size > 0
      ? [
          `// Set ${[...new Set(secrets.values())].join(", ")} before running: secrets are never recorded.`,
        ]
      : []),
    `test(${literal(recording.title || "recorded flow")}, async ({ page }) => {`,
  ]
  return [...header, ...lines, "})", ""].join("\n")
}
