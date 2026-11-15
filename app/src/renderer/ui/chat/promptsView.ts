import type { PromptRow } from '../../../shared/chat'
import { drawable, type HistoryEntry } from '../../../shared/history'
import { goneBack, savesBetween, type SaveRun } from './historyJoin'

// "Prompts only": the project's prompts as one row each, with the builds that came out of each, from the entries' own
// `turn` and `cause` (never worked out from times, but for where the person's saves lie between two prompts). Pure.

/** One prompt with its builds. */
export interface PromptItem {
  kind: 'prompt'
  row: PromptRow
  /** The builds that came out of it, oldest first: a failed one too. */
  entries: HistoryEntry[]
  /** The newest build that can be drawn before its first: where it started from. */
  from?: HistoryEntry
  /** The last build of it that can be drawn. */
  to?: HistoryEntry
  /** A build of it is starred. */
  starred: boolean
  /** A Go back undid it (every build of it is undone). */
  gone: boolean
}

export type PromptLine =
  | PromptItem
  /** What the person built between two prompts. */
  | { kind: 'saves'; id: string; run: SaveRun }
  /** Where a conversation began: a quiet line. `current`: the one the chat shows now. */
  | { kind: 'began'; id: string; conversation: string; at: number; current: boolean }
  /** Prompts a Go back undid, folded: `first` to `last` by number; their lines inside, newest first. */
  | { kind: 'gone'; id: string; first: number; last: number; lines: PromptLine[] }

/** Far past any build: the end of the history. */
const LATER = '9999-12-31T00:00:00Z'

function itemOf(row: PromptRow, entries: readonly HistoryEntry[], gone: ReadonlySet<string>): PromptItem {
  const mine = entries.filter((e) => e.turn?.prompt === row.id)
  const first = mine.length > 0 ? entries.indexOf(mine[0]) : -1
  const from = first > 0 ? entries.slice(0, first).findLast(drawable) : undefined
  const to = mine.findLast(drawable)
  return { kind: 'prompt', row, entries: mine, ...(from ? { from } : {}), ...(to ? { to } : {}), starred: mine.some((e) => e.starred), gone: gone.has(row.id) }
}

/**
 * What a prompt came to, in a word: that a Go back undid it, a build that failed last (or how many failed on the way), how
 * many checks of the model fail in its last build, that a build of it is starred, or that it passes. Nothing for a prompt
 * that built nothing.
 */
export function resultWord(p: PromptItem): string {
  if (p.gone) return 'gone back from'
  if (p.entries.length === 0) return ''
  const failed = p.entries.filter((e) => e.failed).length
  if (p.entries.at(-1)?.failed) return 'build failed'
  if (failed > 0) return `${failed} failed on the way`
  const failing = p.to?.failing?.length ?? 0
  if (failing > 0) return `${failing} ${failing === 1 ? 'check fails' : 'checks fail'}`
  return p.starred ? 'starred' : 'passes'
}

/**
 * The prompts of the project, newest first, each with its builds; the person's saves between two prompts as one line, a
 * quiet line at the start of each conversation (a run of prompts of one), the prompts a Go back undid folded into one row,
 * with the saves between them. `starred`: only the prompts with a starred build. `hideGone`: the folded rows are left out.
 * `rows` are oldest first, as `listPrompts` gives them.
 */
export function promptLines(rows: readonly PromptRow[], entries: readonly HistoryEntry[], opts: { current?: string; starred?: boolean; hideGone?: boolean }): PromptLine[] {
  const gone = goneBack(entries)
  const items = rows.map((row) => itemOf(row, entries, gone))
  if (opts.starred) return items.filter((p) => p.starred).reverse()

  // Oldest first: where each conversation began, each prompt, and what the person built before the next one.
  const flat: PromptLine[] = []
  items.forEach((p, at) => {
    if (at === 0 || items[at - 1].row.conversation !== p.row.conversation) flat.push({ kind: 'began', id: `began-${p.row.id}`, conversation: p.row.conversation, at: p.row.at, current: opts.current !== undefined && p.row.conversation === opts.current })
    flat.push(p)
    const next = items[at + 1]
    const before = next ? new Date(next.row.at).toISOString() : LATER
    savesBetween(entries, new Date(p.row.at).toISOString(), before).forEach((run, n) => flat.push({ kind: 'saves', id: `saves-${p.row.id}-${n}`, run }))
  })

  // The folded rows: gone prompts in a row, with the saves between them; the saves after the last of them are not theirs.
  const out: PromptLine[] = []
  let run: PromptLine[] = []
  let held: PromptLine[] = []
  const close = (): void => {
    if (run.length > 0) {
      const numbers = run.flatMap((l) => (l.kind === 'prompt' ? [l.row.number] : []))
      out.push({ kind: 'gone', id: `gone-${numbers[0]}`, first: Math.min(...numbers), last: Math.max(...numbers), lines: [...run].reverse() })
    }
    out.push(...held)
    run = []
    held = []
  }
  for (const line of flat) {
    if (line.kind === 'prompt' && line.gone) {
      run.push(...held, line)
      held = []
    } else if (line.kind === 'saves' && run.length > 0) held.push(line)
    else {
      close()
      out.push(line)
    }
  }
  close()
  return (opts.hideGone ? out.filter((l) => l.kind !== 'gone') : out).reverse()
}
