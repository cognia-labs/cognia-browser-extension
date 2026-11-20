/**
 * Which part of the side panel is showing: one of its tabs, or its settings.
 *
 * Kept in `chrome.storage.session` so a panel closed and reopened in the same
 * browser session comes back where the person left it, and a new session
 * starts on Send, the panel's reason to exist.
 */
import { useCallback, useEffect, useRef, useState } from "react"

import { SESSION_KEYS, type BrowserApi } from "../browser-api"

export const PANEL_TABS = ["send", "inspect", "tools"] as const
export type PanelTab = (typeof PANEL_TABS)[number]
export type PanelView = PanelTab | "settings"

export const DEFAULT_PANEL_VIEW: PanelView = "send"

export function parsePanelView(value: unknown): PanelView {
  return value === "settings" || (PANEL_TABS as readonly unknown[]).includes(value)
    ? (value as PanelView)
    : DEFAULT_PANEL_VIEW
}

/** The view, and a chooser that shows it now and remembers it. */
export function usePanelView(
  api: Pick<BrowserApi, "readSession" | "writeSession">
): [PanelView, (next: PanelView) => void] {
  const [view, setView] = useState<PanelView>(DEFAULT_PANEL_VIEW)
  // A choice made before the stored view answers is newer than it.
  const chosenRef = useRef(false)
  useEffect(() => {
    let cancelled = false
    void api
      .readSession<unknown>(SESSION_KEYS.panelView)
      .then((stored) => {
        if (!cancelled && !chosenRef.current) setView(parsePanelView(stored))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [api])
  const choose = useCallback(
    (next: PanelView) => {
      chosenRef.current = true
      setView(next)
      void api.writeSession(SESSION_KEYS.panelView, next).catch(() => undefined)
    },
    [api]
  )
  return [view, choose]
}
