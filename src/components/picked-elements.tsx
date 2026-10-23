import { useEffect, useRef, useState } from "react"
import {
  Badge,
  Button,
  Card,
  CardContent,
  cn,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  CopyFeedbackIcon,
  Input,
  Label,
  Textarea,
  useCopy,
} from "@cognia/plugin-ui"
import { ChevronRightIcon, CrosshairIcon, NotebookPenIcon, XIcon } from "lucide-react"

import type { BrowserApi } from "@ext/src/lib/browser-api"
import type { PickedElement } from "@ext/src/lib/inspect/element-context"
import { codeSnippet } from "@ext/src/lib/inspect/element-markup"
import { formatLocation } from "@ext/src/lib/inspect/inspect-markdown"
import { hasEdits, MAX_TEXT_EDIT } from "@ext/src/lib/inspect/style-edits"
import { MarkdownView } from "./markdown-view"
import { StyleEditor } from "./style-editor"

/** What a pick's card is doing right now, if anything. */
export type PickAction = "locate" | "shoot" | "adjust"

export interface PickedElementsProps {
  api: BrowserApi
  elements: PickedElement[]
  /** Element ids the page no longer has. */
  detached: string[]
  busy: { elementId: string; action: PickAction } | null
  /** Whether a screenshot can still be attached. */
  canShoot: boolean
  /** The Markdown these picks add to what is sent, for review. */
  preview: string
  onChange: (elementId: string, next: Pick<PickedElement, "note" | "edits">) => void
  onRemove: (elementId: string) => void
  onLocate: (elementId: string) => void
  onShoot: (elementId: string) => void
  /** Resize it and nudge its spacing on the page itself. */
  onAdjust?: (elementId: string) => void
  /** Sample a colour from the screen into a style field, where the browser can. */
  onEyedrop?: () => Promise<string | null>
}

function CopyButton({ api, value, label }: { api: BrowserApi; value: string; label: string }) {
  const { copied, copy } = useCopy()
  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-5 w-5 shrink-0 p-0"
      onClick={() => void copy(value)}
      aria-label={api.message("inspectCopy", [label])}
    >
      <CopyFeedbackIcon copied={copied} className="size-3" />
    </Button>
  )
}

/**
 * The elements the person picked, each with what the page said about it and
 * what they want changed (Design Mode, React Grab).
 *
 * A card leads with what identifies the element in the source — the component
 * chain and where it was written — because that is the step a screenshot
 * cannot do. Its note and style edits are the request; the edits preview on
 * the page while the card is here, and go back when it is removed.
 */
