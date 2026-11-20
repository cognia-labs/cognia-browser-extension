import { useId, useRef, type KeyboardEvent, type ReactNode } from "react"
import { Button, cn } from "@cognia/plugin-ui"
import {
  CameraIcon,
  SendIcon,
  Settings2Icon,
  SparklesIcon,
  SquareMousePointerIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react"

import type { BrowserApi } from "@ext/src/lib/browser-api"
import { PANEL_TABS, type PanelTab, type PanelView } from "@ext/src/lib/panel/panel-view"
import type { PanelDensity } from "@ext/src/lib/preferences"

const TAB_ICONS: Record<PanelTab, LucideIcon> = {
  send: SendIcon,
  inspect: SquareMousePointerIcon,
  tools: WrenchIcon,
}

function tabLabel(api: BrowserApi, tab: PanelTab, local: boolean): string {
  switch (tab) {
    case "send":
      // Without a Host nothing is sent: the first tab captures, to copy or export.
      return local ? api.message("tabCapture") : api.message("tabSend")
    case "inspect":
      return api.message("tabInspect")
    case "tools":
      return api.message("tabTools")
  }
}

/** Something under way in a tab: a count of results, or just a dot. */
export type TabActivity = number | boolean

export interface PanelShellProps {
  api: BrowserApi
  view: PanelView
  onView: (next: PanelView) => void
  density: PanelDensity
  /** The connection pill at the right of the heading. */
  connection: ReactNode
  /** What is running on the page, shown under the tabs whichever is open. */
  status?: ReactNode
  activity?: Partial<Record<PanelTab, TabActivity>>
  /** Pinned under Send's content: the instruction and the ways out. */
  composer?: ReactNode
  /** No Host: the first tab is for capturing, not sending. */
  local?: boolean
  panels: Record<PanelView, ReactNode>
}

/**
 * The panel's frame for a tall, narrow side panel: the heading, tabs and
 * running activity stay put at the top, each view scrolls on its own, and the
 * composer stays reachable at the bottom of Send however long the capture is.
 *
 * Every view stays mounted while hidden, so a half-written mock rule or an
 * audit's results are still there when the person comes back to it.
 */
export function PanelShell({
  api,
  view,
  onView,
  density,
  connection,
  status,
  activity = {},
  composer,
  panels,
  local = false,
}: PanelShellProps) {
  const baseId = useId()
  const tabRefs = useRef<Partial<Record<PanelTab, HTMLButtonElement | null>>>({})
  const settingsOpen = view === "settings"

  // Arrow keys move between tabs, as in any tab list; Tab leaves the list.
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, tab: PanelTab) => {
    const at = PANEL_TABS.indexOf(tab)
    const next =
      event.key === "ArrowRight"
        ? PANEL_TABS[(at + 1) % PANEL_TABS.length]
        : event.key === "ArrowLeft"
          ? PANEL_TABS[(at - 1 + PANEL_TABS.length) % PANEL_TABS.length]
          : event.key === "Home"
            ? PANEL_TABS[0]
            : event.key === "End"
              ? PANEL_TABS[PANEL_TABS.length - 1]
              : null
    if (!next) return
    event.preventDefault()
    onView(next)
    tabRefs.current[next]?.focus()
  }

  return (
    <div
      className="flex h-screen flex-col bg-muted/40"
      data-panel-density={density}
      data-testid="panel-shell"
    >
      <div className="shrink-0 space-y-2 border-b border-border px-3 pt-2.5 pb-2 comfy:pt-3">
        <header className="flex items-center gap-2 px-0.5">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm comfy:size-8 comfy:rounded-xl">
            <SparklesIcon className="size-3.5 comfy:size-4" aria-hidden="true" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-sm leading-tight font-semibold">{api.message("panelBrand")}</span>
            <span className="hidden truncate text-[11px] text-muted-foreground comfy:block">
              {api.message("panelTagline")}
            </span>
          </span>
          {connection}
          <Button
            variant={settingsOpen ? "secondary" : "ghost"}
            size="icon"
            className="size-7 shrink-0"
            aria-label={api.message("settingsTitle")}
            title={api.message("settingsTitle")}
            aria-pressed={settingsOpen}
            onClick={() => onView(settingsOpen ? "send" : "settings")}
            data-testid="settings-toggle"
          >
            <Settings2Icon className="size-4" aria-hidden="true" />
          </Button>
        </header>
        <div
          role="tablist"
          aria-label={api.message("panelTabsLabel")}
          className="grid grid-cols-3 gap-0.5 rounded-lg bg-muted p-0.5"
        >
          {PANEL_TABS.map((tab) => {
            const Icon = local && tab === "send" ? CameraIcon : TAB_ICONS[tab]
            const selected = view === tab
            const running = activity[tab]
            return (
              <button
                key={tab}
                ref={(node) => {
                  tabRefs.current[tab] = node
                }}
                type="button"
                role="tab"
                id={`${baseId}-tab-${tab}`}
                aria-selected={selected}
                aria-controls={`${baseId}-panel-${tab}`}
                tabIndex={selected || (settingsOpen && tab === "send") ? 0 : -1}
                onClick={() => onView(tab)}
                onKeyDown={(event) => onTabKey(event, tab)}
                className={cn(
                  "relative flex h-7 min-w-0 items-center justify-center gap-1.5 rounded-md px-1.5 text-xs font-medium text-muted-foreground transition-colors comfy:h-8",
                  "hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
                  selected && "bg-card text-foreground shadow-sm"
                )}
                data-testid={`tab-${tab}`}
              >
                <Icon className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{tabLabel(api, tab, local)}</span>
                {typeof running === "number" && running > 0 ? (
                  <span
                    className="min-w-4 rounded-full bg-info px-1 text-[10px] leading-4 text-white tabular-nums"
                    data-testid={`tab-${tab}-count`}
                  >
                    {running}
                  </span>
                ) : running === true ? (
                  <span
                    className="size-1.5 shrink-0 rounded-full bg-info"
                    role="img"
                    aria-label={api.message("tabActive")}
                    data-testid={`tab-${tab}-active`}
                  />
                ) : null}
              </button>
            )
          })}
        </div>
        {status ? (
          <div className="space-y-1.5" data-testid="panel-status">
            {status}
          </div>
        ) : null}
      </div>
      {PANEL_TABS.map((tab) => (
        <div
          key={tab}
          role="tabpanel"
          id={`${baseId}-panel-${tab}`}
          aria-labelledby={`${baseId}-tab-${tab}`}
          hidden={view !== tab}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
          data-testid={`panel-${tab}`}
        >
          <div className="flex flex-col gap-2.5 p-3 comfy:gap-3">{panels[tab]}</div>
        </div>
      ))}
      <section
        aria-label={api.message("settingsTitle")}
        hidden={!settingsOpen}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        data-testid="panel-settings"
      >
        <div className="flex flex-col gap-2.5 p-3 comfy:gap-3">{panels.settings}</div>
      </section>
      {/* Hidden rather than unmounted off Send, like the views: inspect tools
          write the instruction from their own tabs. */}
      {composer ? (
        <div
          hidden={view !== "send"}
          className="max-h-[55vh] shrink-0 overflow-y-auto border-t border-border bg-card px-3 py-2 shadow-[0_-4px_12px_-8px_rgb(0_0_0/0.25)]"
          data-testid="composer"
        >
          {composer}
        </div>
      ) : null}
    </div>
  )
}
