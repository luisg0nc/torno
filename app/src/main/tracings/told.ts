import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Tracing, TracingsFile } from '../../shared/tracings'
import { ensureIgnored } from '../ignored'
import { FOLDER, ownTorno, writeOwn } from '../own'

// What Claude was last told of each tracing, for the one line every prompt carries when the project has tracings: `tracings: T1, T2
// (1 changed since you were told: T1's photo was lined up again). Read them with tracings.` The line is built by `tracingsLine` from
// the tracings file and what the last delivered prompt told (`.torno/tracings/told.json`, git-ignored): kept only once the prompt that
// carried the line has been delivered (`onDelivered`), as the board's `told.json` is, so a prompt that never leaves says it again.

/** The most the line takes of a prompt, in characters. Its names are counted, so it holds with the most tracings a project may have. */
export const TRACINGS_LIMIT = 500
/** How many tracings the line names, and how many of what changed; the rest are counted. */
const MOST_IDS = 8
const MOST_NEWS = 3

const TOLD = ['tracings', 'told.json'] as const
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 8)

/** What of a tracing Claude is told, one hash each: a part changes alone, so the line can say which. Not the fade, nor what is hidden. */
const PARTS = ['name', 'plane', 'lost', 'layers', 'photo'] as const
type Part = (typeof PARTS)[number]

const NO_PHOTO = hash('none')

function frameOf(t: Tracing): unknown {
  const from = t.plane.from
  // A face tracing's plane is moved after each build and its ref may be renumbered, so the origin is not what is told, nor the build a ref is of.
  if (from.kind === 'face') return [t.plane.label, from.kind, from.ref, t.plane.x, t.plane.y]
  if (from.kind === 'section') return [t.plane.label, from.kind, from.origin, from.normal, t.plane.x, t.plane.y]
  return [t.plane.label, from.kind, from.axis, from.offset, t.plane.x, t.plane.y]
}

/** How a photo is lined up, or that it is not: the clicks and what they gave, never the fade or whether it is hidden. */
function photoOf(t: Tracing): string {
  const p = t.photo
  if (!p) return NO_PHOTO
  return hash([p.sha256, p.method, p.pairs, p.transform ?? null, p.scale ?? null, p.angle ?? null, p.fit ?? null])
}

const partsOf = (t: Tracing): Record<Part, string> => ({
  name: hash(t.name),
  plane: hash(frameOf(t)),
  lost: hash(t.lost ?? null),
  layers: hash(t.layers.map((l) => [l.id, l.name, l.colour, l.revision, l.by])),
  photo: photoOf(t)
})

/** What is kept of a tracing, as the line will have told it: the hashes of its parts, joined. */
const keptOf = (t: Tracing): string => PARTS.map((part) => partsOf(t)[part]).join('.')

/** The parts that differ from what was kept, or null when what was kept is not of this shape (it all counts as news then). */
function changedParts(t: Tracing, before: string): Part[] {
  const was = before.split('.')
  const now = partsOf(t)
  if (was.length !== PARTS.length) return [...PARTS]
  return PARTS.filter((part, i) => was[i] !== now[part])
}

const linedUp = (t: Tracing): boolean => t.photo?.transform !== undefined && t.photo.scale !== undefined

/** One tracing's news in a phrase: the one thing that changed in words, or what changed when it is several. */
function newsOf(t: Tracing, before: string): string | null {
  const changed = changedParts(t, before)
  if (changed.length === 0) return null
  if (changed.length > 1) return `${t.id} changed: ${changed.map((part) => (part === 'lost' ? 'its face' : part)).join(', ')}`
  switch (changed[0]) {
    case 'name':
      return `${t.id} was renamed`
    case 'plane':
      return `${t.id}'s plane changed`
    case 'lost':
      return t.lost ? `${t.id}'s face is no longer in its plane` : `${t.id}'s face is back in its plane`
    case 'layers':
      return `${t.id}'s layers changed`
    case 'photo':
      if (before.split('.')[4] === NO_PHOTO) return `${t.id} got a photo`
      if (t.photo === undefined) return `${t.id}'s photo was removed`
      return linedUp(t) ? `${t.id}'s photo was lined up again` : `${t.id}'s photo changed`
  }
}

const listed = (names: readonly string[], most: number, separator = ', '): string => `${names.slice(0, most).join(separator)}${names.length > most ? ` and ${names.length - most} more` : ''}`

export interface TracingsLine {
  /** The line, or '' when the project has no tracings. */
  line: string
  /** What the agent will have been told of each tracing once the prompt is delivered: kept by whoever delivers it (`markTracingsTold`). */
  told: Record<string, string>
}

/**
 * The one line every prompt carries when the project has tracings: their ids, and what changed since the agent was last told (`told`, as
 * `readTracingsTold` read it): a tracing new to it, renamed, in another plane, with other layers, with a photo lined up again, with its face
 * gone or back, or removed. Nothing for a project with none, but once when it was told of some: `tracings: none (T1 was removed)`.
 */
export function tracingsLine(file: TracingsFile, told: Readonly<Record<string, string>>, toolName: (tool: string) => string): TracingsLine {
  if (file.tracings.length === 0) {
    // What it was told of is gone: said once, and the empty record is kept, so that the next prompt says nothing.
    const gone = Object.keys(told)
    return { line: gone.length === 0 ? '' : `tracings: none (${listed(gone.map((id) => `${id} was removed`), MOST_NEWS, '; ')})`, told: {} }
  }
  const kept: Record<string, string> = {}
  const news: string[] = []
  for (const t of file.tracings) {
    kept[t.id] = keptOf(t)
    const before = told[t.id]
    if (before === undefined) news.push(`${t.id} is new`)
    else {
      const said = newsOf(t, before)
      if (said !== null) news.push(said)
    }
  }
  const here = new Set(file.tracings.map((t) => t.id))
  for (const id of Object.keys(told)) if (!here.has(id)) news.push(`${id} was removed`)
  const everyNew = file.tracings.every((t) => told[t.id] === undefined) && Object.keys(told).every((id) => here.has(id))
  const ids = listed(
    file.tracings.map((t) => t.id),
    MOST_IDS
  )
  const changed = news.length === 0 ? 'none changed since you were told' : everyNew ? 'new to you' : `${news.length} changed since you were told: ${listed(news, MOST_NEWS, '; ')}`
  return { line: `tracings: ${ids} (${changed}). Read them with ${toolName('tracings')}.`, told: kept }
}

/** What the last delivered prompt told of each tracing of a project (`.torno/tracings/told.json`). Empty when there is none, or it is not a record of strings: everything is then news. */
export async function readTracingsTold(dir: string): Promise<Record<string, string>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(dir, FOLDER, ...TOLD), 'utf8'))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === 'string'))
  } catch {
    return {}
  }
}

/** Keeps what a delivered prompt told of the tracings: whole or not at all, in a folder of torno's own, and ignored by git before it is there. */
export async function markTracingsTold(dir: string, told: Record<string, string>): Promise<void> {
  await ownTorno(dir, TOLD[0])
  await ensureIgnored(dir, [TOLD.join('/')])
  await writeOwn(dir, TOLD.join('/'), `${JSON.stringify(told, null, 2)}\n`)
}
