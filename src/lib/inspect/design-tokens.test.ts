/** @jest-environment <rootDir>/testing/jsdom-environment.cjs */
import { collectDesignTokens, tokensMarkdown } from "./design-tokens"

afterEach(() => {
  document.body.innerHTML = ""
  document.head.innerHTML = ""
  document.documentElement.removeAttribute("style")
})

describe("collectDesignTokens", () => {
  it("counts what visible elements use, most used first", () => {
    document.documentElement.style.setProperty("--brand", "#2563eb")
    document.documentElement.style.setProperty("--tw-ring-color", "red")
    document.head.innerHTML = `<style>
      @media (min-width: 768px) { .a { color: red } }
      @media (max-width: 40em) { .b { color: blue } }
    </style>`
    document.body.innerHTML = `
      <section style="background-color: #2563eb; padding: 16px; border-radius: 8px">
        <p style="color: #111111; font-size: 14px; font-family: 'Inter', sans-serif">One</p>
        <p style="color: #111111; font-size: 14px; font-family: 'Inter', sans-serif">Two</p>
        <h1 style="color: #2563eb; font-size: 32px; font-family: Georgia">Title</h1>
        <p style="display:none; color: #ff0000">Hidden</p>
        <textarea style="color: #00ff00">typed secret</textarea>
      </section>`
    const tokens = collectDesignTokens(document)
    expect(tokens.colors[0]).toMatchObject({ hex: "#2563eb", count: 2 })
    expect(tokens.colors[0]?.uses.sort()).toEqual(["background", "text"])
    expect(tokens.colors.map((color) => color.hex)).toContain("#111111")
    expect(tokens.colors.map((color) => color.hex)).not.toContain("#ff0000")
    expect(tokens.fonts[0]).toEqual({ value: "Inter", count: 2 })
    expect(tokens.type[0]).toMatchObject({ family: "Georgia", size: "32px", sample: "Title" })
    expect(JSON.stringify(tokens)).not.toContain("typed secret")
    expect(tokens.spacing).toContainEqual({ value: "16px", count: 4 })
    expect(tokens.radii).toContainEqual({ value: "8px", count: 1 })
    expect(tokens.variables).toEqual([{ name: "--brand", value: "#2563eb" }])
    expect(tokens.breakpoints).toEqual(["40em", "768px"])
  })

  it("renders as Markdown a new screen can match", () => {
    const text = tokensMarkdown({
      colors: [{ hex: "#2563eb", count: 3, uses: ["background"] }],
      fonts: [{ value: "Inter", count: 2 }],
      type: [
        {
          family: "Inter",
          size: "14px",
          weight: "400",
          lineHeight: "20px",
          count: 2,
          sample: "Hi",
        },
      ],
      spacing: [{ value: "8px", count: 4 }],
      radii: [],
      shadows: [{ value: "0 1px 2px #0003", count: 1 }],
      variables: [{ name: "--brand", value: "#2563eb" }],
      breakpoints: ["768px"],
      scanned: 10,
    })
    expect(text).toContain("## Design tokens in use")
    expect(text).toContain("- `#2563eb` ×3 (background)")
    expect(text).toContain('- Inter 14px / 400 / 20px ×2 — "Hi"')
    expect(text).toContain("Spacing: `8px` ×4")
    expect(text).not.toContain("Radii")
    expect(text).toContain("Breakpoints: `768px`")
    expect(text).toContain("--brand: #2563eb;")
  })
})
