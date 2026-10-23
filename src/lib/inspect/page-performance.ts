/**
 * How the page loads and responds (Lighthouse, the Web Vitals extension), as
 * the browser itself measured it — no reload, no throttling, no lab.
 *
 * Every page keeps a performance timeline from the moment it starts loading:
 * navigation and paint timings, the largest contentful paint, layout shifts,
 * long tasks and long animation frames, slow interactions, every resource.
 * Reading it buffered answers what happened to this visit, which is what the
 * person is looking at and complaining about. What it says is a field
 * measurement of one visit, and the report says so.
 *
 * Runs in the page's MAIN world, serialized by `chrome.scripting`: everything
 * it needs is inside the function.
 */

export interface PagePerformance {
  tabId: number
  ranAt: number
  navigation: {
    type: string
    /** Milliseconds from the start of navigation; null where the page did not get there. */
    ttfb: number | null
    fcp: number | null
    domContentLoaded: number | null
    load: number | null
    transferBytes: number | null
  }
  lcp: { ms: number; element?: string } | null
  /** Cumulative layout shift: the worst session window, as Web Vitals counts it. */
  cls: number | null
  /** The slowest interaction on record — INP for a short visit. */
  interaction: { ms: number; event: string; target?: string } | null
  longTasks: { count: number; blockingMs: number }
  /** Scripts behind long animation frames, worst first. */
  scripts: { source: string; invoker: string; ms: number }[]
  resources: {
    count: number
    bytes: number
    byType: { type: string; count: number; bytes: number }[]
    largest: { url: string; type: string; bytes: number }[]
    slowest: { url: string; type: string; ms: number }[]
    renderBlocking: string[]
    thirdParty: { host: string; count: number; bytes: number }[]
  }
  images: {
    /** Served much larger than shown. */
    oversized: { element: string; natural: string; shown: string }[]
    /** Without width and height, so the layout shifts when they load. */
    unsized: number
  }
  dom: { elements: number; depth: number; heapMb?: number }
}

