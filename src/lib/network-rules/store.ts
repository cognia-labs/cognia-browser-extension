/**
 * The worker's side of the request rules: the only writer of the person's
 * library and of each agent conversation's rules.
 *
 * The panel asks for one change at a time ({@link RuleCommand}); applying it
 * is a read-modify-write against storage, serialized, so two changes landing
 * together cannot each write back a library missing the other.
 */
import type { StorageArea } from "../agent/storage-area"
import {
  AGENT_NETWORK_RULES_KEY,
  MAX_AGENT_RULES,
  MAX_GROUPS,
  MAX_RULES_PER_GROUP,
  NETWORK_RULES_KEY,
  cleanRule,
  cleanSite,
  parseAgentRuleSets,
  parseLibrary,
  type AgentRuleSets,
  type NetworkRule,
  type RuleGroup,
  type RuleLibrary,
} from "./rules"

export type RuleCommand =
  | { op: "add-group"; name: string; sites: string[]; rules?: unknown[] }
  | { op: "update-group"; groupId: string; name?: string; sites?: string[]; enabled?: boolean }
  | { op: "remove-group"; groupId: string }
  | { op: "add-rule"; groupId: string; rule: unknown }
  | { op: "update-rule"; groupId: string; ruleId: string; rule: unknown }
  | { op: "toggle-rule"; groupId: string; ruleId: string; enabled: boolean }
  | { op: "remove-rule"; groupId: string; ruleId: string }
  | { op: "move-rule"; groupId: string; ruleId: string; by: -1 | 1 }
  | { op: "import"; groups: RuleGroup[] }
  | { op: "remove-agent-rule"; sessionId: string; ruleId: string }

export interface RuleCommandMessage {
  kind: "cognia-network-rules"
  command: RuleCommand
}

/** `skipped`: rules sent with a new group that could not be applied. */
export type RuleCommandResult =
  { ok: true; skipped?: number } | { ok: false; error: RuleCommandError }

export type RuleCommandError =
  | "invalid_rule"
  | "invalid_sites"
  | "unknown_group"
  | "unknown_rule"
  | "too_many_groups"
  | "too_many_rules"

const OPS = new Set([
  "add-group",
  "update-group",
  "remove-group",
  "add-rule",
  "update-rule",
  "toggle-rule",
  "remove-rule",
  "move-rule",
  "import",
  "remove-agent-rule",
])

export function isRuleCommandMessage(value: unknown): value is RuleCommandMessage {
  if (!value || typeof value !== "object") return false
  const record = value as Record<string, unknown>
  const command = record.command as Record<string, unknown> | null
  return (
    record.kind === "cognia-network-rules" &&
    !!command &&
    typeof command === "object" &&
    OPS.has(String(command.op))
  )
}

class Refusal extends Error {
  constructor(readonly code: RuleCommandError) {
    super(code)
  }
}

function sitesOf(input: unknown): string[] {
  const sites = Array.isArray(input)
    ? [
        ...new Set(
          input
            .filter((site): site is string => typeof site === "string")
            .map(cleanSite)
            .filter((site): site is string => site !== null)
        ),
      ]
    : []
  if (sites.length === 0) throw new Refusal("invalid_sites")
  return sites
}

