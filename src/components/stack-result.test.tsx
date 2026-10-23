/** @jest-environment <rootDir>/testing/jsdom-environment.cjs */
import { fireEvent, render, screen } from "@testing-library/react"

import type { BrowserApi } from "@ext/src/lib/browser-api"
import type { DetectedStack } from "@ext/src/lib/inspect/tech-stack"

import { StackResult } from "./stack-result"

const api = {
  message: (key: string, subs?: string[]) => (subs ? `${key}:${subs.join("/")}` : key),
} as unknown as BrowserApi

const STACK: DetectedStack = {
  entries: [
    {
      name: "Next.js",
      category: "meta-framework",
      version: "15.1.0",
      detail: "App Router",
      evidence: "self.__next_f",
    },
    { name: "React", category: "framework", version: "19.1.0", evidence: "React fiber" },
    { name: "Tailwind CSS", category: "styling", detail: "v4", evidence: "@property --tw-*" },
    { name: "Vercel", category: "hosting" },
  ],
  development: false,
  facts: {
    scripts: 12,
    moduleScripts: 0,
    inlineScripts: 3,
    stylesheets: 2,
    jsKb: 512,
    cssKb: null,
    protocol: "h3",
    serviceWorker: true,
    manifest: false,
    importMap: false,
    customElements: ["my-card"],
    thirdParty: [{ host: "www.googletagmanager.com", count: 4 }],
  },
}

describe("StackResult", () => {
  it("groups what was found by kind, in the order the agent reads it", () => {
    render(<StackResult api={api} stack={STACK} />)
    expect(screen.getByTestId("stack-count")).toHaveTextContent("stackCount:4")
    const groups = screen.getAllByTestId(/^stack-group-/).map((group) => group.dataset.testid)
    expect(groups).toEqual([
      "stack-group-meta-framework",
      "stack-group-framework",
      "stack-group-styling",
      "stack-group-hosting",
    ])
    const next = screen.getByTestId("stack-group-meta-framework")
    expect(next).toHaveTextContent("stackCategoryMetaFramework")
    expect(next).toHaveTextContent("Next.js15.1.0· App Router")
    expect(screen.getByTitle("React fiber")).toHaveTextContent("React19.1.0")
    expect(screen.getByTestId("stack-build")).toHaveTextContent("stackProduction")
  })

  it("shows how the page is put together", () => {
    render(<StackResult api={api} stack={STACK} />)
    expect(screen.getByTestId("stack-fact-scripts")).toHaveTextContent("stackFactScriptsValue:12/3")
    expect(screen.getByTestId("stack-fact-js")).toHaveTextContent("512 KB")
    expect(screen.getByTestId("stack-fact-css")).toHaveTextContent("—")
    expect(screen.getByTestId("stack-facts")).toHaveTextContent("h3")
    expect(screen.getByTestId("stack-facts")).toHaveTextContent("stackFactServiceWorker")
    expect(screen.getByTestId("stack-facts")).not.toHaveTextContent("stackFactManifest")
    expect(screen.getByTestId("stack-elements")).toHaveTextContent("<my-card>")
    expect(screen.getByTestId("stack-third-party")).toHaveTextContent("www.googletagmanager.com4")
  })

  it("lists the evidence on request", () => {
    render(<StackResult api={api} stack={STACK} />)
    expect(screen.queryByTestId("stack-evidence")).toBeNull()
    fireEvent.click(screen.getByTestId("stack-evidence-toggle"))
    const evidence = screen.getByTestId("stack-evidence")
    expect(evidence).toHaveTextContent("Next.jsself.__next_f")
    expect(evidence).toHaveTextContent("Vercel—")
  })

  it("says when nothing was recognisable, and leaves out what an older check did not read", () => {
    render(<StackResult api={api} stack={{ entries: [], development: null }} />)
    expect(screen.getByText("stackNone")).toBeInTheDocument()
    expect(screen.queryByTestId("stack-facts")).toBeNull()
    expect(screen.queryByTestId("stack-build")).toBeNull()
    expect(screen.queryByTestId("stack-evidence-toggle")).toBeNull()
  })
})
