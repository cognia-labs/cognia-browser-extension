/**
 * How a test should find an element again: Playwright locators, best first,
 * each kept only if it picks out this element and no other on the page.
 *
 * The order is Playwright's own advice — a test id the team put there on
 * purpose, then what a person perceives (role and name, label, placeholder,
 * text), and a CSS path last, because it breaks with the markup. Every
 * argument is a JSON string literal, which is what `isLocator` accepts.
 */
import { uniqueSelector } from "../inspect/element-context"

const TEST_IDS = ["data-testid", "data-test-id", "data-test", "data-cy", "data-qa"]
const MAX_NAME = 80

const squash = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim()

/** The ARIA role an element has, explicit or implied, for the tags a test acts on. */
export function roleOf(element: Element): string | null {
  const explicit = element.getAttribute("role")?.trim().split(/\s+/)[0]
  if (explicit) return explicit
  const tag = element.tagName.toLowerCase()
  switch (tag) {
    case "a":
      return element.hasAttribute("href") ? "link" : null
    case "button":
    case "summary":
      return "button"
    case "select":
      return (element as HTMLSelectElement).multiple || (element as HTMLSelectElement).size > 1
        ? "listbox"
        : "combobox"
    case "textarea":
      return "textbox"
    case "img":
      return element.getAttribute("alt") ? "img" : null
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6":
      return "heading"
    case "option":
      return "option"
    case "input": {
      const type = (element.getAttribute("type") ?? "text").toLowerCase()
      if (type === "checkbox") return "checkbox"
      if (type === "radio") return "radio"
      if (["button", "submit", "reset", "image"].includes(type)) return "button"
      if (type === "range") return "slider"
      if (type === "number") return "spinbutton"
      if (type === "search") return element.hasAttribute("list") ? "combobox" : "searchbox"
      if (["email", "tel", "text", "url", ""].includes(type))
        return element.hasAttribute("list") ? "combobox" : "textbox"
      return null
    }
    default:
      return null
  }
}

function labelText(element: Element): string {
  const doc = element.ownerDocument
  const labelledBy = element.getAttribute("aria-labelledby")
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => squash(doc.getElementById(id)?.textContent))
      .filter(Boolean)
      .join(" ")
    if (text) return text
  }
  const labels = (element as HTMLInputElement).labels
  if (labels && labels.length > 0) return squash(labels[0]!.textContent)
  return ""
}

/** The accessible name, as far as a test needs it: aria, label, alt, value, text. */
export function nameOf(element: Element): string {
  const aria = squash(element.getAttribute("aria-label"))
  if (aria) return aria
  const label = labelText(element)
  if (label) return label
  const tag = element.tagName.toLowerCase()
  if (tag === "img") return squash(element.getAttribute("alt"))
  if (tag === "input") {
    const type = (element.getAttribute("type") ?? "").toLowerCase()
    if (["button", "submit", "reset"].includes(type))
      return squash((element as HTMLInputElement).value)
    return squash(element.getAttribute("title"))
  }
  if (["select", "textarea"].includes(tag)) return squash(element.getAttribute("title"))
  return (
    squash((element as HTMLElement).innerText ?? element.textContent) ||
    squash(element.getAttribute("title"))
  )
}

const literal = (value: string) => JSON.stringify(value)

function candidates(doc: Document, selector: string): Element[] {
  try {
    return [...doc.querySelectorAll(selector)]
  } catch {
    return []
  }
}

/** The locators for one element, best first, each unique on the page. */
export function locatorsFor(element: Element): {
  locators: string[]
  role?: string
  name?: string
} {
  const doc = element.ownerDocument
  const all = [...doc.querySelectorAll("*")]
  const locators: string[] = []
  const only = (matches: (other: Element) => boolean) =>
    all.filter(matches).length === 1 && matches(element)

  for (const attribute of TEST_IDS) {
    const value = element.getAttribute(attribute)
    const quoted = `[${attribute}="${value?.replace(/["\\]/g, "\\$&")}"]`
    if (value && candidates(doc, quoted).length === 1) {
      // Playwright's getByTestId reads data-testid; another attribute is a CSS locator.
      locators.push(
        attribute === "data-testid"
          ? `getByTestId(${literal(value)})`
          : `locator(${literal(`[${attribute}=${literal(value)}]`)})`
      )
      break
    }
  }

  const role = roleOf(element)
  const name = nameOf(element)
  const shortName = name.length <= MAX_NAME ? name : ""
  if (role && shortName) {
    if (only((other) => roleOf(other) === role && nameOf(other) === shortName))
      locators.push(`getByRole(${literal(role)}, { name: ${literal(shortName)}, exact: true })`)
  } else if (role && !name && only((other) => roleOf(other) === role)) {
    locators.push(`getByRole(${literal(role)})`)
  }

  const label = labelText(element)
  if (label && label.length <= MAX_NAME && only((other) => labelText(other) === label))
    locators.push(`getByLabel(${literal(label)})`)

  const placeholder = squash(element.getAttribute("placeholder"))
  if (placeholder && only((other) => squash(other.getAttribute("placeholder")) === placeholder))
    locators.push(`getByPlaceholder(${literal(placeholder)})`)

  const own = squash((element as HTMLElement).innerText ?? element.textContent)
  if (
    own &&
    own.length <= MAX_NAME &&
    !role &&
    // The innermost element with this text: its ancestors share it. The
    // textContent test first: innerText lays the page out.
    only(
      (other) =>
        (other.textContent ?? "").includes(own.split(" ")[0]!) &&
        squash((other as HTMLElement).innerText ?? other.textContent) === own &&
        ![...other.children].some(
          (child) => squash((child as HTMLElement).innerText ?? child.textContent) === own
        )
    )
  )
    locators.push(`getByText(${literal(own)})`)

  locators.push(`locator(${literal(uniqueSelector(element))})`)
  return {
    locators: [...new Set(locators)].slice(0, 5),
    ...(role ? { role } : {}),
    ...(name ? { name: name.slice(0, 200) } : {}),
  }
}

/**
 * A field whose value must not be recorded: a password, a one-time code, a
 * card's number or security code, or anything named like a secret.
 */
export function isSecretField(element: Element): boolean {
  const input = element as HTMLInputElement
  if (element.tagName === "INPUT" && input.type === "password") return true
  const autocomplete = (element.getAttribute("autocomplete") ?? "").toLowerCase()
  if (
    /\b(?:current-password|new-password|one-time-code|cc-number|cc-csc|cc-exp)/.test(autocomplete)
  )
    return true
  const hints = [
    element.getAttribute("name"),
    element.id,
    element.getAttribute("aria-label"),
    labelText(element),
  ]
    .join(" ")
    .toLowerCase()
  return /pass(?:word|code|phrase)?|secret|token|otp|one[-_ ]?time|\bpin\b|cvv|cvc|card[-_ ]?number|ssn|api[-_ ]?key/.test(
    hints
  )
}
