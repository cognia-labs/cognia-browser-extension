/** @jest-environment <rootDir>/testing/jsdom-environment.cjs */
import { fireEvent, render, screen } from "@testing-library/react"

import type { BrowserApi } from "@ext/src/lib/browser-api"

import { EvidenceExport } from "./evidence-export"

const api = {
  message: (key: string, subs?: string[]) => (subs ? `${key}:${subs.join("/")}` : key),
} as unknown as BrowserApi

const attachment = (id: string, size: number) => ({
  id,
  name: `${id}.png`,
  mediaType: "image/png",
  kind: "screenshot" as const,
  bytes: new Uint8Array(size),
})

describe("EvidenceExport", () => {
  it("lists every file chosen, lets any be left out, and downloads what is left", () => {
    const onDownload = jest.fn()
    render(
      <EvidenceExport
        api={api}
        attachments={[attachment("a", 2048), attachment("b", 1024)]}
        onDownload={onDownload}
        onCancel={() => undefined}
      />
    )
    expect(screen.getByTestId("evidence-total")).toHaveTextContent("exportBundleSize:3.0")
    fireEvent.click(screen.getByTestId("evidence-export-file-b"))
    expect(screen.getByTestId("evidence-total")).toHaveTextContent("exportBundleSize:2.0")
    fireEvent.click(screen.getByTestId("evidence-export-download"))
    expect([...(onDownload.mock.calls[0]![0] as Set<string>)]).toEqual(["a"])
  })
})
