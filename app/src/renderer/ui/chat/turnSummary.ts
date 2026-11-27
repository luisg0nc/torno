import { type ChatItem, TORNO_TOOL_PREFIX } from '../../../shared/chat'
import { number } from '../../../shared/format'
import type { DigestPart, Verdict } from '../../../shared/sanity'
import type { UsageFacts } from '../../../shared/usage'

/** The tools of Claude Code that write a file. */
const WRITES = new Set(['Edit', 'Write', 'MultiEdit'])

/** What a turn did, said from its own items and nothing else: no number here that the kernel did not give. */
export interface TurnSummary {
  /** The files the agent edited or wrote, in the order it first did, by path as the tool was given it, and how many times. */
  files: Array<{ path: string; edits: number }>
  /** The builds the turn's edits started. `from`: the build on show when the prompt was sent; `to`: the last that worked. */
  builds?: { from?: number; to?: number; failed: number; lastFailed: boolean }
  /** The marks the agent placed and the marks it resolved, as `M3`. */
  added: string[]
  /** The sketches the agent drew (`add_sketch`), and those it drew again, as `M9`. */
  sketched: string[]
  resketched: string[]
  resolved: string[]
  /** The dimensions whose verdict at the end of the turn is another than at its start, as far as the builds measured them. */
  dimensions: Array<{ id: string; now: Verdict }>
  /** What the builds did to each part, taken together (`partChanges`): the numbers `netParts` says in words and the tags of Compare write on the parts. */
  parts: PartChange[]
}

/** One part whose volume or face count the turn's builds left other than it began, from the kernel's numbers of the digests; `exact` is whether every volume it went through was. */
export interface PartChange {
  /** `layout:name`, a part's key in a scene. */
  id: string
  name: string
  layout: string
  volume: { before: number; after: number; exact: boolean }
  faces: { before: number; after: number }
}

/** What a turn's end draws besides its own fields: what it did, and the builds' numbers taken together (`netParts`). */
export interface TurnAccount {
  summary: TurnSummary
  net: string[]
  /** The pictures that came in and the builds that ran (`usageFacts`): what says why a large turn was large. */
  facts?: UsageFacts
}

/** The items of one turn: after the turn before it, up to its own end. Empty for an id that is not a turn. */
export function itemsOfTurn(items: readonly ChatItem[], turnId: string): ChatItem[] {
  const end = items.findIndex((item) => item.kind === 'turn' && item.id === turnId)
  if (end < 0) return []
  let start = end
  while (start > 0 && items[start - 1].kind !== 'turn') start -= 1
  return items.slice(start, end)
}

const base = (path: string): string => path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)

/** The place an edit tool was given: its `file_path`. */
function pathOf(input: unknown): string | undefined {
  const path = typeof input === 'object' && input !== null ? (input as { file_path?: unknown }).file_path : undefined
  return typeof path === 'string' && path !== '' ? path : undefined
}

/** The number of a mark an `add_mark` placed, from what it answered: `placed in layout main: (yours) M5 pin ...`. */
function placedMark(result: string | undefined): string | undefined {
  return result === undefined ? undefined : /placed in layout [^\n]*?: (?:\([^)]*\) )?(M\d+)\b/.exec(result)?.[1]
}

/** What the items of a turn (`itemsOfTurn`) did to the project. */
export function turnSummary(items: readonly ChatItem[]): TurnSummary {
  const files = new Map<string, number>()
  const added: string[] = []
  const sketched: string[] = []
  const resketched: string[] = []
  const resolved: string[] = []
  let from: number | undefined
  let to: number | undefined
  let failed = 0
  let built = 0
  let lastFailed = false
  const first = new Map<string, Verdict>()
  const last = new Map<string, Verdict>()

  for (const item of items) {
    if (item.kind === 'context' && !item.forTool) {
      // The build on show when the prompt was sent: the start of "r1 → r3".
      if (from === undefined && item.revision !== undefined) from = item.revision
    } else if (item.kind === 'context' && !item.byPerson) {
      if (item.buildState === 'ok') {
        built += 1
        lastFailed = false
        if (item.revision !== undefined) to = item.revision
      } else if (item.buildState === 'failed') {
        built += 1
        failed += 1
        lastFailed = true
      }
      for (const change of item.digest?.dimensions ?? []) {
        if (!first.has(change.id)) first.set(change.id, change.was)
        last.set(change.id, change.now)
      }
    } else if (item.kind === 'tool' && item.state === 'done') {
      if (WRITES.has(item.name)) {
        const path = pathOf(item.input)
        if (path) files.set(path, (files.get(path) ?? 0) + 1)
      } else if (item.name === `${TORNO_TOOL_PREFIX}add_mark`) {
        const id = placedMark(item.result)
        if (id && !added.includes(id)) added.push(id)
      } else if (item.name === `${TORNO_TOOL_PREFIX}add_sketch`) {
        const [, how, id] = /^(made|replaced) in layout [^\n]*?: (M\d+)\b/.exec(item.result ?? '') ?? []
        const into = how === 'made' ? sketched : how === 'replaced' ? resketched : undefined
        if (id && into && !into.includes(id)) into.push(id)
      } else if (item.name === `${TORNO_TOOL_PREFIX}resolve_mark`) {
        const id = typeof item.input === 'object' && item.input !== null ? (item.input as { id?: unknown }).id : undefined
        if (typeof id === 'string' && /^M\d+$/.test(id) && item.result?.startsWith('resolved:') && !resolved.includes(id)) resolved.push(id)
      }
    }
  }

  const dimensions = [...last].flatMap(([id, now]) => (first.get(id) === now ? [] : [{ id, now }]))
  return {
    files: [...files].map(([path, edits]) => ({ path, edits })),
    ...(built > 0 ? { builds: { ...(from !== undefined ? { from } : {}), ...(to !== undefined ? { to } : {}), failed, lastFailed } } : {}),
    added,
    sketched,
    resketched,
    resolved,
    dimensions,
    parts: partChanges(items)
  }
}

