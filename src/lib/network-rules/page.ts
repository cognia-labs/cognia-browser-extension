/**
 * The page's half of the request rules: what the page's own `fetch`/XHR must
 * run, because only there are bodies and counts available (`rules.ts`).
 *
 * The rules are in `chrome.storage`, which the page's world cannot read and
 * which answers only asynchronously, while a page starts requests as soon as
 * its first script runs. So two scripts registered for the sites with page
 * rules meet at `document_start`: the MAIN-world gate installs its own slot of
 * the request engine and holds the page's requests, and the isolated loader
 * asks the worker for this tab's rules and hands them over. The requests go
 * on once the rules are in, or after {@link HOLD_MS} if the worker does not
 * answer — a page is never stuck behind its rules.
 */
import { mainRequestMocks, type RequestMock } from "../inspect/request-mocks"

/** The request engine's slot these rules run in, apart from the panel's. */
export const RULES_SLOT = "Rules"
export const RULES_EVENT = "cognia:network-rules"
export const RULES_REQUEST_EVENT = "cognia:network-rules-request"
export const HOLD_MS = 2_000

export interface PageRulesMessage {
  kind: "cognia-network-rules-for-page"
}

export function isPageRulesMessage(value: unknown): value is PageRulesMessage {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { kind?: unknown }).kind === "cognia-network-rules-for-page"
  )
}

/** MAIN world, `document_start`: hold the page's requests until its rules are in. */
export function mainRuleGate(holdMs = HOLD_MS): void {
  const marker = "__cogniaRuleGate"
  const holder = window as unknown as Record<string, unknown>
  if (holder[marker]) return
  holder[marker] = true

  // The engine first, then the hold around it: a held request is decided
  // against the rules, not let through before they are known.
  mainRequestMocks([], false, RULES_SLOT)
  let ready = false
  let release: () => void = () => undefined
  const gate = new Promise<void>((resolve) => {
    release = () => {
      if (ready) return
      ready = true
      resolve()
    }
  })
  const timer = setTimeout(release, holdMs)

  const innerFetch = window.fetch
  if (typeof innerFetch === "function") {
    window.fetch = function (this: unknown, ...args: Parameters<typeof fetch>) {
      if (ready) return innerFetch.apply(this, args)
      return gate.then(() => innerFetch.apply(this, args))
    } as typeof fetch
  }
  if (typeof XMLHttpRequest === "function") {
    const proto = XMLHttpRequest.prototype
    const innerOpen = proto.open
    const innerSend = proto.send
    const synchronous = new WeakSet<XMLHttpRequest>()
    proto.open = function (this: XMLHttpRequest, ...args: unknown[]) {
      if (args.length > 2 && args[2] === false) synchronous.add(this)
      else synchronous.delete(this)
      return (innerOpen as (...a: unknown[]) => void).apply(this, args)
    } as typeof proto.open
    proto.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
      // A synchronous request cannot wait: it goes now, against no rules yet.
      if (ready || synchronous.has(this)) return innerSend.call(this, body)
      void gate.then(() => {
        try {
          innerSend.call(this, body)
        } catch {
          // Aborted or reopened while held: the page has moved on.
        }
      })
    }
  }
  const innerBeacon = typeof navigator.sendBeacon === "function" ? navigator.sendBeacon : null
  if (innerBeacon) {
    navigator.sendBeacon = function (
      this: Navigator,
      ...args: Parameters<Navigator["sendBeacon"]>
    ) {
      if (ready) return innerBeacon.apply(this, args)
      void gate.then(() => innerBeacon.apply(this, args))
      return true
    }
  }

  // Only the first answer counts: anything later on this event is the page's own.
  document.addEventListener(
    RULES_EVENT,
    (event) => {
      const detail = (event as CustomEvent<unknown>).detail
      try {
        const rules = typeof detail === "string" ? (JSON.parse(detail) as unknown) : null
        if (Array.isArray(rules) && rules.length > 0)
          mainRequestMocks(rules as RequestMock[], false, RULES_SLOT)
      } catch {
        // A malformed answer: the requests go on without rules.
      }
      clearTimeout(timer)
      release()
    },
    { once: true }
  )
  document.dispatchEvent(new CustomEvent(RULES_REQUEST_EVENT))
}

/** Isolated world, `document_start`: fetch this tab's rules and hand them to the gate. */
export function isolatedRuleLoader(ask: () => Promise<unknown>): () => void {
  let answer: string | null = null
  const deliver = () => {
    if (answer !== null) document.dispatchEvent(new CustomEvent(RULES_EVENT, { detail: answer }))
  }
  // The gate may start before or after this script; either one's event finds the other.
  document.addEventListener(RULES_REQUEST_EVENT, deliver)
  void ask().then(
    (rules) => {
      answer = JSON.stringify(Array.isArray(rules) ? rules : [])
      deliver()
    },
    () => {
      answer = "[]"
      deliver()
    }
  )
  return () => document.removeEventListener(RULES_REQUEST_EVENT, deliver)
}
