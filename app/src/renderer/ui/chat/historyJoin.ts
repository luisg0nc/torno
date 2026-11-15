import type { ChatItem, PromptRow } from '../../../shared/chat'
import { FIRST_BUILD, drawable, type HistoryEntry } from '../../../shared/history'

// The chat is the project's history: each turn is joined to the builds that came out of its prompt (main labels each
// build when it keeps it: `cause` and `turn.prompt`, which is the `id` of the person's `user` item), and the builds the
// person made between turns (their own saves, their tried Params) are small lines between the prompts. Pure: the
// window only draws what these say.

/** A turn of the chat with the builds of its prompt. */
export interface JoinedTurn {
  /** The `id` of the person's `user` item the turn answers. */
  promptId: string
  /** Its number among the prompts of the project, from 1 (0 when it has none). */
  number: number
  /** The builds that came out of the prompt, oldest first: a failed one too. */
  entries: HistoryEntry[]
  /** The newest build that can be drawn before the first of `entries`: where the prompt started from. */
  from?: HistoryEntry
}

const queued = (item: ChatItem): boolean => item.kind === 'user' && item.state === 'queued'

/**
 * The number of each prompt, by its id: the number the project's list gives it (`PromptRow.number`, counted from 1 across
 * every conversation, one number wherever the prompt is shown), and, for a prompt of the open transcript the list does not
 * have yet (it was only just sent, or is queued: it will be), the numbers after the list's last, in the order they were made.
 */
export function numbersOf(rows: readonly PromptRow[], items: readonly ChatItem[]): Map<string, number> {
  const out = new Map<string, number>(rows.map((row) => [row.id, row.number]))
  let last = rows.reduce((most, row) => Math.max(most, row.number), 0)
  for (const item of items) if (item.kind === 'user' && !out.has(item.id)) out.set(item.id, (last += 1))
  return out
}

/**
 * Each turn of `items` (in the order they are drawn) with its builds: the turn answers the prompt before it, and the
 * entries that say that prompt are its. An entry that says nothing of its prompt belongs to no turn. A turn that built
 * nothing is joined too, with no entries.
 */
export function joinTurns(items: readonly ChatItem[], entries: readonly HistoryEntry[], numbering: Map<string, number>): Map<string, JoinedTurn> {
  const out = new Map<string, JoinedTurn>()
  let prompt: string | undefined
  for (const item of items) {
    if (item.kind === 'user' && !queued(item)) prompt = item.id
    else if (item.kind === 'turn' && prompt !== undefined) {
      const mine = entries.filter((e) => e.turn?.prompt === prompt)
      const first = mine.length > 0 ? entries.indexOf(mine[0]) : -1
      const from = first > 0 ? entries.slice(0, first).findLast(drawable) : undefined
      out.set(item.id, { promptId: prompt, number: numbering.get(prompt) ?? 0, entries: mine, ...(from ? { from } : {}) })
      prompt = undefined
    }
  }
  return out
}

/** The prompts a Go back undid: each has builds, and every one of them is marked undone. */
export function goneBack(entries: readonly HistoryEntry[]): Set<string> {
  const standing = new Set<string>()
  const undone = new Set<string>()
  for (const e of entries) {
    if (!e.turn) continue
    if (e.undone) undone.add(e.turn.prompt)
    else standing.add(e.turn.prompt)
  }
  return new Set([...undone].filter((id) => !standing.has(id)))
}

/** Builds the person made, in a row: their saves, or their tried Params. */
export interface SaveRun {
  cause: 'person' | 'params'
  entries: HistoryEntry[]
}

/**
 * The builds the person made (their own saves and their tried Params) that landed after `afterAt` up to `beforeAt`, in
 * runs: a run is builds of one cause with no other build between them, so three saves with no prompt between are one.
 */
export function savesBetween(entries: readonly HistoryEntry[], afterAt: string, beforeAt: string): SaveRun[] {
  const [after, before] = [Date.parse(afterAt), Date.parse(beforeAt)]
  const runs: SaveRun[] = []
  let last: SaveRun | undefined
  for (const e of entries) {
    const at = Date.parse(e.at)
    if (!(at > after && at <= before)) continue
    const cause = e.cause === 'person' || e.cause === 'params' ? e.cause : undefined
    if (!cause) {
      last = undefined
      continue
    }
    if (last && last.cause === cause) last.entries.push(e)
    else runs.push((last = { cause, entries: [e] }))
  }
  return runs
}

