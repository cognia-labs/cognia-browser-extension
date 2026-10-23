/**
 * What went wrong on the page, for a bug report (Jam).
 *
 * The console and the page's own requests are only visible from its main
 * world, and only from the moment something is listening: the panel's
 * recorder installs the agent's page hooks (`page-hooks.ts`) without their
 * dialog handling, the person reproduces the problem, and this reads what the
 * hooks heard. Requests that failed before recording started still show in
 * the browser's Resource Timing, which every page keeps from its load, so
 * those are read too.
 *
 * The report is text the person reviews and can trim before it is sent, and
 * addresses lose their query strings the way the page's own address does:
 * an API call's query is where a token lives.
 */
import type { ConsoleLine, NetworkLine } from "../agent/page-hooks"
import { normalizeCaptureUrl } from "../capture/normalize-url"
import { stepText, type ReproStep } from "./interaction-recorder"

export interface ResourceFailure {
  url: string
  status: number
  initiator: string
  durationMs: number
}

export interface DevSnapshot {
  /** Whether the hooks are listening in this document. */
  recording: boolean
  console: ConsoleLine[]
  network: (NetworkLine & { ts?: number })[]
  resources: ResourceFailure[]
  /** What the person did while recording; absent from a page recorded before steps were. */
  steps?: ReproStep[]
  environment: {
    userAgent: string
    language: string
    viewport: { width: number; height: number; dpr: number }
    readyState: string
  }
}

/** Runs in the page's MAIN world; serialized by `chrome.scripting`. */
export function mainDevSnapshot(): DevSnapshot {
  const world = window as unknown as {
    __cogniaPageHooks?: { peekConsole?: () => unknown[]; peekNetwork?: () => unknown[] }
    __cogniaSteps?: { peek?: () => unknown[] }
  }
  const hooks = world.__cogniaPageHooks
  const absolute = (value: string) => {
    try {
      return new URL(value, location.href).href
    } catch {
      return value
    }
  }
  const resources: ResourceFailure[] = []
  try {
    for (const entry of performance.getEntriesByType("resource") as (PerformanceResourceTiming & {
      responseStatus?: number
    })[]) {
      const status = entry.responseStatus ?? 0
      if (status >= 400 && resources.length < 100) {
        resources.push({
          url: entry.name,
          status,
          initiator: entry.initiatorType,
          durationMs: Math.round(entry.duration),
        })
      }
    }
  } catch {
    // A page that replaced `performance` keeps its secrets.
  }
  const network = (hooks?.peekNetwork?.() ?? []) as (NetworkLine & { ts?: number })[]
  return {
    recording: typeof hooks?.peekConsole === "function",
    console: (hooks?.peekConsole?.() ?? []) as ConsoleLine[],
    network: network.map((line) => ({ ...line, url: absolute(line.url) })),
    resources,
    steps: (world.__cogniaSteps?.peek?.() ?? []) as ReproStep[],
    environment: {
      userAgent: navigator.userAgent,
      language: navigator.language,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        dpr: window.devicePixelRatio || 1,
      },
      readyState: document.readyState,
    },
  }
}

/** Main-world: whether the hooks are installed, without installing them. */
export function mainDevRecording(): boolean {
  return Boolean((window as unknown as { __cogniaPageHooks?: unknown }).__cogniaPageHooks)
}

export interface DevReport {
  /** The tab it was read from, so a recapture of another page drops it. */
  tabId: number
  capturedAt: number
  counts: { errors: number; warnings: number; failedRequests: number; steps: number }
  /** The report as it will be sent; the person may edit it. */
  text: string
}

const MAX_STEPS = 60
const MAX_CONSOLE = 40
const MAX_REQUESTS = 40
const MAX_LINE = 400

function clip(value: string, max = MAX_LINE): string {
  const single = value.replace(/\s+/g, " ").trim()
  return single.length > max ? `${single.slice(0, max - 1)}…` : single
}

/** An address as the report shows it: no credentials, no query unless asked. */
export function reportUrl(raw: string, includeFullUrl: boolean): string {
  const decision = normalizeCaptureUrl(raw, includeFullUrl)
  return decision.ok ? decision.url : clip(raw, 200)
}

