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
 *
 * Registered at `document_start`, the recorder cannot know yet whether its
 * tab is recording — only the worker does, and asking takes a round trip a
 * slow page's first click can beat. So it starts *held*: listening from the
 * first moment, keeping what it records in memory, showing nothing and
 * sending nothing. The worker's answer either confirms it, and what it held
 * goes out in order, or discards it, and nothing was ever sent.
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
  /** Keep steps until {@link TestRecorderHandle.confirm} says the tab records. */
  held?: boolean
}

export interface TestRecorderHandle {
  /** Still waiting for the worker to say whether the tab records. */
  readonly held: boolean
  /**
   * Take the recorder out. Answers the steps not sent yet — typing that had
   * not settled — so the worker can keep them in the recording it is ending.
   */
  stop(): RecordedStep[]
  /**
   * The tab records: show the badge and send what was held, in order —
   * the person's own steps, or in an agent's tab (`synthetic`) all of them.
   * Nothing for a recorder that is already live.
   */
  confirm(synthetic: boolean): void
  /** The tab does not record: take everything out, having sent nothing. */
  discard(): void
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

export function installTestRecorder(deps: RecorderDeps): TestRecorderHandle {
  const { win } = deps
  const holder = win as unknown as Record<string, TestRecorderHandle | undefined>
  const existing = holder[MARK]
  if (existing) return existing
  const doc = win.document
  const now = deps.now ?? (() => Date.now())
  const ownTrust = deps.trusted ?? ((event: Event) => event.isTrusted)
  const controlTrusted = deps.controlTrusted ?? ((event: Event) => event.isTrusted)
  const settleMs = deps.settleMs ?? 600
  let checking = false
  let held = deps.held === true
  /** In an agent's tab: every event is a step, the agent's included. */
  let everyEvent = false
  let ended = false
  let lastUrl = win.location.href
  /** Typing still settling, and whether each field's typing was the person's. */
  const pending = new Map<Element, { timer: ReturnType<typeof setTimeout>; trusted: boolean }>()
  /** What a held recorder recorded, and whether each was the person's doing. */
  const queue: { step: RecordedStep; trusted: boolean }[] = []
  /** Where steps go while the recorder is being taken out: back to the worker. */
  let collected: RecordedStep[] | null = null

  const trusted = (event: Event) => everyEvent || ownTrust(event)
  const ours = (node: EventTarget | null) =>
    node instanceof Element && node.closest(`#${BADGE_ID}`) !== null
  /** The element an event is about; a held recorder takes untrusted events too, marked. */
  const targetOf = (event: Event): Element | null => {
    if (!held && !trusted(event)) return null
    const node = event.composedPath?.()[0] ?? event.target
    if (!(node instanceof Element) || ours(node) || ours(event.target)) return null
    return node
  }
  const step = (partial: Omit<RecordedStep, "at">, isTrusted = true) => {
    const recorded: RecordedStep = { ...partial, at: now() }
    if (held) queue.push({ step: recorded, trusted: isTrusted })
    else if (!isTrusted && !everyEvent) return
    else if (collected) collected.push(recorded)
    else deps.send(recorded)
  }

  const flushFill = (element: Element) => {
    const entry = pending.get(element)
    if (entry === undefined) return
    clearTimeout(entry.timer)
    pending.delete(element)
    const secret = isSecretField(element)
    const value =
      element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
        ? element.value
        : squash((element as HTMLElement).innerText)
    step(
      {
        action: "fill",
        target: locatorsFor(element),
        ...(secret ? { secret: true } : { value }),
      },
      entry.trusted
    )
  }
  const flushAll = () => {
    for (const element of [...pending.keys()]) flushFill(element)
  }

  const onInput = (event: Event) => {
    const element = targetOf(event)
    if (!element || !isField(element)) return
    const entry = pending.get(element)
    if (entry !== undefined) clearTimeout(entry.timer)
    pending.set(element, {
      timer: setTimeout(() => flushFill(element), settleMs),
      trusted: trusted(event),
    })
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
    step({ action: "click", target: locatorsFor(element) }, trusted(event))
  }

  const onDoubleClick = (event: Event) => {
    const hit = targetOf(event)
    if (!hit || checking) return
    const element = actionable(hit)
    if (isField(element)) return
    step({ action: "double_click", target: locatorsFor(element) }, trusted(event))
  }

  const onChange = (event: Event) => {
    const element = targetOf(event)
    if (!element) return
    // What was typed elsewhere came first.
    for (const field of [...pending.keys()]) if (field !== element) flushFill(field)
    if (element instanceof HTMLSelectElement) {
      const option = element.selectedOptions[0]
      step(
        {
          action: "select",
          target: locatorsFor(element),
          value: option ? option.value || squash(option.textContent) : "",
        },
        trusted(event)
      )
      return
    }
    if (
      element instanceof HTMLInputElement &&
      (element.type === "checkbox" || element.type === "radio")
    ) {
      step(
        {
          action: "click",
          target: locatorsFor(element),
          value: element.checked ? "checked" : "unchecked",
        },
        trusted(event)
      )
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
    step(
      {
        action: "press_key",
        ...(element !== doc.body && element !== doc.documentElement
          ? { target: locatorsFor(element) }
          : {}),
        value: name,
      },
      trusted(event)
    )
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
  const show = () => {
    paint()
    // At `document_start` there may be no root yet to hang the badge on.
    if (doc.documentElement) doc.documentElement.appendChild(host)
    else
      doc.addEventListener(
        "DOMContentLoaded",
        () => !ended && doc.documentElement?.appendChild(host),
        { once: true }
      )
  }

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
  if (!held) show()

  const remove = () => {
    ended = true
    for (const entry of pending.values()) clearTimeout(entry.timer)
    pending.clear()
    for (const [type, listener, options] of listeners)
      doc.removeEventListener(type, listener, options)
    win.removeEventListener("pagehide", onLeave)
    win.clearInterval(poll)
    host.remove()
    if (holder[MARK] === handle) delete holder[MARK]
  }

  const handle: TestRecorderHandle = {
    get held() {
      return held
    },
    stop() {
      if (ended) return []
      // A recorder still held has sent nothing; the person's steps it kept
      // are as much the recording's as the typing still settling.
      const kept = held ? queue.filter((entry) => entry.trusted).map((entry) => entry.step) : []
      held = false
      collected = kept
      flushAll()
      collected = null
      remove()
      return kept
    },
    confirm(synthetic) {
      if (ended || !held) return
      held = false
      everyEvent = synthetic
      for (const entry of queue.splice(0)) if (entry.trusted || synthetic) deps.send(entry.step)
      if (synthetic) for (const entry of pending.values()) entry.trusted = true
      show()
    },
    discard() {
      if (ended || !held) return
      queue.length = 0
      remove()
    },
  }
  holder[MARK] = handle
  return handle
}

/**
 * Called by the worker in the page's isolated world, to end a recording
 * there. Answers what the recorder had not sent, for the worker to keep.
 */
export function stopTestRecorder(): RecordedStep[] {
  const holder = globalThis as unknown as Record<string, { stop(): RecordedStep[] } | undefined>
  return holder.__cogniaTestRecorder?.stop() ?? []
}
