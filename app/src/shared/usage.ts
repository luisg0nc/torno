import type { ChatItem, PromptRow, TokenCount, TurnUsage } from './chat'

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
export interface TurnFacts {
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
  facts: TurnFacts
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
export function turnFacts(items: readonly ChatItem[]): TurnFacts {
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
export function addFacts(a: TurnFacts, b: TurnFacts): TurnFacts {
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
