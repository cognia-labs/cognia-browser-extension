/**
 * Simulated responses for the page's own requests (Requestly): make a call
 * fail, answer it with a status, headers and body of the person's choosing,
 * hold it back, change what the real server answered, or send it somewhere
 * else — to see how the page copes with an outage, an empty list, a slow
 * server or another backend without touching any of them.
 *
 * The rules live in the page's MAIN world, where its `fetch`,
 * `XMLHttpRequest` and `sendBeacon` are. By default they last until the page
 * reloads; kept, they are also written to the tab's own `sessionStorage` and
 * put back by a script the extension registers for that site, at
 * `document_start`, so the requests a page makes while it loads are caught
 * too — and still only in that tab, until it closes or the rules are cleared.
 * Nothing is installed for the extension's own requests or other tabs, and no
 * network permission is involved. What the agent is sent says which requests
 * were simulated, so a failure in the report is not mistaken for the
 * backend's.
 */

export const MOCK_ACTIONS = ["fail", "respond", "modify", "delay", "redirect"] as const
export type MockAction = (typeof MOCK_ACTIONS)[number]

export const MOCK_METHODS = ["", "GET", "POST", "PUT", "PATCH", "DELETE"] as const

export interface RequestMock {
  id: string
  /**
   * Part of the URL to match, `*` standing for anything; or `/a regular
   * expression/flags` — one that uses some expression syntax, so a path
   * between slashes stays a path.
   */
  match: string
  /** Upper-case; empty for any method. */
  method: string
  action: MockAction
  /** For `respond`; for `modify`, 0 keeps the server's. */
  status: number
  /**
   * For `respond`: sent as the body, JSON when it parses as JSON. For
   * `modify`: JSON merged into the server's JSON answer, or text replacing it.
   */
  body: string
  /** For `respond` and `modify`: response headers, one `Name: value` a line. */
  headers: string
  /**
   * For `redirect`: a full URL to send it to instead, or what replaces the
   * part of the URL the match covers; `$1` stands for the match's first group.
   */
  target: string
  /** Before the request is answered, failed or sent. */
  delayMs: number
  /** How many matching requests it applies to; 0 for all of them. */
  times: number
  /** The share of matching requests it applies to, 1–100: a flaky server. */
  chance: number
  /** Paused rules stay listed but do nothing. */
  enabled: boolean
}

/** One request a rule caught, newest last. */
export interface MockLogEntry {
  rule: string
  method: string
  url: string
  at: number
  /** What the page got: `503`, `network error`, `held 2000 ms`, `→ https://…`. */
  outcome: string
}

export interface MockHits {
  /** Whether the page still has the rules: a reload takes them away unless kept. */
  installed: boolean
  /** Whether the tab keeps them across reloads. */
  kept: boolean
  hits: Record<string, { count: number; lastUrl: string | null }>
  log: MockLogEntry[]
}

export const MAX_MOCKS = 12
export const MAX_MOCK_BODY = 20_000
export const MAX_MOCK_DELAY_MS = 30_000
export const MAX_MOCK_LOG = 50
/** Where kept rules wait in the tab's `sessionStorage` for the next load. */
export const MOCK_STORE_KEY = "__cogniaRequestMocks__"

/**
 * Install, replace or read the tab's rules — `null` reads the hit counts and
 * log without changing anything, `[]` clears them. `keep` writes the rules
 * where the next load of this tab finds them. Run with
 * `chrome.scripting.executeScript({ func, world: "MAIN" })`, which serializes
 * it: every helper lives inside the body.
 */
