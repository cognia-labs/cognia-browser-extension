/**
 * How picked elements differ (CSS Peeper, VisBug): of the computed styles
 * each pick reports, with any previewed edit applied, the ones that are not
 * the same across them all — two buttons that should match, and do not.
 *
 * A property a pick leaves out is the browser's default for it, shown as
 * nothing rather than guessed.
 */
import { DESCRIBED_STYLES, type PickedElement } from "./element-context"

export interface ComparedPick {
  label: string
  selector: string
}

export interface StyleDifference {
  property: string
  /** One per pick, in pick order; `null` for the browser's default. */
  values: (string | null)[]
}

export interface PickComparison {
  picks: ComparedPick[]
  differences: StyleDifference[]
  /** How many reported properties all the picks share. */
  same: number
}

export const MAX_COMPARED = 8

type Comparable = Pick<PickedElement, "label" | "selector" | "styles"> & {
  edits?: Pick<PickedElement["edits"], "styles">
}

/** The styles a pick shows now: as picked, with the edit previewed over them. */
function effectiveStyles(pick: Comparable): Record<string, string> {
  return { ...pick.styles, ...(pick.edits?.styles ?? {}) }
}

export function comparePicks(picks: readonly Comparable[]): PickComparison | null {
  const compared = picks.slice(0, MAX_COMPARED)
  if (compared.length < 2) return null
  const styles = compared.map(effectiveStyles)
  const known = new Set<string>(DESCRIBED_STYLES)
  const properties = [
    ...DESCRIBED_STYLES,
    ...[...new Set(styles.flatMap(Object.keys))].filter((name) => !known.has(name)).sort(),
  ]
  const differences: StyleDifference[] = []
  let same = 0
  for (const property of properties) {
    const values = styles.map((style) => style[property] ?? null)
    if (values.every((value) => value === null)) continue
    if (values.every((value) => value === values[0])) same++
    else differences.push({ property, values })
  }
  return {
    picks: compared.map(({ label, selector }) => ({ label, selector })),
    differences,
    same,
  }
}

function properties(count: number): string {
  return `${count} ${count === 1 ? "property" : "properties"}`
}

function cell(value: string | null): string {
  return value === null ? "—" : `\`${value.replace(/\|/g, "\\|").replace(/`/g, "'")}\``
}

export function comparisonMarkdown(comparison: PickComparison): string {
  const lines = [`## How the picks differ (${properties(comparison.differences.length)})`, ""]
  if (comparison.differences.length === 0) {
    lines.push(
      `The ${comparison.picks.length} picked elements share every reported style (${properties(comparison.same)}).`
    )
    return lines.join("\n")
  }
  lines.push(
    `Computed styles that are not the same across the ${comparison.picks.length} picked elements, with previewed edits applied; — is the browser's default. ${comparison.same} other ${comparison.same === 1 ? "property matches" : "properties match"}.`,
    "",
    `| Property | ${comparison.picks
      .map((pick, index) => `${index + 1}. \`${pick.selector.replace(/\|/g, "\\|")}\``)
      .join(" | ")} |`,
    `| --- | ${comparison.picks.map(() => "---").join(" | ")} |`
  )
  for (const difference of comparison.differences)
    lines.push(`| ${difference.property} | ${difference.values.map(cell).join(" | ")} |`)
  return lines.join("\n")
}
