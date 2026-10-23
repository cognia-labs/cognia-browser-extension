/**
 * What the person did while recording a bug (Jam's repro steps): clicks,
 * typing, keys, form submits, navigation and scrolling, in order.
 *
 * "Click Save, then press Enter in the email field" is the part of a bug
 * report people leave out and agents most need. Installed beside the console
 * and network hooks in the page's MAIN world, from the same recording.
 *
 * Only trusted events — the person's, not the page's own scripts — are
 * recorded, and never what was typed: a text field records that something
 * was entered, a password field not even that much detail. Listeners are
 * passive and in the capture phase, so the page behaves exactly as without
 * them. Clicks made while Cognia's own picker is pointing are the panel's,
 * not the bug's, and are left out.
 */
import { elementLabel, escapeIdentifier, uniqueSelector } from "./element-context"

export type StepKind =
  "click" | "input" | "toggle" | "select" | "key" | "submit" | "navigate" | "scroll"

export interface ReproStep {
  ts: number
  kind: StepKind
  /** The element acted on, when there was one. */
  selector?: string
  label?: string
  /** A short description: the element's name, the key, the address, the scroll position. */
  detail?: string
}

export interface InteractionRecorder {
  peek(): ReproStep[]
}

declare global {
  var __cogniaSteps: InteractionRecorder | undefined
}

/** Marks the picker's overlay while it is taking the person's clicks. */
export const POINTING_ATTRIBUTE = "data-cognia-pointing"

export const MAX_STEPS = 200
const MAX_DETAIL = 80
/** Typing, scrolling and the like closer together than this are one step. */
const COALESCE_MS = 1_500

const NAMED_KEYS = new Set([
  "Enter",
  "Escape",
  "Tab",
  "Backspace",
  "Delete",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "PageUp",
  "PageDown",
  "Home",
  "End",
])

function clip(value: string, max = MAX_DETAIL): string {
  const single = value.replace(/\s+/g, " ").trim()
  return single.length > max ? `${single.slice(0, max - 1)}…` : single
}

/** What the person would call the element: its accessible name or visible text. */
function nameOf(element: Element): string {
  const aria = element.getAttribute("aria-label") ?? element.getAttribute("title")
  if (aria?.trim()) return clip(aria)
  const tag = element.tagName
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    const id = element.id
    const label =
      (id ? element.ownerDocument.querySelector(`label[for="${escapeIdentifier(id)}"]`) : null) ??
      element.closest("label")
    if (label?.textContent?.trim()) return clip(label.textContent)
    const placeholder = element.getAttribute("placeholder")
    if (placeholder?.trim()) return clip(placeholder)
    return element.getAttribute("name") ?? ""
  }
  return clip((element as HTMLElement).innerText ?? element.textContent ?? "")
}

/** The element a click means: the button or link around the icon that was hit. */
function actionable(target: Element): Element {
  return (
    target.closest(
      'a[href], button, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="option"], [role="checkbox"], [role="switch"], label, summary, input, select, textarea'
    ) ?? target
  )
}

/** The address as a step shows it: path and hash, never the query. */
function pathOf(href: string): string {
  try {
    const url = new URL(href)
    return clip(`${url.pathname}${url.hash}`, 160)
  } catch {
    return ""
  }
}