export function mainRequestMocks(rules: RequestMock[] | null, keep = false): MockHits {
  type Rule = RequestMock & { pattern: RegExp | null; applied: number }
  interface State {
    rules: Rule[]
    hits: Record<string, { count: number; lastUrl: string | null }>
    log: MockLogEntry[]
  }
  const KEY = "__cogniaRequestMocks"
  const STORE = "__cogniaRequestMocks__"
  const LOG_SIZE = 50
  const holder = window as unknown as Record<string, State | undefined>
  const stored = () => {
    try {
      return sessionStorage.getItem(STORE) !== null
    } catch {
      return false
    }
  }
  const report = (state: State | undefined): MockHits => ({
    installed: state !== undefined && state.rules.length > 0,
    kept: stored(),
    hits: state ? JSON.parse(JSON.stringify(state.hits)) : {},
    log: state ? JSON.parse(JSON.stringify(state.log)) : [],
  })
  if (rules === null) return report(holder[KEY])

  let state = holder[KEY]
  if (!state) {
    const created: State = { rules: [], hits: {}, log: [] }
    state = created
    holder[KEY] = created
    const absolute = (url: string) => {
      try {
        return new URL(url, location.href).href
      } catch {
        return url
      }
    }
    /** The first rule that takes this request, counted; null to let it through. */
    const find = (url: string, method: string): Rule | null => {
      for (const rule of created.rules) {
        if (!rule.enabled || !rule.pattern) continue
        if (rule.method && rule.method !== method) continue
        rule.pattern.lastIndex = 0
        if (!rule.pattern.test(url)) continue
        if (rule.times > 0 && rule.applied >= rule.times) continue
        if (rule.chance < 100 && Math.random() * 100 >= rule.chance) continue
        rule.applied++
        const hit = created.hits[rule.id] ?? { count: 0, lastUrl: null }
        hit.count++
        hit.lastUrl = url
        created.hits[rule.id] = hit
        return rule
      }
      return null
    }
    const note = (rule: Rule, method: string, url: string, outcome: string) => {
      created.log.push({ rule: rule.id, method, url: url.slice(0, 300), at: Date.now(), outcome })
      if (created.log.length > LOG_SIZE) created.log.splice(0, created.log.length - LOG_SIZE)
    }
    const STATUS_TEXT: Record<number, string> = {
      200: "OK",
      201: "Created",
      204: "No Content",
      400: "Bad Request",
      401: "Unauthorized",
      403: "Forbidden",
      404: "Not Found",
      409: "Conflict",
      422: "Unprocessable Content",
      429: "Too Many Requests",
      500: "Internal Server Error",
      502: "Bad Gateway",
      503: "Service Unavailable",
      504: "Gateway Timeout",
    }
    const NO_BODY = [101, 204, 205, 304]
    const parseJson = (text: string): { ok: boolean; value: unknown } => {
      try {
        return { ok: true, value: JSON.parse(text) }
      } catch {
        return { ok: false, value: null }
      }
    }
    const contentType = (body: string) =>
      parseJson(body).ok ? "application/json" : "text/plain;charset=utf-8"
    const headerLines = (text: string): [string, string][] =>
      text.split("\n").flatMap((line) => {
        const at = line.indexOf(":")
        const name = at > 0 ? line.slice(0, at).trim() : ""
        return /^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(name) ? [[name, line.slice(at + 1).trim()]] : []
      })
    const isObject = (value: unknown): value is Record<string, unknown> =>
      typeof value === "object" && value !== null && !Array.isArray(value)
    /** The rule's JSON laid over the server's: objects merged, the rest replaced. */
    const merge = (base: unknown, over: unknown): unknown => {
      if (!isObject(base) || !isObject(over)) return over
      const out: Record<string, unknown> = { ...base }
      for (const [key, value] of Object.entries(over)) out[key] = merge(base[key], value)
      return out
    }
    /**
     * Where a redirected request goes: a full address replaces the whole URL,
     * `$1` taking the match's first group; anything else replaces just the
     * part the match covers.
     */
    const redirected = (rule: Rule, url: string) => {
      rule.pattern!.lastIndex = 0
      if (/^(https?:)?\/\//i.test(rule.target)) {
        const found = rule.pattern!.exec(url) ?? []
        return absolute(rule.target.replace(/\$(\d)/g, (_, group) => found[Number(group)] ?? ""))
      }
      return absolute(url.replace(rule.pattern!, rule.target))
    }
    /** What a `respond` or `modify` answer is made of. */
    interface Answer {
      status: number
      statusText: string
      body: string
      headers: [string, string][]
    }
    const made = (rule: Rule): Answer => {
      const empty = NO_BODY.includes(rule.status)
      const own = headerLines(rule.headers)
      const typed = own.some(([name]) => name.toLowerCase() === "content-type")
      return {
        status: rule.status,
        statusText: STATUS_TEXT[rule.status] ?? "",
        body: empty ? "" : rule.body,
        headers: [
          ...(empty || typed ? [] : [["content-type", contentType(rule.body)] as [string, string]]),
          ...own,
        ],
      }
    }
    const modified = (
      rule: Rule,
      real: { status: number; statusText: string; text: string; headers: [string, string][] }
    ): Answer => {
      let body = real.text
      if (rule.body) {
        const theirs = parseJson(real.text)
        const ours = parseJson(rule.body)
        body = theirs.ok && ours.ok ? JSON.stringify(merge(theirs.value, ours.value)) : rule.body
      }
      const own = headerLines(rule.headers)
      const replaced = new Set(own.map(([name]) => name.toLowerCase()))
      return {
        status: rule.status || real.status,
        statusText: rule.status ? (STATUS_TEXT[rule.status] ?? "") : real.statusText,
        body,
        headers: [
          ...real.headers.filter(
            ([name]) =>
              !replaced.has(name.toLowerCase()) &&
              // The body is decoded and maybe changed: its length and encoding no longer hold.
              !["content-length", "content-encoding"].includes(name.toLowerCase())
          ),
          ...own,
        ],
      }
    }
    const abortError = () => new DOMException("The user aborted a request.", "AbortError")
    const wait = (ms: number, signal?: AbortSignal | null) =>
      new Promise<void>((resolve, reject) => {
        if (signal?.aborted) return reject(abortError())
        if (ms <= 0) return resolve()
        const timer = setTimeout(resolve, ms)
        signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer)
            reject(abortError())
          },
          { once: true }
        )
      })
    const describe = (rule: Rule, answer?: Answer) => {
      switch (rule.action) {
        case "fail":
          return rule.delayMs > 0 ? `network error after ${rule.delayMs} ms` : "network error"
        case "delay":
          return `held ${rule.delayMs} ms`
        case "redirect":
          return "redirected"
        default:
          return String(answer?.status ?? rule.status)
      }
    }

    const originalFetch = window.fetch
    if (typeof originalFetch === "function") {
      window.fetch = function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
        const request = typeof Request === "function" && input instanceof Request ? input : null
        const url = absolute(request ? request.url : String(input))
        const method = String(init?.method ?? request?.method ?? "GET").toUpperCase()
        const rule = find(url, method)
        if (!rule) return originalFetch.call(this, input, init)
        const signal = init?.signal ?? request?.signal ?? null
        const answer = (value: Answer, from: string) => {
          const response = new Response(NO_BODY.includes(value.status) ? null : value.body, {
            status: value.status,
            statusText: value.statusText,
            headers: value.headers,
          })
          // A made response has no address of its own; the page may read one.
          Object.defineProperty(response, "url", { value: from, configurable: true })
          return response
        }
        return wait(rule.delayMs, signal).then(async () => {
          switch (rule.action) {
            case "delay":
              note(rule, method, url, describe(rule))
              return originalFetch.call(this, input, init)
            case "fail":
              note(rule, method, url, describe(rule))
              throw new TypeError("Failed to fetch")
            case "redirect": {
              const target = redirected(rule, url)
              note(rule, method, url, `→ ${target}`)
              return originalFetch.call(this, request ? new Request(target, request) : target, init)
            }
            case "modify": {
              const real = await originalFetch.call(this, input, init)
              // A no-cors answer cannot be read, so it cannot be changed either.
              if (real.type === "opaque" || real.status === 0) {
                note(rule, method, url, "unchanged (opaque response)")
                return real
              }
              const value = modified(rule, {
                status: real.status,
                statusText: real.statusText,
                text: await real.text(),
                headers: [...real.headers.entries()],
              })
              note(rule, method, url, `${describe(rule, value)} (modified)`)
              return answer(value, real.url || url)
            }
            case "respond": {
              const value = made(rule)
              note(rule, method, url, describe(rule, value))
              return answer(value, url)
            }
          }
        })
      } as typeof fetch
    }

    const beacon = typeof navigator.sendBeacon === "function" ? navigator.sendBeacon : null
    if (beacon) {
      navigator.sendBeacon = function (this: Navigator, url: string | URL, data?: BodyInit | null) {
        const absoluteUrl = absolute(String(url))
        const rule = find(absoluteUrl, "POST")
        if (rule?.action === "fail") {
          note(rule, "POST", absoluteUrl, "beacon refused")
          return false
        }
        if (rule?.action === "redirect") {
          const target = redirected(rule, absoluteUrl)
          note(rule, "POST", absoluteUrl, `→ ${target}`)
          return beacon.call(this, target, data)
        }
        if (rule) note(rule, "POST", absoluteUrl, "sent (beacons cannot be answered)")
        return beacon.call(this, url, data)
      }
    }

    const proto = typeof XMLHttpRequest === "function" ? XMLHttpRequest.prototype : null
    if (proto) {
      const open = proto.open
      const send = proto.send
      const setHeader = proto.setRequestHeader
      interface Call {
        method: string
        url: string
        rule: Rule | null
        headers: [string, string][]
      }
      const calls = new WeakMap<XMLHttpRequest, Call>()
      proto.open = function (this: XMLHttpRequest, method: string, url: string | URL) {
        const upper = String(method).toUpperCase()
        const absoluteUrl = absolute(String(url))
        // Decided now, as the browser would route it: a redirect changes
        // what is opened; the rest answer when it is sent.
        const rule = find(absoluteUrl, upper)
        calls.set(this, { method: upper, url: absoluteUrl, rule, headers: [] })
        // eslint-disable-next-line prefer-rest-params -- open's optional arguments, as given
        const args = [...(arguments as unknown as unknown[])]
        if (rule?.action === "redirect") {
          const target = redirected(rule, absoluteUrl)
          note(rule, upper, absoluteUrl, `→ ${target}`)
          args[1] = target
        }
        return open.apply(this, args as unknown as Parameters<typeof open>)
      } as typeof open
      proto.setRequestHeader = function (this: XMLHttpRequest, name: string, value: string) {
        calls.get(this)?.headers.push([name, value])
        return setHeader.call(this, name, value)
      }
      /** Answer an XHR as the rule says, the way the browser would have. */
      const settle = (xhr: XMLHttpRequest, call: Call, value: Answer | null) => {
        const define = (values: Record<string, unknown>) => {
          for (const [key, entry] of Object.entries(values))
            Object.defineProperty(xhr, key, { value: entry, configurable: true })
        }
        const fire = (...types: string[]) => {
          for (const type of types) xhr.dispatchEvent(new ProgressEvent(type))
        }
        if (!value) {
          define({ readyState: 4, status: 0, statusText: "" })
          xhr.dispatchEvent(new Event("readystatechange"))
          fire("error", "loadend")
          return
        }
        let response: unknown = value.body
        if (xhr.responseType === "json") response = parseJson(value.body).value
        const lower = value.headers.map(([name, entry]) => [name.toLowerCase(), entry] as const)
        define({
          readyState: 4,
          status: value.status,
          statusText: value.statusText,
          responseURL: call.url,
          response,
          ...(xhr.responseType === "" || xhr.responseType === "text"
            ? { responseText: value.body }
            : {}),
          getResponseHeader: (name: string) => {
            const found = lower.filter(([key]) => key === name.toLowerCase())
            return found.length > 0 ? found.map(([, entry]) => entry).join(", ") : null
          },
          getAllResponseHeaders: () =>
            lower.map(([name, entry]) => `${name}: ${entry}\r\n`).join(""),
        })
        xhr.dispatchEvent(new Event("readystatechange"))
        fire("load", "loadend")
      }
      proto.send = function (
        this: XMLHttpRequest,
        body?: Document | XMLHttpRequestBodyInit | null
      ) {
        const call = calls.get(this)
        const rule = call?.rule
        if (!call || !rule || rule.action === "redirect") return send.call(this, body)
        let aborted = false
        this.addEventListener("abort", () => (aborted = true), { once: true })
        setTimeout(() => {
          if (aborted) return
          switch (rule.action) {
            case "delay":
              note(rule, call.method, call.url, describe(rule))
              try {
                send.call(this, body)
              } catch {
                // Aborted or re-opened while held back: nothing to send.
              }
              return
            case "fail":
              note(rule, call.method, call.url, describe(rule))
              settle(this, call, null)
              return
            case "respond": {
              const value = made(rule)
              note(rule, call.method, call.url, describe(rule, value))
              settle(this, call, value)
              return
            }
            case "modify":
              // The real answer, fetched as the request would have gone, then changed.
              void originalFetch
                .call(window, call.url, {
                  method: call.method,
                  headers: call.headers,
                  body: body instanceof Document ? null : (body ?? null),
                  credentials: this.withCredentials ? "include" : "same-origin",
                })
                .then(async (real) => {
                  const value = modified(rule, {
                    status: real.status,
                    statusText: real.statusText,
                    text: await real.text(),
                    headers: [...real.headers.entries()],
                  })
                  if (aborted) return
                  note(rule, call.method, call.url, `${describe(rule, value)} (modified)`)
                  settle(this, call, value)
                })
                .catch(() => {
                  if (aborted) return
                  note(rule, call.method, call.url, "network error")
                  settle(this, call, null)
                })
              return
          }
        }, rule.delayMs)
      } as typeof send
    }
  }

  const escape = (value: string) => value.replace(/[.+?^${}()|[\]\\]/g, "\\$&")
  const compile = (match: string): RegExp | null => {
    // Slashes alone make a path, not an expression: `/api/` is a path.
    const literal = /^\/(.*[\\^$.|?+()[\]{].*)\/([dimsu]*)$/.exec(match)
    try {
      if (literal) return new RegExp(literal[1]!, literal[2]!.replace(/[gy]/g, ""))
      return new RegExp(match.split("*").map(escape).join(".*"), "i")
    } catch {
      return null
    }
  }
  const previous = new Map(state.rules.map((rule) => [rule.id, rule.applied]))
  state.rules = rules.map((rule) => ({
    ...rule,
    pattern: compile(rule.match),
    // A rule kept as it was keeps its count against `times`.
    applied: previous.get(rule.id) ?? 0,
  }))
  const kept = new Set(rules.map((rule) => rule.id))
  for (const id of Object.keys(state.hits)) if (!kept.has(id)) delete state.hits[id]
  state.log = state.log.filter((entry) => kept.has(entry.rule))
  try {
    if (keep && rules.length > 0) sessionStorage.setItem(STORE, JSON.stringify(rules))
    else sessionStorage.removeItem(STORE)
  } catch {
    // Storage the page has turned off: the rules last until the reload.
  }
  return report(state)
}

