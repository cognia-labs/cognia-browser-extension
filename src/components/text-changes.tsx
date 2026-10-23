import { Button } from "@cognia/plugin-ui"

import type { BrowserApi } from "@ext/src/lib/browser-api"
import type { TextChange } from "@ext/src/lib/inspect/text-edits"

/**
 * The words the person changed on the page (Design Mode), each as before and
 * after, for the agent to make in the source. Any one can be left out.
 */
export function TextChanges({
  api,
  changes,
  onRemove,
}: {
  api: BrowserApi
  changes: TextChange[]
  onRemove: (index: number) => void
}) {
  if (changes.length === 0) return null
  return (
    <div className="space-y-1.5" data-testid="text-changes">
      <p className="text-xs font-medium">
        {api.message("textChangesTitle", [String(changes.length)])}
      </p>
      <ol className="space-y-1">
        {changes.map((change, index) => (
          <li
            key={`${change.selector ?? change.label}-${index}`}
            className="animate-enter space-y-0.5 rounded-control border border-border p-1.5 motion-reduce:animate-none"
            data-testid={`text-change-${index}`}
          >
            <div className="flex items-center justify-between gap-1">
              <span className="truncate font-mono text-[10px] text-muted-foreground">
                {change.selector ?? `${change.label} · ${api.message("textChangeDeleted")}`}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-5 shrink-0 px-1.5 text-[10px]"
                onClick={() => onRemove(index)}
                aria-label={api.message("textChangeRemove", [String(index + 1)])}
                data-testid={`text-change-remove-${index}`}
              >
                {api.message("remove")}
              </Button>
            </div>
            {change.before ? (
              <p className="break-words text-[11px] text-muted-foreground line-through">
                {change.before}
              </p>
            ) : null}
            <p className="break-words text-[11px]">
              {change.after || (
                <span className="italic text-muted-foreground">
                  {api.message("textChangeRemoved")}
                </span>
              )}
            </p>
          </li>
        ))}
      </ol>
    </div>
  )
}
