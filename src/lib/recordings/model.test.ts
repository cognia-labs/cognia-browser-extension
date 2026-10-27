import {
  MAX_RECORDINGS,
  appendStep,
  cleanStep,
  isLocator,
  parseRecordings,
  secretName,
  toPlaywright,
  type RecordedStep,
  type Recording,
} from "./model"

const BUTTON = { locators: ['getByRole("button", { name: "Save", exact: true })'] }
const EMAIL = { locators: ['getByLabel("Email")'], role: "textbox", name: "Email" }

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
  const click = (at: number): RecordedStep => ({ action: "click", target: BUTTON, at })

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

  it("checks later addresses instead of visiting them, once each", () => {
    let steps = appendStep([], { action: "navigate", url: "https://a.test/", at: 0 })
    steps = appendStep(steps, { action: "navigate", url: "https://a.test/", at: 1 })
    steps = appendStep(steps, { action: "navigate", url: "https://a.test/done", at: 2 })
    steps = appendStep(steps, { action: "navigate", url: "https://a.test/done", at: 3 })
    expect(steps).toEqual([
      { action: "navigate", url: "https://a.test/", at: 0 },
      { action: "assert", assertion: { kind: "url", expected: "https://a.test/done" }, at: 2 },
    ])
  })
})

describe("parseRecordings", () => {
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

  it("names an unnamed secret by its place", () => {
    expect(secretName({ action: "fill", secret: true, at: 0 }, 2)).toBe("E2E_SECRET_3")
  })
})