/**
 * At `document_start` in a tab whose rules were kept: put them back before
 * the page's own scripts run. The body of the script the extension registers
 * for the site, in the MAIN world.
 */
export function restoreKeptMocks(): void {
  let saved: unknown = null
  try {
    const raw = sessionStorage.getItem(MOCK_STORE_KEY)
    saved = raw ? JSON.parse(raw) : null
  } catch {
    return
  }
  if (!Array.isArray(saved)) return
  const rules = saved.flatMap((rule) => (cleanMock(rule as RequestMock) ? [rule] : []))
  if (rules.length > 0) mainRequestMocks(rules as RequestMock[], true)
}

/** Whether a match is a regular expression that compiles, or not one at all. */
export function matchIsValid(match: string): boolean {
  const literal = /^\/(.*[\\^$.|?+()[\]{].*)\/([dimsu]*)$/.exec(match.trim())
  if (!literal) return true
  try {
    new RegExp(literal[1]!, literal[2]!.replace(/[gy]/g, ""))
    return true
  } catch {
    return false
  }
}

/** A rule the panel can install: in range, and matching something. */
export function cleanMock(
  mock: Partial<RequestMock> & Pick<RequestMock, "id">
): RequestMock | null {
  const match = String(mock.match ?? "").trim()
  if (!match || match.replace(/\*/g, "") === "" || !matchIsValid(match)) return null
  const method = (MOCK_METHODS as readonly string[]).includes(mock.method ?? "")
    ? (mock.method ?? "")
    : ""
  const action = mock.action
  if (!action || !(MOCK_ACTIONS as readonly string[]).includes(action)) return null
  const status = Math.trunc(Number(mock.status) || 0)
  if (action === "respond" && !(status >= 200 && status <= 599)) return null
  if (action === "modify" && status !== 0 && !(status >= 200 && status <= 599)) return null
  const delayMs = Math.max(0, Math.min(MAX_MOCK_DELAY_MS, Math.trunc(Number(mock.delayMs)) || 0))
  if (action === "delay" && delayMs === 0) return null
  const target = String(mock.target ?? "").trim()
  if (action === "redirect" && !target) return null
  const body = String(mock.body ?? "").slice(0, MAX_MOCK_BODY)
  const headers = String(mock.headers ?? "").slice(0, 2_000)
  if (action === "modify" && status === 0 && !body && !headers.trim()) return null
  const answers = action === "respond" || action === "modify"
  return {
    id: mock.id,
    match: match.slice(0, 500),
    method,
    action,
    status: answers ? status : 0,
    body: answers ? body : "",
    headers: answers ? headers : "",
    target: action === "redirect" ? target.slice(0, 500) : "",
    delayMs,
    times: Math.max(0, Math.min(1_000, Math.trunc(Number(mock.times)) || 0)),
    chance: Math.max(1, Math.min(100, Math.trunc(Number(mock.chance ?? 100)) || 100)),
    enabled: mock.enabled !== false,
  }
}

/** One line for a rule, as the panel and the agent read it. */
export function mockSummary(mock: RequestMock): string {
  const target = `${mock.method || "Any method"} \`${mock.match}\``
  const after = mock.delayMs > 0 ? ` after ${mock.delayMs} ms` : ""
  const limits = [
    mock.times > 0 ? `first ${mock.times} only` : "",
    mock.chance < 100 ? `${mock.chance}% of the time` : "",
    mock.enabled ? "" : "paused",
  ]
    .filter(Boolean)
    .join(", ")
  const tail = limits ? ` (${limits})` : ""
  switch (mock.action) {
    case "fail":
      return `${target} → network error${after}${tail}`
    case "respond":
      return `${target} → ${mock.status}${mock.body ? " with a body" : ""}${after}${tail}`
    case "modify":
      return `${target} → the server's answer${mock.status ? ` as ${mock.status}` : ""}${mock.body ? " with the body changed" : ""}${mock.headers.trim() ? " with headers added" : ""}${after}${tail}`
    case "delay":
      return `${target} → held back ${mock.delayMs} ms, then sent${tail}`
    case "redirect":
      return `${target} → sent to \`${mock.target}\`${after}${tail}`
  }
}

export function mocksMarkdown(mocks: readonly RequestMock[], hits: MockHits | null): string {
  if (mocks.length === 0) return ""
  const lines = [
    `## Simulated requests (${mocks.length})`,
    "",
    "The person made the page's own requests fail, answer, change, wait or go elsewhere on purpose while looking at it. Errors, delays or data from these requests in this report are simulated, not the backend's.",
    "",
  ]
  for (const mock of mocks) {
    const hit = hits?.hits[mock.id]
    const count = hit
      ? ` — matched ${hit.count} time${hit.count === 1 ? "" : "s"}`
      : " — not matched"
    lines.push(`- ${mockSummary(mock)}${count}`)
    if ((mock.action === "respond" || mock.action === "modify") && mock.body)
      lines.push(
        "",
        "  ```",
        ...mock.body
          .slice(0, 1_000)
          .split("\n")
          .map((line) => `  ${line}`),
        "  ```",
        ""
      )
  }
  const recent = hits?.log.slice(-10) ?? []
  if (recent.length > 0) {
    lines.push("", "Requests caught, most recent last:", "")
    for (const entry of recent) {
      let path = entry.url
      try {
        const url = new URL(entry.url)
        path = `${url.pathname}${url.search ? "?…" : ""}`
      } catch {
        // Not a URL: shown as caught.
      }
      lines.push(`- ${entry.method} \`${path}\` → ${entry.outcome}`)
    }
  }
  return lines.join("\n").trimEnd()
}