/** Runs in the page's MAIN world; serialized by `chrome.scripting`. */
export function mainPagePerformance(): Omit<PagePerformance, "tabId" | "ranAt"> {
  const round = (value: number) => Math.round(value)
  const label = (node: unknown): string | undefined => {
    if (!node || typeof node !== "object" || (node as Node).nodeType !== 1) return undefined
    const element = node as Element
    const tag = element.tagName.toLowerCase()
    if (element.id) return `${tag}#${element.id}`.slice(0, 80)
    const classes = [...element.classList].filter((name) => name.length < 30).slice(0, 2)
    return (classes.length > 0 ? `${tag}.${classes.join(".")}` : tag).slice(0, 80)
  }
  const bare = (raw: string): string => {
    try {
      const url = new URL(raw, location.href)
      if (url.protocol === "data:") return "data:…"
      return `${url.origin}${url.pathname}`.slice(0, 160)
    } catch {
      return raw.slice(0, 160)
    }
  }
  const buffered = (type: string): PerformanceEntry[] => {
    try {
      const observer = new PerformanceObserver(() => undefined)
      observer.observe({ type, buffered: true })
      const entries = observer.takeRecords()
      observer.disconnect()
      return entries
    } catch {
      return []
    }
  }

  const navigationEntry = performance.getEntriesByType("navigation")[0] as
    PerformanceNavigationTiming | undefined
  const fcpEntry = performance
    .getEntriesByType("paint")
    .find((entry) => entry.name === "first-contentful-paint")
  const positive = (value: number | undefined) =>
    value !== undefined && value > 0 ? round(value) : null

  const lcpEntries = buffered("largest-contentful-paint") as (PerformanceEntry & {
    element?: Element | null
  })[]
  const lcpLast = lcpEntries.at(-1)

  // Layout shifts in session windows: gaps under 1s, windows under 5s.
  let cls: number | null = null
  const shifts = buffered("layout-shift") as (PerformanceEntry & {
    value: number
    hadRecentInput: boolean
  })[]
  const observable = (type: string) =>
    typeof PerformanceObserver !== "undefined" &&
    (PerformanceObserver.supportedEntryTypes ?? []).includes(type)
  if (observable("layout-shift")) {
    let worst = 0
    let current = 0
    let first = 0
    let last = 0
    for (const shift of shifts) {
      if (shift.hadRecentInput) continue
      if (current > 0 && shift.startTime - last < 1_000 && shift.startTime - first < 5_000) {
        current += shift.value
      } else {
        current = shift.value
        first = shift.startTime
      }
      last = shift.startTime
      worst = Math.max(worst, current)
    }
    cls = Math.round(worst * 1000) / 1000
  }

  const events = buffered("event") as (PerformanceEntry & {
    interactionId?: number
    target?: Element | null
  })[]
  let interaction: PagePerformance["interaction"] = null
  for (const entry of events) {
    if (!entry.interactionId) continue
    if (!interaction || entry.duration > interaction.ms) {
      const target = label(entry.target)
      interaction = { ms: round(entry.duration), event: entry.name, ...(target ? { target } : {}) }
    }
  }

  const longTasks = buffered("longtask")
  const blockingMs = longTasks.reduce((sum, task) => sum + Math.max(0, task.duration - 50), 0)

  const scriptTimes = new Map<string, { source: string; invoker: string; ms: number }>()
  for (const frame of buffered("long-animation-frame") as (PerformanceEntry & {
    scripts?: { sourceURL?: string; invoker?: string; duration: number }[]
  })[]) {
    for (const script of frame.scripts ?? []) {
      // An inline script is attributed to the document that holds it.
      const fromUrl = script.sourceURL ? bare(script.sourceURL) : ""
      const source = !fromUrl || fromUrl === bare(location.href) ? "(inline script)" : fromUrl
      const invoker = (script.invoker ?? "").slice(0, 80)
      const key = `${source} ${invoker}`
      const known = scriptTimes.get(key)
      if (known) known.ms += script.duration
      else scriptTimes.set(key, { source, invoker, ms: script.duration })
    }
  }
  const scripts = [...scriptTimes.values()]
    .map((script) => ({ ...script, ms: round(script.ms) }))
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 5)

  const resourceEntries = performance.getEntriesByType("resource") as (PerformanceResourceTiming & {
    renderBlockingStatus?: string
  })[]
  const byType = new Map<string, { type: string; count: number; bytes: number }>()
  const hosts = new Map<string, { host: string; count: number; bytes: number }>()
  let bytes = 0
  for (const entry of resourceEntries) {
    const size = entry.transferSize || entry.encodedBodySize || 0
    bytes += size
    const type = entry.initiatorType || "other"
    const known = byType.get(type) ?? { type, count: 0, bytes: 0 }
    known.count++
    known.bytes += size
    byType.set(type, known)
    try {
      const url = new URL(entry.name)
      if (url.host !== location.host) {
        const host = hosts.get(url.host) ?? { host: url.host, count: 0, bytes: 0 }
        host.count++
        host.bytes += size
        hosts.set(url.host, host)
      }
    } catch {
      // Not an address: nothing to group.
    }
  }
  const sized = resourceEntries.map((entry) => ({
    url: bare(entry.name),
    type: entry.initiatorType || "other",
    bytes: entry.transferSize || entry.encodedBodySize || 0,
    ms: round(entry.duration),
  }))

  const oversized: PagePerformance["images"]["oversized"] = []
  let unsized = 0
  const dpr = window.devicePixelRatio || 1
  for (const image of [...document.images].slice(0, 500)) {
    if (!image.complete || image.naturalWidth === 0) continue
    const rect = image.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) continue
    if (!image.hasAttribute("width") || !image.hasAttribute("height")) {
      const style = image.getAttribute("style") ?? ""
      if (!/width|height|aspect-ratio/.test(style)) unsized++
    }
    const needed = rect.width * dpr * rect.height * dpr
    const served = image.naturalWidth * image.naturalHeight
    if (served > needed * 2.25 && served - needed > 100_000 && oversized.length < 8) {
      oversized.push({
        element: label(image) ?? "img",
        natural: `${image.naturalWidth}×${image.naturalHeight}`,
        shown: `${round(rect.width)}×${round(rect.height)}`,
      })
    }
  }

  let elements = 0
  let depth = 0
  const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT)
  for (
    let node: Node | null = walker.currentNode;
    node && elements < 50_000;
    node = walker.nextNode()
  ) {
    elements++
    if (elements % 25 === 0 || !node.firstChild) {
      let level = 0
      for (let up: Node | null = node; up; up = up.parentNode) level++
      depth = Math.max(depth, level - 1)
    }
  }
  const memory = (performance as { memory?: { usedJSHeapSize?: number } }).memory

  return {
    navigation: {
      type: navigationEntry?.type ?? "navigate",
      ttfb: positive(navigationEntry?.responseStart),
      fcp: positive(fcpEntry?.startTime),
      domContentLoaded: positive(navigationEntry?.domContentLoadedEventEnd),
      load: positive(navigationEntry?.loadEventEnd),
      transferBytes: navigationEntry ? navigationEntry.transferSize || null : null,
    },
    lcp: lcpLast
      ? (() => {
          const element = label(lcpLast.element)
          return { ms: round(lcpLast.startTime), ...(element ? { element } : {}) }
        })()
      : null,
    cls,
    interaction,
    longTasks: { count: longTasks.length, blockingMs: round(blockingMs) },
    scripts,
    resources: {
      count: resourceEntries.length,
      bytes,
      byType: [...byType.values()].sort((a, b) => b.bytes - a.bytes).slice(0, 8),
      largest: [...sized]
        .filter((entry) => entry.bytes > 0)
        .sort((a, b) => b.bytes - a.bytes)
        .slice(0, 6)
        .map(({ url, type, bytes: size }) => ({ url, type, bytes: size })),
      slowest: [...sized]
        .sort((a, b) => b.ms - a.ms)
        .slice(0, 5)
        .map(({ url, type, ms }) => ({ url, type, ms })),
      renderBlocking: resourceEntries
        .filter((entry) => entry.renderBlockingStatus === "blocking")
        .map((entry) => bare(entry.name))
        .slice(0, 8),
      thirdParty: [...hosts.values()].sort((a, b) => b.bytes - a.bytes).slice(0, 6),
    },
    images: { oversized, unsized },
    dom: {
      elements,
      depth,
      ...(memory?.usedJSHeapSize ? { heapMb: Math.round(memory.usedJSHeapSize / 1e5) / 10 } : {}),
    },
  }
}

