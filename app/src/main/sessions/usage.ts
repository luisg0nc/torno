import type { ChatItem } from '../../shared/chat'
import { addUsageFacts, addUsage, medianCost, usageFacts, usageOf, type ProjectUsage, type UsageRow } from '../../shared/usage'
import { readLog } from './chatlog'
import { listPrompts } from './prompts'

// What Claude Code spent on a project (#370): each prompt of `listPrompts` with what its turns used, from the `turn`
// lines of `.torno/chat/` (the CLI's own `result` numbers, kept by the transcript), and the pictures and builds the
// items of each turn hold. A terminal's prompts are listed as not recorded: a terminal keeps no log. Reads only.

/** Every line of a log is read: a turn's numbers are on its last line, its pictures on the lines before it. */
const ALL = Number.MAX_SAFE_INTEGER

/** The items of a log once each, where each first stood, as last written (an item is written again when it changes). */
function once(items: readonly ChatItem[]): ChatItem[] {
  const at = new Map<string, number>()
  const out: ChatItem[] = []
  for (const item of items) {
    const i = at.get(item.id)
    if (i === undefined) {
      at.set(item.id, out.length)
      out.push(item)
    } else out[i] = item
  }
  return out
}

type Took = Pick<UsageRow, 'usage' | 'resumed' | 'facts' | 'turns'>

/** What the turns of a conversation took, by the id of the prompt each answered: the last sent before it. */
function tookOf(items: readonly ChatItem[]): Map<string, Took> {
  const out = new Map<string, Took>()
  let prompt: string | undefined
  let turn: ChatItem[] = []
  for (const item of once(items)) {
    if (item.kind === 'user' && item.state === 'sent') prompt = item.id
    if (item.kind !== 'turn') {
      turn.push(item)
      continue
    }
    if (prompt !== undefined) {
      const was = out.get(prompt)
      const facts = usageFacts(turn)
      const used = item.usage ? usageOf(item.usage) : undefined
      const usage = was?.usage && used ? addUsage(was.usage, used) : (was?.usage ?? used)
      // Tokens said with no cost: the first turn of a resumed conversation (`TurnUsage`).
      const resumed = was?.resumed === true || (item.usage !== undefined && item.usage.costUsd === undefined)
      out.set(prompt, { facts: was ? addUsageFacts(was.facts, facts) : facts, turns: [...(was?.turns ?? []), item.id], ...(usage ? { usage } : {}), ...(resumed ? { resumed: true } : {}) })
    }
    turn = []
  }
  return out
}

/** The prompts of the project in `dir`, as `listPrompts` numbers them, with what each took, and the median cost of a prompt. */
export async function listUsage(dir: string): Promise<ProjectUsage> {
  const prompts = await listPrompts(dir)
  const conversations = [...new Set(prompts.filter((p) => !p.id.startsWith('t-')).map((p) => p.conversation))]
  const took = new Map<string, Took>()
  for (const conversation of conversations) for (const [id, t] of tookOf(await readLog(dir, conversation, ALL))) took.set(id, t)
  const rows: UsageRow[] = prompts.map((p) => {
    if (p.id.startsWith('t-')) return { ...p, terminal: true, facts: { pictures: {}, builds: { count: 0 } }, turns: [] }
    return { ...p, ...(took.get(p.id) ?? { facts: { pictures: {}, builds: { count: 0 } }, turns: [] }) }
  })
  const median = medianCost(rows)
  return { rows, ...(median !== undefined ? { median } : {}) }
}
