import {
  CAUSED_NAVIGATION_MS,
  MAX_RECORDINGS,
  appendStep,
  cleanStep,
  isLocator,
  parseRecordings,
  secretName,
  toPlaywright,
  type RecordedStep,
  type Recording,
  readableBy,
} from "./model"

const BUTTON = { locators: ['getByRole("button", { name: "Save", exact: true })'] }
const EMAIL = { locators: ['getByLabel("Email")'], role: "textbox", name: "Email" }
const click = (at: number): RecordedStep => ({ action: "click", target: BUTTON, at })

describe("isLocator", () => {
  it("keeps exactly the locators the recorder builds", () => {
    expect(isLocator('getByTestId("save")')).toBe(true)
    expect(isLocator('getByRole("button", { name: "Save \\"now\\"", exact: true })')).toBe(true)
    expect(isLocator('getByRole("checkbox")')).toBe(true)
    expect(isLocator('locator("#app > button:nth-of-type(2)")')).toBe(true)
  })

  it("refuses anything that would be other code in a generated test", () => {
    expect(isLocator('getByText("x")).click(); await evil(page.getByText("y")')).toBe(false)
    expect(isLocator("getByText('x')")).toBe(false)
    expect(isLocator('evaluate("x")')).toBe(false)
    expect(isLocator('getByRole("button", { name: "x", hasText: evil })')).toBe(false)
    expect(isLocator('getByText("\\q")')).toBe(false)
  })
})

describe("cleanStep", () => {
  it("drops a step without a target, a bad locator or a secret's value", () => {
    expect(cleanStep({ action: "click", target: { locators: ["evil()"] }, at: 1 })).toBeNull()
    expect(cleanStep({ action: "teleport", at: 1 })).toBeNull()
    expect(cleanStep({ action: "navigate", at: 1 })).toBeNull()
    expect(
      cleanStep({ action: "fill", target: EMAIL, secret: true, value: "hunter2", at: 1 })
    ).toEqual({ action: "fill", target: EMAIL, secret: true, at: 1 })
    expect(
      cleanStep({ action: "assert", assertion: { kind: "url", expected: "/done" }, at: 2 })
    ).toEqual({
      action: "assert",
      assertion: { kind: "url", expected: "/done" },
      at: 2,
    })
  })
})

describe("appendStep", () => {
  const fill = (value: string, at: number): RecordedStep => ({
    action: "fill",
    target: EMAIL,
    value,
    at,
  })

  it("keeps the last fill of a field, and folds two clicks into a double click", () => {
    let steps = appendStep([], { action: "navigate", url: "https://a.test/", at: 0 })
    steps = appendStep(steps, fill("a", 1))
    steps = appendStep(steps, fill("ab@c", 2))
    steps = appendStep(steps, click(3))
    steps = appendStep(steps, click(4))
    steps = appendStep(steps, { action: "double_click", target: BUTTON, at: 5 })
    expect(steps.map((step) => [step.action, step.value])).toEqual([
      ["navigate", undefined],
      ["fill", "ab@c"],
      ["double_click", undefined],
    ])
  })

  it("checks the address a click led to, once", () => {
    let steps = appendStep([], { action: "navigate", url: "https://a.test/", at: 0 })
    steps = appendStep(steps, { action: "navigate", url: "https://a.test/", at: 1 })
    steps = appendStep(steps, click(2))
    steps = appendStep(steps, { action: "navigate", url: "https://a.test/done", at: 3 })
    steps = appendStep(steps, { action: "navigate", url: "https://a.test/done", at: 4 })
    expect(steps).toEqual([
      { action: "navigate", url: "https://a.test/", at: 0 },
      click(2),
      { action: "assert", assertion: { kind: "url", expected: "https://a.test/done" }, at: 3 },
    ])
  })

  it("visits an address nothing in the recording led to", () => {
    let steps = appendStep([], { action: "navigate", url: "https://a.test/", at: 0 })
    // Typed into the address bar: the test has to go there itself.
    steps = appendStep(steps, { action: "navigate", url: "https://a.test/b", at: 5 })
    // Typing in a field takes nobody anywhere.
    steps = appendStep(steps, fill("x", 6))
    steps = appendStep(steps, { action: "navigate", url: "https://a.test/c", at: 7 })
    expect(steps.map((step) => [step.action, step.url])).toEqual([
      ["navigate", "https://a.test/"],
      ["navigate", "https://a.test/b"],
      ["fill", undefined],
      ["navigate", "https://a.test/c"],
    ])
  })

  it("does not credit a click long ago with a later load", () => {
    let steps = appendStep([], { action: "navigate", url: "https://a.test/", at: 0 })
    steps = appendStep(steps, click(10))
    steps = appendStep(steps, {
      action: "navigate",
      url: "https://a.test/late",
      at: 10 + CAUSED_NAVIGATION_MS + 1,
    })
    // An assertion in between is not something done: the click still counts.
    steps = appendStep(steps, click(20_000))
    steps = appendStep(steps, {
      action: "assert",
      target: BUTTON,
      assertion: { kind: "visible" },
      at: 20_001,
    })
    steps = appendStep(steps, { action: "navigate", url: "https://a.test/next", at: 20_002 })
    expect(steps.map((step) => [step.action, step.url ?? step.assertion?.expected])).toEqual([
      ["navigate", "https://a.test/"],
      ["click", undefined],
      ["navigate", "https://a.test/late"],
      ["click", undefined],
      ["assert", undefined],
      ["assert", "https://a.test/next"],
    ])
  })
})