export type Rating = "good" | "needs-improvement" | "poor"

export type VitalName = "lcp" | "cls" | "inp" | "fcp" | "ttfb" | "tbt"

/** Web Vitals' own thresholds: good up to the first, poor beyond the second. */
export const VITAL_THRESHOLDS: Record<VitalName, [number, number]> = {
  lcp: [2_500, 4_000],
  cls: [0.1, 0.25],
  inp: [200, 500],
  fcp: [1_800, 3_000],
  ttfb: [800, 1_800],
  tbt: [200, 600],
}

export function rate(name: VitalName, value: number): Rating {
  const [good, poor] = VITAL_THRESHOLDS[name]
  return value <= good ? "good" : value <= poor ? "needs-improvement" : "poor"
}

/** The vitals that were measured, in the order they matter. */
export function vitals(
  performance: Omit<PagePerformance, "tabId" | "ranAt">
): { name: VitalName; value: number; rating: Rating }[] {
  const values: [VitalName, number | null | undefined][] = [
    ["lcp", performance.lcp?.ms],
    ["cls", performance.cls],
    ["inp", performance.interaction?.ms],
    ["fcp", performance.navigation.fcp],
    ["ttfb", performance.navigation.ttfb],
    ["tbt", performance.longTasks.blockingMs],
  ]
  return values
    .filter((entry): entry is [VitalName, number] => typeof entry[1] === "number")
    .map(([name, value]) => ({ name, value, rating: rate(name, value) }))
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

export function formatVital(name: VitalName, value: number): string {
  if (name === "cls") return value.toFixed(3)
  return value >= 1_000 ? `${(value / 1000).toFixed(2)} s` : `${value} ms`
}

const VITAL_TITLES: Record<VitalName, string> = {
  lcp: "Largest contentful paint",
  cls: "Cumulative layout shift",
  inp: "Slowest interaction (≈ INP)",
  fcp: "First contentful paint",
  ttfb: "Time to first byte",
  tbt: "Main thread blocked (TBT, from long tasks)",
}

export function performanceMarkdown(report: Omit<PagePerformance, "tabId" | "ranAt">): string {
  const lines = [
    "## Performance (this visit)",
    "",
    "Field measurements of the visit on screen, from the browser's performance timeline; not a lab run. Ratings use Web Vitals thresholds.",
    "",
  ]
  for (const vital of vitals(report)) {
    let extra = ""
    if (vital.name === "lcp" && report.lcp?.element) extra = ` — \`${report.lcp.element}\``
    if (vital.name === "inp" && report.interaction)
      extra = ` — ${report.interaction.event}${report.interaction.target ? ` on \`${report.interaction.target}\`` : ""}`
    if (vital.name === "tbt") extra = ` — ${report.longTasks.count} long tasks`
    lines.push(
      `- ${VITAL_TITLES[vital.name]}: ${formatVital(vital.name, vital.value)} (${vital.rating})${extra}`
    )
  }
  const nav = report.navigation
  const loads = [
    nav.domContentLoaded !== null
      ? `DOMContentLoaded ${formatVital("fcp", nav.domContentLoaded)}`
      : null,
    nav.load !== null ? `load ${formatVital("fcp", nav.load)}` : null,
  ].filter(Boolean)
  if (loads.length > 0) lines.push(`- Navigation (${nav.type}): ${loads.join(", ")}`)
  const { resources } = report
  lines.push(
    `- Resources: ${resources.count}, ${formatBytes(resources.bytes)} transferred${
      resources.byType.length > 0
        ? ` (${resources.byType.map((entry) => `${entry.type} ${formatBytes(entry.bytes)}`).join(", ")})`
        : ""
    }`
  )
  lines.push(
    `- DOM: ${report.dom.elements} elements, ${report.dom.depth} deep${report.dom.heapMb !== undefined ? `; JS heap ${report.dom.heapMb} MB` : ""}`
  )
  if (report.scripts.length > 0) {
    lines.push("", "### Scripts behind long frames", "")
    for (const script of report.scripts)
      lines.push(
        `- \`${script.source}\`${script.invoker ? ` (${script.invoker})` : ""}: ${script.ms} ms`
      )
  }
  if (resources.renderBlocking.length > 0) {
    lines.push("", "### Render-blocking resources", "")
    for (const url of resources.renderBlocking) lines.push(`- \`${url}\``)
  }
  if (resources.largest.length > 0) {
    lines.push("", "### Largest resources", "")
    for (const entry of resources.largest)
      lines.push(`- \`${entry.url}\` (${entry.type}): ${formatBytes(entry.bytes)}`)
  }
  if (resources.slowest.length > 0) {
    lines.push("", "### Slowest resources", "")
    for (const entry of resources.slowest)
      lines.push(`- \`${entry.url}\` (${entry.type}): ${entry.ms} ms`)
  }
  if (resources.thirdParty.length > 0) {
    lines.push("", "### Third-party hosts", "")
    for (const host of resources.thirdParty)
      lines.push(`- ${host.host}: ${host.count} requests, ${formatBytes(host.bytes)}`)
  }
  if (report.images.oversized.length > 0 || report.images.unsized > 0) {
    lines.push("", "### Images", "")
    for (const image of report.images.oversized)
      lines.push(`- \`${image.element}\` is served at ${image.natural} but shown at ${image.shown}`)
    if (report.images.unsized > 0)
      lines.push(
        `- ${report.images.unsized} images have no width and height, so the layout shifts as they load`
      )
  }
  return lines.join("\n")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

