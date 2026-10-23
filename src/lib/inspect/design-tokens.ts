/**
 * The design system a page actually uses, read off its rendered elements
 * (CSS Peeper, ColorZilla, WhatFont).
 *
 * Counted rather than declared: a stylesheet can define forty greys and use
 * three, and the three are what a new screen should match. Colours resolve to
 * sRGB hex through the canvas (`page-colors.ts`); type is the family, size,
 * weight and line height of text that is actually shown; spacing, radii and
 * shadows are the values elements carry. What the page declares is read too —
 * the custom properties on `:root` and the widths its media queries switch
 * at — because those are the names the source uses.
 */
import { createVisibility, hidesFromView } from "./element-context"
import { createColorReader, toHex } from "./page-colors"

export type ColorUse = "text" | "background" | "border"

export interface ColorToken {
  hex: string
  count: number
  uses: ColorUse[]
}

export interface TypeToken {
  family: string
  size: string
  weight: string
  lineHeight: string
  count: number
  /** A little of the text set this way. */
  sample: string
}

export interface CountedValue {
  value: string
  count: number
}

export interface DesignTokens {
  tabId: number
  ranAt: number
  colors: ColorToken[]
  fonts: CountedValue[]
  type: TypeToken[]
  spacing: CountedValue[]
  radii: CountedValue[]
  shadows: CountedValue[]
  /** Custom properties on `:root`, as computed. */
  variables: { name: string; value: string }[]
  /** Widths the page's media queries switch at, ascending. */
  breakpoints: string[]
  scanned: number
}

const MAX_SCANNED = 3_000
const LIMITS = { colors: 24, fonts: 6, type: 12, spacing: 14, radii: 8, shadows: 6, variables: 80 }
const SPACING = [
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "row-gap",
  "column-gap",
] as const

function counter() {
  const counts = new Map<string, number>()
  return {
    add: (value: string) => counts.set(value, (counts.get(value) ?? 0) + 1),
    top: (limit: number): CountedValue[] =>
      [...counts]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, limit),
  }
}

