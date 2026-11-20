/** @jest-environment <rootDir>/testing/jsdom-environment.cjs */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"

import type { BrowserApi } from "@ext/src/lib/browser-api"
import {
  AGENT_NETWORK_RULES_KEY,
  EXPORT_FORMAT,
  NETWORK_RULES_KEY,
  parseLibrary,
} from "@ext/src/lib/network-rules/rules"
import type { RuleCommand } from "@ext/src/lib/network-rules/store"
import { RULE_SYNC_STATUS_KEY } from "@ext/src/lib/network-rules/sync"

import { NetworkRules, parseHeaderLines } from "./network-rules"

// jsdom's Blob has no text(); the panel's file import and the export read through it.
if (!Blob.prototype.text)
  Blob.prototype.text = function (this: Blob) {
    return new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.readAsText(this)
    })
  }

function harness(
  options: {
    library?: unknown
    agent?: unknown
    status?: unknown
    answer?: { ok: true } | { ok: false; error: string }
  } = {}
) {
  const local = new Map<string, unknown>([[NETWORK_RULES_KEY, options.library ?? null]])
  const session = new Map<string, unknown>([
    [AGENT_NETWORK_RULES_KEY, options.agent ?? null],
    [RULE_SYNC_STATUS_KEY, options.status ?? null],
  ])
  const localListeners = new Map<string, (value: unknown) => void>()
  const sessionListeners = new Map<string, (value: unknown) => void>()
  const commands: RuleCommand[] = []
  const requested: unknown[] = []
  const api = {
    message: (key: string, subs?: string[]) => (subs ? `${key}:${subs.join("/")}` : key),
    read: async (key: string) => local.get(key) ?? null,
    readSession: async (key: string) => session.get(key) ?? null,
    onStorageChange: (key: string, listener: (value: unknown) => void) => {
      localListeners.set(key, listener)
      return () => localListeners.delete(key)
    },
    onSessionChange: (key: string, listener: (value: unknown) => void) => {
      sessionListeners.set(key, listener)
      return () => sessionListeners.delete(key)
    },
    networkRuleCommand: jest.fn(async (command: RuleCommand) => {
      commands.push(command)
      return options.answer ?? { ok: true }
    }),
    requestPermissions: jest.fn(async (request: unknown) => {
      requested.push(request)
      return true
    }),
  } as unknown as BrowserApi
  render(<NetworkRules api={api} currentHost="shop.test" now={() => Date.UTC(2026, 9, 27)} />)
  return {
    api,
    commands,
    requested,
    pushLibrary: (value: unknown) => act(() => localListeners.get(NETWORK_RULES_KEY)?.(value)),
    pushAgent: (value: unknown) =>
      act(() => sessionListeners.get(AGENT_NETWORK_RULES_KEY)?.(value)),
  }
}

const LIBRARY = {
  v: 1,
  groups: [
    {
      id: "g1",
      name: "Shop",
      sites: ["shop.test"],
      enabled: true,
      rules: [
        { id: "r1", match: "/api/orders", action: "respond", status: 503 },
        { id: "r2", match: "/api/", action: "request_headers", headers: { "X-Env": "staging" } },
      ],
    },
  ],
}

function expand() {
  const toggle = screen.getByRole("button", { name: "rulesTitle" })
  if (toggle.getAttribute("aria-expanded") === "false") fireEvent.click(toggle)
}

/** A change in flight disables the controls until the worker answers. */
const settle = () =>
  waitFor(() => expect(screen.getAllByRole("button", { name: "rulesRemove" })[0]).toBeEnabled())

async function choose(trigger: string, option: string) {
  fireEvent.click(screen.getByTestId(trigger))
  fireEvent.click(await screen.findByRole("option", { name: option }))
}

