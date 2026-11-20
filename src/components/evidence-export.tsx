import { useState } from "react"
import { Button, Checkbox, Label } from "@cognia/plugin-ui"

import type { BrowserApi } from "@ext/src/lib/browser-api"
import type { PendingAttachment } from "@ext/src/lib/panel/screenshots"

export interface EvidenceExportProps {
  api: BrowserApi
  attachments: readonly PendingAttachment[]
  onDownload: (chosen: ReadonlySet<string>) => void
  onCancel: () => void
}

/**
 * Choose what goes into an evidence bundle, before it is made (report item 05).
 *
 * Every file is listed with its size and starts chosen — each is one the
 * person attached here — and any can be left out. Nothing goes in unlisted:
 * the bundle is the Markdown export and these files, as shown.
 */
export function EvidenceExport({ api, attachments, onDownload, onCancel }: EvidenceExportProps) {
  const [chosen, setChosen] = useState<Set<string>>(
    () => new Set(attachments.map((attachment) => attachment.id))
  )
  const total = attachments
    .filter((attachment) => chosen.has(attachment.id))
    .reduce((sum, attachment) => sum + attachment.bytes.byteLength, 0)
  const toggle = (id: string, on: boolean) =>
    setChosen((current) => {
      const next = new Set(current)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  return (
    <div
      className="space-y-1.5 rounded-control border border-border bg-card p-2"
      role="group"
      aria-label={api.message("exportBundleTitle")}
      data-testid="evidence-export"
    >
      <p className="text-[11px] font-medium">{api.message("exportBundleTitle")}</p>
      <p className="text-[10px] text-muted-foreground">{api.message("exportBundleHint")}</p>
      <ul className="max-h-40 space-y-1 overflow-y-auto">
        {attachments.map((attachment) => (
          <li key={attachment.id} className="flex min-w-0 items-center gap-2">
            <Checkbox
              id={`cognia-bundle-${attachment.id}`}
              checked={chosen.has(attachment.id)}
              onCheckedChange={(next) => toggle(attachment.id, next === true)}
              data-testid={`evidence-export-file-${attachment.id}`}
            />
            <Label
              htmlFor={`cognia-bundle-${attachment.id}`}
              className="min-w-0 flex-1 truncate text-[11px] font-normal"
              title={attachment.name}
            >
              {attachment.name}
            </Label>
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {api.message("exportBundleSize", [(attachment.bytes.byteLength / 1024).toFixed(1)])}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-end gap-1.5">
        <span className="mr-auto text-[10px] text-muted-foreground" data-testid="evidence-total">
          {api.message("exportBundleSize", [(total / 1024).toFixed(1)])}
        </span>
        <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={onCancel}>
          {api.message("cancel")}
        </Button>
        <Button
          size="sm"
          className="h-7 text-[11px]"
          onClick={() => onDownload(chosen)}
          data-testid="evidence-export-download"
        >
          {api.message("exportBundleDownload")}
        </Button>
      </div>
    </div>
  )
}