/** The most files or names told one by one. */
const MOST = 3

/** A piece of a line, in the face of numbers and names (`mono`) or in the sentence's. */
export interface Piece {
  text: string
  mono?: true
}

const plain = (text: string): Piece => ({ text })
const mono = (text: string): Piece => ({ text, mono: true })

/** `a.py, b.py` or `a.py, b.py, c.py and 2 more files`, as pieces. */
function listed(names: string[], what: string): Piece[] {
  const shown = names.slice(0, MOST).flatMap((name, at) => (at === 0 ? [mono(name)] : [plain(', '), mono(name)]))
  return names.length <= MOST ? shown : [...shown, plain(` and ${names.length - MOST} more ${what}`)]
}

/** The line between turns for a run, as pieces: `You saved common/fillets.py in your editor · h39`, `You tried wall, lid · h40`. */
export function saveParts(run: SaveRun): Piece[] {
  const [first, last] = [run.entries[0], run.entries[run.entries.length - 1]]
  const builds = run.entries.length > 1 ? [mono(first.id), plain(' to '), mono(last.id)] : [mono(first.id)]
  if (run.cause === 'params') {
    const names = [...new Set(run.entries.flatMap((e) => e.tried ?? []))]
    return [plain('You tried '), ...(names.length > 0 ? listed(names, 'Params') : [plain('other values of Params')]), plain(' · '), ...builds]
  }
  if (run.entries.length > 1) return [plain('You saved '), mono(String(run.entries.length)), plain(' times in your editor · '), ...builds]
  return [plain('You saved '), ...(first.files.length > 0 ? listed(first.files, 'files') : [plain('the model')]), plain(' in your editor · '), ...builds]
}

/** The same line as plain text. */
export const saveWords = (run: SaveRun): string => saveParts(run).map((p) => p.text).join('')

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/** The builds of a turn in the strip: where it began and every build, or, past `MOST_THUMBS`, the first and the last of them with the count between. */
export type StripItem = { kind: 'build'; entry: HistoryEntry; start?: true } | { kind: 'more'; count: number }

/** The most pictures a strip holds. */
export const MOST_THUMBS = 5

export function stripOf(j: JoinedTurn): StripItem[] {
  const all: StripItem[] = [...(j.from ? [{ kind: 'build' as const, entry: j.from, start: true as const }] : []), ...j.entries.map((entry) => ({ kind: 'build' as const, entry }))]
  if (all.length <= MOST_THUMBS) return all
  return [...all.slice(0, 2), { kind: 'more', count: all.length - 4 }, ...all.slice(-2)]
}

/**
 * What the builds of a turn did, in short phrases, from what each build kept (never worked out again): the parts they
 * changed, the checks of the model that began or stopped failing between where the turn began and where it ended, the
 * builds that failed on the way.
 */
export function turnFacts(j: JoinedTurn): string[] {
  const built = j.entries.filter(drawable)
  const last = built.at(-1)
  const facts: string[] = []
  const lines = [...new Set(built.map((e) => e.line).filter((line) => line !== FIRST_BUILD && line !== 'no part changed'))]
  if (lines.length > 0) facts.push(lines.join('; '))
  if (j.from && last) {
    const [was, now] = [new Set(j.from.failing ?? []), new Set(last.failing ?? [])]
    const fixed = [...was].filter((name) => !now.has(name))
    const broke = [...now].filter((name) => !was.has(name))
    if (fixed.length > 0) facts.push(`${plural(fixed.length, 'check', 'checks')} now ${fixed.length === 1 ? 'passes' : 'pass'}`)
    if (broke.length > 0) facts.push(`${plural(broke.length, 'check', 'checks')} now ${broke.length === 1 ? 'fails' : 'fail'}`)
  }
  const failed = j.entries.filter((e) => e.failed).length
  if (failed > 0) facts.push(j.entries.at(-1)?.failed ? (failed === 1 ? 'the build failed' : `${failed} builds failed`) : `${failed} failed on the way`)
  return facts
}