export function PickedElements({
  api,
  elements,
  detached,
  busy,
  canShoot,
  preview,
  onChange,
  onRemove,
  onLocate,
  onShoot,
  onAdjust,
  onEyedrop,
}: PickedElementsProps) {
  const [showPreview, setShowPreview] = useState(false)
  // Which cards are open. A pick added on its own opens, to be worked on; a
  // batch chosen together comes in folded, so the list stays readable.
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const known = useRef<Set<string> | null>(null)
  const ids = elements.map((element) => element.elementId)
  const fresh = ids.filter((id) => !known.current?.has(id))
  const idsKey = ids.join(" ")
  useEffect(() => {
    const arrived = idsKey.split(" ").filter((id) => id && !known.current?.has(id))
    known.current = new Set(idsKey.split(" "))
    if (arrived.length > 0)
      setOpen((current) => ({
        ...current,
        ...Object.fromEntries(arrived.map((id) => [id, arrived.length === 1])),
      }))
  }, [idsKey])
  const isOpen = (id: string) => open[id] ?? (fresh.includes(id) ? fresh.length === 1 : true)
  if (elements.length === 0) return null
  const allOpen = ids.every(isOpen)
  return (
    <div className="space-y-2" data-testid="picked-elements">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium">
          {api.message("inspectPickedTitle", [String(elements.length)])}
        </p>
        {elements.length > 1 ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[11px] text-muted-foreground"
            onClick={() => setOpen(Object.fromEntries(ids.map((id) => [id, !allOpen])))}
            data-testid="picks-expand-all"
          >
            {allOpen ? api.message("inspectCollapseAll") : api.message("inspectExpandAll")}
          </Button>
        ) : null}
      </div>
      <ol className="space-y-1.5">
        {elements.map((element, index) => (
          <li key={element.elementId} className="animate-enter motion-reduce:animate-none">
            <PickedElementCard
              api={api}
              element={element}
              index={index}
              open={isOpen(element.elementId)}
              onOpenChange={(next) =>
                setOpen((current) => ({ ...current, [element.elementId]: next }))
              }
              detached={detached.includes(element.elementId)}
              busy={busy?.elementId === element.elementId ? busy.action : null}
              canShoot={canShoot}
              onChange={(next) => onChange(element.elementId, next)}
              onRemove={() => onRemove(element.elementId)}
              onLocate={() => onLocate(element.elementId)}
              onShoot={() => onShoot(element.elementId)}
              {...(onAdjust ? { onAdjust: () => onAdjust(element.elementId) } : {})}
              {...(onEyedrop ? { onEyedrop } : {})}
            />
          </li>
        ))}
      </ol>
      <Collapsible open={showPreview} onOpenChange={setShowPreview}>
        <CollapsibleTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[11px]"
            data-testid="inspect-preview-toggle"
          >
            {showPreview ? api.message("inspectPreviewHide") : api.message("inspectPreviewShow")}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="max-h-72 overflow-auto rounded-control border border-border p-2">
            <MarkdownView api={api} source={preview} testId="inspect-preview" />
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

function PickedElementCard({
  api,
  element,
  index,
  open,
  onOpenChange,
  detached,
  busy,
  canShoot,
  onChange,
  onRemove,
  onLocate,
  onShoot,
  onAdjust,
  onEyedrop,
}: {
  api: BrowserApi
  element: PickedElement
  index: number
  open: boolean
  onOpenChange: (open: boolean) => void
  detached: boolean
  busy: PickAction | null
  canShoot: boolean
  onChange: (next: Pick<PickedElement, "note" | "edits">) => void
  onRemove: () => void
  onLocate: () => void
  onShoot: () => void
  onAdjust?: () => void
  onEyedrop?: () => Promise<string | null>
}) {
  const [styling, setStyling] = useState(false)
  const [showProps, setShowProps] = useState(false)
  const [showState, setShowState] = useState(false)
  const { copied: codeCopied, copy: copyCode } = useCopy()
  const id = element.elementId
  const framework = element.framework
  const source = framework?.source ?? framework?.components.find((frame) => frame.source)?.source
  const location = source ?? element.sourceHints[0]
  const edited = hasEdits(element.styles, element.edits, element.text)
  const component = framework?.components[0]?.name
  // One line in the header, however much text the element holds.
  const excerpt = (element.name ?? element.text ?? "").replace(/\s+/g, " ").trim()
  const size = (
    <Badge
      variant="outline"
      className="shrink-0 font-mono text-[10px]"
      data-testid={`pick-size-${index}`}
    >
      {element.box.width}×{element.box.height}
    </Badge>
  )
  return (
    <Card className="gap-0 overflow-hidden py-0" data-testid={`pick-${index}`}>
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <div className={cn("flex items-start gap-1 px-2 py-2", open && "border-b border-border")}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex min-w-0 flex-1 items-start gap-1.5 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              aria-expanded={open}
              data-testid={`pick-toggle-${index}`}
            >
              <ChevronRightIcon
                className={cn(
                  "mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none",
                  open && "rotate-90"
                )}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 space-y-0.5">
                <span
                  className="block truncate font-mono text-xs font-medium"
                  title={element.label}
                >
                  {index + 1}. {element.label}
                </span>
                {excerpt ? (
                  <span
                    className="block truncate text-[11px] text-muted-foreground"
                    title={excerpt.slice(0, 300)}
                    data-testid={`pick-excerpt-${index}`}
                  >
                    {excerpt}
                  </span>
                ) : null}
                {open ? null : (
                  // Folded: what is on the card, at a glance.
                  <span
                    className="flex flex-wrap items-center gap-1 pt-0.5"
                    data-testid={`pick-summary-${index}`}
                  >
                    {size}
                    {component ? (
                      <Badge variant="secondary" className="font-mono text-[10px]">
                        {component}
                      </Badge>
                    ) : null}
                    {element.note.trim() ? (
                      <Badge variant="outline" className="gap-0.5 text-[10px]">
                        <NotebookPenIcon className="size-2.5" aria-hidden="true" />
                        {api.message("inspectNoted")}
                      </Badge>
                    ) : null}
                    {edited ? (
                      <Badge variant="secondary" className="text-[10px]">
                        {api.message("inspectEdited")}
                      </Badge>
                    ) : null}
                    {element.contrast && !element.contrast.aa ? (
                      <Badge variant="destructive" className="text-[10px]">
                        AA ✗
                      </Badge>
                    ) : null}
                    {detached ? (
                      <Badge variant="warning" className="text-[10px]">
                        {api.message("inspectDetached")}
                      </Badge>
                    ) : null}
                  </span>
                )}
              </span>
            </button>
          </CollapsibleTrigger>
          {open ? <span className="mt-0.5">{size}</span> : null}
          {open ? null : (
            <>
              <Button
                size="icon-xs"
                variant="ghost"
                className="shrink-0 text-muted-foreground"
                disabled={busy !== null || detached}
                onClick={onLocate}
                title={api.message("inspectLocate")}
                aria-label={api.message("inspectLocate")}
                data-testid={`pick-quick-locate-${index}`}
              >
                <CrosshairIcon aria-hidden="true" />
              </Button>
              <Button
                size="icon-xs"
                variant="ghost"
                className="shrink-0 text-muted-foreground hover:text-destructive"
                onClick={onRemove}
                title={api.message("remove")}
                aria-label={api.message("inspectRemove", [element.label])}
                data-testid={`pick-quick-remove-${index}`}
              >
                <XIcon aria-hidden="true" />
              </Button>
            </>
          )}
        </div>
        <CollapsibleContent>
          <CardContent className="space-y-2 px-3 py-2.5">
            {element.contrast ? (
              <div
                className="flex flex-wrap items-center gap-1"
                data-testid={`pick-contrast-${index}`}
              >
                <span
                  className="rounded border border-border px-1 text-[11px] font-semibold"
                  style={{
                    color: element.contrast.foreground,
                    background: element.contrast.background,
                  }}
                  aria-hidden="true"
                >
                  Aa
                </span>
                <span className="font-mono text-[11px]">{element.contrast.ratio.toFixed(2)}:1</span>
                <Badge
                  variant={element.contrast.aa ? "secondary" : "destructive"}
                  className="text-[10px]"
                >
                  AA {element.contrast.aa ? "✓" : "✗"}
                </Badge>
                <Badge
                  variant={element.contrast.aaa ? "secondary" : "outline"}
                  className="text-[10px]"
                >
                  AAA {element.contrast.aaa ? "✓" : "✗"}
                </Badge>
                {element.contrast.suggestion ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-5 gap-1 px-1.5 text-[10px]"
                    onClick={() =>
                      onChange({
                        note: element.note,
                        edits: {
                          ...element.edits,
                          styles: { ...element.edits.styles, color: element.contrast!.suggestion! },
                        },
                      })
                    }
                    title={api.message("inspectContrastFixHint")}
                    data-testid={`pick-contrast-fix-${index}`}
                  >
                    <span
                      className="h-3 w-3 rounded-sm border border-border"
                      style={{ background: element.contrast.suggestion }}
                      aria-hidden="true"
                    />
                    {api.message("inspectContrastFix", [element.contrast.suggestion])}
                  </Button>
                ) : null}
              </div>
            ) : null}
            {framework && framework.components.length > 0 ? (
              <p className="break-words text-[11px]" data-testid={`pick-components-${index}`}>
                <span className="text-muted-foreground">{api.message("inspectComponents")} </span>
                <span className="font-mono">
                  {framework.components
                    .slice(0, 4)
                    .map((frame) => frame.name)
                    .join(" ← ")}
                </span>
              </p>
            ) : null}
            {location ? (
              <div className="flex items-center gap-1" data-testid={`pick-source-${index}`}>
                <span className="text-[11px] text-muted-foreground">
                  {api.message("inspectSource")}
                </span>
                <code
                  className="min-w-0 truncate font-mono text-[11px]"
                  title={formatLocation(location)}
                >
                  {formatLocation(location)}
                </code>
                {location.approximate ? (
                  <Badge variant="outline" className="text-[10px]">
                    {api.message("inspectApproximate")}
                  </Badge>
                ) : null}
                <CopyButton
                  api={api}
                  value={formatLocation(location)}
                  label={formatLocation(location)}
                />
              </div>
            ) : (
              <p
                className="text-[11px] text-muted-foreground"
                data-testid={`pick-no-source-${index}`}
              >
                {api.message("inspectNoSource")}
              </p>
            )}
            <div className="flex items-center gap-1">
              <code
                className="min-w-0 truncate font-mono text-[11px] text-muted-foreground"
                title={element.selector}
              >
                {element.selector}
              </code>
              <CopyButton api={api} value={element.selector} label={element.selector} />
            </div>
            {framework?.props ? (
              <Collapsible open={showProps} onOpenChange={setShowProps}>
                <CollapsibleTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[11px]"
                    data-testid={`pick-props-toggle-${index}`}
                  >
                    {api.message("inspectProps", [framework.props.component])}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <pre
                    className="max-h-40 overflow-auto rounded-control border border-border p-1.5 font-mono text-[10px]"
                    data-testid={`pick-props-${index}`}
                  >
                    {framework.props.json}
                  </pre>
                </CollapsibleContent>
              </Collapsible>
            ) : null}
            {framework?.state ? (
              <Collapsible open={showState} onOpenChange={setShowState}>
                <CollapsibleTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[11px]"
                    data-testid={`pick-state-toggle-${index}`}
                  >
                    {api.message("inspectState", [framework.state.component])}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <pre
                    className="max-h-40 overflow-auto rounded-control border border-border p-1.5 font-mono text-[10px]"
                    data-testid={`pick-state-${index}`}
                  >
                    {framework.state.json}
                  </pre>
                </CollapsibleContent>
              </Collapsible>
            ) : null}

            {detached ? (
              <Badge
                variant="warning"
                className="text-[10px]"
                data-testid={`pick-detached-${index}`}
              >
                {api.message("inspectDetached")}
              </Badge>
            ) : null}

            <div className="space-y-1">
              <Label htmlFor={`pick-note-${id}`} className="text-[11px] text-muted-foreground">
                {api.message("inspectNoteLabel")}
              </Label>
              <Textarea
                id={`pick-note-${id}`}
                rows={2}
                value={element.note}
                maxLength={MAX_TEXT_EDIT}
                placeholder={api.message("inspectNotePlaceholder")}
                onChange={(event) => onChange({ note: event.target.value, edits: element.edits })}
                className="text-xs"
                data-testid={`pick-note-${index}`}
              />
            </div>

            {element.textEditable ? (
              <div className="space-y-1">
                <Label htmlFor={`pick-text-${id}`} className="text-[11px] text-muted-foreground">
                  {api.message("inspectTextLabel")}
                </Label>
                <Input
                  id={`pick-text-${id}`}
                  value={element.edits.text ?? element.text}
                  maxLength={MAX_TEXT_EDIT}
                  onChange={(event) => {
                    const { text: _previous, ...rest } = element.edits
                    onChange({
                      note: element.note,
                      edits:
                        event.target.value === element.text
                          ? rest
                          : { ...rest, text: event.target.value },
                    })
                  }}
                  className="h-7 text-xs"
                  data-testid={`pick-text-${index}`}
                />
              </div>
            ) : null}

            <Collapsible open={styling} onOpenChange={setStyling}>
              <CollapsibleTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-[11px]"
                  data-testid={`pick-styles-toggle-${index}`}
                >
                  {styling ? api.message("inspectStylesHide") : api.message("inspectStylesShow")}
                  {edited ? (
                    <Badge variant="secondary" className="ml-1 text-[10px]">
                      {api.message("inspectEdited")}
                    </Badge>
                  ) : null}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-1">
                <StyleEditor
                  api={api}
                  idPrefix={`pick-${index}`}
                  computed={element.styles}
                  edits={element.edits.styles}
                  onChange={(styles) =>
                    onChange({ note: element.note, edits: { ...element.edits, styles } })
                  }
                  {...(onEyedrop ? { onEyedrop } : {})}
                />
              </CollapsibleContent>
            </Collapsible>

            <div className="flex flex-wrap gap-1">
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-[11px]"
                disabled={busy !== null || detached}
                onClick={onLocate}
                data-testid={`pick-locate-${index}`}
              >
                {busy === "locate" ? api.message("attachWorking") : api.message("inspectLocate")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-[11px]"
                disabled={busy !== null || detached || !canShoot}
                onClick={onShoot}
                data-testid={`pick-shoot-${index}`}
              >
                {busy === "shoot" ? api.message("attachWorking") : api.message("inspectShoot")}
              </Button>
              {onAdjust ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-[11px]"
                  disabled={busy !== null || detached}
                  onClick={onAdjust}
                  title={api.message("adjustButtonHint")}
                  data-testid={`pick-adjust-${index}`}
                >
                  {busy === "adjust" ? api.message("adjustWorking") : api.message("adjustButton")}
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="outline"
                className="h-6 gap-1 px-2 text-[11px]"
                onClick={() => void copyCode(codeSnippet(element))}
                title={api.message("inspectCopyCodeHint")}
                data-testid={`pick-copy-code-${index}`}
              >
                <CopyFeedbackIcon copied={codeCopied} className="size-3" />
                {api.message("inspectCopyCode")}
              </Button>
              {edited ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-[11px]"
                  onClick={() => onChange({ note: element.note, edits: { styles: {} } })}
                  data-testid={`pick-revert-${index}`}
                >
                  {api.message("inspectRevert")}
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[11px]"
                onClick={onRemove}
                aria-label={api.message("inspectRemove", [element.label])}
                data-testid={`pick-remove-${index}`}
              >
                {api.message("remove")}
              </Button>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}
