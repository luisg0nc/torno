import type { ChatItem, PromptRow, TokenCount, TurnUsage } from './chat'
import { dollars, number, tokens } from './format'

// What Claude Code spent on a project (#357), from what its `result` messages said and the chat's own items: the
// prompts of the project with what their turns used (`UsageRow`, read by main from `.torno/chat/`, `main/sessions/usage.ts`),
// and the rules the window says it by. Nothing here is estimated: a number is the CLI's, or a count or a sum of what the
// log holds. A turn's cost is never split by cause.

/** What a prompt's turns used: the tokens and the calls summed, and the cost when every turn said one. No `costUsd`: not known. */
export interface Usage extends TokenCount {
  requests?: number
  costUsd?: number
}

/** What a turn's items say it did besides spending: the pictures that came into the conversation and the builds its edits started. */
export interface UsageFacts {
  /** By where from: a tool's own name (`look`, `Read`), `you` for the person's own pictures. */
  pictures: Record<string, number>
  /** The builds that ran (ok or failed); `from` the build on show when the prompt was sent, `to` the last that worked. */
  builds: { count: number; from?: number; to?: number }
}

/** One prompt of the project with what its turns took. A terminal's prompt has no usage: a terminal records none. */
export interface UsageRow extends PromptRow {
  /** Said in a terminal: nothing of its turn is recorded. */
  terminal?: true
  /** Absent: no turn of it was counted (it is going on, or the CLI said nothing). */
  usage?: Usage
  /** Its turn was the first of a resumed conversation: its tokens are its own, its cost cannot be told apart. */
  resumed?: true
  facts: UsageFacts
  /** The ids of the turn items that answered it, in order. */
  turns: string[]
}

export interface ProjectUsage {
  rows: UsageRow[]
  /** The median cost of the project's prompts whose cost is known: what "large" is measured against. */
  median?: number
}

/** A tool's own name: `look` of `mcp__torno__look`. */
export const toolName = (name: string): string => (name.startsWith('mcp__') && name.split('__').length > 2 ? name.split('__').slice(2).join('__') : name)

/** What the items of one turn (from the prompt to its end) did besides spending: pictures that came in, builds that ran. */
export function usageFacts(items: readonly ChatItem[]): UsageFacts {
  const pictures: Record<string, number> = {}
  const add = (from: string, n: number): void => {
    if (n > 0) pictures[from] = (pictures[from] ?? 0) + n
  }
  let count = 0
  let from: number | undefined
  let to: number | undefined
  for (const item of items) {
    if (item.kind === 'user') add('you', item.images.length)
    else if (item.kind === 'tool') add(toolName(item.name), item.images.length)
    else if (item.kind === 'context' && !item.forTool) {
      if (from === undefined && item.revision !== undefined) from = item.revision
    } else if (item.kind === 'context' && (item.buildState === 'ok' || item.buildState === 'failed')) {
      count += 1
      if (item.buildState === 'ok' && item.revision !== undefined) to = item.revision
    }
  }
  return { pictures, builds: { count, ...(count > 0 && from !== undefined ? { from } : {}), ...(to !== undefined ? { to } : {}) } }
}

/** The facts of two turns of one prompt taken together. */
export function addUsageFacts(a: UsageFacts, b: UsageFacts): UsageFacts {
  const pictures = { ...a.pictures }
  for (const [from, n] of Object.entries(b.pictures)) pictures[from] = (pictures[from] ?? 0) + n
  const from = a.builds.from ?? b.builds.from
  const to = b.builds.to ?? a.builds.to
  return { pictures, builds: { count: a.builds.count + b.builds.count, ...(from !== undefined ? { from } : {}), ...(to !== undefined ? { to } : {}) } }
}

/** A turn's usage as a row keeps it: the counts, the calls and the cost, not the running total nor the models. */
export function usageOf(turn: TurnUsage): Usage {
  return { input: turn.input, output: turn.output, cacheRead: turn.cacheRead, cacheCreation: turn.cacheCreation, ...(turn.requests !== undefined ? { requests: turn.requests } : {}), ...(turn.costUsd !== undefined ? { costUsd: turn.costUsd } : {}) }
}

/** Two turns' usage summed. The cost is known only when both said it. */
export function addUsage(a: Usage, b: Usage): Usage {
  const requests = a.requests === undefined && b.requests === undefined ? undefined : (a.requests ?? 0) + (b.requests ?? 0)
  const costUsd = a.costUsd !== undefined && b.costUsd !== undefined ? a.costUsd + b.costUsd : undefined
  return { input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, cacheCreation: a.cacheCreation + b.cacheCreation, ...(requests !== undefined ? { requests } : {}), ...(costUsd !== undefined ? { costUsd } : {}) }
}