export function installInteractionRecorder(
  win: Window & typeof globalThis,
  { trusted = (event: Event) => event.isTrusted }: { trusted?: (event: Event) => boolean } = {}
): InteractionRecorder {
  if (win.__cogniaSteps) return win.__cogniaSteps
  const doc = win.document
  const steps: ReproStep[] = []

  const push = (step: Omit<ReproStep, "ts">, coalesce = false) => {
    const ts = Date.now()
    const last = steps.at(-1)
    if (
      coalesce &&
      last &&
      last.kind === step.kind &&
      last.selector === step.selector &&
      ts - last.ts < COALESCE_MS
    ) {
      steps[steps.length - 1] = { ...last, ...step, ts }
      return
    }
    steps.push({ ts, ...step })
    if (steps.length > MAX_STEPS) steps.shift()
  }

  // Editing the page's words for the panel is not a step of the bug either.
  const pointing = () =>
    doc.designMode === "on" || doc.querySelector(`[${POINTING_ATTRIBUTE}]`) !== null
  const ours = (element: Element) => element.closest("[data-cognia-chrome]") !== null

  const about = (element: Element) => ({
    selector: uniqueSelector(element),
    label: elementLabel(element),
  })

  const target = (event: Event): Element | null => {
    if (!trusted(event) || pointing()) return null
    const node = event.composedPath?.()[0] ?? event.target
    if (!node || (node as Node).nodeType !== 1) return null
    return ours(node as Element) ? null : (node as Element)
  }

  const onClick = (event: Event) => {
    const hit = target(event)
    if (!hit) return
    const element = actionable(hit)
    // A click on a field is followed by what is typed into it; a click on a
    // checkbox by its change. Those say more than the click.
    if (
      element.matches(
        "input:not([type=button]):not([type=submit]):not([type=reset]), textarea, select"
      )
    )
      return
    const name = nameOf(element)
    push({ kind: "click", ...about(element), ...(name ? { detail: name } : {}) })
  }

  /** A choice made: fires once, on `change`. */
  const onChange = (event: Event) => {
    const element = target(event)
    if (!element) return
    if (element instanceof win.HTMLSelectElement) {
      const chosen = element.selectedOptions[0]?.textContent ?? ""
      push({ kind: "select", ...about(element), detail: clip(chosen) })
      return
    }
    if (
      element instanceof win.HTMLInputElement &&
      (element.type === "checkbox" || element.type === "radio")
    ) {
      push({ kind: "toggle", ...about(element), detail: element.checked ? "on" : "off" })
    }
  }

  /** Typing: fires per keystroke, coalesced into one step per field. */
  const onInput = (event: Event) => {
    const element = target(event)
    if (!element) return
    if (
      element instanceof win.HTMLSelectElement ||
      (element instanceof win.HTMLInputElement &&
        ["checkbox", "radio", "range", "color", "file"].includes(element.type))
    )
      return
    const field =
      element instanceof win.HTMLInputElement ||
      element instanceof win.HTMLTextAreaElement ||
      (element as HTMLElement).isContentEditable
    if (!field) return
    const secret = element instanceof win.HTMLInputElement && element.type === "password"
    const name = secret ? "password" : nameOf(element)
    push({ kind: "input", ...about(element), ...(name ? { detail: name } : {}) }, true)
  }

  const onKey = (event: Event) => {
    const element = target(event)
    if (!element) return
    const key = event as KeyboardEvent
    const chord = key.ctrlKey || key.metaKey || key.altKey
    if (!NAMED_KEYS.has(key.key) && !(chord && key.key.length === 1)) return
    if (key.key === "Tab" && !chord) return
    const parts = [
      ...(key.ctrlKey ? ["Ctrl"] : []),
      ...(key.metaKey ? ["Meta"] : []),
      ...(key.altKey ? ["Alt"] : []),
      ...(key.shiftKey && chord ? ["Shift"] : []),
      key.key.length === 1 ? key.key.toUpperCase() : key.key,
    ]
    const focused = element === doc.body || element === doc.documentElement ? null : element
    push({ kind: "key", detail: parts.join("+"), ...(focused ? about(focused) : {}) })
  }

  const onSubmit = (event: Event) => {
    const form = target(event)
    if (!form) return
    push({ kind: "submit", ...about(form) })
  }

  let lastPath = pathOf(win.location.href)
  const onNavigate = () => {
    const path = pathOf(win.location.href)
    if (path === lastPath) return
    lastPath = path
    push({ kind: "navigate", detail: path })
  }

  const onScroll = (event: Event) => {
    if (!trusted(event) || pointing()) return
    if (event.target !== doc && event.target !== win) return
    push({ kind: "scroll", detail: `${Math.round(win.scrollY)}px` }, true)
  }

  const options = { capture: true, passive: true }
  win.addEventListener("click", onClick, options)
  win.addEventListener("input", onInput, options)
  win.addEventListener("change", onChange, options)
  win.addEventListener("keydown", onKey, options)
  win.addEventListener("submit", onSubmit, options)
  win.addEventListener("scroll", onScroll, options)
  win.addEventListener("popstate", onNavigate, options)
  win.addEventListener("hashchange", onNavigate, options)
  // A single-page app navigates through the History API without an event;
  // the wrappers call through, unchanged, and look at the address after.
  for (const method of ["pushState", "replaceState"] as const) {
    const original = win.history[method]
    win.history[method] = function (this: History, ...args: Parameters<History["pushState"]>) {
      const result = original.apply(this, args)
      try {
        onNavigate()
      } catch {
        // Never let the recording break the page's navigation.
      }
      return result
    }
  }

  const recorder: InteractionRecorder = { peek: () => steps.slice() }
  Object.defineProperty(win, "__cogniaSteps", {
    value: recorder,
    configurable: true,
    enumerable: false,
    writable: false,
  })
  return recorder
}

/** A step as one line of the report. */
export function stepText(step: ReproStep): string {
  const where = step.selector ? `\`${step.selector}\`` : ""
  const name = step.detail ? ` "${step.detail}"` : ""
  switch (step.kind) {
    case "click":
      return `Clicked ${where}${name}`
    case "input":
      return step.detail === "password"
        ? `Entered a password in ${where}`
        : `Entered text in ${where}${name}`
    case "toggle":
      return `Turned ${where} ${step.detail ?? ""}`.trimEnd()
    case "select":
      return `Chose${name} in ${where}`
    case "key":
      return `Pressed ${step.detail ?? "a key"}${where ? ` in ${where}` : ""}`
    case "submit":
      return `Submitted ${where}`
    case "navigate":
      return `Navigated to ${step.detail ?? "another page"}`
    case "scroll":
      return `Scrolled to ${step.detail ?? "another position"}`
  }
}
