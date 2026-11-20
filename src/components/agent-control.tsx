import { useState } from "react"
import { Badge, Button } from "@cognia/plugin-ui"

import {
  AGENT_SESSIONS_KEY,
  parseStoredSessions,
  type AgentSession,
} from "@ext/src/lib/agent/sessions"
import type { BrowserApi } from "@ext/src/lib/browser-api"
import { useStoredValue } from "@ext/src/lib/panel/use-stored-value"

function hostOf(origin: string): string {
  try {
    return new URL(origin).host
  } catch {
    return origin
  }
}

/**
 * Who is driving this browser, from the side panel (report item 06).
 *
 * The in-page bar shows a conversation's state on its own tabs only. Here each
 * conversation holding tabs is listed in one place: whether it is acting or
 * paused, how many tabs it holds, the sites it was allowed for itself only,
 * and what Cognia answered the last Stop — with a way to ask again when it did
 * not confirm. Standing decisions are browser-wide, kept in Settings.
 *
 * Read from the worker's own session record; the panel writes nothing to it.
 */
export function AgentControl({
  api,
  conversationTitles = {},
  onManage,
}: {
  api: BrowserApi
  conversationTitles?: Record<string, string>
  /** Open where standing site decisions and agent permissions are managed. */
  onManage: () => void
}) {
  const sessions = useStoredValue(api, "session", AGENT_SESSIONS_KEY, parseStoredSessions)
  const [retrying, setRetrying] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const held = Object.values(sessions)
    .filter((session) => (session.tabIds?.length ?? 0) > 0 || session.takeover)
    .sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0))
  if (held.length === 0) return null

  const retry = async (id: string) => {
    setRetrying(id)
    setError(null)
    try {
      await api.retryHostStop(id)
    } catch {
      setError(api.message("agentControlRetryFailed"))
    } finally {
      setRetrying(null)
    }
  }

  const showTab = (session: AgentSession) => {
    const tabId = session.activeTabId ?? session.tabIds?.[0]
    if (tabId !== undefined && tabId !== null) void api.activateTab(tabId).catch(() => undefined)
  }

  return (
    <section
      className="space-y-1.5 rounded-panel border border-border bg-card px-2.5 py-2"
      aria-label={api.message("agentControlTitle")}
      data-testid="agent-control"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium">{api.message("agentControlTitle")}</p>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-[11px]"
          onClick={onManage}
          data-testid="agent-control-manage"
        >
          {api.message("agentControlManage")}
        </Button>
      </div>
      <ul className="space-y-1.5">
        {held.map((session) => {
          const tabs = session.tabIds?.length ?? 0
          const once = (session.onceOrigins ?? []).map(hostOf)
          const stop = session.hostStop
          return (
            <li
              key={session.id}
              className="space-y-0.5 text-[11px]"
              data-testid={`agent-control-${session.id}`}
            >
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate" title={session.id}>
                  {conversationTitles[session.id] ??
                    api.message("agentControlConversation", [session.id.slice(0, 8)])}
                </span>
                <Badge variant={session.takeover ? "warning" : "secondary"} className="shrink-0">
                  {session.takeover
                    ? api.message("agentControlPaused")
                    : api.message("agentControlActing")}
                </Badge>
                {tabs > 0 ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 shrink-0 px-1.5 text-[11px]"
                    onClick={() => showTab(session)}
                    title={api.message("agentControlShowTab")}
                    data-testid={`agent-control-show-${session.id}`}
                  >
                    {api.message("agentConversationTabs", [String(tabs)])}
                  </Button>
                ) : null}
              </div>
              {once.length > 0 ? (
                <p
                  className="truncate text-[10px] text-muted-foreground"
                  title={once.join(", ")}
                  data-testid={`agent-control-once-${session.id}`}
                >
                  {api.message("agentControlOnceSites", [once.join(", ")])}
                </p>
              ) : null}
              {stop?.outcome === "failed" && session.takeover ? (
                <div
                  className="flex flex-wrap items-center gap-1.5 text-[10px] text-warning"
                  role="status"
                  data-testid={`agent-control-unconfirmed-${session.id}`}
                >
                  <span className="min-w-0 flex-1">
                    {api.message("agentControlStopUnconfirmed")}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[11px]"
                    disabled={retrying === session.id}
                    onClick={() => void retry(session.id)}
                    data-testid={`agent-control-retry-${session.id}`}
                  >
                    {retrying === session.id
                      ? api.message("agentControlRetrying")
                      : api.message("agentControlRetryStop")}
                  </Button>
                </div>
              ) : stop && session.takeover ? (
                <p className="text-[10px] text-muted-foreground">
                  {stop.outcome === "cancelled"
                    ? api.message("agentControlStopConfirmed")
                    : api.message("agentControlStopNone")}
                </p>
              ) : null}
            </li>
          )
        })}
      </ul>
      {error ? (
        <p role="alert" className="text-[11px] text-destructive" data-testid="agent-control-error">
          {error}
        </p>
      ) : null}
    </section>
  )
}