function firstFamily(family: string): string {
  return (family.split(",")[0] ?? family).trim().replace(/^["']|["']$/g, "")
}

/** Media-query widths from every stylesheet the page lets this world read. */
function breakpointsOf(doc: Document): string[] {
  const widths = new Map<number, string>()
  const visit = (rules: CSSRuleList | undefined, depth: number) => {
    if (!rules || depth > 3) return
    for (const rule of rules) {
      const condition =
        (rule as CSSMediaRule).conditionText ?? (rule as CSSMediaRule).media?.mediaText
      if (typeof condition === "string") {
        for (const match of condition.matchAll(/(?:min|max)-width\s*:\s*([\d.]+)(px|em|rem)/g)) {
          const value = Number(match[1])
          const px = match[2] === "px" ? value : value * 16
          if (!widths.has(px)) widths.set(px, `${match[1]}${match[2]}`)
        }
      }
      visit((rule as CSSGroupingRule).cssRules, depth + 1)
    }
  }
  for (const sheet of doc.styleSheets) {
    try {
      visit(sheet.cssRules, 0)
    } catch {
      // A cross-origin stylesheet keeps its rules to itself.
    }
  }
  return [...widths].sort(([a], [b]) => a - b).map(([, label]) => label)
}

export function collectDesignTokens(doc: Document): Omit<DesignTokens, "tabId" | "ranAt"> {
  const view = doc.defaultView
  const readColor = createColorReader()
  const colors = new Map<string, ColorToken>()
  const fonts = counter()
  const spacing = counter()
  const radii = counter()
  const shadows = counter()
  const type = new Map<string, TypeToken>()
  // Every box on screen counts toward colours and spacing; text is sampled
  // only where a pick may read it — never a field's or an editor's contents.
  const visible = createVisibility(hidesFromView)
  const readable = createVisibility()
  const addColor = (css: string, use: ColorUse) => {
    const rgba = readColor(css)
    if (!rgba || rgba[3] === 0) return
    const hex = toHex(rgba)
    const token = colors.get(hex) ?? { hex, count: 0, uses: [] }
    token.count++
    if (!token.uses.includes(use)) token.uses.push(use)
    colors.set(hex, token)
  }

  const elements = [doc.body, ...(doc.body?.querySelectorAll("*") ?? [])]
    .filter((element): element is HTMLElement => Boolean(element))
    .slice(0, MAX_SCANNED)
  let scanned = 0
  if (view) {
    for (const element of elements) {
      if (element.closest("[data-cognia-chrome]") || !visible(element)) continue
      scanned++
      const style = view.getComputedStyle(element)
      const ownText = !readable(element)
        ? ""
        : [...element.childNodes]
            .filter((child) => child.nodeType === 3)
            .map((child) => child.nodeValue ?? "")
            .join(" ")
            .replace(/\s+/g, " ")
            .trim()
      if (ownText) {
        addColor(style.color, "text")
        const family = firstFamily(style.fontFamily)
        fonts.add(family)
        const key = [family, style.fontSize, style.fontWeight, style.lineHeight].join("|")
        const token = type.get(key) ?? {
          family,
          size: style.fontSize,
          weight: style.fontWeight,
          lineHeight: style.lineHeight,
          count: 0,
          sample: ownText.slice(0, 40),
        }
        token.count++
        type.set(key, token)
      }
      addColor(style.backgroundColor, "background")
      if (Number.parseFloat(style.borderTopWidth) > 0 && style.borderTopStyle !== "none")
        addColor(style.borderTopColor, "border")
      for (const property of SPACING) {
        const value = style.getPropertyValue(property)
        const px = Number.parseFloat(value)
        if (value.endsWith("px") && px > 0) spacing.add(`${Math.round(px * 100) / 100}px`)
      }
      // The shorthand, so `8px 8px 0 0` reads as one value rather than four.
      const radius = style.getPropertyValue("border-radius") || style.borderTopLeftRadius
      if (radius && radius !== "0px") radii.add(radius)
      if (style.boxShadow && style.boxShadow !== "none") shadows.add(style.boxShadow.slice(0, 160))
    }
  }

  const variables: { name: string; value: string }[] = []
  if (view) {
    const root = view.getComputedStyle(doc.documentElement)
    for (let index = 0; index < root.length && variables.length < LIMITS.variables; index++) {
      const name = root[index]
      // Tailwind's internals are plumbing, not the design system's names.
      if (!name?.startsWith("--") || name.startsWith("--tw-")) continue
      const value = root.getPropertyValue(name).trim()
      if (value && value.length <= 120) variables.push({ name, value })
    }
  }

  return {
    colors: [...colors.values()].sort((a, b) => b.count - a.count).slice(0, LIMITS.colors),
    fonts: fonts.top(LIMITS.fonts),
    type: [...type.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, LIMITS.type)
      .sort((a, b) => Number.parseFloat(b.size) - Number.parseFloat(a.size)),
    spacing: spacing
      .top(LIMITS.spacing)
      .sort((a, b) => Number.parseFloat(a.value) - Number.parseFloat(b.value)),
    radii: radii.top(LIMITS.radii),
    shadows: shadows.top(LIMITS.shadows),
    variables,
    breakpoints: breakpointsOf(doc),
    scanned,
  }
}

/** The tokens as Markdown, so new work can match what the page already uses. */
export function tokensMarkdown(tokens: Omit<DesignTokens, "tabId" | "ranAt">): string {
  const lines = ["## Design tokens in use", "", `Counted over ${tokens.scanned} visible elements.`]
  if (tokens.colors.length > 0) {
    lines.push("", "Colours (most used first):")
    for (const color of tokens.colors)
      lines.push(`- \`${color.hex}\` ×${color.count} (${color.uses.join(", ")})`)
  }
  if (tokens.type.length > 0) {
    lines.push("", "Type (family / size / weight / line height):")
    for (const entry of tokens.type)
      lines.push(
        `- ${entry.family} ${entry.size} / ${entry.weight} / ${entry.lineHeight} ×${entry.count} — "${entry.sample}"`
      )
  }
  const list = (title: string, values: CountedValue[]) => {
    if (values.length === 0) return
    lines.push(
      "",
      `${title}: ${values.map((entry) => `\`${entry.value}\` ×${entry.count}`).join(", ")}`
    )
  }
  list("Fonts", tokens.fonts)
  list("Spacing", tokens.spacing)
  list("Radii", tokens.radii)
  if (tokens.shadows.length > 0) {
    lines.push("", "Shadows:")
    for (const shadow of tokens.shadows) lines.push(`- \`${shadow.value}\` ×${shadow.count}`)
  }
  if (tokens.breakpoints.length > 0)
    lines.push("", `Breakpoints: ${tokens.breakpoints.map((value) => `\`${value}\``).join(", ")}`)
  if (tokens.variables.length > 0) {
    lines.push("", "Custom properties on `:root`:", "", "```css")
    for (const variable of tokens.variables) lines.push(`${variable.name}: ${variable.value};`)
    lines.push("```")
  }
  return lines.join("\n")
}
