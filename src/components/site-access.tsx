import { useEffect, useState } from "react"
import { Button } from "@cognia/plugin-ui"

import type { BrowserApi, PermissionRequest } from "@ext/src/lib/browser-api"
import { usePreferences } from "@ext/src/lib/panel/use-stored-value"

const ALL_SITES: PermissionRequest = { origins: ["<all_urls>"] }

/** Persistent website access is separate from pairing and agent control. */
export function SiteAccess({ api, onGranted }: { api: BrowserApi; onGranted: () => void }) {
  const [preferences, updatePreferences] = usePreferences(api)
  const [granted, setGranted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let revision = 0
    const refresh = () => {
      const requested = ++revision
      void api
        .hasPermissions(ALL_SITES)
        .then((allowed) => {
          if (!cancelled && requested === revision) setGranted(allowed)
        })
        .catch(() => undefined)
    }
    const stop = api.onPermissionsChange(refresh)
    refresh()
    window.addEventListener("focus", refresh)
    document.addEventListener("visibilitychange", refresh)
    return () => {
      cancelled = true
      stop()
      window.removeEventListener("focus", refresh)
      document.removeEventListener("visibilitychange", refresh)
    }
  }, [api, preferences.agentMode, preferences.allSitesAccess])

  const allowAll = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      // Request before any storage read, while the button's gesture is active.
      const allowed = await api.requestPermissions(ALL_SITES)
      setGranted(allowed)
      if (!allowed) {
        setError(api.message("siteAccessDenied"))
        return
      }
      await updatePreferences({ allSitesAccess: true })
      onGranted()
    } catch {
      setError(api.message("siteAccessFailed"))
    } finally {
      setBusy(false)
    }
  }

  const manage = () => {
    const id = new URL(api.extensionOrigin()).host
    void api.openUrl(`chrome://extensions/?id=${id}`).catch(() => {
      setError(api.message("siteAccessFailed"))
    })
  }

  const hint = granted ? api.message("siteAccessGrantedHint") : api.message("siteAccessHint")
  return (
    <div className="min-w-0 space-y-1 border-t border-border pt-2" data-testid="site-access">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <p className="min-w-0 truncate text-[11px] text-muted-foreground" role="status">
          {granted ? api.message("siteAccessAllAllowed") : api.message("siteAccessTitle")}
        </p>
        <Button
          variant="outline"
          size="sm"
          className="h-7 shrink-0 px-2 text-[11px]"
          disabled={busy}
          onClick={granted ? manage : () => void allowAll()}
        >
          {busy
            ? api.message("siteAccessWorking")
            : granted
              ? api.message("siteAccessManage")
              : api.message("siteAccessAllowAll")}
        </Button>
      </div>
      <p className="truncate text-[11px] text-muted-foreground" title={hint}>
        {hint}
      </p>
      {error ? (
        <p role="alert" className="text-[11px] text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}
