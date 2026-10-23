import { comparePicks, comparisonMarkdown, MAX_COMPARED } from "./pick-compare"

const pick = (
  selector: string,
  styles: Record<string, string>,
  edits: Record<string, string> = {}
) => ({
  label: selector,
  selector,
  styles,
  edits: { styles: edits },
})

describe("comparePicks", () => {
  it("lists the styles that differ, in the order picks report them, with edits applied", () => {
    const comparison = comparePicks([
      pick("#a", { "font-size": "14px", color: "rgb(0, 0, 0)", "border-radius": "8px" }),
      pick("#b", { "font-size": "16px", color: "rgb(0, 0, 0)" }, { "border-radius": "8px" }),
      pick("#c", {
        "font-size": "14px",
        color: "rgb(0, 0, 0)",
        "border-radius": "6px",
        cursor: "x",
      }),
    ])
    expect(comparison?.differences).toEqual([
      { property: "font-size", values: ["14px", "16px", "14px"] },
      { property: "border-radius", values: ["8px", "8px", "6px"] },
      // Not one the picker reports by name: after the rest.
      { property: "cursor", values: [null, null, "x"] },
    ])
    expect(comparison?.same).toBe(1)
    expect(comparison?.picks.map((entry) => entry.selector)).toEqual(["#a", "#b", "#c"])
  })

  it("needs two picks, and compares no more than it can show", () => {
    expect(comparePicks([pick("#a", {})])).toBeNull()
    const many = Array.from({ length: MAX_COMPARED + 3 }, (_, index) =>
      pick(`#p${index}`, { width: `${index}px` })
    )
    expect(comparePicks(many)?.picks).toHaveLength(MAX_COMPARED)
  })
})

describe("comparisonMarkdown", () => {
  it("writes the differences as a table an agent can read", () => {
    const markdown = comparisonMarkdown(
      comparePicks([
        pick("#a", { "font-size": "14px", color: "red" }),
        pick("a[href='x|y']", { color: "red" }),
      ])!
    )
    expect(markdown).toContain("## How the picks differ (1 property)")
    expect(markdown).toContain("| Property | 1. `#a` | 2. `a[href='x\\|y']` |")
    expect(markdown).toContain("| font-size | `14px` | — |")
    expect(markdown).toContain("1 other property matches")
  })

  it("says so when the picks match", () => {
    expect(
      comparisonMarkdown(
        comparePicks([pick("#a", { color: "red" }), pick("#b", { color: "red" })])!
      )
    ).toContain("share every reported style (1 property)")
  })
})