describe("parseRecordings", () => {
  it("shares a person's recording only when they chose to, and an agent's from the start", () => {
    const [legacy, chosen, unshared, agent] = parseRecordings([
      // Kept by an earlier build, which shared every recording at once.
      { id: "legacy", byAgent: false, shared: true, steps: [] },
      { id: "chosen", byAgent: false, shared: true, sharedAt: 50, steps: [] },
      { id: "unshared", byAgent: false, shared: false, sharedAt: 50, steps: [] },
      { id: "agent", byAgent: true, shared: true, steps: [] },
    ])
    expect(legacy).toMatchObject({ shared: false })
    expect(legacy).not.toHaveProperty("sharedAt")
    expect(chosen).toMatchObject({ shared: true, sharedAt: 50 })
    expect(unshared).toMatchObject({ shared: false })
    expect(unshared).not.toHaveProperty("sharedAt")
    expect(agent).toMatchObject({ shared: true })
  })

  it("keeps an agent's recording to its own conversation, and who it was shared with", () => {
    const [agent, widened, named, junk] = parseRecordings([
      // An earlier build let every conversation read an agent's recording.
      { id: "agent", byAgent: true, sessionId: "s1", shared: true, steps: [] },
      { id: "widened", byAgent: true, sessionId: "s1", shared: true, sharedAt: 9, steps: [] },
      {
        id: "named",
        byAgent: false,
        shared: true,
        sharedAt: 9,
        sharedWith: ["s2", "s2", 4],
        steps: [],
      },
      { id: "junk", byAgent: false, shared: false, sharedWith: ["s2"], steps: [] },
    ])
    expect(agent).toMatchObject({ shared: true, sharedWith: ["s1"] })
    expect(readableBy(agent!, "s1")).toBe(true)
    expect(readableBy(agent!, "s2")).toBe(false)
    // Shared wider by the person: every conversation.
    expect(widened).not.toHaveProperty("sharedWith")
    expect(readableBy(widened!, "s9")).toBe(true)
    expect(named).toMatchObject({ sharedWith: ["s2"] })
    expect(readableBy(named!, "s1")).toBe(false)
    // Not shared: no one, whatever it names.
    expect(junk).not.toHaveProperty("sharedWith")
    expect(readableBy(junk!, "s2")).toBe(false)
  })

  it("caps the list and drops duplicates and junk", () => {
    const many = Array.from({ length: MAX_RECORDINGS + 3 }, (_, index) => ({
      id: `r${index}`,
      steps: [],
    }))
    expect(parseRecordings([{ id: "r0" }, ...many, null, { nope: true }])).toHaveLength(
      MAX_RECORDINGS
    )
    expect(parseRecordings("nope")).toEqual([])
  })
})