function time(ts: number): string {
  return new Date(ts).toISOString().slice(11, 23)
}

/** The snapshot as a Markdown report, failures first and noise left out. */
export function buildDevReport(
  snapshot: DevSnapshot,
  options: { tabId: number; now: number; includeFullUrl: boolean; recordingSince: number | null }
): DevReport {
  // A restarted recording starts over: the hooks keep one buffer per document.
  const since = snapshot.recording ? options.recordingSince : null
  const recent = <T extends { ts?: number }>(line: T) =>
    since === null || line.ts === undefined || line.ts >= since
  const problems = snapshot.console.filter(
    (line) => (line.level === "error" || line.level === "warn") && recent(line)
  )
  const errors = problems.filter((line) => line.level === "error").length
  const failed = new Map<
    string,
    { method: string; url: string; status: number; durationMs: number | null }
  >()
  for (const line of snapshot.network) {
    if (line.ok || !recent(line)) continue
    const url = reportUrl(line.url, options.includeFullUrl)
    failed.set(`${line.method} ${url} ${line.status}`, {
      method: line.method,
      url,
      status: line.status,
      durationMs: line.durationMs,
    })
  }
  for (const entry of snapshot.resources) {
    const url = reportUrl(entry.url, options.includeFullUrl)
    const key = `GET ${url} ${entry.status}`
    if (!failed.has(key))
      failed.set(key, { method: "GET", url, status: entry.status, durationMs: entry.durationMs })
  }
  const requests = [...failed.values()]
  const steps = since === null ? [] : (snapshot.steps ?? []).filter(recent)
  const lines: string[] = ["## Console and network"]
  const env = snapshot.environment
  lines.push(
    "",
    `- Viewport: ${env.viewport.width}×${env.viewport.height} @${env.viewport.dpr}x, ${env.language}`,
    `- Browser: ${clip(env.userAgent, 200)}`,
    since !== null
      ? `- Recorded from ${time(since)} to ${time(options.now)} (UTC)`
      : "- Console not recorded; failed requests from the page's resource timing only"
  )
  if (steps.length > 0) {
    // The steps first: they are the story the errors below happened in.
    const start = steps[0]!.ts
    const shown = steps.slice(-MAX_STEPS)
    lines.push("", `### Steps to reproduce (${steps.length})`, "")
    if (steps.length > MAX_STEPS)
      lines.push(`… ${steps.length - MAX_STEPS} earlier steps left out`, "")
    shown.forEach((step, index) => {
      const offset = ((step.ts - start) / 1000).toFixed(1)
      lines.push(`${index + 1}. +${offset}s ${stepText(step)}`)
    })
    lines.push(
      "",
      "Typed values are not recorded. Times are from the first step; console lines below are at UTC."
    )
  }
  if (problems.length > 0) {
    lines.push("", `### Console errors and warnings (${problems.length})`, "", "```text")
    for (const line of problems.slice(-MAX_CONSOLE)) {
      lines.push(`${time(line.ts)} [${line.level}] ${clip(line.text)}`)
    }
    if (problems.length > MAX_CONSOLE)
      lines.push(`… ${problems.length - MAX_CONSOLE} earlier lines`)
    lines.push("```")
  } else if (snapshot.recording) {
    lines.push("", "No console errors or warnings while recording.")
  }
  if (requests.length > 0) {
    lines.push("", `### Failed requests (${requests.length})`, "")
    for (const request of requests.slice(-MAX_REQUESTS)) {
      const status = request.status === 0 ? "network error" : String(request.status)
      const duration = request.durationMs !== null ? ` · ${request.durationMs} ms` : ""
      lines.push(`- \`${request.method} ${request.url}\` → ${status}${duration}`)
    }
    if (requests.length > MAX_REQUESTS) lines.push(`- … ${requests.length - MAX_REQUESTS} more`)
  } else {
    lines.push("", "No failed requests.")
  }
  return {
    tabId: options.tabId,
    capturedAt: options.now,
    counts: {
      errors,
      warnings: problems.length - errors,
      failedRequests: requests.length,
      steps: steps.length,
    },
    text: lines.join("\n"),
  }
}