describe("NetworkRules", () => {
  it("adds a group for this site, then a rule in it, through the worker", async () => {
    const h = harness()
    expand()
    expect(await screen.findByTestId("rules-empty")).toBeInTheDocument()
    expect(screen.getByTestId("rules-group-add")).toBeDisabled()
    fireEvent.click(screen.getByTestId("rules-group-this-site"))
    fireEvent.change(screen.getByTestId("rules-group-name"), { target: { value: "Shop" } })
    fireEvent.click(screen.getByTestId("rules-group-add"))
    await waitFor(() =>
      expect(h.commands).toEqual([{ op: "add-group", name: "Shop", sites: ["shop.test"] }])
    )
    h.pushLibrary({ ...LIBRARY, groups: [{ ...LIBRARY.groups[0], rules: [] }] })
    fireEvent.click(await screen.findByTestId("rules-group-toggle"))
    expect(screen.getByTestId("rules-add")).toBeDisabled()
    fireEvent.change(screen.getByTestId("rules-match"), { target: { value: "/api/*" } })
    await choose("rules-action", "rulesActionRequestHeaders")
    expect(screen.getByTestId("rules-add")).toBeDisabled()
    fireEvent.change(screen.getByTestId("rules-headers"), {
      target: { value: "X-Env: staging\nnot a header" },
    })
    fireEvent.change(screen.getByTestId("rules-remove-headers"), {
      target: { value: "cookie, " },
    })
    expect(screen.getByTestId("rules-coverage")).toHaveTextContent("rulesCoverageAll")
    fireEvent.click(screen.getByTestId("rules-add"))
    await waitFor(() =>
      expect(h.commands.at(-1)).toEqual({
        op: "add-rule",
        groupId: "g1",
        rule: expect.objectContaining({
          match: "/api/*",
          action: "request_headers",
          headers: { "X-Env": "staging" },
          removeHeaders: ["cookie"],
        }),
      })
    )
  })

  it("lists a group's rules and changes them in place", async () => {
    const h = harness({ library: LIBRARY })
    expand()
    fireEvent.click(await screen.findByTestId("rules-group-toggle"))
    expect(screen.getAllByTestId("rules-rule").map((row) => row.textContent)).toEqual([
      expect.stringContaining("rulesDoRespond:503"),
      expect.stringContaining("rulesDoSetHeaders:X-Env"),
    ])
    fireEvent.click(screen.getAllByRole("button", { name: "rulesMoveDown" })[0]!)
    await waitFor(() =>
      expect(h.commands.at(-1)).toEqual({ op: "move-rule", groupId: "g1", ruleId: "r1", by: 1 })
    )
    await settle()
    fireEvent.click(screen.getAllByRole("button", { name: "rulesPause" })[1]!)
    await waitFor(() =>
      expect(h.commands.at(-1)).toEqual({
        op: "toggle-rule",
        groupId: "g1",
        ruleId: "r2",
        enabled: false,
      })
    )
    await settle()
    fireEvent.click(screen.getByTestId("rules-group-enabled"))
    await waitFor(() =>
      expect(h.commands.at(-1)).toEqual({ op: "update-group", groupId: "g1", enabled: false })
    )
    await settle()
    fireEvent.click(screen.getByTestId("rules-group-remove"))
    await waitFor(() => expect(h.commands.at(-1)).toEqual({ op: "remove-group", groupId: "g1" }))
  })

  it("shows the agent's rules open and lets the person remove one", async () => {
    const h = harness({
      agent: { s1: [{ id: "s1:a", match: "/track", action: "fail" }] },
    })
    expect(await screen.findByTestId("rules-agent")).toHaveTextContent("rulesDoFail")
    fireEvent.click(screen.getByRole("button", { name: "rulesRemove" }))
    await waitFor(() =>
      expect(h.commands).toEqual([{ op: "remove-agent-rule", sessionId: "s1", ruleId: "s1:a" }])
    )
    h.pushAgent(null)
    await waitFor(() => expect(screen.queryByTestId("rules-agent")).toBeNull())
  })

  it("asks for what the rules still need inside the click", async () => {
    const h = harness({
      library: LIBRARY,
      status: { needsDnr: true, missingOrigins: ["*://*.shop.test/*"], unsupported: ["x"] },
    })
    expand()
    fireEvent.click(await screen.findByTestId("rules-grant-dnr"))
    fireEvent.click(screen.getByTestId("rules-grant-sites"))
    expect(h.requested).toEqual([
      { permissions: ["declarativeNetRequestWithHostAccess"] },
      { origins: ["*://*.shop.test/*"] },
    ])
    expect(screen.getByTestId("rules-unsupported")).toHaveTextContent("rulesUnsupported:1")
  })

  it("says why the worker refused a change", async () => {
    harness({ library: LIBRARY, answer: { ok: false, error: "too_many_rules" } })
    expand()
    fireEvent.click(await screen.findByTestId("rules-group-remove"))
    expect(await screen.findByTestId("rules-notice")).toHaveTextContent("rulesErrorRules")
  })

  it("exports the library to a file and imports one back", async () => {
    const h = harness({ library: LIBRARY })
    expand()
    await screen.findByTestId("rules-groups")
    const created: Blob[] = []
    URL.createObjectURL = jest.fn((blob: Blob) => {
      created.push(blob)
      return "blob:rules"
    })
    URL.revokeObjectURL = jest.fn()
    const click = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
    fireEvent.click(screen.getByTestId("rules-export"))
    expect(click).toHaveBeenCalled()
    const text = await created[0]!.text()
    expect(JSON.parse(text)).toMatchObject({
      format: EXPORT_FORMAT,
      groups: parseLibrary(LIBRARY).groups,
    })
    const file = new File([text], "rules.json", { type: "application/json" })
    fireEvent.change(screen.getByTestId("rules-import-file"), { target: { files: [file] } })
    await waitFor(() =>
      expect(h.commands.at(-1)).toMatchObject({
        op: "import",
        groups: [expect.objectContaining({ name: "Shop", sites: ["shop.test"] })],
      })
    )
    fireEvent.change(screen.getByTestId("rules-import-file"), {
      target: { files: [new File(["{}"], "other.json")] },
    })
    expect(await screen.findByTestId("rules-notice")).toHaveTextContent("rulesImportInvalid")
    click.mockRestore()
  })
})

describe("parseHeaderLines", () => {
  it("reads Name: value lines and skips the rest", () => {
    expect(parseHeaderLines("A: 1\n: no\nB:2:3\nnothing")).toEqual({ A: "1", B: "2:3" })
  })
})
