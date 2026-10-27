import { useCallback, useEffect, useRef, useState } from "react"
import {
  Badge,
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
  cn,
} from "@cognia/plugin-ui"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronRightIcon,
  PauseIcon,
  PlayIcon,
  XIcon,
} from "lucide-react"

import type { BrowserApi } from "@ext/src/lib/browser-api"
import { ToolSection } from "@ext/src/components/panel-section"
import { MAX_MOCK_BODY, MAX_MOCK_DELAY_MS, matchIsValid } from "@ext/src/lib/inspect/request-mocks"
import {
  AGENT_NETWORK_RULES_KEY,
  DNR_PERMISSION,
  MAX_RULES_PER_GROUP,
  NETWORK_RULES_KEY,
  RULE_ACTIONS,
  RULE_METHODS,
  cleanRule,
  cleanSite,
  coverageOf,
  exportLibrary,
  importLibrary,
  parseAgentRuleSets,
  parseLibrary,
  type AgentRuleSets,
  type NetworkRule,
  type RuleAction,
  type RuleGroup,
  type RuleLibrary,
} from "@ext/src/lib/network-rules/rules"
import type { RuleCommand, RuleCommandError } from "@ext/src/lib/network-rules/store"
import { RULE_SYNC_STATUS_KEY, type RuleSyncStatus } from "@ext/src/lib/network-rules/sync"

type Message = (key: string, substitutions?: string[]) => string

/** A `switch` with literal keys, so the locale coverage test can see them. */
export function ruleActionLabel(action: RuleAction, message: Message): string {
  switch (action) {
    case "fail":
      return message("rulesActionFail")
    case "respond":
      return message("rulesActionRespond")
    case "modify":
      return message("rulesActionModify")
    case "delay":
      return message("rulesActionDelay")
    case "redirect":
      return message("rulesActionRedirect")
    case "request_headers":
      return message("rulesActionRequestHeaders")
    case "response_headers":
      return message("rulesActionResponseHeaders")
  }
}

function errorText(error: RuleCommandError | "import_invalid" | "import_empty", message: Message) {
  switch (error) {
    case "invalid_rule":
      return message("rulesErrorRule")
    case "invalid_sites":
      return message("rulesErrorSites")
    case "unknown_group":
    case "unknown_rule":
      return message("rulesErrorGone")
    case "too_many_groups":
      return message("rulesErrorGroups")
    case "too_many_rules":
      return message("rulesErrorRules")
    case "import_invalid":
      return message("rulesImportInvalid")
    case "import_empty":
      return message("rulesImportEmpty")
  }
}

/** What a rule does, in the panel's language. */
export function ruleDescription(rule: NetworkRule, message: Message): string {
  const names = (headers: string[]) => headers.join(", ")
  switch (rule.action) {
    case "fail":
      return message("rulesDoFail")
    case "respond":
      return message("rulesDoRespond", [String(rule.status)])
    case "modify":
      return rule.status
        ? message("rulesDoModifyStatus", [String(rule.status)])
        : message("rulesDoModify")
    case "delay":
      return message("rulesDoDelay", [String(rule.delayMs)])
    case "redirect":
      return message("rulesDoRedirect", [rule.redirectTo])
    case "request_headers":
    case "response_headers": {
      const parts = [
        Object.keys(rule.headers).length
          ? message("rulesDoSetHeaders", [names(Object.keys(rule.headers))])
          : "",
        rule.removeHeaders.length
          ? message("rulesDoRemoveHeaders", [names(rule.removeHeaders)])
          : "",
      ].filter(Boolean)
      return `${ruleActionLabel(rule.action, message)}: ${parts.join(" · ")}`
    }
  }
}

interface Form {
  match: string
  method: string
  action: RuleAction
  status: string
  body: string
  headers: string
  removeHeaders: string
  redirectTo: string
  delay: string
  times: string
}

const ANY = "any"
const EMPTY_FORM: Form = {
  match: "",
  method: ANY,
  action: "fail",
  status: "500",
  body: "",
  headers: "",
  removeHeaders: "",
  redirectTo: "",
  delay: "0",
  times: "0",
}

