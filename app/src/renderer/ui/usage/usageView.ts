import { dollars, number } from '../../../shared/format'
import { allTokens, newTokens, type UsageRow } from '../../../shared/usage'
import type { UsageRange } from '../../state/usage'

// The Usage page's rules (#371), pure: which prompts a range takes, the sentences that lead the page and a conversation's
// ledger, the cost by day (or by week), the turns grouped by their pictures, and the conversations. Every number is a
// count or a sum of what the logs hold; a cost not known is counted as not known, never guessed.

const DAY = 24 * 60 * 60 * 1000
const DAYS: Record<Exclude<UsageRange, 'all'>, number> = { week: 7, month: 30 }
const RANGE_WORD: Record<UsageRange, string> = { week: 'the week', month: 'the month', all: 'all of it' }

/** Midnight of the day `at` is in, local time. */
const dayOf = (at: number): number => {
  const d = new Date(at)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}
const addDays = (at: number, n: number): number => {
  const d = new Date(at)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime()
}

/** The first day a range takes, counted back from today: the last 7 days for the week, 30 for the month. */
export const rangeStart = (range: UsageRange, now: number): number | null => (range === 'all' ? null : addDays(dayOf(now), 1 - DAYS[range]))

/** The prompts said in the range. */
export function rowsIn(rows: readonly UsageRow[], range: UsageRange, now: number): UsageRow[] {
  const start = rangeStart(range, now)
  return start === null ? [...rows] : rows.filter((r) => r.at >= start)
}

