/**
 * The recorder in a page that is being recorded for a test (`recording-v1`).
 *
 * It runs in the extension's isolated world, so the page can neither read
 * what it records nor speak for it, and records only trusted events — the
 * person's own, or the agent's in its own tab. Each step goes to the worker
 * at once, so a load or a crash loses nothing already done; the worker puts
 * the recorder back on every load while the tab is recording.
 *
 * A badge in a closed shadow root says the tab is recording, offers Stop, and
 * "Add a check": the next click is not passed to the page but recorded as
 * what a test should expect to see there.
 */
import type { RecordedStep } from "./model"
import { isSecretField, locatorsFor } from "./locators"

export interface RecorderLabels {
  recording: string
  check: string
  checking: string
  cancel: string
  stop: string
}

export interface RecorderDeps {
  win: Window & typeof globalThis
  send: (step: RecordedStep) => void
  stop: () => void
  labels: RecorderLabels
  now?: () => number
  /**
   * Which events are steps: the person's only, or in an agent's tab also the
   * synthetic ones its actions dispatch.
   */
  trusted?: (event: Event) => boolean
  /** Which clicks may press the badge's own buttons: a person's; tests pass their own. */
  controlTrusted?: (event: Event) => boolean
  /** How long typing rests before it is a step. */
  settleMs?: number
}

declare global {
  /** Left by `test-recorder.js` for the worker to start the recorder with. */
  var __cogniaStartTestRecorder: ((synthetic: boolean) => boolean) | undefined
}

export const BADGE_ID = "__cognia-recording-badge"
const MARK = "__cogniaTestRecorder"
const KEYS = new Set([
  "Enter",
  "Escape",
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  "End",
])
const MAX_TEXT = 200

const squash = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim()

function actionable(element: Element): Element {
  return (
    element.closest(
      'a[href], button, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="option"], [role="checkbox"], [role="switch"], summary, input, select, textarea, label'
    ) ?? element
  )
}

function isField(element: Element): boolean {
  if (element instanceof HTMLTextAreaElement) return true
  if ((element as HTMLElement).isContentEditable) return true
  return (
    element instanceof HTMLInputElement &&
    !["checkbox", "radio", "button", "submit", "reset", "image", "file", "range", "color"].includes(
      element.type
    )
  )
}

