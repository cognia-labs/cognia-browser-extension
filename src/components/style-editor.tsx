import { Button, Input, Label } from "@cognia/plugin-ui"
import { PipetteIcon } from "lucide-react"

import type { BrowserApi } from "@ext/src/lib/browser-api"
import {
  EDITABLE_PROPERTIES,
  STYLE_GROUPS,
  colorToHex,
  isSafeStyleValue,
  type StyleGroup,
} from "@ext/src/lib/inspect/style-edits"

export interface StyleEditorProps {
  api: BrowserApi
  /** A stable prefix for ids and test ids: the pick's own id. */
  idPrefix: string
  /** What the page computed, shown as each field's starting value. */
  computed: Record<string, string>
  edits: Record<string, string>
  onChange: (edits: Record<string, string>) => void
  /**
   * Sample a colour from anywhere on screen (ColorZilla), when the browser
   * offers an eyedropper; `null` when the person cancels.
   */
  onEyedrop?: () => Promise<string | null>
}

/** A `switch` with literal keys, so the locale coverage test can see them. */
function groupLabel(group: StyleGroup, message: (key: string) => string): string {
  switch (group) {
    case "layout":
      return message("styleGroupLayout")
    case "spacing":
      return message("styleGroupSpacing")
    case "type":
      return message("styleGroupType")
    case "appearance":
      return message("styleGroupAppearance")
  }
}

/**
 * Try values on a picked element (VisBug, UiToolbar).
 *
 * Each field starts at what the page computed and previews on the page as it
 * is typed; a field put back to that value, or emptied, is no longer an edit.
 * A value that could not be a CSS value is marked and never applied. Property
 * names are CSS's own, untranslated: they are what the agent will write.
 */
export function StyleEditor({
  api,
  idPrefix,
  computed,
  edits,
  onChange,
  onEyedrop,
}: StyleEditorProps) {
  const set = (property: string, value: string) => {
    const next = { ...edits }
    if (!value.trim() || value.trim() === (computed[property] ?? "")) delete next[property]
    else next[property] = value
    onChange(next)
  }
  return (
    <div className="space-y-2" data-testid={`style-editor-${idPrefix}`}>
      {STYLE_GROUPS.map((group) => (
        <fieldset key={group} className="space-y-1">
          <legend className="text-[11px] font-medium text-muted-foreground">
            {groupLabel(group, api.message)}
          </legend>
          <div className="grid grid-cols-[minmax(0,6.5rem)_1fr] items-center gap-x-2 gap-y-1">
            {EDITABLE_PROPERTIES.filter((entry) => entry.group === group).map((entry) => {
              const id = `${idPrefix}-${entry.property}`
              const value = edits[entry.property] ?? computed[entry.property] ?? ""
              const edited = edits[entry.property] !== undefined
              const invalid = edited && !isSafeStyleValue(value)
              const hex = entry.color ? colorToHex(value) : null
              return (
                <div key={entry.property} className="contents">
                  <Label
                    htmlFor={id}
                    className={`truncate font-mono text-[11px] ${edited ? "text-primary" : "text-muted-foreground"}`}
                  >
                    {entry.property}
                  </Label>
                  <div className="flex items-center gap-1">
                    {entry.color ? (
                      <input
                        type="color"
                        value={hex ?? "#000000"}
                        onChange={(event) => set(entry.property, event.target.value)}
                        aria-label={api.message("stylePickColor", [entry.property])}
                        className="h-6 w-6 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0"
                        data-testid={`style-color-${entry.property}`}
                      />
                    ) : null}
                    {entry.color && onEyedrop ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 shrink-0 p-0"
                        onClick={() =>
                          void onEyedrop().then((picked) => {
                            if (picked) set(entry.property, picked)
                          })
                        }
                        aria-label={api.message("styleEyedrop", [entry.property])}
                        data-testid={`style-eyedrop-${entry.property}`}
                      >
                        <PipetteIcon className="size-3.5" aria-hidden="true" />
                      </Button>
                    ) : null}
                    <Input
                      id={id}
                      value={value}
                      spellCheck={false}
                      aria-invalid={invalid || undefined}
                      onChange={(event) => set(entry.property, event.target.value)}
                      className="h-6 px-1.5 font-mono text-[11px]"
                      data-testid={`style-${entry.property}`}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </fieldset>
      ))}
      {Object.keys(edits).length > 0 ? (
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-[11px]"
          onClick={() => onChange({})}
          data-testid={`style-reset-${idPrefix}`}
        >
          {api.message("styleReset")}
        </Button>
      ) : null}
    </div>
  )
}