const costOf = (r: UsageRow): number | undefined => r.usage?.costUsd
const sum = (rows: readonly UsageRow[], f: (r: UsageRow) => number): number => rows.reduce((s, r) => s + f(r), 0)
const pictureCount = (r: UsageRow): number => Object.values(r.facts.pictures).reduce((s, k) => s + k, 0)
const percent = (share: number): string => `${number(Math.round(share * 100))} %`
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`
/** A row whose cost cannot be counted: a terminal's prompt, the first turn after a resume. */
export const unknownCost = (r: UsageRow): boolean => r.terminal === true || (r.usage !== undefined && r.usage.costUsd === undefined)

/** The tokens of the rows by kind: read again, new to the context, written. */
export function tokenKinds(rows: readonly UsageRow[]): { read: number; fresh: number; written: number; all: number } {
  const counted = rows.flatMap((r) => (r.usage ? [r.usage] : []))
  const read = counted.reduce((s, u) => s + u.cacheRead, 0)
  const fresh = counted.reduce((s, u) => s + newTokens(u), 0)
  const written = counted.reduce((s, u) => s + u.output, 0)
  return { read, fresh, written, all: counted.reduce((s, u) => s + allTokens(u), 0) }
}

/**
 * The page's lead (`head`): what the range cost over how many prompts and conversations, and the share of the tokens that
 * was the conversation read again; and under it (`more`) the prompt that took most of it, when it took a good deal more
 * than the next, and what has no cost to count.
 */
export function pageLead(rows: readonly UsageRow[], range: UsageRange): { head: string; more: string } {
  if (rows.length === 0) return { head: range === 'all' ? 'No turn of Claude Code yet.' : `No turn of Claude Code in ${RANGE_WORD[range]}.`, more: '' }
  const cost = sum(rows, (r) => costOf(r) ?? 0)
  const conversations = new Set(rows.map((r) => r.conversation)).size
  const kinds = tokenKinds(rows)
  const read = kinds.all > 0 ? ` ${percent(kinds.read / kinds.all)} of the tokens were the conversation read again.` : ''
  const head = `${dollars(cost)} over ${plural(rows.length, 'prompt', 'prompts')} in ${plural(conversations, 'conversation', 'conversations')}.${read}`
  const more: string[] = []
  const costed = rows.filter((r) => costOf(r) !== undefined).sort((a, b) => costOf(b)! - costOf(a)!)
  const [top, next] = costed
  if (top && next && cost > 0 && costOf(top)! >= 2 * costOf(next)! && costOf(top)! / cost >= 0.25) {
    const pictures = pictureCount(top)
    const what = [top.usage?.requests !== undefined ? plural(top.usage.requests, 'call', 'calls') : '', pictures > 0 ? plural(pictures, 'picture', 'pictures') : ''].filter((s) => s !== '')
    more.push(`Prompt ${top.number} took ${percent(costOf(top)! / cost)} of ${RANGE_WORD[range]}${what.length > 0 ? `: ${what.join(' and ')}` : ''}.`)
  }
  const terminal = rows.filter((r) => r.terminal).length
  const resumed = rows.filter((r) => !r.terminal && unknownCost(r)).length
  const gaps = [terminal > 0 ? `${plural(terminal, 'prompt', 'prompts')} in a terminal` : '', resumed > 0 ? `${plural(resumed, 'first turn', 'first turns')} after a resume` : ''].filter((s) => s !== '')
  if (gaps.length > 0) more.push(`${gaps.join(' and ')} ${terminal + resumed === 1 ? 'has' : 'have'} no cost to count.`)
  return { head, more: more.join(' ') }
}

/** A column of the chart of cost: a day, or a week for all of a project longer than a month. */
export interface Bucket {
  start: number
  end: number
  /** Its two lines under the axis: `Fri` and `20` for a day, `Nov` and `16` (its Monday) for a week. */
  top: string
  bottom: string
  cost: number
  /** Its prompts whose cost is not known: a terminal's, a first turn after a resume. */
  unknown: number
}

const WEEKDAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short' })
const MONTH = new Intl.DateTimeFormat('en-GB', { month: 'short' })

/** The cost of the range by day (by week for all of a project that runs longer than a month), oldest first, every day there whether it had a prompt or not. */
export function buckets(rows: readonly UsageRow[], range: UsageRange, now: number): Bucket[] {
  const today = dayOf(now)
  const first = rangeStart(range, now) ?? dayOf(Math.min(today, ...rows.map((r) => r.at)))
  const span = Math.round((today - first) / DAY) + 1
  const weeks = range === 'all' && span > 31
  const out: Bucket[] = []
  if (weeks) {
    // From the Monday of the first week.
    let start = addDays(first, -((new Date(first).getDay() + 6) % 7))
    while (start <= today) {
      const end = addDays(start, 7)
      out.push({ start, end, top: MONTH.format(start), bottom: String(new Date(start).getDate()), cost: 0, unknown: 0 })
      start = end
    }
  } else {
    for (let i = 0; i < span; i++) {
      const start = addDays(first, i)
      out.push({ start, end: addDays(start, 1), top: WEEKDAY.format(start), bottom: String(new Date(start).getDate()), cost: 0, unknown: 0 })
    }
  }
  for (const r of rows) {
    const b = out.find((x) => r.at >= x.start && r.at < x.end)
    if (!b) continue
    b.cost += costOf(r) ?? 0
    if (unknownCost(r)) b.unknown += 1
  }
  return out
}

/** A group of turns by the pictures they had, each turn counted whole under them. */
export interface PictureGroup {
  label: string
  turns: number
  calls: number
  cost: number
  /** Of the cost of the turns whose cost is known. */
  share: number
}

/** The turns whose cost is known grouped by their pictures: 5 or more, 2 to 4, 1 or none. */
export function byPictures(rows: readonly UsageRow[]): PictureGroup[] {
  const costed = rows.filter((r) => costOf(r) !== undefined)
  const total = sum(costed, (r) => costOf(r)!)
  const group = (label: string, take: (k: number) => boolean): PictureGroup => {
    const of = costed.filter((r) => take(pictureCount(r)))
    const cost = sum(of, (r) => costOf(r)!)
    return { label, turns: of.length, calls: sum(of, (r) => r.usage?.requests ?? 0), cost, share: total > 0 ? cost / total : 0 }
  }
  return [group('With 5 or more pictures', (k) => k >= 5), group('With 2 to 4 pictures', (k) => k >= 2 && k < 5), group('With 1 picture or none', (k) => k < 2)]
}

/** One conversation of the project, as the page lists it. */
export interface ConversationUsage {
  id: string
  /** Its first prompt's words: a conversation has no name of its own. */
  name: string
  from: number
  to: number
  prompts: number
  calls: number
  pictures: number
  /** The sum of the costs that are known. */
  cost: number
  /** Its prompts whose cost is not known. */
  unknown: number
  /** Each prompt's cost, in order; null where it is not known or not counted. */
  costs: Array<number | null>
  terminal: boolean
  resumed: boolean
  rows: UsageRow[]
}

/** The conversations of the rows, by the time their first prompt was said. */
export function conversationsOf(rows: readonly UsageRow[]): ConversationUsage[] {
  const by = new Map<string, UsageRow[]>()
  for (const r of [...rows].sort((a, b) => a.at - b.at)) by.set(r.conversation, [...(by.get(r.conversation) ?? []), r])
  return [...by].map(([id, of]) => ({
    id,
    name: of[0]!.text,
    from: of[0]!.at,
    to: of.at(-1)!.at,
    prompts: of.length,
    calls: sum(of, (r) => r.usage?.requests ?? 0),
    pictures: sum(of, pictureCount),
    cost: sum(of, (r) => costOf(r) ?? 0),
    unknown: of.filter(unknownCost).length,
    costs: of.map((r) => costOf(r) ?? null),
    terminal: of.every((r) => r.terminal === true),
    resumed: of.some((r) => r.resumed === true),
    rows: of
  }))
}

/** The lead of a conversation's ledger: `$10.80 for 7 prompts and 112 calls, with 1 turn of unknown cost.` */
export function ledgerLead(c: ConversationUsage): string {
  if (c.terminal) return `${plural(c.prompts, 'prompt', 'prompts')} in a terminal, which records no usage.`
  const unknown = c.unknown > 0 ? `, with ${plural(c.unknown, 'turn', 'turns')} of unknown cost` : ''
  return `${dollars(c.cost)} for ${plural(c.prompts, 'prompt', 'prompts')} and ${plural(c.calls, 'call', 'calls')}${unknown}.`
}

/** The share of the read-again, new and written tokens, as the page's bar of kinds draws them. */
export const shareOf = (part: number, all: number): string => (all > 0 ? percent(part / all) : '0 %')

const DAY_MONTH = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' })

/** Two days as a span: `20 to 26 Nov`, `28 Oct to 3 Nov`, `26 Nov` when they are one. */
export function daySpan(from: number, to: number): string {
  const [a, b] = [new Date(from), new Date(to)]
  if (dayOf(from) === dayOf(to)) return DAY_MONTH.format(a)
  return a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear() ? `${a.getDate()} to ${DAY_MONTH.format(b)}` : `${DAY_MONTH.format(a)} to ${DAY_MONTH.format(b)}`
}

/** The pictures a row had, as a number. */
export { pictureCount }
