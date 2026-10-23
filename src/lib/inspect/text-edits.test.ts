/** @jest-environment <rootDir>/testing/jsdom-environment.cjs */
import { parseTextChanges, startTextEditing, textChangesMarkdown } from "./text-edits"

beforeEach(() => {
  document.body.innerHTML = `
    <main>
      <h1 id="title">Pricing plans</h1>
      <p id="lead">Pick the plan that suits <a id="more" href="/x">your team</a> best.</p>
      <ul id="features"><li>Unlimited projects</li><li>Priority support</li></ul>
      <textarea id="notes">typed by the person</textarea>
      <script>var x = 1</script>
    </main>`
  document.designMode = "off"
})

describe("startTextEditing", () => {
  it("turns the page editable, and reads back each changed unit as before → after", () => {
    const session = startTextEditing(document)
    expect(document.designMode).toBe("on")
    document.getElementById("title")!.firstChild!.nodeValue = "Plans and pricing"
    document.querySelectorAll("li")[1]!.textContent = "24/7 support"
    document.getElementById("notes")!.textContent = "changed"
    expect(session.changes()).toEqual([
      {
        selector: "#title",
        label: "h1#title",
        before: "Pricing plans",
        after: "Plans and pricing",
      },
      {
        selector: "li:nth-of-type(2)",
        label: "li",
        before: "Priority support",
        after: "24/7 support",
      },
    ])
    expect(session.stop(true)).toHaveLength(2)
    expect(document.designMode).toBe("off")
  })

  it("reports a word changed in a link once, at the link, unless the paragraph changed too", () => {
    const session = startTextEditing(document)
    document.getElementById("more")!.textContent = "your whole team"
    expect(session.changes()).toEqual([
      { selector: "#more", label: "a#more", before: "your team", after: "your whole team" },
    ])
    document.getElementById("lead")!.firstChild!.nodeValue = "Choose the plan that suits "
    expect(session.changes().map((change) => change.label)).toEqual(["p#lead", "a#more"])
  })

  it("reports deleted and new text", () => {
    const session = startTextEditing(document)
    document.getElementById("title")!.remove()
    const added = document.createElement("p")
    added.id = "added"
    added.textContent = "New line of copy"
    document.querySelector("main")!.appendChild(added)
    expect(session.changes()).toEqual([
      { label: "h1#title", before: "Pricing plans", after: "" },
      { selector: "#added", label: "p#added", before: "", after: "New line of copy" },
    ])
  })

  it("unwinds the edits through the editing undo stack when not kept", () => {
    const execCommand = jest
      .fn()
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValue(false)
    Object.defineProperty(document, "execCommand", { value: execCommand, configurable: true })
    const session = startTextEditing(document)
    document.getElementById("title")!.textContent = "Edited"
    expect(session.stop(false)).toEqual([])
    expect(execCommand).toHaveBeenCalledTimes(3)
    expect(execCommand).toHaveBeenCalledWith("undo")
    expect(document.designMode).toBe("off")
    delete (document as { execCommand?: unknown }).execCommand
  })
})

describe("as text", () => {
  it("lists each change for the agent to make in the source", () => {
    const text = textChangesMarkdown([
      {
        selector: "#title",
        label: "h1#title",
        before: "Pricing plans",
        after: "Plans and pricing",
      },
      { label: "p.note", before: "Old note", after: "" },
      { selector: "#added", label: "p#added", before: "", after: "New copy" },
    ])
    expect(text).toContain("## Text changes (3)")
    expect(text).toContain(
      '1. `#title`\n   - Before: "Pricing plans"\n   - After: "Plans and pricing"'
    )
    expect(text).toContain("2. `p.note` (deleted)")
    expect(text).toContain("   - After: (removed)")
    expect(text).toContain("   - Before: (new text)")
    expect(textChangesMarkdown([])).toBe("")
  })

  it("restores stored changes, dropping malformed ones", () => {
    expect(
      parseTextChanges([
        { selector: "#a", label: "p#a", before: "x", after: "y" },
        { label: 1, before: "x", after: "y" },
        { label: "p", before: "x", after: "y", selector: 7 },
      ])
    ).toEqual([{ selector: "#a", label: "p#a", before: "x", after: "y" }])
    expect(parseTextChanges("nope")).toEqual([])
  })
})