/** The median cost of the rows whose cost is known; undefined when none is. */
export function medianCost(rows: readonly UsageRow[]): number | undefined {
  const costs = rows.flatMap((r) => (r.usage?.costUsd !== undefined ? [r.usage.costUsd] : [])).sort((a, b) => a - b)
  if (costs.length === 0) return undefined
  const mid = Math.floor(costs.length / 2)
  return costs.length % 2 === 1 ? costs[mid]! : (costs[mid - 1]! + costs[mid]!) / 2
}

/** The tokens that were new to the conversation: what was sent uncached and what was written to the cache. */
export const newTokens = (u: TokenCount): number => u.input + u.cacheCreation

/** All the tokens of a usage. */
export const allTokens = (u: TokenCount): number => u.input + u.output + u.cacheRead + u.cacheCreation

const calls = (n: number): string => `${n} ${n === 1 ? 'call' : 'calls'}`

/**
 * What a turn took, in one sentence for its end (#368): the cost first (`lead`), then the calls and the three kinds of
 * token (`$0.64 for 8 calls: 742 k of context read again, 14.2 k new to it, 6.3 k written.`). With no cost (the first
 * turn after a resume) the lead says it is not known, and the tokens follow. Null for a turn the CLI counted nothing for.
 */
export function usageLine(u: Usage | undefined): { lead: string; rest: string; known: boolean } | null {
  if (!u || (allTokens(u) === 0 && !u.requests && !u.costUsd)) return null
  const kinds = `${tokens(u.cacheRead)} of context read again, ${tokens(newTokens(u))} new to it, ${tokens(u.output)} written.`
  if (u.costUsd === undefined) return { lead: 'Cost not known for this turn.', rest: ` ${u.requests !== undefined ? `${calls(u.requests)}: ` : ''}${kinds}`, known: false }
  return { lead: dollars(u.costUsd), rest: `${u.requests !== undefined ? ` for ${calls(u.requests)}` : ''}: ${kinds}`, known: true }
}

/** A turn is large from this many times the project's median turn cost (Luis, 2026-11-26). */
export const LARGE_TIMES = 3
/** Never within the project's first prompts: there is no usual turn yet. */
export const LARGE_AFTER = 3

/**
 * How many times the project's usual turn (the median cost, `medianCost`) a turn of the prompt numbered `number` cost,
 * when that is at least `LARGE_TIMES` and the prompt is past the project's first `LARGE_AFTER`; null when it is not large
 * or cannot be told (no cost, no number, no usual turn).
 */
export function largeTimes(cost: number | undefined, number: number | undefined, median: number | undefined): number | null {
  if (cost === undefined || number === undefined || median === undefined || median <= 0 || number <= LARGE_AFTER) return null
  const times = cost / median
  return times >= LARGE_TIMES ? times : null
}

const and = (parts: string[]): string => (parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`)

/**
 * Why a turn was large (#369), as facts in a row and never a cause: the calls and the context each read again, the
 * pictures that came in (which every call after reads too) and where from, the builds that ran. Claude Code says what a
 * turn cost, not what each picture or build did, so nothing here splits the cost.
 */
export function whyLarge(u: Usage, facts: UsageFacts, times: number): { head: string; lines: string[] } {
  const lines: string[] = []
  if (u.requests) lines.push(`${calls(u.requests)}, and each read the whole conversation again: ${tokens(u.cacheRead / u.requests)} a call on average, ${tokens(u.cacheRead)} in all.`)
  const from = Object.entries(facts.pictures).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const pictures = from.reduce((n, [, k]) => n + k, 0)
  if (pictures > 0) {
    const where = pictures === 1 ? `from ${from[0]![0]}` : and(from.map(([name, n]) => `${n} from ${name}`))
    lines.push(`${pictures} ${pictures === 1 ? 'picture' : 'pictures'} came in on the way, ${where}. A picture stays in the conversation, so every call after it reads it too.`)
  }
  const { count, from: first, to } = facts.builds
  if (count > 0) {
    const span = to === undefined ? '' : first !== undefined && first !== to ? `, r${first} to r${to}` : `, r${to}`
    lines.push(`${count} ${count === 1 ? 'build' : 'builds'} ran${span}.`)
  }
  return { head: `Why this turn was large: ${number(Math.round(times * 10) / 10)} × this project's usual turn`, lines }
}

/** Why a resumed conversation's first turn has no cost, said once under it. */
export const RESUMED_NOTE = "Claude Code counts a resumed conversation's cost together with what its earlier processes spent, so this turn's own share cannot be told apart."

/** What a cost is on a Claude plan, said where costs are shown. */
export const PLAN_NOTE = 'On a Claude plan these are what the tokens would cost through the API, not what you pay.'
