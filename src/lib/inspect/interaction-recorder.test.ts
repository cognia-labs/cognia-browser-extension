/** @jest-environment <rootDir>/testing/jsdom-environment.cjs */
import {
  MAX_STEPS,
  POINTING_ATTRIBUTE,
  installInteractionRecorder,
  stepText,
  type InteractionRecorder,
} from "./interaction-recorder"

type RecorderWindow = Window & typeof globalThis

function fresh(trusted: (event: Event) => boolean = () => true): InteractionRecorder {
  delete (window as { __cogniaSteps?: unknown }).__cogniaSteps
  return installInteractionRecorder(window as RecorderWindow, { trusted })
}

beforeEach(() => {
  document.body.innerHTML = `
    <form id="signup">
      <label for="email">Email</label>
      <input id="email" type="email" />
      <input id="secret" type="password" />
      <input id="terms" type="checkbox" />
      <select id="plan"><option>Free</option><option>Pro</option></select>
      <button id="go" type="button"><svg id="icon"></svg> Sign up</button>
    </form>
    <a id="docs" href="#docs">Read the docs</a>`
})

afterEach(() => {
  jest.useRealTimers()
})

const fire = (target: EventTarget, event: Event) => target.dispatchEvent(event)

describe("installInteractionRecorder", () => {
  it("installs once per document", () => {
    const recorder = fresh()
    expect(installInteractionRecorder(window as RecorderWindow)).toBe(recorder)
  })

  it("records the button a click meant, by name, and not the page's own events", () => {
    const recorder = fresh((event) => (event as { fromPerson?: boolean }).fromPerson !== false)
    fire(document.getElementById("icon")!, new MouseEvent("click", { bubbles: true }))
    const synthetic = new MouseEvent("click", { bubbles: true })
    Object.assign(synthetic, { fromPerson: false })
    fire(document.getElementById("docs")!, synthetic)
    expect(recorder.peek()).toEqual([
      expect.objectContaining({
        kind: "click",
        selector: "#go",
        label: "button#go",
        detail: "Sign up",
      }),
    ])
  })

  it("records that text was entered, never what, and one step per field", () => {
    const recorder = fresh()
    const email = document.getElementById("email") as HTMLInputElement
    const secret = document.getElementById("secret") as HTMLInputElement
    // The click that focuses a field adds nothing the typing does not say.
    fire(email, new MouseEvent("click", { bubbles: true }))
    for (const value of ["a", "an", "ann@x.test"]) {
      email.value = value
      fire(email, new Event("input", { bubbles: true }))
    }
    fire(email, new Event("change", { bubbles: true }))
    secret.value = "hunter2"
    fire(secret, new Event("input", { bubbles: true }))
    const steps = recorder.peek()
    expect(steps.map((step) => [step.kind, step.selector, step.detail])).toEqual([
      ["input", "#email", "Email"],
      ["input", "#secret", "password"],
    ])
    expect(JSON.stringify(steps)).not.toMatch(/ann@x|hunter2/)
    expect(stepText(steps[1]!)).toBe("Entered a password in `#secret`")
  })

  it("records toggles and choices once each", () => {
    const recorder = fresh()
    const terms = document.getElementById("terms") as HTMLInputElement
    terms.checked = true
    fire(terms, new Event("input", { bubbles: true }))
    fire(terms, new Event("change", { bubbles: true }))
    const plan = document.getElementById("plan") as HTMLSelectElement
    plan.selectedIndex = 1
    fire(plan, new Event("input", { bubbles: true }))
    fire(plan, new Event("change", { bubbles: true }))
    expect(recorder.peek().map(stepText)).toEqual(["Turned `#terms` on", 'Chose "Pro" in `#plan`'])
  })

  it("records named keys and shortcuts, not ordinary typing, and submits", () => {
    const recorder = fresh()
    const email = document.getElementById("email")!
    fire(email, new KeyboardEvent("keydown", { key: "a", bubbles: true }))
    fire(email, new KeyboardEvent("keydown", { key: "Tab", bubbles: true }))
    fire(email, new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    fire(document.body, new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }))
    fire(document.getElementById("signup")!, new Event("submit", { bubbles: true }))
    expect(recorder.peek().map(stepText)).toEqual([
      "Pressed Enter in `#email`",
      "Pressed Meta+K",
      "Submitted `#signup`",
    ])
  })

  it("records navigation within the app, without the query", () => {
    const recorder = fresh()
    history.pushState({}, "", "/settings/profile?token=x")
    history.replaceState({}, "", "/settings/profile?token=y")
    history.pushState({}, "", "/settings/billing#plans")
    expect(recorder.peek().map(stepText)).toEqual([
      "Navigated to /settings/profile",
      "Navigated to /settings/billing#plans",
    ])
    history.replaceState({}, "", "/")
  })

  it("coalesces scrolling, and leaves out what happens while Cognia's picker points", () => {
    jest.useFakeTimers({ now: 10_000 })
    const recorder = fresh()
    fire(document, new Event("scroll"))
    jest.advanceTimersByTime(500)
    fire(document, new Event("scroll"))
    const host = document.createElement("div")
    host.setAttribute(POINTING_ATTRIBUTE, "1")
    document.documentElement.appendChild(host)
    fire(document.getElementById("go")!, new MouseEvent("click", { bubbles: true }))
    host.remove()
    const chrome = document.createElement("div")
    chrome.setAttribute("data-cognia-chrome", "1")
    document.body.appendChild(chrome)
    fire(chrome, new MouseEvent("click", { bubbles: true }))
    expect(recorder.peek().map((step) => step.kind)).toEqual(["scroll"])
  })

  it("keeps the latest steps when there are too many", () => {
    const recorder = fresh()
    const go = document.getElementById("go")!
    for (let index = 0; index < MAX_STEPS + 5; index++)
      fire(go, new MouseEvent("click", { bubbles: true }))
    expect(recorder.peek()).toHaveLength(MAX_STEPS)
  })
})