/** `Name: value` a line, as people paste them from DevTools. */
export function parseHeaderLines(text: string): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const line of text.split("\n")) {
    const at = line.indexOf(":")
    if (at <= 0) continue
    headers[line.slice(0, at).trim()] = line.slice(at + 1).trim()
  }
  return headers
}

function draftOf(form: Form): NetworkRule | null {
  return cleanRule(
    {
      match: form.match,
      method: form.method === ANY ? "" : form.method,
      action: form.action,
      status: Number(form.status),
      body: form.body,
      headers: parseHeaderLines(form.headers),
      removeHeaders: form.removeHeaders.split(","),
      redirectTo: form.redirectTo,
      delayMs: Number(form.delay),
      times: Number(form.times),
    },
    "draft"
  )
}

function RuleForm({
  message,
  busy,
  full,
  onAdd,
}: {
  message: Message
  busy: boolean
  full: boolean
  onAdd: (rule: NetworkRule) => void
}) {
  const [form, setForm] = useState<Form>(EMPTY_FORM)
  const set = (patch: Partial<Form>) => setForm((current) => ({ ...current, ...patch }))
  const draft = draftOf(form)
  const badMatch = form.match.trim() !== "" && !matchIsValid(form.match)
  const answers = form.action === "respond" || form.action === "modify"
  const rewrites = form.action === "request_headers" || form.action === "response_headers"
  return (
    <div
      className="space-y-1.5 rounded-lg border border-border bg-muted/30 p-2"
      data-testid="rules-form"
    >
      <div className="space-y-1">
        <Label htmlFor="cognia-rules-match" className="text-[11px] text-muted-foreground">
          {message("rulesMatch")}
        </Label>
        <Input
          id="cognia-rules-match"
          value={form.match}
          maxLength={500}
          placeholder="/api/orders*"
          onChange={(event) => set({ match: event.target.value })}
          className={cn("h-7 font-mono text-xs", badMatch && "border-destructive")}
          aria-invalid={badMatch}
          data-testid="rules-match"
        />
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <div className="space-y-1">
          <Label htmlFor="cognia-rules-method" className="text-[11px] text-muted-foreground">
            {message("rulesMethod")}
          </Label>
          <Select value={form.method} onValueChange={(method) => set({ method })}>
            <SelectTrigger
              id="cognia-rules-method"
              className="h-7 w-full bg-card px-1.5 text-[11px]"
              data-testid="rules-method"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RULE_METHODS.map((value) => (
                <SelectItem key={value || ANY} value={value || ANY}>
                  {value || message("rulesMethodAny")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="cognia-rules-action" className="text-[11px] text-muted-foreground">
            {message("rulesAction")}
          </Label>
          <Select
            value={form.action}
            onValueChange={(next) =>
              set({
                action: next as RuleAction,
                delay: next === "delay" ? "2000" : "0",
                status: next === "modify" ? "" : form.status || "500",
              })
            }
          >
            <SelectTrigger
              id="cognia-rules-action"
              className="h-7 w-full bg-card px-1.5 text-[11px]"
              data-testid="rules-action"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RULE_ACTIONS.map((value) => (
                <SelectItem key={value} value={value}>
                  {ruleActionLabel(value, message)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {answers ? (
        <>
          <div className="space-y-1">
            <Label htmlFor="cognia-rules-status" className="text-[11px] text-muted-foreground">
              {form.action === "modify" ? message("rulesStatusKeep") : message("rulesStatus")}
            </Label>
            <Input
              id="cognia-rules-status"
              type="number"
              min={100}
              max={599}
              value={form.status}
              onChange={(event) => set({ status: event.target.value })}
              className="h-7 bg-card text-xs"
              data-testid="rules-status"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cognia-rules-body" className="text-[11px] text-muted-foreground">
              {form.action === "modify" ? message("rulesBodyMerge") : message("rulesBody")}
            </Label>
            <Textarea
              id="cognia-rules-body"
              rows={3}
              value={form.body}
              maxLength={MAX_MOCK_BODY}
              onChange={(event) => set({ body: event.target.value })}
              className="max-h-40 overflow-y-auto bg-card font-mono text-[11px]"
              data-testid="rules-body"
            />
          </div>
        </>
      ) : null}
      {answers || rewrites ? (
        <div className="space-y-1">
          <Label htmlFor="cognia-rules-headers" className="text-[11px] text-muted-foreground">
            {rewrites ? message("rulesSetHeaders") : message("rulesHeaders")}
          </Label>
          <Textarea
            id="cognia-rules-headers"
            rows={2}
            value={form.headers}
            placeholder={"x-env: staging\ncache-control: no-store"}
            onChange={(event) => set({ headers: event.target.value })}
            className="bg-card font-mono text-[11px]"
            data-testid="rules-headers"
          />
        </div>
      ) : null}
      {rewrites ? (
        <div className="space-y-1">
          <Label htmlFor="cognia-rules-remove" className="text-[11px] text-muted-foreground">
            {message("rulesRemoveHeaders")}
          </Label>
          <Input
            id="cognia-rules-remove"
            value={form.removeHeaders}
            placeholder="cookie, x-debug"
            onChange={(event) => set({ removeHeaders: event.target.value })}
            className="h-7 bg-card font-mono text-xs"
            data-testid="rules-remove-headers"
          />
        </div>
      ) : null}
      {form.action === "redirect" ? (
        <div className="space-y-1">
          <Label htmlFor="cognia-rules-target" className="text-[11px] text-muted-foreground">
            {message("rulesRedirectTo")}
          </Label>
          <Input
            id="cognia-rules-target"
            value={form.redirectTo}
            placeholder="http://localhost:3000/api/orders"
            onChange={(event) => set({ redirectTo: event.target.value })}
            className="h-7 bg-card font-mono text-xs"
            data-testid="rules-redirect"
          />
        </div>
      ) : null}
      {rewrites ? null : (
        <div className="grid grid-cols-2 gap-1.5">
          <div className="space-y-1">
            <Label htmlFor="cognia-rules-delay" className="text-[11px] text-muted-foreground">
              {message("rulesDelay")}
            </Label>
            <Input
              id="cognia-rules-delay"
              type="number"
              min={0}
              max={MAX_MOCK_DELAY_MS}
              step={100}
              value={form.delay}
              onChange={(event) => set({ delay: event.target.value })}
              className="h-7 bg-card text-xs"
              data-testid="rules-delay"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cognia-rules-times" className="text-[11px] text-muted-foreground">
              {message("rulesTimes")}
            </Label>
            <Input
              id="cognia-rules-times"
              type="number"
              min={0}
              max={1000}
              value={form.times}
              onChange={(event) => set({ times: event.target.value })}
              className="h-7 bg-card text-xs"
              data-testid="rules-times"
            />
          </div>
        </div>
      )}
      {draft ? (
        <p className="text-[10px] text-muted-foreground" data-testid="rules-coverage">
          {coverageOf(draft) === "all-requests"
            ? message("rulesCoverageAll")
            : message("rulesCoveragePage")}
        </p>
      ) : null}
      <Button
        size="sm"
        className="h-7 w-full text-[11px]"
        disabled={busy || full || draft === null}
        onClick={() => {
          if (!draft) return
          onAdd(draft)
          set({ match: "" })
        }}
        data-testid="rules-add"
      >
        {full ? message("rulesFull") : message("rulesAdd")}
      </Button>
    </div>
  )
}

function RuleRow({
  rule,
  index,
  last,
  message,
  busy,
  onToggle,
  onMove,
  onRemove,
}: {
  rule: NetworkRule
  index: number
  last: boolean
  message: Message
  busy: boolean
  onToggle?: (enabled: boolean) => void
  onMove?: (by: -1 | 1) => void
  onRemove: () => void
}) {
  return (
    <li
      className={cn(
        "flex items-start gap-1 rounded-lg border border-border bg-card p-1.5",
        !rule.enabled && "opacity-60"
      )}
      data-testid="rules-rule"
    >
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="font-mono text-[10px] break-all">
          <span className="rounded bg-muted px-1 font-semibold">
            {rule.method || message("rulesMethodAny")}
          </span>{" "}
          {rule.match}
        </p>
        <p className="text-[11px]">
          {ruleDescription(rule, message)}
          {rule.delayMs > 0 && rule.action !== "delay"
            ? ` · ${message("rulesAfter", [String(rule.delayMs)])}`
            : ""}
          {rule.times > 0 ? ` · ${message("rulesFirstTimes", [String(rule.times)])}` : ""}
        </p>
      </div>
      <Badge variant="outline" className="shrink-0 text-[9px]">
        {coverageOf(rule) === "all-requests" ? message("rulesBadgeAll") : message("rulesBadgePage")}
      </Badge>
      {onMove ? (
        <>
          <Button
            size="icon-xs"
            variant="ghost"
            className="shrink-0 text-muted-foreground"
            disabled={busy || index === 0}
            onClick={() => onMove(-1)}
            aria-label={message("rulesMoveUp")}
          >
            <ArrowUpIcon aria-hidden="true" />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            className="shrink-0 text-muted-foreground"
            disabled={busy || last}
            onClick={() => onMove(1)}
            aria-label={message("rulesMoveDown")}
          >
            <ArrowDownIcon aria-hidden="true" />
          </Button>
        </>
      ) : null}
      {onToggle ? (
        <Button
          size="icon-xs"
          variant="ghost"
          className="shrink-0 text-muted-foreground"
          disabled={busy}
          onClick={() => onToggle(!rule.enabled)}
          aria-label={rule.enabled ? message("rulesPause") : message("rulesResume")}
        >
          {rule.enabled ? <PauseIcon aria-hidden="true" /> : <PlayIcon aria-hidden="true" />}
        </Button>
      ) : null}
      <Button
        size="icon-xs"
        variant="ghost"
        className="shrink-0 text-muted-foreground hover:text-destructive"
        disabled={busy}
        onClick={onRemove}
        aria-label={message("rulesRemove")}
      >
        <XIcon aria-hidden="true" />
      </Button>
    </li>
  )
}

function GroupCard({
  group,
  message,
  busy,
  run,
}: {
  group: RuleGroup
  message: Message
  busy: boolean
  run: (command: RuleCommand) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <li
      className="space-y-1.5 rounded-lg border border-border p-1.5"
      data-testid={`rules-group-${group.id}`}
    >
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1 text-left"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          data-testid="rules-group-toggle"
        >
          <ChevronRightIcon
            className={cn("size-3 shrink-0 transition-transform", open && "rotate-90")}
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[11px] font-medium">{group.name}</span>
            <span className="block truncate font-mono text-[10px] text-muted-foreground">
              {group.sites
                .map((site) => (site === "*" ? message("rulesEverySite") : site))
                .join(", ")}
              {" · "}
              {message("rulesCount", [String(group.rules.length)])}
            </span>
          </span>
        </button>
        <Switch
          checked={group.enabled}
          disabled={busy}
          onCheckedChange={(enabled) => run({ op: "update-group", groupId: group.id, enabled })}
          aria-label={message("rulesGroupEnabled")}
          data-testid="rules-group-enabled"
        />
        <Button
          size="icon-xs"
          variant="ghost"
          className="shrink-0 text-muted-foreground hover:text-destructive"
          disabled={busy}
          onClick={() => run({ op: "remove-group", groupId: group.id })}
          aria-label={message("rulesRemoveGroup")}
          data-testid="rules-group-remove"
        >
          <XIcon aria-hidden="true" />
        </Button>
      </div>
      {open ? (
        <div className="space-y-1.5">
          {group.rules.length > 0 ? (
            <ol className="space-y-1">
              {group.rules.map((rule, index) => (
                <RuleRow
                  key={rule.id}
                  rule={rule}
                  index={index}
                  last={index === group.rules.length - 1}
                  message={message}
                  busy={busy}
                  onToggle={(enabled) =>
                    run({ op: "toggle-rule", groupId: group.id, ruleId: rule.id, enabled })
                  }
                  onMove={(by) => run({ op: "move-rule", groupId: group.id, ruleId: rule.id, by })}
                  onRemove={() => run({ op: "remove-rule", groupId: group.id, ruleId: rule.id })}
                />
              ))}
            </ol>
          ) : null}
          <RuleForm
            message={message}
            busy={busy}
            full={group.rules.length >= MAX_RULES_PER_GROUP}
            onAdd={(rule) => run({ op: "add-rule", groupId: group.id, rule })}
          />
        </div>
      ) : null}
    </li>
  )
}

/**
 * The person's saved request rules, by site, and the ones an agent set in
 * its own tabs (ADR-0242). They apply to every page of a site, and to pages
 * loaded after a change; the worker stores and applies them.
 */
export function NetworkRules({
  api,
  currentHost,
  now = () => Date.now(),
}: {
  api: BrowserApi
  /** The tab the panel is looking at, to offer its site for a new group. */
  currentHost: string | null
  now?: () => number
}) {
  const message = api.message
  const [library, setLibrary] = useState<RuleLibrary>({ v: 1, groups: [] })
  const [agent, setAgent] = useState<AgentRuleSets>({})
  const [status, setStatus] = useState<RuleSyncStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [sites, setSites] = useState("")
  const file = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let live = true
    void api.read(NETWORK_RULES_KEY).then((value) => live && setLibrary(parseLibrary(value)))
    void api
      .readSession(AGENT_NETWORK_RULES_KEY)
      .then((value) => live && setAgent(parseAgentRuleSets(value)))
    void api
      .readSession<RuleSyncStatus>(RULE_SYNC_STATUS_KEY)
      .then((value) => live && setStatus(value))
    const stops = [
      api.onStorageChange(NETWORK_RULES_KEY, (value) => setLibrary(parseLibrary(value))),
      api.onSessionChange(AGENT_NETWORK_RULES_KEY, (value) => setAgent(parseAgentRuleSets(value))),
      api.onSessionChange(RULE_SYNC_STATUS_KEY, (value) =>
        setStatus((value as RuleSyncStatus | null) ?? null)
      ),
    ]
    return () => {
      live = false
      for (const stop of stops) stop()
    }
  }, [api])

  const run = useCallback(
    (command: RuleCommand) => {
      setBusy(true)
      setNotice(null)
      void api
        .networkRuleCommand(command)
        .then(
          (result) => {
            if (!result.ok) setNotice(errorText(result.error, message))
          },
          () => setNotice(message("rulesErrorWorker"))
        )
        .finally(() => setBusy(false))
    },
    [api, message]
  )

  const exportFile = () => {
    const blob = new Blob([exportLibrary(library, now())], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = "cognia-request-rules.json"
    link.click()
    URL.revokeObjectURL(url)
  }

  const importFile = async (chosen: File | undefined) => {
    if (!chosen) return
    const outcome = importLibrary(await chosen.text(), () => crypto.randomUUID())
    if (!outcome.ok) {
      setNotice(
        errorText(outcome.reason === "invalid" ? "import_invalid" : "import_empty", message)
      )
      return
    }
    run({ op: "import", groups: outcome.groups })
    if (outcome.skipped > 0) setNotice(message("rulesImportSkipped", [String(outcome.skipped)]))
  }

  const agentRules = Object.entries(agent)
  const total = library.groups.reduce((sum, group) => sum + group.rules.length, 0)
  const siteList = sites
    .split(",")
    .map((site) => cleanSite(site))
    .filter((site): site is string => site !== null)

  return (
    <ToolSection
      testId="network-rules"
      title={message("rulesTitle")}
      hint={message("rulesHint")}
      active={agentRules.length > 0}
    >
      {status?.needsDnr ? (
        <div className="space-y-1 rounded-lg bg-muted/50 p-2" data-testid="rules-needs-dnr">
          <p className="text-[11px]">{message("rulesNeedsDnr")}</p>
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-[11px]"
            onClick={() => void api.requestPermissions({ permissions: [DNR_PERMISSION] })}
            data-testid="rules-grant-dnr"
          >
            {message("rulesGrantDnr")}
          </Button>
        </div>
      ) : null}
      {status && status.missingOrigins.length > 0 ? (
        <div className="space-y-1 rounded-lg bg-muted/50 p-2" data-testid="rules-needs-sites">
          <p className="text-[11px]">{message("rulesNeedsSites")}</p>
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-[11px]"
            onClick={() => void api.requestPermissions({ origins: status.missingOrigins })}
            data-testid="rules-grant-sites"
          >
            {message("rulesGrantSites")}
          </Button>
        </div>
      ) : null}
      {status && status.unsupported.length > 0 ? (
        <p className="text-[11px] text-warning" data-testid="rules-unsupported">
          {message("rulesUnsupported", [String(status.unsupported.length)])}
        </p>
      ) : null}

      {agentRules.length > 0 ? (
        <div className="space-y-1" data-testid="rules-agent">
          <p className="text-[11px] font-medium">{message("rulesAgentTitle")}</p>
          <p className="text-[10px] text-muted-foreground">{message("rulesAgentHint")}</p>
          <ol className="space-y-1">
            {agentRules.flatMap(([sessionId, rules]) =>
              rules.map((rule, index) => (
                <RuleRow
                  key={rule.id}
                  rule={rule}
                  index={index}
                  last
                  message={message}
                  busy={busy}
                  onRemove={() => run({ op: "remove-agent-rule", sessionId, ruleId: rule.id })}
                />
              ))
            )}
          </ol>
        </div>
      ) : null}

      {library.groups.length > 0 ? (
        <ul className="space-y-1.5" data-testid="rules-groups">
          {library.groups.map((group) => (
            <GroupCard key={group.id} group={group} message={message} busy={busy} run={run} />
          ))}
        </ul>
      ) : (
        <p className="text-[11px] text-muted-foreground" data-testid="rules-empty">
          {message("rulesEmpty")}
        </p>
      )}

      <div className="space-y-1.5 rounded-lg border border-dashed border-border p-2">
        <div className="grid grid-cols-2 gap-1.5">
          <div className="space-y-1">
            <Label htmlFor="cognia-rules-group-name" className="text-[11px] text-muted-foreground">
              {message("rulesGroupName")}
            </Label>
            <Input
              id="cognia-rules-group-name"
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
              className="h-7 bg-card text-xs"
              data-testid="rules-group-name"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cognia-rules-group-sites" className="text-[11px] text-muted-foreground">
              {message("rulesGroupSites")}
            </Label>
            <Input
              id="cognia-rules-group-sites"
              value={sites}
              placeholder={currentHost ?? "example.com"}
              onChange={(event) => setSites(event.target.value)}
              className="h-7 bg-card font-mono text-xs"
              data-testid="rules-group-sites"
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          <Button
            size="sm"
            className="h-6 text-[11px]"
            disabled={busy || siteList.length === 0}
            onClick={() => {
              run({ op: "add-group", name, sites: siteList })
              setName("")
              setSites("")
            }}
            data-testid="rules-group-add"
          >
            {message("rulesAddGroup")}
          </Button>
          {currentHost && sites.trim() === "" ? (
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-[11px]"
              onClick={() => setSites(currentHost)}
              data-testid="rules-group-this-site"
            >
              {message("rulesThisSite")}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-[11px]"
          disabled={total === 0 && library.groups.length === 0}
          onClick={exportFile}
          data-testid="rules-export"
        >
          {message("rulesExport")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-[11px]"
          disabled={busy}
          onClick={() => file.current?.click()}
          data-testid="rules-import"
        >
          {message("rulesImport")}
        </Button>
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => {
            void importFile(event.target.files?.[0])
            event.target.value = ""
          }}
          data-testid="rules-import-file"
        />
      </div>
      <p className="text-[10px] text-muted-foreground">{message("rulesReloadHint")}</p>
      {notice ? (
        <p className="text-[11px] text-warning" role="status" data-testid="rules-notice">
          {notice}
        </p>
      ) : null}
    </ToolSection>
  )
}
