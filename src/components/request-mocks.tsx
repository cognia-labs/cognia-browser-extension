import { useEffect, useState } from "react"
import {
  Badge,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
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
import { ChevronRightIcon, PauseIcon, PlayIcon, XIcon } from "lucide-react"

import type { BrowserApi } from "@ext/src/lib/browser-api"
import {
  cleanMock,
  matchIsValid,
  MAX_MOCK_BODY,
  MAX_MOCK_DELAY_MS,
  MAX_MOCKS,
  MOCK_ACTIONS,
  MOCK_METHODS,
  type MockAction,
  type MockHits,
  type RequestMock,
} from "@ext/src/lib/inspect/request-mocks"

/** A `switch` with literal keys, so the locale coverage test can see them. */
export function mockActionLabel(action: MockAction, message: (key: string) => string): string {
  switch (action) {
    case "fail":
      return message("mockActionFail")
    case "respond":
      return message("mockActionRespond")
    case "modify":
      return message("mockActionModify")
    case "delay":
      return message("mockActionDelay")
    case "redirect":
      return message("mockActionRedirect")
  }
}

/** What a rule does, in the panel's language. */
function ruleText(rule: RequestMock, message: (key: string, subs?: string[]) => string): string {
  switch (rule.action) {
    case "fail":
      return rule.delayMs > 0
        ? message("mockRuleFailAfter", [String(rule.delayMs)])
        : message("mockRuleFail")
    case "respond":
      return message("mockRuleRespond", [String(rule.status)])
    case "modify":
      return rule.status
        ? message("mockRuleModifyStatus", [String(rule.status)])
        : message("mockRuleModify")
    case "delay":
      return message("mockRuleDelay", [String(rule.delayMs)])
    case "redirect":
      return message("mockRuleRedirect", [rule.target])
  }
}

/** The common cases, one click to fill the form (Requestly's templates). */
const PRESETS = ["offline", "slow", "error", "empty", "unauthorized", "flaky"] as const
type Preset = (typeof PRESETS)[number]

function presetLabel(preset: Preset, message: (key: string) => string): string {
  switch (preset) {
    case "offline":
      return message("mockPresetOffline")
    case "slow":
      return message("mockPresetSlow")
    case "error":
      return message("mockPresetError")
    case "empty":
      return message("mockPresetEmpty")
    case "unauthorized":
      return message("mockPresetUnauthorized")
    case "flaky":
      return message("mockPresetFlaky")
  }
}

const PRESET_FORMS: Record<Preset, Partial<Form>> = {
  offline: { action: "fail", delay: "0", chance: "100" },
  slow: { action: "delay", delay: "3000", chance: "100" },
  error: {
    action: "respond",
    status: "500",
    body: '{"error":"Internal Server Error"}',
    delay: "0",
    chance: "100",
  },
  empty: { action: "respond", status: "200", body: "[]", delay: "0", chance: "100" },
  unauthorized: {
    action: "respond",
    status: "401",
    body: '{"error":"Unauthorized"}',
    delay: "0",
    chance: "100",
  },
  flaky: { action: "fail", delay: "0", chance: "50" },
}

interface Form {
  match: string
  method: string
  action: MockAction
  status: string
  body: string
  headers: string
  target: string
  delay: string
  times: string
  chance: string
}

const ANY = "any"

const EMPTY_FORM: Form = {
  match: "",
  method: ANY,
  action: "fail",
  status: "500",
  body: "",
  headers: "",
  target: "",
  delay: "0",
  times: "0",
  chance: "100",
}

function timeOf(at: number): string {
  const date = new Date(at)
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((part) => String(part).padStart(2, "0"))
    .join(":")
}

function pathOf(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.pathname}${parsed.search}`
  } catch {
    return url
  }
}

/**
 * Rules that make the page's own requests fail, answer, change, wait or go
 * elsewhere (Requestly), to see how it copes — kept until the page reloads,
 * or across reloads when the person asks, and named in what is sent so the
 * agent knows which failures were staged. What they caught is listed as it
 * happens.
 */
export function RequestMocks({
  api,
  rules,
  hits,
  busy,
  canKeep,
  onAdd,
  onRemove,
  onToggle,
  onClear,
  onRefresh,
  onPoll,
  onKeep,
}: {
  api: BrowserApi
  rules: RequestMock[]
  hits: MockHits | null
  busy: boolean
  /** Whether the page can keep rules across reloads: a web page. */
  canKeep: boolean
  onAdd: (rule: RequestMock) => void
  onRemove: (id: string) => void
  onToggle: (id: string, enabled: boolean) => void
  onClear: () => void
  onRefresh: () => void
  /** Read the counts and log again, without holding up the controls. */
  onPoll: () => void
  onKeep: (keep: boolean) => void
}) {
  const [form, setForm] = useState<Form>(EMPTY_FORM)
  const [more, setMore] = useState(false)
  const [showLog, setShowLog] = useState(false)
  const set = (patch: Partial<Form>) => setForm((current) => ({ ...current, ...patch }))
  const draft = cleanMock({
    id: "",
    match: form.match,
    method: form.method === ANY ? "" : form.method,
    action: form.action,
    status: Number(form.status),
    body: form.body,
    headers: form.headers,
    target: form.target,
    delayMs: Number(form.delay),
    times: Number(form.times),
    chance: Number(form.chance),
    enabled: true,
  })
  const full = rules.length >= MAX_MOCKS
  const badMatch = form.match.trim() !== "" && !matchIsValid(form.match)
  // Rules the panel holds but the page no longer runs: it reloaded.
  const lost = rules.length > 0 && hits !== null && !hits.installed
  const log = hits?.log ?? []
  const answers = form.action === "respond" || form.action === "modify"

  // While the log is open, what the page does shows up as it happens.
  useEffect(() => {
    if (!showLog || rules.length === 0) return
    const timer = setInterval(onPoll, 2_000)
    return () => clearInterval(timer)
  }, [showLog, rules.length, onPoll])

  return (
    <div className="space-y-2" data-testid="request-mocks">
      <h3 className="text-xs font-medium">{api.message("mockTitle")}</h3>
      <p className="text-[11px] text-muted-foreground">{api.message("mockHint")}</p>

      <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-2">
        <div className="flex flex-wrap gap-1" data-testid="mock-presets">
          {PRESETS.map((preset) => (
            <Button
              key={preset}
              size="sm"
              variant="outline"
              className="h-6 rounded-full bg-card px-2 text-[10px]"
              onClick={() =>
                setForm((current) => ({
                  ...current,
                  ...PRESET_FORMS[preset],
                  match: current.match || "*",
                }))
              }
              data-testid={`mock-preset-${preset}`}
            >
              {presetLabel(preset, api.message)}
            </Button>
          ))}
        </div>
        <div className="space-y-1">
          <Label htmlFor="cognia-mock-match" className="text-[11px] text-muted-foreground">
            {api.message("mockMatch")}
          </Label>
          <Input
            id="cognia-mock-match"
            value={form.match}
            maxLength={500}
            placeholder="/api/orders*"
            onChange={(event) => set({ match: event.target.value })}
            className={cn("h-7 font-mono text-xs", badMatch && "border-destructive")}
            aria-invalid={badMatch}
            data-testid="mock-match"
          />
          <p className="text-[10px] text-muted-foreground">
            {badMatch ? api.message("mockBadMatch") : api.message("mockMatchHint")}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <div className="space-y-1">
            <Label htmlFor="cognia-mock-method" className="text-[11px] text-muted-foreground">
              {api.message("mockMethod")}
            </Label>
            <Select value={form.method} onValueChange={(method) => set({ method })}>
              <SelectTrigger
                id="cognia-mock-method"
                className="h-7 w-full bg-card px-1.5 text-[11px]"
                data-testid="mock-method"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MOCK_METHODS.map((value) => (
                  <SelectItem key={value || ANY} value={value || ANY}>
                    {value || api.message("mockMethodAny")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="cognia-mock-action" className="text-[11px] text-muted-foreground">
              {api.message("mockAction")}
            </Label>
            <Select
              value={form.action}
              onValueChange={(next) =>
                set({
                  action: next as MockAction,
                  // A delay is what that action is; elsewhere it starts at none.
                  delay: next === "delay" ? "2000" : "0",
                  status: next === "modify" ? "" : form.status || "500",
                })
              }
            >
              <SelectTrigger
                id="cognia-mock-action"
                className="h-7 w-full bg-card px-1.5 text-[11px]"
                data-testid="mock-action"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MOCK_ACTIONS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {mockActionLabel(value, api.message)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {answers ? (
          <div className="space-y-1">
            <Label htmlFor="cognia-mock-status" className="text-[11px] text-muted-foreground">
              {form.action === "modify" ? api.message("mockStatusKeep") : api.message("mockStatus")}
            </Label>
            <Input
              id="cognia-mock-status"
              type="number"
              min={200}
              max={599}
              value={form.status}
              placeholder={form.action === "modify" ? api.message("mockStatusSame") : ""}
              onChange={(event) => set({ status: event.target.value })}
              className="h-7 bg-card text-xs"
              data-testid="mock-status"
            />
          </div>
        ) : null}
        {answers ? (
          <div className="space-y-1">
            <Label htmlFor="cognia-mock-body" className="text-[11px] text-muted-foreground">
              {form.action === "modify" ? api.message("mockBodyMerge") : api.message("mockBody")}
            </Label>
            <Textarea
              id="cognia-mock-body"
              rows={3}
              value={form.body}
              maxLength={MAX_MOCK_BODY}
              placeholder={form.action === "modify" ? '{"user": {"plan": "pro"}}' : '{"items": []}'}
              onChange={(event) => set({ body: event.target.value })}
              className="max-h-40 overflow-y-auto bg-card font-mono text-[11px]"
              data-testid="mock-body"
            />
          </div>
        ) : null}
        {form.action === "redirect" ? (
          <div className="space-y-1">
            <Label htmlFor="cognia-mock-target" className="text-[11px] text-muted-foreground">
              {api.message("mockTarget")}
            </Label>
            <Input
              id="cognia-mock-target"
              value={form.target}
              maxLength={500}
              placeholder="http://localhost:3000/api/orders"
              onChange={(event) => set({ target: event.target.value })}
              className="h-7 bg-card font-mono text-xs"
              data-testid="mock-target"
            />
            <p className="text-[10px] text-muted-foreground">{api.message("mockTargetHint")}</p>
          </div>
        ) : null}
        <div className="space-y-1">
          <Label htmlFor="cognia-mock-delay" className="text-[11px] text-muted-foreground">
            {api.message("mockDelay")}
          </Label>
          <Input
            id="cognia-mock-delay"
            type="number"
            min={0}
            max={MAX_MOCK_DELAY_MS}
            step={100}
            value={form.delay}
            onChange={(event) => set({ delay: event.target.value })}
            className="h-7 bg-card text-xs"
            data-testid="mock-delay"
          />
        </div>

        <Collapsible open={more} onOpenChange={setMore}>
          <CollapsibleTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
              data-testid="mock-more"
            >
              <ChevronRightIcon
                className={cn("size-3 transition-transform", more && "rotate-90")}
                aria-hidden="true"
              />
              {api.message("mockMore")}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-1.5 pt-1">
            {answers ? (
              <div className="space-y-1">
                <Label htmlFor="cognia-mock-headers" className="text-[11px] text-muted-foreground">
                  {api.message("mockHeaders")}
                </Label>
                <Textarea
                  id="cognia-mock-headers"
                  rows={2}
                  value={form.headers}
                  placeholder={"x-request-id: test\ncache-control: no-store"}
                  onChange={(event) => set({ headers: event.target.value })}
                  className="bg-card font-mono text-[11px]"
                  data-testid="mock-headers"
                />
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-1.5">
              <div className="space-y-1">
                <Label htmlFor="cognia-mock-times" className="text-[11px] text-muted-foreground">
                  {api.message("mockTimes")}
                </Label>
                <Input
                  id="cognia-mock-times"
                  type="number"
                  min={0}
                  max={1000}
                  value={form.times}
                  onChange={(event) => set({ times: event.target.value })}
                  className="h-7 bg-card text-xs"
                  data-testid="mock-times"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="cognia-mock-chance" className="text-[11px] text-muted-foreground">
                  {api.message("mockChance")}
                </Label>
                <Input
                  id="cognia-mock-chance"
                  type="number"
                  min={1}
                  max={100}
                  value={form.chance}
                  onChange={(event) => set({ chance: event.target.value })}
                  className="h-7 bg-card text-xs"
                  data-testid="mock-chance"
                />
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground">{api.message("mockLimitsHint")}</p>
          </CollapsibleContent>
        </Collapsible>

        <Button
          size="sm"
          className="h-7 w-full text-[11px]"
          disabled={busy || full || draft === null}
          onClick={() => {
            if (!draft) return
            onAdd({ ...draft, id: crypto.randomUUID() })
            set({ match: "" })
          }}
          data-testid="mock-add"
        >
          {full ? api.message("mockFull") : api.message("mockAdd")}
        </Button>
      </div>

      {lost ? (
        <p className="text-[11px] text-warning" data-testid="mock-lost">
          {api.message("mockLost")}
        </p>
      ) : null}
      {rules.length > 0 ? (
        <ul className="space-y-1" data-testid="mock-rules">
          {rules.map((rule, index) => {
            const hit = hits?.hits[rule.id]
            return (
              <li
                key={rule.id}
                className={cn(
                  "flex animate-enter items-start gap-1.5 rounded-lg border border-border bg-card p-1.5 motion-reduce:animate-none",
                  !rule.enabled && "opacity-60"
                )}
                data-testid={`mock-rule-${index}`}
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="font-mono text-[10px] break-all">
                    <span className="rounded bg-muted px-1 font-semibold">
                      {rule.method || api.message("mockMethodAny")}
                    </span>{" "}
                    {rule.match}
                  </p>
                  <p className="text-[11px]">
                    {ruleText(rule, api.message)}
                    {rule.times > 0
                      ? ` · ${api.message("mockRuleTimes", [String(rule.times)])}`
                      : ""}
                    {rule.chance < 100
                      ? ` · ${api.message("mockRuleChance", [String(rule.chance)])}`
                      : ""}
                  </p>
                </div>
                <Badge
                  variant={hit && hit.count > 0 ? "secondary" : "outline"}
                  className="shrink-0 text-[10px]"
                  title={hit?.lastUrl ?? undefined}
                  data-testid={`mock-hits-${index}`}
                >
                  {api.message("mockHits", [String(hit?.count ?? 0)])}
                </Badge>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  className="shrink-0 text-muted-foreground"
                  disabled={busy}
                  onClick={() => onToggle(rule.id, !rule.enabled)}
                  title={rule.enabled ? api.message("mockPause") : api.message("mockResume")}
                  aria-label={rule.enabled ? api.message("mockPause") : api.message("mockResume")}
                  data-testid={`mock-toggle-${index}`}
                >
                  {rule.enabled ? (
                    <PauseIcon aria-hidden="true" />
                  ) : (
                    <PlayIcon aria-hidden="true" />
                  )}
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  disabled={busy}
                  onClick={() => onRemove(rule.id)}
                  aria-label={api.message("mockRemove")}
                  data-testid={`mock-remove-${index}`}
                >
                  <XIcon aria-hidden="true" />
                </Button>
              </li>
            )
          })}
        </ul>
      ) : null}
      {rules.length > 0 ? (
        <>
          {canKeep ? (
            <div className="flex items-start justify-between gap-2 rounded-lg bg-muted/50 px-2 py-1.5">
              <Label
                htmlFor="cognia-mock-keep"
                className="flex-col items-start gap-0.5 text-[11px]"
              >
                <span>{api.message("mockKeep")}</span>
                <span className="font-normal text-muted-foreground">
                  {api.message("mockKeepHint")}
                </span>
              </Label>
              <Switch
                id="cognia-mock-keep"
                checked={hits?.kept === true}
                disabled={busy}
                onCheckedChange={onKeep}
                data-testid="mock-keep"
              />
            </div>
          ) : null}
          <Collapsible open={showLog} onOpenChange={setShowLog}>
            <div className="flex flex-wrap items-center gap-1">
              <CollapsibleTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 gap-1 px-1.5 text-[11px]"
                  data-testid="mock-log-toggle"
                >
                  <ChevronRightIcon
                    className={cn("size-3 transition-transform", showLog && "rotate-90")}
                    aria-hidden="true"
                  />
                  {api.message("mockLog", [String(log.length)])}
                </Button>
              </CollapsibleTrigger>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[11px]"
                disabled={busy}
                onClick={onRefresh}
                data-testid="mock-refresh"
              >
                {lost ? api.message("mockReapply") : api.message("mockRefresh")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[11px]"
                disabled={busy}
                onClick={onClear}
                data-testid="mock-clear"
              >
                {api.message("mockClear")}
              </Button>
            </div>
            <CollapsibleContent>
              {log.length === 0 ? (
                <p className="px-1.5 text-[11px] text-muted-foreground">
                  {api.message("mockLogEmpty")}
                </p>
              ) : (
                <ol
                  className="max-h-48 space-y-0.5 overflow-y-auto rounded-md border border-border bg-card p-1 font-mono text-[10px]"
                  data-testid="mock-log"
                >
                  {log
                    .slice()
                    .reverse()
                    .map((entry, index) => (
                      <li
                        key={`${entry.at}-${index}`}
                        className="flex gap-1.5"
                        title={entry.url}
                        data-testid={`mock-log-${index}`}
                      >
                        <span className="shrink-0 text-muted-foreground">{timeOf(entry.at)}</span>
                        <span className="shrink-0 font-semibold">{entry.method}</span>
                        <span className="min-w-0 flex-1 truncate">{pathOf(entry.url)}</span>
                        <span className="shrink-0 text-warning">{entry.outcome}</span>
                      </li>
                    ))}
                </ol>
              )}
            </CollapsibleContent>
          </Collapsible>
        </>
      ) : null}
    </div>
  )
}