const numberOr = <T>(value: unknown, fallback: T): number | T =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback

const listOf = <T>(value: unknown, guard: (item: unknown) => item is T, max = 10): T[] =>
  Array.isArray(value) ? value.filter(guard).slice(0, max) : []

const hasStrings =
  (...keys: string[]) =>
  (item: unknown): item is never =>
    isRecord(item) && keys.every((key) => typeof item[key] === "string")

/**
 * A stored performance read this build can show, from an unsent draft.
 * Malformed parts are dropped; the check can always be run again.
 */
export function parsePerformance(value: unknown): Omit<PagePerformance, "tabId" | "ranAt"> | null {
  if (!isRecord(value) || !isRecord(value.navigation) || !isRecord(value.resources)) return null
  const nav = value.navigation
  const resources = value.resources
  const images = isRecord(value.images) ? value.images : {}
  const dom = isRecord(value.dom) ? value.dom : {}
  const longTasks = isRecord(value.longTasks) ? value.longTasks : {}
  const lcp = isRecord(value.lcp) ? value.lcp : null
  const interaction = isRecord(value.interaction) ? value.interaction : null
  return {
    navigation: {
      type: typeof nav.type === "string" ? nav.type : "navigate",
      ttfb: numberOr(nav.ttfb, null),
      fcp: numberOr(nav.fcp, null),
      domContentLoaded: numberOr(nav.domContentLoaded, null),
      load: numberOr(nav.load, null),
      transferBytes: numberOr(nav.transferBytes, null),
    },
    lcp:
      lcp && typeof lcp.ms === "number"
        ? { ms: lcp.ms, ...(typeof lcp.element === "string" ? { element: lcp.element } : {}) }
        : null,
    cls: numberOr(value.cls, null),
    interaction:
      interaction && typeof interaction.ms === "number" && typeof interaction.event === "string"
        ? {
            ms: interaction.ms,
            event: interaction.event,
            ...(typeof interaction.target === "string" ? { target: interaction.target } : {}),
          }
        : null,
    longTasks: {
      count: numberOr(longTasks.count, 0),
      blockingMs: numberOr(longTasks.blockingMs, 0),
    },
    scripts: listOf(value.scripts, hasStrings("source", "invoker")),
    resources: {
      count: numberOr(resources.count, 0),
      bytes: numberOr(resources.bytes, 0),
      byType: listOf(resources.byType, hasStrings("type")),
      largest: listOf(resources.largest, hasStrings("url", "type")),
      slowest: listOf(resources.slowest, hasStrings("url", "type")),
      renderBlocking: listOf(
        resources.renderBlocking,
        (item): item is string => typeof item === "string"
      ),
      thirdParty: listOf(resources.thirdParty, hasStrings("host")),
    },
    images: {
      oversized: listOf(images.oversized, hasStrings("element", "natural", "shown")),
      unsized: numberOr(images.unsized, 0),
    },
    dom: {
      elements: numberOr(dom.elements, 0),
      depth: numberOr(dom.depth, 0),
      ...(typeof dom.heapMb === "number" ? { heapMb: dom.heapMb } : {}),
    },
  }
}
