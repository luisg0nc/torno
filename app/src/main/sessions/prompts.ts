import type { PromptRow } from '../../shared/chat'
import type { HistoryEntry } from '../../shared/history'
import { readHistory } from '../history'
import { conversations, readPrompts } from './chatlog'

// The prompts of a project, across all its conversations: what "Prompts only" lists. A chat's are read from the logs of
// `.torno/chat/` (the person's prompts that were sent, never one still queued or not sent); a terminal's come from the
// history's entries, which say the prompt of the turn a build came out of (`turn`, `t-<conversation>-<n>`), because a
// terminal keeps no log. Reads only.

export type { PromptRow }

/** The most rows listed: the newest. */
export const MOST_PROMPTS = 2000

/** The prompts a terminal said, once each, from the builds that name them. */
function terminalPrompts(entries: readonly HistoryEntry[]): Array<Omit<PromptRow, 'number'>> {
  const seen = new Set<string>()
  const out: Array<Omit<PromptRow, 'number'>> = []
  for (const e of entries) {
    const turn = e.turn
    const at = Date.parse(e.at)
    if (!turn || !turn.prompt.startsWith('t-') || seen.has(turn.prompt) || !Number.isFinite(at)) continue
    seen.add(turn.prompt)
    out.push({ conversation: turn.conversation ?? '', id: turn.prompt, text: turn.text ?? '', at })
  }
  return out
}

/**
 * The prompts of the project in `dir`, oldest first, numbered from 1 across all its conversations (the number is the
 * prompt's wherever it is shown: a turn card, a row, the status line). `most` keeps the newest rows, with the numbers
 * they have in the whole.
 */
export async function listPrompts(dir: string, opts: { most?: number } = {}): Promise<PromptRow[]> {
  const [names, entries] = await Promise.all([conversations(dir), readHistory(dir).catch(() => [] as HistoryEntry[])])
  const logged = await Promise.all(names.map(async (conversation) => (await readPrompts(dir, conversation)).map((item) => ({ conversation, id: item.id, text: item.text, at: item.at, ...(item.carried ? { marks: item.carried.marks, ...(item.carried.review !== undefined ? { review: item.carried.review } : {}) } : {}) }))))
  const rows = [...logged.flat(), ...terminalPrompts(entries)]
  // A stable sort: prompts said in the same millisecond keep the order of their log.
  rows.sort((a, b) => a.at - b.at)
  const numbered = rows.map((row, at) => ({ ...row, number: at + 1 }))
  const most = Math.max(1, opts.most ?? MOST_PROMPTS)
  return numbered.length > most ? numbered.slice(numbered.length - most) : numbered
}
