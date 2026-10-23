import type { BrowserCaptureMode } from "@cognia/companion-client"
import { useState } from "react"
import { Badge, Button, Input, Label, Textarea, cn } from "@cognia/plugin-ui"

import type { BrowserApi } from "@ext/src/lib/browser-api"
import { editableText, withEditedText } from "@ext/src/lib/panel/page-context"
import type { CapturedPage } from "@ext/src/lib/panel-state"

export interface CaptureEditorProps {
  api: BrowserApi
  page: CapturedPage
  mode: BrowserCaptureMode
  onChange: (page: CapturedPage) => void
}

/**
 * Edit what will be sent, under the preview (ADR-0228 §1).
 *
 * The title and the mode's text are the person's to trim before they agree
 * to send them; what the page said about itself, the video's transcript and
 * a right-clicked link or image are shown as they will go, so nothing rides
 * along unseen.
 */
/** Past this, the text is shown in a box of its own height that scrolls, until opened. */
export const LONG_TEXT_CHARS = 600
export const LONG_TEXT_LINES = 10

export function CaptureEditor({ api, page, mode, onChange }: CaptureEditorProps) {
  const text = editableText(page, mode)
  const [expanded, setExpanded] = useState(false)
  const lines = text === null ? 0 : text.split("\n").length
  const long = text !== null && (text.length > LONG_TEXT_CHARS || lines > LONG_TEXT_LINES)
  const metadata = page.metadata
  return (
    <div className="space-y-2" data-testid="capture-editor">
      <div className="space-y-1">
        <Label htmlFor="cognia-capture-title" className="text-xs text-muted-foreground">
          {api.message("captureEditTitle")}
        </Label>
        <Input
          id="cognia-capture-title"
          value={page.title}
          maxLength={500}
          onChange={(event) => onChange({ ...page, title: event.target.value })}
          data-testid="capture-title-input"
        />
      </div>
      {text !== null ? (
        <div className="space-y-1">
          <div className="flex items-end justify-between gap-2">
            <Label htmlFor="cognia-capture-text" className="text-xs text-muted-foreground">
              {api.message("captureEditText")}
            </Label>
            <span
              className="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums"
              data-testid="capture-text-size"
            >
              {api.message("captureTextSize", [text.length.toLocaleString(), String(lines)])}
            </span>
          </div>
          <Textarea
            id="cognia-capture-text"
            rows={6}
            className={cn(
              "resize-none overflow-y-auto font-mono text-[11px] leading-relaxed break-words",
              // A whole page of text scrolls in its box instead of stretching the panel.
              expanded ? "max-h-[60vh]" : "max-h-44"
            )}
            value={text}
            onChange={(event) => onChange(withEditedText(page, mode, event.target.value))}
            data-testid="capture-text-input"
          />
          {long ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 w-full text-[11px] text-muted-foreground"
              onClick={() => setExpanded((open) => !open)}
              aria-expanded={expanded}
              data-testid="capture-text-expand"
            >
              {expanded ? api.message("captureTextCollapse") : api.message("captureTextExpand")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {metadata && Object.keys(metadata).length > 0 ? (
        <dl
          className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px]"
          data-testid="capture-metadata"
        >
          {metadata.siteName ? (
            <>
              <dt className="text-muted-foreground">{api.message("metadataSite")}</dt>
              <dd className="truncate">{metadata.siteName}</dd>
            </>
          ) : null}
          {metadata.byline ? (
            <>
              <dt className="text-muted-foreground">{api.message("metadataByline")}</dt>
              <dd className="truncate">{metadata.byline}</dd>
            </>
          ) : null}
          {metadata.publishedAt ? (
            <>
              <dt className="text-muted-foreground">{api.message("metadataPublished")}</dt>
              <dd className="truncate">{metadata.publishedAt}</dd>
            </>
          ) : null}
          {metadata.lang ? (
            <>
              <dt className="text-muted-foreground">{api.message("metadataLanguage")}</dt>
              <dd className="truncate">{metadata.lang}</dd>
            </>
          ) : null}
        </dl>
      ) : null}
      {page.transcript ? (
        <div className="flex flex-wrap items-center gap-1.5" data-testid="capture-transcript">
          {page.transcript.status === "available" ? (
            <>
              <Badge variant="secondary">{api.message("transcriptAvailable")}</Badge>
              {page.transcript.language ? (
                <Badge variant="outline">{page.transcript.language}</Badge>
              ) : null}
              {page.transcript.autoGenerated ? (
                <Badge variant="outline">{api.message("transcriptAutoGenerated")}</Badge>
              ) : null}
              {page.transcript.truncated ? (
                <Badge variant="warning">{api.message("captureTruncated")}</Badge>
              ) : null}
            </>
          ) : page.transcript.reason === "no_captions" ? (
            <Badge variant="outline">{api.message("transcriptNoCaptions")}</Badge>
          ) : page.transcript.reason === "fetch_failed" ? (
            <Badge variant="outline">{api.message("transcriptFailed")}</Badge>
          ) : null}
        </div>
      ) : null}
      {page.link ? (
        <p className="break-all text-[11px]" data-testid="capture-link">
          <span className="text-muted-foreground">{api.message("captureLinkLabel")} </span>
          {page.link.text ? `${page.link.text} — ` : ""}
          <span className="font-mono">{page.link.url}</span>
        </p>
      ) : null}
      {page.image ? (
        <p className="break-all text-[11px]" data-testid="capture-image">
          <span className="text-muted-foreground">{api.message("captureImageLabel")} </span>
          <span className="font-mono">{page.image.url}</span>
        </p>
      ) : null}
    </div>
  )
}
