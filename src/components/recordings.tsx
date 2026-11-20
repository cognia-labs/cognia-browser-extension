import { useEffect, useState } from "react"
import { Badge, Button, cn } from "@cognia/plugin-ui"
import { CircleIcon, DownloadIcon, SquareIcon, XIcon } from "lucide-react"

import { AGENT_SESSIONS_KEY, parseStoredSessions } from "@ext/src/lib/agent/sessions"
import type { BrowserApi, TabRef } from "@ext/src/lib/browser-api"
import { useStoredValue } from "@ext/src/lib/panel/use-stored-value"
import { ToolSection } from "@ext/src/components/panel-section"
import {
  ACTIVE_RECORDINGS_KEY,
  RECORDINGS_KEY,
  parseRecordings,
  secretName,
  toPlaywright,
  type RecordedStep,
  type Recording,
} from "@ext/src/lib/recordings/model"
import type { RecordingCommand } from "@ext/src/lib/recordings/controller"

/** The file name a generated test is saved under: the title, made safe. */
export function testFileName(recording: Pick<Recording, "title">): string {
  const base =
    recording.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "recorded-flow"
  return `${base}.spec.ts`
}

/** The pattern for this page's site and scheme: what re-injecting on every load needs. */
function siteOf(url: string): string | null {
  try {
    const parsed = new URL(url)
    return /^https?:$/.test(parsed.protocol) ? `${parsed.protocol}//${parsed.hostname}/*` : null
  } catch {
    return null
  }
}

/** A step's verb, in the person's language. */
function stepVerb(step: RecordedStep, message: BrowserApi["message"]): string {
  switch (step.action) {
    case "navigate":
      return message("recordingsStepNavigate")
    case "click":
      return message("recordingsStepClick")
    case "double_click":
      return message("recordingsStepDoubleClick")
    case "hover":
      return message("recordingsStepHover")
    case "fill":
      return message("recordingsStepFill")
    case "select":
      return message("recordingsStepSelect")
    case "press_key":
      return message("recordingsStepPressKey")
    case "scroll":
      return message("recordingsStepScroll")
    case "assert":
      return step.assertion?.kind === "url"
        ? message("recordingsStepUrl")
        : message("recordingsStepAssert")
  }
}

/**
 * What one step will do and with what, as the test and an agent would read
 * it: the element by its name or best locator, the address, the value — a
 * secret by the variable it is read from, never anything typed.
 */
function StepLine({
  step,
  index,
  message,
}: {
  step: RecordedStep
  index: number
  message: BrowserApi["message"]
}) {
  const expected =
    step.assertion?.expected === undefined ? undefined : String(step.assertion.expected)
  const checksUrl = step.assertion?.kind === "url"
  const what =
    step.url ?? step.target?.name ?? step.target?.locators[0] ?? (checksUrl ? expected : "") ?? ""
  const value = step.secret
    ? message("recordingsStepSecret", [secretName(step, index)])
    : step.action === "assert"
      ? checksUrl
        ? undefined
        : expected
      : step.value
  return (
    <li className="flex min-w-0 gap-1 text-[10px]" data-testid="recordings-step">
      <span className="shrink-0 text-muted-foreground">{index + 1}.</span>
      <span className="shrink-0 font-medium">{stepVerb(step, message)}</span>
      <span className="min-w-0 truncate font-mono" title={what}>
        {what}
      </span>
      {value ? (
        <span
          className={cn("min-w-0 truncate", step.secret ? "italic text-muted-foreground" : "")}
          title={value}
        >
          {step.secret ? value : `“${value}”`}
        </span>
      ) : null}
    </li>
  )
}

/**
 * Recordings for end-to-end tests (ADR-0242, `recording-v1`): record what
 * you do in a tab, steps and all — typed text too, never a secret field's —
 * then download the Playwright test made from it, or let an agent in a
 * Cognia conversation read it and write the test with you.
 *
 * A recording of the person's is private until they share it, and they can
 * share it only once it has stopped: the steps are listed here first, so
 * what an agent would read is something they have been able to look at.
 */
/** Who may read a recording, as the panel's choice names it. */
export function shareChoice(recording: Pick<Recording, "shared" | "sharedWith">): string {
  if (!recording.shared) return "private"
  if (!recording.sharedWith) return "all"
  return recording.sharedWith.length === 1 ? `session:${recording.sharedWith[0]}` : "some"
}

