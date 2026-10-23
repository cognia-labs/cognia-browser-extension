/**
 * How the page presents itself to search engines and link previews (META
 * SEO inspector, the social card debuggers): the head's metadata, the
 * heading outline, structured data, and what a shared link would show.
 *
 * Read from the document as it is now, so a single-page app's client-set
 * title and tags count — which is what a crawler that renders sees, and what
 * the person wants checked. The findings are a checklist of common mistakes,
 * not a ranking promise.
 */
import { bareUrl, visibleText } from "./element-context"

export type SeoSeverity = "error" | "warning" | "info"

export const SEO_RULES = [
  "title-missing",
  "title-length",
  "description-missing",
  "description-length",
  "canonical-missing",
  "canonical-multiple",
  "noindex",
  "viewport-missing",
  "h1-count",
  "og-missing",
  "og-image-relative",
  "twitter-missing",
  "structured-data-missing",
  "structured-data-invalid",
  "image-alt",
  "link-text",
] as const

export type SeoRule = (typeof SEO_RULES)[number]

export interface SeoIssue {
  rule: SeoRule
  severity: SeoSeverity
  detail?: string
}

export interface SeoReport {
  tabId: number
  ranAt: number
  url: string
  title: string | null
  description: string | null
  canonical: string | null
  robots: string | null
  lang: string | null
  viewport: string | null
  /** Open Graph and Twitter card properties, as the page declares them. */
  social: { property: string; content: string }[]
  /** Schema.org types from JSON-LD and microdata. */
  structuredData: string[]
  alternates: { lang: string; href: string }[]
  headings: { level: number; text: string }[]
  counts: {
    h1: number
    images: number
    imagesWithoutAlt: number
    links: number
    internalLinks: number
    nofollowLinks: number
    linksWithoutText: number
    words: number
  }
  issues: SeoIssue[]
}

export const TITLE_RANGE = [15, 60] as const
export const DESCRIPTION_RANGE = [50, 160] as const
const MAX_HEADINGS = 40
const MAX_TEXT = 120
const MAX_SOCIAL = 20

/** Problems first, then what is merely missing. */
const SEVERITY_ORDER: Record<SeoSeverity, number> = { error: 0, warning: 1, info: 2 }

function collapse(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim()
}

function clip(value: string, max = MAX_TEXT): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

function meta(doc: Document, key: string): string | null {
  for (const element of doc.querySelectorAll("meta")) {
    const name = (
      element.getAttribute("name") ??
      element.getAttribute("property") ??
      ""
    ).toLowerCase()
    if (name === key) return collapse(element.getAttribute("content")) || null
  }
  return null
}

/** Schema.org types named in a JSON-LD value, however deep the graph nests them. */
function ldTypes(value: unknown, into: Set<string>, depth = 0): void {
  if (depth > 6 || into.size >= 20) return
  if (Array.isArray(value)) {
    for (const item of value) ldTypes(item, into, depth + 1)
    return
  }
  if (!value || typeof value !== "object") return
  const record = value as Record<string, unknown>
  const type = record["@type"]
  for (const name of Array.isArray(type) ? type : [type])
    if (typeof name === "string" && name) into.add(name.slice(0, 60))
  if (record["@graph"]) ldTypes(record["@graph"], into, depth + 1)
}