/** Whether the turn changed anything this can say. */
export const isEmpty = (s: TurnSummary): boolean => s.files.length === 0 && !s.builds && s.added.length === 0 && s.sketched.length === 0 && s.resketched.length === 0 && s.resolved.length === 0 && s.dimensions.length === 0

/** The most of a kind named one by one; the rest are counted. */
const MOST = 3

const list = (names: string[], what: string): string => (names.length <= MOST ? names.join(', ') : `${names.slice(0, MOST).join(', ')} and ${names.length - MOST} more ${what}`)

/** What a dimension's verdict became, in words. */
const NOW: Record<Verdict, string> = { pass: 'now passes', fail: 'now fails', none: 'is no longer measured' }

/** The account as short phrases, one for each thing: `hollow.py edited ×2`, `r1 → r3 ok`, `resolved M1`, `added M5`, `drew a sketch M9`, `M3 now passes`. */
export function summaryParts(s: TurnSummary): string[] {
  const parts: string[] = []
  if (s.files.length > 0) {
    const names = s.files.map((f) => base(f.path))
    const times = s.files.reduce((n, f) => n + f.edits, 0)
    parts.push(s.files.length === 1 ? `${names[0]} edited${times > 1 ? ` ×${times}` : ''}` : `${list(names, 'files')} edited`)
  }
  if (s.builds) {
    const { from, to, failed, lastFailed } = s.builds
    if (lastFailed) parts.push(failed > 1 ? `${failed} builds failed` : 'build failed')
    else {
      const range = to === undefined ? 'built' : from !== undefined && from !== to ? `r${from} → r${to} ok` : `r${to} ok`
      parts.push(failed > 0 ? `${range} after ${failed} failed ${failed === 1 ? 'build' : 'builds'}` : range)
    }
  }
  if (s.resolved.length > 0) parts.push(`resolved ${list(s.resolved, 'marks')}`)
  if (s.added.length > 0) parts.push(`added ${list(s.added, 'marks')}`)
  if (s.sketched.length > 0) parts.push(s.sketched.length === 1 ? `drew a sketch ${s.sketched[0]}` : `drew sketches ${list(s.sketched, 'sketches')}`)
  if (s.resketched.length > 0) parts.push(`drew ${list(s.resketched, 'sketches')} again`)
  for (const d of s.dimensions.slice(0, MOST)) parts.push(`${d.id} ${NOW[d.now]}`)
  if (s.dimensions.length > MOST) parts.push(`${s.dimensions.length - MOST} more dimensions changed`)
  return parts
}

/**
 * What the turn's builds did to each part, taken together: the volume and the face count the build the turn began with
 * had, against those of the last build that worked, from the kernel's numbers in the digests (`DigestPart`), never
 * worked out again here. A part is listed only where one of the two is another; its volume is not exact where the
 * volume of any of its steps is not. Empty when no build of the turn worked, or when the builds left every part as it was.
 */
export function partChanges(items: readonly ChatItem[]): PartChange[] {
  const first = new Map<string, DigestPart>()
  const last = new Map<string, DigestPart>()
  const inexact = new Set<string>()
  for (const item of items) {
    if (item.kind !== 'context' || !item.forTool || item.byPerson || item.buildState !== 'ok') continue
    for (const part of item.digest?.parts ?? []) {
      const key = `${part.layout}/${part.name}`
      if (!part.volume.exact) inexact.add(key)
      if (!first.has(key)) first.set(key, part)
      last.set(key, part)
    }
  }
  const out: PartChange[] = []
  for (const [key, was] of first) {
    const now = last.get(key)!
    const [v0, v1] = [was.volume.before, now.volume.after]
    if (v0 === v1 && was.faces.before === now.faces.after) continue
    out.push({ id: `${now.layout}:${now.name}`, name: now.name, layout: now.layout, volume: { before: v0, after: v1, exact: !inexact.has(key) }, faces: { before: was.faces.before, after: now.faces.after } })
  }
  return out
}

/** `partChanges` in words, one line for each part: `tub: volume ≈ 28400 → 25560 mm³ (-10 %), faces 14 → 22`. */
export function netParts(items: readonly ChatItem[]): string[] {
  const lines: string[] = []
  for (const part of partChanges(items)) {
    const said: string[] = []
    const { before: v0, after: v1 } = part.volume
    if (v0 !== v1) {
      const percent = v0 === 0 ? '' : ` (${v1 > v0 ? '+' : ''}${number(((v1 - v0) / v0) * 100)} %)`
      said.push(`volume ${part.volume.exact ? '' : '≈ '}${number(v0)} → ${number(v1)} mm³${percent}`)
    }
    if (part.faces.before !== part.faces.after) said.push(`faces ${part.faces.before} → ${part.faces.after}`)
    lines.push(`${part.name}: ${said.join(', ')}`)
  }
  return lines
}