describe("toPlaywright", () => {
  const recording: Recording = {
    id: "r",
    title: 'Sign in "fast"',
    url: "https://a.test/login",
    startedAt: 0,
    byAgent: false,
    shared: true,
    steps: [
      { action: "navigate", url: "https://a.test/login", at: 0 },
      { action: "fill", target: EMAIL, value: 'me@a.test"); evil("', at: 1 },
      {
        action: "fill",
        target: { locators: ['getByLabel("Password")'], role: "textbox", name: "Password" },
        secret: true,
        at: 2,
      },
      { action: "click", target: { locators: ['getByRole("checkbox")'] }, value: "checked", at: 3 },
      { action: "select", target: { locators: ['getByLabel("Plan")'] }, value: "pro", at: 4 },
      { action: "press_key", target: EMAIL, value: "Enter", at: 5 },
      { action: "click", target: BUTTON, at: 6 },
      { action: "assert", assertion: { kind: "url", expected: "https://a.test/home" }, at: 7 },
      {
        action: "assert",
        target: { locators: ['getByTestId("greeting")'] },
        assertion: { kind: "text", expected: "Hi" },
        at: 8,
      },
    ],
  }

  it("writes a test that follows the best locators and reads secrets from the environment", () => {
    expect(toPlaywright(recording)).toBe(
      [
        'import { expect, test } from "@playwright/test"',
        "",
        "// Set E2E_PASSWORD before running: secrets are never recorded.",
        'test("Sign in \\"fast\\"", async ({ page }) => {',
        '  await page.goto("https://a.test/login")',
        '  await page.getByLabel("Email").fill("me@a.test\\"); evil(\\"")',
        '  await page.getByLabel("Password").fill(process.env.E2E_PASSWORD ?? "")',
        '  await page.getByRole("checkbox").check()',
        '  await page.getByLabel("Plan").selectOption("pro")',
        '  await page.getByLabel("Email").press("Enter")',
        '  await page.getByRole("button", { name: "Save", exact: true }).click()',
        '  await expect(page).toHaveURL("https://a.test/home")',
        '  await expect(page.getByTestId("greeting")).toContainText("Hi")',
        "})",
        "",
      ].join("\n")
    )
  })

  it("lists the other locators beside the one it uses", () => {
    const code = toPlaywright({
      ...recording,
      steps: [
        { action: "navigate", url: "https://a.test/login", at: 0 },
        {
          action: "click",
          target: {
            locators: [
              'getByRole("button", { name: "Save", exact: true })',
              'getByText("Save")',
              'locator("#save\u2028x")',
            ],
          },
          at: 1,
        },
      ],
    })
    expect(code).toContain(
      '  await page.getByRole("button", { name: "Save", exact: true }).click() // or: page.getByText("Save"), page.locator("#save\\u2028x")'
    )
    // A raw line separator would end the comment; written as its escape it cannot.
    expect(code).not.toMatch(/[\u2028\u2029]/)
  })

  it("goes to an address the person opened, rather than checking for it", () => {
    let steps = appendStep([], { action: "navigate", url: "https://a.test/a", at: 0 })
    steps = appendStep(steps, { action: "navigate", url: "https://a.test/b", at: 1 })
    steps = appendStep(steps, click(2))
    const code = toPlaywright({ ...recording, url: "https://a.test/a", steps })
    expect(code).toContain(
      '  await page.goto("https://a.test/a")\n  await page.goto("https://a.test/b")'
    )
    expect(code).not.toContain("toHaveURL")
  })

  it("names an unnamed secret by its place", () => {
    expect(secretName({ action: "fill", secret: true, at: 0 }, 2)).toBe("E2E_SECRET_3")
  })
})