export function checkSeo(doc: Document): Omit<SeoReport, "tabId" | "ranAt"> {
  const base = doc.baseURI
  const here = (() => {
    try {
      return new URL(base)
    } catch {
      return null
    }
  })()
  const issues: SeoIssue[] = []
  const report = (rule: SeoRule, severity: SeoSeverity, detail?: string) =>
    issues.push({ rule, severity, ...(detail ? { detail } : {}) })

  const title = collapse(doc.title) || null
  if (!title) report("title-missing", "error")
  else if (title.length < TITLE_RANGE[0] || title.length > TITLE_RANGE[1])
    report(
      "title-length",
      "warning",
      `${title.length} characters, aim for ${TITLE_RANGE[0]}–${TITLE_RANGE[1]}`
    )

  const description = meta(doc, "description")
  if (!description) report("description-missing", "warning")
  else if (description.length < DESCRIPTION_RANGE[0] || description.length > DESCRIPTION_RANGE[1])
    report(
      "description-length",
      "info",
      `${description.length} characters, aim for ${DESCRIPTION_RANGE[0]}–${DESCRIPTION_RANGE[1]}`
    )

  const canonicals = [...doc.querySelectorAll('link[rel~="canonical" i]')]
  const canonicalHref = canonicals[0]?.getAttribute("href")
  const canonical = canonicalHref ? bareUrl(canonicalHref, base) : null
  if (canonicals.length === 0) report("canonical-missing", "info")
  else if (canonicals.length > 1)
    report("canonical-multiple", "error", `${canonicals.length} canonical links`)

  const robots = meta(doc, "robots")
  if (robots && /noindex/i.test(robots)) report("noindex", "warning", robots)

  const viewport = meta(doc, "viewport")
  if (!viewport) report("viewport-missing", "warning")

  const social: SeoReport["social"] = []
  for (const element of doc.querySelectorAll("meta[property], meta[name]")) {
    const property = (
      element.getAttribute("property") ??
      element.getAttribute("name") ??
      ""
    ).toLowerCase()
    if (!property.startsWith("og:") && !property.startsWith("twitter:")) continue
    if (social.length >= MAX_SOCIAL) break
    let content = collapse(element.getAttribute("content"))
    if (/:(image|url)(:secure_url)?$/.test(property) && content) content = bareUrl(content, base)
    social.push({ property, content: clip(content, 300) })
  }
  const og = (key: string) => social.find((entry) => entry.property === `og:${key}`)?.content
  const missingOg = ["title", "description", "image"].filter((key) => !og(key))
  if (missingOg.length > 0)
    report(
      "og-missing",
      missingOg.includes("image") ? "warning" : "info",
      missingOg.map((key) => `og:${key}`).join(", ")
    )
  const rawImage = [...doc.querySelectorAll('meta[property="og:image" i]')][0]?.getAttribute(
    "content"
  )
  if (rawImage && !/^https?:\/\//i.test(rawImage.trim()))
    report("og-image-relative", "warning", clip(rawImage.trim(), 80))
  if (!social.some((entry) => entry.property === "twitter:card")) report("twitter-missing", "info")

  const types = new Set<string>()
  let invalid = 0
  for (const script of doc.querySelectorAll('script[type="application/ld+json" i]')) {
    try {
      ldTypes(JSON.parse(script.textContent ?? ""), types)
    } catch {
      invalid++
    }
  }
  for (const element of doc.querySelectorAll("[itemscope][itemtype]")) {
    for (const type of (element.getAttribute("itemtype") ?? "").split(/\s+/))
      if (type) types.add(type.replace(/^https?:\/\/schema\.org\//i, "").slice(0, 60))
  }
  const structuredData = [...types].slice(0, 20)
  if (invalid > 0)
    report("structured-data-invalid", "error", `${invalid} JSON-LD blocks do not parse`)
  else if (structuredData.length === 0) report("structured-data-missing", "info")

  const alternates = [...doc.querySelectorAll('link[rel~="alternate" i][hreflang]')]
    .slice(0, 20)
    .map((link) => ({
      lang: link.getAttribute("hreflang") ?? "",
      href: bareUrl(link.getAttribute("href") ?? "", base),
    }))

  const headingElements = [...doc.querySelectorAll("h1, h2, h3, h4, h5, h6")]
  const headings = headingElements.slice(0, MAX_HEADINGS).map((heading) => ({
    level: Number(heading.tagName.slice(1)),
    text: clip(visibleText(heading) || collapse(heading.textContent)),
  }))
  const h1 = headingElements.filter((heading) => heading.tagName === "H1").length
  if (h1 !== 1) report("h1-count", h1 === 0 ? "warning" : "info", `${h1} h1 elements`)

  const images = [...doc.images]
  const imagesWithoutAlt = images.filter((image) => !image.hasAttribute("alt")).length
  if (imagesWithoutAlt > 0)
    report("image-alt", "warning", `${imagesWithoutAlt} of ${images.length} images`)

  const links = [...doc.querySelectorAll("a[href]")]
  let internalLinks = 0
  let nofollowLinks = 0
  let linksWithoutText = 0
  for (const link of links) {
    try {
      const target = new URL(link.getAttribute("href") ?? "", base)
      if (here && target.origin === here.origin) internalLinks++
    } catch {
      // A malformed address links nowhere; it is still a link to count.
    }
    if (/\bnofollow\b/i.test(link.getAttribute("rel") ?? "")) nofollowLinks++
    const named =
      collapse(link.textContent) ||
      link.getAttribute("aria-label")?.trim() ||
      link.getAttribute("title")?.trim() ||
      link.querySelector("img[alt]:not([alt=''])")
    if (!named) linksWithoutText++
  }
  if (linksWithoutText > 0) report("link-text", "warning", `${linksWithoutText} links`)

  const words = collapse(doc.body ? visibleText(doc.body, 1_000_000) : "")
    .split(" ")
    .filter(Boolean).length

  issues.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
  return {
    url: here ? bareUrl(here.href, base) : "",
    title,
    description,
    canonical,
    robots,
    lang: doc.documentElement.getAttribute("lang")?.trim() || null,
    viewport,
    social,
    structuredData,
    alternates,
    headings,
    counts: {
      h1,
      images: images.length,
      imagesWithoutAlt,
      links: links.length,
      internalLinks,
      nofollowLinks,
      linksWithoutText,
      words,
    },
    issues,
  }
}

export const SEO_RULE_TEXT: Record<SeoRule, string> = {
  "title-missing": "The page has no title",
  "title-length": "The title is likely to be cut or too thin in results",
  "description-missing": "No meta description",
  "description-length": "The meta description is likely to be cut or too thin",
  "canonical-missing": "No canonical link",
  "canonical-multiple": "More than one canonical link",
  noindex: "Robots are told not to index the page",
  "viewport-missing": "No viewport meta tag, so phones render it zoomed out",
  "h1-count": "There should be exactly one h1",
  "og-missing": "Open Graph tags for link previews are missing",
  "og-image-relative": "og:image is not an absolute URL, so previews cannot load it",
  "twitter-missing": "No Twitter card",
  "structured-data-missing": "No structured data (JSON-LD or microdata)",
  "structured-data-invalid": "Structured data that does not parse",
  "image-alt": "Images without alt text",
  "link-text": "Links with no text to describe them",
}

export function seoMarkdown(report: Omit<SeoReport, "tabId" | "ranAt">): string {
  const lines = ["## SEO and link previews", ""]
  const quoted = (value: string | null) => (value ? `"${value}" (${value.length})` : "missing")
  lines.push(
    `- Title: ${quoted(report.title)}`,
    `- Description: ${quoted(report.description)}`,
    `- Canonical: ${report.canonical ? `\`${report.canonical}\`` : "missing"}`,
    `- Robots: ${report.robots ?? "not set (indexable)"}`,
    `- Language: ${report.lang ?? "not set"}; viewport: ${report.viewport ?? "missing"}`,
    `- Structured data: ${report.structuredData.length > 0 ? report.structuredData.join(", ") : "none"}`,
    `- Content: ${report.counts.words} words, ${report.counts.images} images (${report.counts.imagesWithoutAlt} without alt), ${report.counts.links} links (${report.counts.internalLinks} internal, ${report.counts.nofollowLinks} nofollow)`
  )
  if (report.issues.length > 0) {
    lines.push("", `### Findings (${report.issues.length})`, "")
    for (const issue of report.issues)
      lines.push(
        `- [${issue.severity}] ${SEO_RULE_TEXT[issue.rule]}${issue.detail ? ` (${issue.detail})` : ""}`
      )
  }
  if (report.social.length > 0) {
    lines.push("", "### Link preview tags", "")
    for (const entry of report.social) lines.push(`- \`${entry.property}\`: ${entry.content}`)
  }
  if (report.alternates.length > 0) {
    lines.push("", "### Language alternates", "")
    for (const entry of report.alternates) lines.push(`- ${entry.lang}: \`${entry.href}\``)
  }
  if (report.headings.length > 0) {
    lines.push("", "### Heading outline", "", "```text")
    for (const heading of report.headings)
      lines.push(
        `${"  ".repeat(Math.max(0, heading.level - 1))}h${heading.level} ${heading.text || "(empty)"}`
      )
    lines.push("```")
  }
  return lines.join("\n")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

const text = (value: unknown): string | null => (typeof value === "string" ? value : null)

/** A stored SEO read this build can show, from an unsent draft; malformed parts are dropped. */
export function parseSeo(value: unknown): Omit<SeoReport, "tabId" | "ranAt"> | null {
  if (!isRecord(value) || !isRecord(value.counts)) return null
  const counts = value.counts
  const count = (key: string) => (typeof counts[key] === "number" ? (counts[key] as number) : 0)
  const list = <T>(raw: unknown, guard: (item: unknown) => item is T, max: number): T[] =>
    Array.isArray(raw) ? raw.filter(guard).slice(0, max) : []
  return {
    url: text(value.url) ?? "",
    title: text(value.title),
    description: text(value.description),
    canonical: text(value.canonical),
    robots: text(value.robots),
    lang: text(value.lang),
    viewport: text(value.viewport),
    social: list(
      value.social,
      (item): item is { property: string; content: string } =>
        isRecord(item) && typeof item.property === "string" && typeof item.content === "string",
      MAX_SOCIAL
    ),
    structuredData: list(
      value.structuredData,
      (item): item is string => typeof item === "string",
      20
    ),
    alternates: list(
      value.alternates,
      (item): item is { lang: string; href: string } =>
        isRecord(item) && typeof item.lang === "string" && typeof item.href === "string",
      20
    ),
    headings: list(
      value.headings,
      (item): item is { level: number; text: string } =>
        isRecord(item) && typeof item.level === "number" && typeof item.text === "string",
      MAX_HEADINGS
    ),
    counts: {
      h1: count("h1"),
      images: count("images"),
      imagesWithoutAlt: count("imagesWithoutAlt"),
      links: count("links"),
      internalLinks: count("internalLinks"),
      nofollowLinks: count("nofollowLinks"),
      linksWithoutText: count("linksWithoutText"),
      words: count("words"),
    },
    issues: list(
      value.issues,
      (item): item is SeoIssue =>
        isRecord(item) &&
        (SEO_RULES as readonly unknown[]).includes(item.rule) &&
        ["error", "warning", "info"].includes(item.severity as string) &&
        (item.detail === undefined || typeof item.detail === "string"),
      SEO_RULES.length
    ),
  }
}
