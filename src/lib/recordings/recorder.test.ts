/** @jest-environment <rootDir>/testing/jsdom-environment.cjs */
import { isSecretField, locatorsFor, roleOf } from "./locators"
import { isLocator, type RecordedStep } from "./model"
import { BADGE_ID, installTestRecorder, stopTestRecorder } from "./recorder"

const LABELS = {
  recording: "Recording",
  check: "Add a check",
  checking: "Click what to check",
  cancel: "Cancel",
  stop: "Stop",
}

function page(html: string) {
  document.body.innerHTML = html
}

function record(settleMs = 0) {
  const steps: RecordedStep[] = []
  const stop = jest.fn()
  const handle = installTestRecorder({
    win: window,
    send: (step) => steps.push(step),
    stop,
    labels: LABELS,
    now: () => 1,
    trusted: () => true,
    controlTrusted: () => true,
    settleMs,
  })
  return { steps, stop, handle }
}

afterEach(() => {
  ;(
    window as unknown as Record<string, { stop(): unknown } | undefined>
  ).__cogniaTestRecorder?.stop()
  document.body.innerHTML = ""
  jest.useRealTimers()
  jest.restoreAllMocks()
})

describe("locatorsFor", () => {
  it("puts a test id first, then role and name, then CSS, each unique", () => {
    page(`<button data-testid="save">Save</button><button>Save</button><button>Cancel</button>`)
    const [withId, twin, cancel] = [...document.querySelectorAll("button")]
    expect(locatorsFor(withId!).locators[0]).toBe('getByTestId("save")')
    // Two buttons are called Save: role and name do not pick one out.
    expect(locatorsFor(twin!).locators.some((locator) => locator.startsWith("getByRole"))).toBe(
      false
    )
    expect(locatorsFor(cancel!)).toMatchObject({
      locators: [
        'getByRole("button", { name: "Cancel", exact: true })',
        expect.stringMatching(/^locator\(/),
      ],
      role: "button",
      name: "Cancel",
    })
    for (const element of [withId!, twin!, cancel!])
      for (const locator of locatorsFor(element).locators) expect(isLocator(locator)).toBe(true)
  })

  it("finds a field by its label and placeholder, quoting what the page wrote", () => {
    page(`<label for="e">Email "work"</label><input id="e" placeholder="you@work" />`)
    const input = document.querySelector("input")!
    expect(roleOf(input)).toBe("textbox")
    expect(locatorsFor(input).locators.slice(0, 3)).toEqual([
      'getByRole("textbox", { name: "Email \\"work\\"", exact: true })',
      'getByLabel("Email \\"work\\"")',
      'getByPlaceholder("you@work")',
    ])
  })

  it("knows a secret field by its type, autocomplete or name", () => {
    page(
      `<input type="password" /><input autocomplete="one-time-code" /><input name="api_key" /><input name="city" />`
    )
    expect([...document.querySelectorAll("input")].map(isSecretField)).toEqual([
      true,
      true,
      true,
      false,
    ])
  })
})

describe("installTestRecorder", () => {
  it("records the visit, what was typed, chosen and clicked, but not a secret", () => {
    jest.useFakeTimers()
    page(`
      <label for="email">Email</label><input id="email" />
      <label for="pw">Password</label><input id="pw" type="password" />
      <label for="plan">Plan</label><select id="plan"><option value="free">Free</option><option value="pro">Pro</option></select>
      <label><input type="checkbox" id="terms" /> Terms</label>
      <button>Sign in</button>`)
    const { steps } = record(100)
    const email = document.getElementById("email") as HTMLInputElement
    email.value = "me@a.test"
    email.dispatchEvent(new Event("input", { bubbles: true }))
    jest.advanceTimersByTime(100)
    const password = document.getElementById("pw") as HTMLInputElement
    password.value = "hunter2"
    password.dispatchEvent(new Event("input", { bubbles: true }))
    const plan = document.getElementById("plan") as HTMLSelectElement
    plan.value = "pro"
    plan.dispatchEvent(new Event("change", { bubbles: true }))
    const terms = document.getElementById("terms") as HTMLInputElement
    terms.click()
    password.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    document.querySelector("button")!.click()
    expect(steps.map((step) => [step.action, step.value, step.secret])).toEqual([
      ["navigate", undefined, undefined],
      ["fill", "me@a.test", undefined],
      // The password's fill comes first: the select's change flushed it.
      ["fill", undefined, true],
      ["select", "pro", undefined],
      ["click", "checked", undefined],
      ["press_key", "Enter", undefined],
      ["click", undefined, undefined],
    ])
    expect(JSON.stringify(steps)).not.toContain("hunter2")
  })

  it("checks text or a field's value after Add a check", () => {
    page(`<p id="greeting">Hi there</p><input id="name" value="Ada" />`)
    const steps: RecordedStep[] = []
    let root: ShadowRoot | null = null
    const attach = HTMLElement.prototype.attachShadow
    jest.spyOn(HTMLElement.prototype, "attachShadow").mockImplementation(function (
      this: HTMLElement,
      init
    ) {
      root = attach.call(this, init)
      return root
    })
    installTestRecorder({
      win: window,
      send: (step) => steps.push(step),
      stop: jest.fn(),
      labels: LABELS,
      now: () => 1,
      trusted: () => true,
      controlTrusted: () => true,
    })
    const pageClicks = jest.fn()
    const greeting = document.getElementById("greeting")!
    greeting.addEventListener("click", pageClicks)
    const press = (label: string) =>
      [...root!.querySelectorAll("button")].find((button) => button.textContent === label)!.click()
    press("Add a check")
    expect(root!.textContent).toContain("Click what to check")
    greeting.click()
    expect(pageClicks).not.toHaveBeenCalled()
    press("Add a check")
    document.getElementById("name")!.click()
    expect(steps.slice(1)).toEqual([
      expect.objectContaining({
        action: "assert",
        assertion: { kind: "text", expected: "Hi there" },
      }),
      expect.objectContaining({ action: "assert", assertion: { kind: "value", expected: "Ada" } }),
    ])
    press("Stop")
  })

  it("hands back the typing still settling when the worker takes it out, and sends none", () => {
    jest.useFakeTimers()
    page(`<label for="q">Search</label><input id="q" />`)
    const { steps } = record(600)
    const field = document.getElementById("q") as HTMLInputElement
    field.value = "shoes"
    field.dispatchEvent(new Event("input", { bubbles: true }))
    const tail = stopTestRecorder()
    expect(tail).toEqual([expect.objectContaining({ action: "fill", value: "shoes" })])
    jest.advanceTimersByTime(1_000)
    expect(steps.map((step) => step.action)).toEqual(["navigate"])
    expect(document.getElementById(BADGE_ID)).toBeNull()
    expect(stopTestRecorder()).toEqual([])
  })

  it("sends the typing itself when its own Stop is pressed, and has none left after", () => {
    jest.useFakeTimers()
    page(`<label for="q">Search</label><input id="q" />`)
    const steps: RecordedStep[] = []
    let root: ShadowRoot | null = null
    const attach = HTMLElement.prototype.attachShadow
    jest.spyOn(HTMLElement.prototype, "attachShadow").mockImplementation(function (
      this: HTMLElement,
      init
    ) {
      root = attach.call(this, init)
      return root
    })
    const stop = jest.fn()
    installTestRecorder({
      win: window,
      send: (step) => steps.push(step),
      stop,
      labels: LABELS,
      now: () => 1,
      trusted: () => true,
      controlTrusted: () => true,
      settleMs: 600,
    })
    const field = document.getElementById("q") as HTMLInputElement
    field.value = "shoes"
    field.dispatchEvent(new Event("input", { bubbles: true }))
    ;[...root!.querySelectorAll("button")].find((button) => button.textContent === "Stop")!.click()
    expect(stop).toHaveBeenCalled()
    expect(steps.map((step) => step.action)).toEqual(["navigate", "fill"])
    // The worker's removal that follows finds nothing more to keep.
    expect(stopTestRecorder()).toEqual([])
  })

  describe("held at document_start", () => {
    function held(settleMs = 0) {
      const steps: RecordedStep[] = []
      const handle = installTestRecorder({
        win: window,
        send: (step) => steps.push(step),
        stop: jest.fn(),
        labels: LABELS,
        now: () => 1,
        // The person's clicks are trusted; the page's own are not.
        trusted: (event) => (event as Event & { fromPerson?: boolean }).fromPerson === true,
        controlTrusted: () => true,
        settleMs,
        held: true,
      })
      return { steps, handle }
    }
    const personClick = (element: Element) => {
      const event = new MouseEvent("click", { bubbles: true, cancelable: true })
      Object.assign(event, { fromPerson: true })
      element.dispatchEvent(event)
    }

    it("keeps what was done before the worker answered, then sends the person's in order", () => {
      page(`<button>Act now</button><button>Other</button>`)
      const { steps, handle } = held()
      const [act, other] = [...document.querySelectorAll("button")]
      personClick(act!)
      other!.click() // the page's own click
      expect(steps).toEqual([])
      expect(document.getElementById(BADGE_ID)).toBeNull()
      expect(handle.held).toBe(true)
      handle.confirm(false)
      expect(handle.held).toBe(false)
      expect(steps.map((step) => [step.action, step.target?.name])).toEqual([
        ["navigate", undefined],
        ["click", "Act now"],
      ])
      expect(document.getElementById(BADGE_ID)).not.toBeNull()
      // Live now: the next person's click goes straight out, the page's does not.
      personClick(other!)
      other!.click()
      expect(steps).toHaveLength(3)
      handle.confirm(false)
      expect(steps).toHaveLength(3)
    })

    it("in an agent's tab, keeps the agent's clicks too", () => {
      page(`<button>Go</button>`)
      const { steps, handle } = held()
      document.querySelector("button")!.click()
      handle.confirm(true)
      document.querySelector("button")!.click()
      expect(steps.map((step) => step.action)).toEqual(["navigate", "click", "click"])
    })

    it("goes without a trace when the tab is not recording", () => {
      jest.useFakeTimers()
      page(`<label for="q">Search</label><input id="q" /><button>Go</button>`)
      const { steps, handle } = held(100)
      personClick(document.querySelector("button")!)
      const field = document.getElementById("q") as HTMLInputElement
      field.value = "x"
      field.dispatchEvent(new Event("input", { bubbles: true }))
      handle.discard()
      jest.advanceTimersByTime(1_000)
      personClick(document.querySelector("button")!)
      expect(steps).toEqual([])
      expect(document.getElementById(BADGE_ID)).toBeNull()
      // A later start is a fresh recorder, not the discarded one.
      const again = installTestRecorder({
        win: window,
        send: (step) => steps.push(step),
        stop: jest.fn(),
        labels: LABELS,
        now: () => 1,
      })
      expect(again).not.toBe(handle)
    })

    it("hands the person's held steps to a stop that comes before the answer", () => {
      page(`<button>Act now</button>`)
      const { steps, handle } = held()
      personClick(document.querySelector("button")!)
      document.querySelector("button")!.click()
      expect(stopTestRecorder().map((step) => step.action)).toEqual(["navigate", "click"])
      handle.confirm(false)
      expect(steps).toEqual([])
    })
  })

  it("ignores what the page does itself, and stops cleanly", () => {
    page(`<button>Go</button>`)
    const steps: RecordedStep[] = []
    const handle = installTestRecorder({
      win: window,
      send: (step) => steps.push(step),
      stop: jest.fn(),
      labels: LABELS,
    })
    document.querySelector("button")!.click()
    expect(steps.map((step) => step.action)).toEqual(["navigate"])
    handle.stop()
    expect(document.getElementById(BADGE_ID)).toBeNull()
  })
})
