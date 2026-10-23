import {
  colorToHex,
  hasEdits,
  isSafeStyleValue,
  sanitizeEdits,
  styleChanges,
  MAX_TEXT_EDIT,
} from "./style-edits"

describe("style edits", () => {
  it("keeps only offered properties with values that could be CSS", () => {
    expect(
      sanitizeEdits({
        styles: {
          color: " #2563eb ",
          padding: "8px 16px",
          gap: "",
          position: "fixed",
          "background-color": "url(https://evil.test/x)",
          margin: "0;} body { display: none",
          width: "expression(alert(1))",
        },
        text: "x".repeat(MAX_TEXT_EDIT + 10),
      })
    ).toEqual({
      styles: { color: "#2563eb", padding: "8px 16px" },
      text: "x".repeat(MAX_TEXT_EDIT),
    })
    expect(isSafeStyleValue("0 1px 2px rgb(0 0 0 / 10%)")).toBe(true)
    expect(isSafeStyleValue("<script>")).toBe(false)
  })

  it("lists the changes that change something, with what they replace, in editor order", () => {
    expect(
      styleChanges(
        { color: "rgb(0, 0, 0)", padding: "8px" },
        { padding: "12px", color: "rgb(0, 0, 0)", "font-size": "18px" }
      )
    ).toEqual([
      { property: "padding", from: "8px", to: "12px" },
      { property: "font-size", from: "", to: "18px" },
    ])
    expect(hasEdits({ padding: "8px" }, { styles: { padding: "8px" } }, "Save")).toBe(false)
    expect(hasEdits({}, { styles: {}, text: "Send" }, "Save")).toBe(true)
  })

  it("turns computed colours into a colour well's hex, and leaves transparency alone", () => {
    expect(colorToHex("rgb(37, 99, 235)")).toBe("#2563eb")
    expect(colorToHex("rgba(37, 99, 235, 0.5)")).toBe("#2563eb")
    expect(colorToHex("#FFF")).toBe("#ffffff")
    expect(colorToHex("rgba(0, 0, 0, 0)")).toBeNull()
    expect(colorToHex("transparent")).toBeNull()
  })
})