export class NetworkRuleStore {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly local: StorageArea,
    private readonly session: StorageArea,
    private readonly newId: () => string
  ) {}

  async library(): Promise<RuleLibrary> {
    return parseLibrary(await this.local.get(NETWORK_RULES_KEY))
  }

  async agentSets(): Promise<AgentRuleSets> {
    return parseAgentRuleSets(await this.session.get(AGENT_NETWORK_RULES_KEY))
  }

  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work)
    this.queue = run.catch(() => undefined)
    return run
  }

  /** Apply one panel change. Answers why it was refused, rather than throwing. */
  apply(command: RuleCommand): Promise<RuleCommandResult> {
    return this.serialize(async () => {
      try {
        if (command.op === "remove-agent-rule") {
          const sets = await this.agentSets()
          const rules = sets[command.sessionId]
          if (!rules?.some((rule) => rule.id === command.ruleId)) throw new Refusal("unknown_rule")
          await this.writeAgent(
            command.sessionId,
            rules.filter((rule) => rule.id !== command.ruleId)
          )
          return { ok: true }
        }
        const library = await this.library()
        const changed = this.change(library, command)
        await this.local.set(NETWORK_RULES_KEY, changed)
        if (command.op === "add-group" && command.rules) {
          const kept = changed.groups.at(-1)?.rules.length ?? 0
          const skipped = Math.min(command.rules.length, MAX_RULES_PER_GROUP) - kept
          const over = Math.max(0, command.rules.length - MAX_RULES_PER_GROUP)
          if (skipped + over > 0) return { ok: true, skipped: skipped + over }
        }
        return { ok: true }
      } catch (error) {
        if (error instanceof Refusal) return { ok: false, error: error.code }
        throw error
      }
    })
  }

  private change(
    library: RuleLibrary,
    command: Exclude<RuleCommand, { op: "remove-agent-rule" }>
  ): RuleLibrary {
    const groups = [...library.groups]
    const at = "groupId" in command ? groups.findIndex((group) => group.id === command.groupId) : -1
    const group = at >= 0 ? groups[at]! : null
    const needGroup = () => {
      if (!group) throw new Refusal("unknown_group")
      return group
    }
    const replace = (next: RuleGroup) => {
      groups[at] = next
      return { v: 1 as const, groups }
    }
    const ruleAt = (current: RuleGroup, ruleId: string) => {
      const index = current.rules.findIndex((rule) => rule.id === ruleId)
      if (index < 0) throw new Refusal("unknown_rule")
      return index
    }
    switch (command.op) {
      case "add-group": {
        if (groups.length >= MAX_GROUPS) throw new Refusal("too_many_groups")
        const sites = sitesOf(command.sites)
        const rules = (command.rules ?? [])
          .slice(0, MAX_RULES_PER_GROUP)
          .map((rule) => cleanRule(rule, this.newId()))
          .filter((rule): rule is NetworkRule => rule !== null)
        groups.push({
          id: this.newId(),
          name: command.name.trim().slice(0, 80) || sites.join(", "),
          sites,
          enabled: true,
          rules,
        })
        return { v: 1, groups }
      }
      case "update-group": {
        const current = needGroup()
        return replace({
          ...current,
          ...(command.name !== undefined
            ? { name: command.name.trim().slice(0, 80) || current.name }
            : {}),
          ...(command.sites !== undefined ? { sites: sitesOf(command.sites) } : {}),
          ...(command.enabled !== undefined ? { enabled: command.enabled } : {}),
        })
      }
      case "remove-group": {
        needGroup()
        groups.splice(at, 1)
        return { v: 1, groups }
      }
      case "add-rule": {
        const current = needGroup()
        if (current.rules.length >= MAX_RULES_PER_GROUP) throw new Refusal("too_many_rules")
        const rule = cleanRule(command.rule, this.newId())
        if (!rule) throw new Refusal("invalid_rule")
        return replace({ ...current, rules: [...current.rules, rule] })
      }
      case "update-rule": {
        const current = needGroup()
        const index = ruleAt(current, command.ruleId)
        const rule = cleanRule(command.rule, command.ruleId)
        if (!rule) throw new Refusal("invalid_rule")
        const rules = [...current.rules]
        rules[index] = rule
        return replace({ ...current, rules })
      }
      case "toggle-rule": {
        const current = needGroup()
        const index = ruleAt(current, command.ruleId)
        const rules = [...current.rules]
        rules[index] = { ...rules[index]!, enabled: command.enabled }
        return replace({ ...current, rules })
      }
      case "remove-rule": {
        const current = needGroup()
        ruleAt(current, command.ruleId)
        return replace({
          ...current,
          rules: current.rules.filter((rule) => rule.id !== command.ruleId),
        })
      }
      case "move-rule": {
        // The first rule that takes a request wins, so order is meaning.
        const current = needGroup()
        const index = ruleAt(current, command.ruleId)
        const target = index + command.by
        if (target < 0 || target >= current.rules.length) return library
        const rules = [...current.rules]
        ;[rules[index], rules[target]] = [rules[target]!, rules[index]!]
        return replace({ ...current, rules })
      }
      case "import": {
        const incoming = parseLibrary({ groups: command.groups }).groups.map((entry) => ({
          ...entry,
          id: this.newId(),
          rules: entry.rules.map((rule) => ({ ...rule, id: this.newId() })),
        }))
        if (groups.length + incoming.length > MAX_GROUPS) throw new Refusal("too_many_groups")
        return { v: 1, groups: [...groups, ...incoming] }
      }
    }
  }

  private async writeAgent(sessionId: string, rules: NetworkRule[]): Promise<void> {
    const sets = await this.agentSets()
    if (rules.length > 0) sets[sessionId] = rules
    else delete sets[sessionId]
    await this.session.set(AGENT_NETWORK_RULES_KEY, sets)
  }

  /**
   * Replace a conversation's rules. Every rule must be valid: an agent told
   * that one of its rules was dropped would otherwise act on a page that
   * does not behave the way it set it up to.
   */
  setAgentRules(
    sessionId: string,
    input: unknown
  ): Promise<{ ok: true; rules: NetworkRule[] } | { ok: false; index: number }> {
    return this.serialize(async () => {
      const list = Array.isArray(input) ? input : []
      if (list.length > MAX_AGENT_RULES) return { ok: false as const, index: MAX_AGENT_RULES }
      const rules: NetworkRule[] = []
      for (const [index, entry] of list.entries()) {
        const rule = cleanRule(entry, `${sessionId}:${this.newId()}`)
        if (!rule) return { ok: false as const, index }
        rules.push(rule)
      }
      await this.writeAgent(sessionId, rules)
      return { ok: true as const, rules }
    })
  }

  clearAgent(sessionId: string): Promise<void> {
    return this.serialize(() => this.writeAgent(sessionId, []))
  }

  /** Drop the rules of conversations that no longer exist. */
  pruneAgents(live: ReadonlySet<string>): Promise<void> {
    return this.serialize(async () => {
      const sets = await this.agentSets()
      const stale = Object.keys(sets).filter((id) => !live.has(id))
      if (stale.length === 0) return
      for (const id of stale) delete sets[id]
      await this.session.set(AGENT_NETWORK_RULES_KEY, sets)
    })
  }
}