export function Recordings({
  api,
  currentTab,
  conversationTitles = {},
  now = () => Date.now(),
}: {
  api: BrowserApi
  currentTab: Pick<TabRef, "id" | "url"> | null
  /** Cognia conversations by id, as the recent list names them. */
  conversationTitles?: Record<string, string>
  now?: () => number
}) {
  const message = api.message
  // The conversations a recording can be shared with: those acting in this
  // browser and those the recent list names.
  const sessions = useStoredValue(api, "session", AGENT_SESSIONS_KEY, parseStoredSessions)
  const known = [...new Set([...Object.keys(sessions), ...Object.keys(conversationTitles)])]
  const conversationLabel = (id: string) =>
    conversationTitles[id] ?? message("recordingsShareConversation", [id.slice(0, 8)])
  const [recordings, setRecordings] = useState<Recording[]>([])
  const [active, setActive] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [reviewing, setReviewing] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void api.read(RECORDINGS_KEY).then((value) => live && setRecordings(parseRecordings(value)))
    void api
      .readSession<Record<string, string>>(ACTIVE_RECORDINGS_KEY)
      .then((value) => live && setActive(value ?? {}))
    const stops = [
      api.onStorageChange(RECORDINGS_KEY, (value) => setRecordings(parseRecordings(value))),
      api.onSessionChange(ACTIVE_RECORDINGS_KEY, (value) =>
        setActive((value as Record<string, string> | null) ?? {})
      ),
    ]
    return () => {
      live = false
      for (const stop of stops) stop()
    }
  }, [api])

  const run = async (command: RecordingCommand) => {
    setBusy(true)
    setNotice(null)
    try {
      await api.recordingCommand(command)
    } catch {
      setNotice(message("recordingsFailed"))
    } finally {
      setBusy(false)
    }
  }

  const recordingIds = new Set(Object.values(active))
  const here = currentTab ? active[String(currentTab.id)] : undefined
  const site = currentTab ? siteOf(currentTab.url) : null

  const start = async () => {
    if (!currentTab || !site) return
    // In the click: the recorder goes back in on every load of this site.
    if (!(await api.requestPermissions({ origins: [site] }))) {
      setNotice(message("recordingsNeedSite"))
      return
    }
    await run({ op: "start", tabId: currentTab.id })
  }

  const download = (recording: Recording) => {
    const blob = new Blob([toPlaywright(recording)], { type: "text/typescript" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = testFileName(recording)
    link.click()
    URL.revokeObjectURL(url)
  }

  const date = (at: number) => {
    const day = new Date(at)
    return now() - at < 86_400_000 ? day.toLocaleTimeString() : day.toLocaleDateString()
  }

  return (
    <ToolSection
      testId="recordings"
      title={message("recordingsTitle")}
      hint={message("recordingsHint")}
      active={recordingIds.size > 0}
    >
      <div className="space-y-1.5 rounded-lg border border-border bg-muted/30 p-2">
        {here ? (
          <Button
            size="sm"
            variant="destructive"
            className="h-7 w-full gap-1.5 text-[11px]"
            disabled={busy}
            onClick={() => void run({ op: "stop", recordingId: here })}
            data-testid="recordings-stop"
          >
            <SquareIcon className="size-3" aria-hidden="true" />
            {message("recordingsStop")}
          </Button>
        ) : (
          <Button
            size="sm"
            className="h-7 w-full gap-1.5 text-[11px]"
            disabled={busy || !site}
            onClick={() => void start()}
            data-testid="recordings-start"
          >
            <CircleIcon className="size-3 fill-current" aria-hidden="true" />
            {message("recordingsStart")}
          </Button>
        )}
        <p className="text-[10px] text-muted-foreground">
          {site ? message("recordingsPrivacy") : message("recordingsNoPage")}
        </p>
      </div>

      {recordings.length > 0 ? (
        <ul className="space-y-1" data-testid="recordings-list">
          {recordings.map((recording) => {
            const live = recordingIds.has(recording.id)
            return (
              <li
                key={recording.id}
                className="space-y-1 rounded-lg border border-border bg-card p-1.5"
                data-testid="recordings-item"
              >
                <div className="flex items-start gap-1.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11px] font-medium" title={recording.url}>
                      {recording.title || recording.url}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {message("recordingsSteps", [String(recording.steps.length)])}
                      {" · "}
                      {date(recording.startedAt)}
                    </p>
                  </div>
                  {live ? (
                    <Badge variant="destructive" className="shrink-0 text-[9px]">
                      {message("recordingsLive")}
                    </Badge>
                  ) : null}
                  {recording.byAgent ? (
                    <Badge variant="outline" className="shrink-0 text-[9px]">
                      {message("recordingsByAgent")}
                    </Badge>
                  ) : null}
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className="shrink-0 text-muted-foreground"
                    disabled={recording.steps.length === 0}
                    onClick={() => download(recording)}
                    aria-label={message("recordingsDownload")}
                    title={message("recordingsDownload")}
                    data-testid="recordings-download"
                  >
                    <DownloadIcon aria-hidden="true" />
                  </Button>
                  {live ? (
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      className="shrink-0 text-muted-foreground"
                      disabled={busy}
                      onClick={() => void run({ op: "stop", recordingId: recording.id })}
                      aria-label={message("recordingsStop")}
                    >
                      <SquareIcon aria-hidden="true" />
                    </Button>
                  ) : (
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                      disabled={busy}
                      onClick={() => void run({ op: "remove", recordingId: recording.id })}
                      aria-label={message("recordingsRemove")}
                      data-testid="recordings-remove"
                    >
                      <XIcon aria-hidden="true" />
                    </Button>
                  )}
                </div>
                {recording.steps.length > 0 ? (
                  <button
                    type="button"
                    className="text-[10px] text-muted-foreground underline-offset-2 hover:underline"
                    aria-expanded={reviewing === recording.id}
                    onClick={() =>
                      setReviewing((current) => (current === recording.id ? null : recording.id))
                    }
                    data-testid="recordings-review"
                  >
                    {reviewing === recording.id
                      ? message("recordingsReviewHide")
                      : message("recordingsReview")}
                  </button>
                ) : null}
                {reviewing === recording.id ? (
                  <ol
                    className="max-h-48 space-y-0.5 overflow-y-auto rounded border border-border bg-muted/30 p-1.5"
                    data-testid="recordings-steps"
                  >
                    {recording.steps.map((step, index) => (
                      <StepLine key={index} step={step} index={index} message={message} />
                    ))}
                  </ol>
                ) : null}
                <label
                  className={cn(
                    "flex items-center justify-between gap-2 text-[10px] text-muted-foreground"
                  )}
                >
                  <span className="shrink-0">
                    {live ? message("recordingsShareAfterStop") : message("recordingsShared")}
                  </span>
                  <select
                    className="h-6 min-w-0 max-w-[60%] truncate rounded-control border border-border bg-background px-1 text-[10px] text-foreground disabled:opacity-50"
                    value={shareChoice(recording)}
                    // Shared once it has stopped, when every step can be read first.
                    disabled={busy || live}
                    onChange={(event) => {
                      const choice = event.target.value
                      if (choice === "some") return
                      void run({
                        op: "share",
                        recordingId: recording.id,
                        shared: choice !== "private",
                        ...(choice.startsWith("session:")
                          ? { sessions: [choice.slice("session:".length)] }
                          : {}),
                      })
                    }}
                    data-testid="recordings-shared"
                  >
                    <option value="private">{message("recordingsSharePrivate")}</option>
                    {[
                      ...new Set([
                        ...(recording.sessionId ? [recording.sessionId] : []),
                        ...(recording.sharedWith ?? []),
                        ...known,
                      ]),
                    ].map((id) => (
                      <option key={id} value={`session:${id}`}>
                        {conversationLabel(id)}
                      </option>
                    ))}
                    {recording.sharedWith && recording.sharedWith.length > 1 ? (
                      <option value="some">
                        {message("recordingsShareSome", [String(recording.sharedWith.length)])}
                      </option>
                    ) : null}
                    <option value="all">{message("recordingsShareAll")}</option>
                  </select>
                </label>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-[11px] text-muted-foreground" data-testid="recordings-empty">
          {message("recordingsEmpty")}
        </p>
      )}
      {notice ? (
        <p className="text-[11px] text-warning" role="status" data-testid="recordings-notice">
          {notice}
        </p>
      ) : null}
    </ToolSection>
  )
}