export function installTestRecorder(deps: RecorderDeps): { stop(): void } {
  const { win } = deps
  const holder = win as unknown as Record<string, { stop(): void } | undefined>
  const existing = holder[MARK]
  if (existing) return existing
  const doc = win.document
  const now = deps.now ?? (() => Date.now())
  const trusted = deps.trusted ?? ((event: Event) => event.isTrusted)
  const controlTrusted = deps.controlTrusted ?? ((event: Event) => event.isTrusted)
  const settleMs = deps.settleMs ?? 600
  let checking = false
  let lastUrl = win.location.href
  const pending = new Map<Element, ReturnType<typeof setTimeout>>()

  const ours = (node: EventTarget | null) =>
    node instanceof Element && node.closest(`#${BADGE_ID}`) !== null
  const targetOf = (event: Event): Element | null => {
    if (!trusted(event)) return null
    const node = event.composedPath?.()[0] ?? event.target
    if (!(node instanceof Element) || ours(node) || ours(event.target)) return null
    return node
  }
  const step = (partial: Omit<RecordedStep, "at">) => deps.send({ ...partial, at: now() })

  const flushFill = (element: Element) => {
    const timer = pending.get(element)
    if (timer === undefined) return
    clearTimeout(timer)
    pending.delete(element)
    const secret = isSecretField(element)
    const value =
      element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
        ? element.value
        : squash((element as HTMLElement).innerText)
    step({
      action: "fill",
      target: locatorsFor(element),
      ...(secret ? { secret: true } : { value }),
    })
  }
  const flushAll = () => {
    for (const element of [...pending.keys()]) flushFill(element)
  }

  const onInput = (event: Event) => {
    const element = targetOf(event)
    if (!element || !isField(element)) return
    const timer = pending.get(element)
    if (timer !== undefined) clearTimeout(timer)
    pending.set(
      element,
      setTimeout(() => flushFill(element), settleMs)
    )
  }

  const check = (element: Element) => {
    const target = locatorsFor(element)
    if (
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement
    ) {
      step(
        isSecretField(element)
          ? { action: "assert", target, assertion: { kind: "visible" } }
          : { action: "assert", target, assertion: { kind: "value", expected: element.value } }
      )
      return
    }
    const text = squash((element as HTMLElement).innerText ?? element.textContent).slice(
      0,
      MAX_TEXT
    )
    step(
      text
        ? { action: "assert", target, assertion: { kind: "text", expected: text } }
        : { action: "assert", target, assertion: { kind: "visible" } }
    )
  }

  const onClick = (event: Event) => {
    const hit = targetOf(event)
    if (!hit) return
    flushAll()
    if (checking) {
      // The click was for the check, not for the page.
      event.preventDefault()
      event.stopImmediatePropagation()
      checking = false
      paint()
      check(hit)
      return
    }
    const element = actionable(hit)
    if (element instanceof HTMLSelectElement || isField(element)) return
    if (
      element instanceof HTMLInputElement &&
      (element.type === "checkbox" || element.type === "radio")
    )
      return
    // A label clicks its control, which records itself.
    if (element instanceof HTMLLabelElement && element.control) return
    step({ action: "click", target: locatorsFor(element) })
  }

  const onDoubleClick = (event: Event) => {
    const hit = targetOf(event)
    if (!hit || checking) return
    const element = actionable(hit)
    if (isField(element)) return
    step({ action: "double_click", target: locatorsFor(element) })
  }

  const onChange = (event: Event) => {
    const element = targetOf(event)
    if (!element) return
    // What was typed elsewhere came first.
    for (const field of [...pending.keys()]) if (field !== element) flushFill(field)
    if (element instanceof HTMLSelectElement) {
      const option = element.selectedOptions[0]
      step({
        action: "select",
        target: locatorsFor(element),
        value: option ? option.value || squash(option.textContent) : "",
      })
      return
    }
    if (
      element instanceof HTMLInputElement &&
      (element.type === "checkbox" || element.type === "radio")
    ) {
      step({
        action: "click",
        target: locatorsFor(element),
        value: element.checked ? "checked" : "unchecked",
      })
      return
    }
    if (isField(element)) flushFill(element)
  }

  const onKey = (event: Event) => {
    const key = event as KeyboardEvent
    const element = targetOf(event)
    if (!element) return
    const chord = key.ctrlKey || key.metaKey || key.altKey
    if (!KEYS.has(key.key) && !(chord && key.key.length === 1)) return
    // What was typed comes first: Enter submits it.
    flushAll()
    const name = [
      key.ctrlKey ? "Control" : "",
      key.metaKey ? "Meta" : "",
      key.altKey ? "Alt" : "",
      key.shiftKey && chord ? "Shift" : "",
      key.key.length === 1 ? key.key.toUpperCase() : key.key,
    ]
      .filter(Boolean)
      .join("+")
    step({
      action: "press_key",
      ...(element !== doc.body && element !== doc.documentElement
        ? { target: locatorsFor(element) }
        : {}),
      value: name,
    })
  }

  // A single-page app changes the address without a load; the worker sees loads.
  const poll = win.setInterval(() => {
    if (win.location.href === lastUrl) return
    lastUrl = win.location.href
    flushAll()
    step({ action: "navigate", url: lastUrl })
  }, 500)

  const onLeave = () => flushAll()

  const host = doc.createElement("div")
  host.id = BADGE_ID
  host.setAttribute("data-cognia-chrome", "1")
  host.style.cssText = "all:initial;position:fixed;z-index:2147483647;right:16px;bottom:16px;"
  const root = host.attachShadow({ mode: "closed" })
  const paint = () => {
    root.innerHTML = ""
    const style = doc.createElement("style")
    style.textContent =
      ".bar{display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:999px;" +
      "font:500 12px system-ui,-apple-system,sans-serif;color:#fff;background:#1f2937;" +
      "box-shadow:0 6px 24px rgba(0,0,0,.25)}.dot{width:8px;height:8px;border-radius:50%;" +
      "background:#f87171}button{all:unset;cursor:pointer;padding:3px 9px;border-radius:999px;" +
      "background:rgba(255,255,255,.14)}button:hover{background:rgba(255,255,255,.26)}" +
      "button:focus-visible{outline:2px solid #93c5fd}"
    const bar = doc.createElement("div")
    bar.className = "bar"
    bar.setAttribute("role", "status")
    const dot = doc.createElement("span")
    dot.className = "dot"
    const label = doc.createElement("span")
    label.textContent = checking ? deps.labels.checking : deps.labels.recording
    const toggle = doc.createElement("button")
    toggle.type = "button"
    toggle.textContent = checking ? deps.labels.cancel : deps.labels.check
    toggle.addEventListener("click", (event) => {
      if (!controlTrusted(event)) return
      checking = !checking
      paint()
    })
    const stopButton = doc.createElement("button")
    stopButton.type = "button"
    stopButton.textContent = deps.labels.stop
    stopButton.addEventListener("click", (event) => {
      // Only a person's click: a synthetic one is the page pressing our controls.
      if (!controlTrusted(event)) return
      flushAll()
      deps.stop()
    })
    bar.append(dot, label, toggle, stopButton)
    root.append(style, bar)
  }
  paint()
  doc.documentElement.appendChild(host)

  const listeners: [string, EventListener, AddEventListenerOptions][] = [
    ["click", onClick, { capture: true }],
    ["dblclick", onDoubleClick, { capture: true, passive: true }],
    ["input", onInput, { capture: true, passive: true }],
    ["change", onChange, { capture: true, passive: true }],
    ["keydown", onKey, { capture: true, passive: true }],
  ]
  for (const [type, listener, options] of listeners) doc.addEventListener(type, listener, options)
  win.addEventListener("pagehide", onLeave)

  step({ action: "navigate", url: lastUrl })

  const handle = {
    stop() {
      flushAll()
      for (const [type, listener, options] of listeners)
        doc.removeEventListener(type, listener, options)
      win.removeEventListener("pagehide", onLeave)
      win.clearInterval(poll)
      host.remove()
      delete holder[MARK]
    },
  }
  holder[MARK] = handle
  return handle
}

/** Called by the worker in the page's isolated world, to end a recording there. */
export function stopTestRecorder(): boolean {
  const holder = globalThis as unknown as Record<string, { stop(): void } | undefined>
  holder.__cogniaTestRecorder?.stop()
  return true
}
