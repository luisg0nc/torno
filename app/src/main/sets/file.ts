import { copyFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Vec3 } from '../../shared/marks'
import {
  GEOM_TYPES,
  MOST_SET_MEMBERS,
  SET_COLOURS,
  SET_COMMENT_MAX,
  SET_ID,
  STROKE_REF,
  type NamedSet,
  type SetMember,
  type SetsFile,
  finiteVec3,
  memberRef,
  parseSelectorForm,
  parseSetRef,
  setNameError,
  slugOf
} from '../../shared/sets'
import { FOLDER, ownTorno, writeOwn } from '../own'

const NAME = 'sets.json'
/** The longest layout name a set may carry. */
const MAX_LAYOUT = 200

/**
 * The sets of the object in `dir`. A missing file is no sets, and nothing is written. A file that is not JSON, or has no
 * list of sets, is copied aside as `sets.json.corrupt-<time>` and a new list started whose ids go on past every `N<n>` the
 * old text names; a file some of whose sets or members could not be kept is copied aside as `sets.json.dropped-<time>` and
 * rewritten with the rest. Either way `problem` says what happened, once: the next read finds nothing wrong.
 */
export async function loadSetsFile(dir: string, now: () => Date = () => new Date()): Promise<{ file: SetsFile; problem?: string }> {
  const path = join(dir, FOLDER, NAME)
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { file: { next: 1, sets: [] } }
    throw e
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    // not JSON
  }
  const stamp = now().toISOString().replace(/[:.]/g, '-')
  if (!isRecord(parsed) || !Array.isArray(parsed.sets)) {
    await ownTorno(dir)
    const aside = `${NAME}.corrupt-${stamp}`
    // Copied, not moved: were the write below to fail, the next read must find the bad file again, and its ids with it.
    await copyFile(path, join(dir, FOLDER, aside))
    const file: SetsFile = { next: salvagedNext(text, parsed), sets: [] }
    await writeOwn(dir, NAME, textOf(file))
    return { file, problem: `The named sets file of this project could not be read. It was kept as ${FOLDER}/${aside}, and a new list was started.` }
  }
  const read = sanitiseSetsFile(parsed)
  if (read.problem === undefined) return { file: read.file }
  await ownTorno(dir)
  const aside = `${NAME}.dropped-${stamp}`
  await copyFile(path, join(dir, FOLDER, aside))
  await writeOwn(dir, NAME, textOf(read.file))
  return { file: read.file, problem: `${read.problem} The file as it was is kept as ${FOLDER}/${aside}.` }
}

/** Writes `<dir>/.torno/sets.json`, creating the folder. Readers see the old file or the new one, never half of one. */
export function saveSetsFile(dir: string, file: SetsFile): Promise<void> {
  return writeOwn(dir, NAME, textOf(sanitiseSetsFile(file).file))
}

function textOf(file: SetsFile): string {
  return `${JSON.stringify(file, null, 2)}\n`
}

/**
 * Keeps what a sets file may hold. A set with a bad id, name or layout goes, and so does a member that is malformed; a
 * selector that is no form of the kernel's grammar goes and its member stays (it is found by its point and normal); of two
 * sets of one name, the first stays. The colour is put into 0 to 7. `next` is past every `N<n>` the file names, kept or not:
 * an id that was given out is never given out again. `problem` says what was left out, or is absent when nothing was.
 */
export function sanitiseSetsFile(raw: unknown): { file: SetsFile; problem?: string } {
  const said: string[] = []
  let next = 1
  const sets: NamedSet[] = []
  if (isRecord(raw)) {
    next = idNumber(raw.next) ?? 1
    const list = Array.isArray(raw.sets) ? raw.sets : []
    let leftOut = 0
    let members = 0
    for (const entry of list) {
      const given = isRecord(entry) && typeof entry.id === 'string' ? /^N(\d{1,15})$/.exec(entry.id) : null
      if (given && idNumber(Number(given[1])) !== undefined) next = Math.max(next, Number(given[1]) + 1)
      const read = readSet(entry)
      if (!read) {
        leftOut += 1
        continue
      }
      members += read.dropped
      const same = sets.find((s) => s.slug === read.set.slug)
      if (same) {
        said.push(`${read.set.id} was left out: it has the name of ${same.id}.`)
        continue
      }
      if (sets.some((s) => s.id === read.set.id)) {
        leftOut += 1
        continue
      }
      sets.push(read.set)
    }
    if (leftOut > 0) said.unshift(`${leftOut} named ${leftOut === 1 ? 'set' : 'sets'} in the named sets file of this project ${leftOut === 1 ? 'was' : 'were'} not whole, and left out.`)
    if (members > 0) said.push(`${members} ${members === 1 ? 'member' : 'members'} of the named sets ${members === 1 ? 'was' : 'were'} not whole, and left out.`)
  }
  const problem = said.length > 0 ? said.join(' ') : undefined
  return { file: { next, sets }, ...(problem === undefined ? {} : { problem }) }
}

/** A set with only the fields a set has, and how many of its members were left out; null when it is not a set. */
function readSet(entry: unknown): { set: NamedSet; dropped: number } | null {
  if (!isRecord(entry)) return null
  if (typeof entry.id !== 'string' || !SET_ID.test(entry.id)) return null
  if (typeof entry.name !== 'string' || setNameError(entry.name, []) !== null) return null
  if (typeof entry.layout !== 'string' || entry.layout === '' || entry.layout.length > MAX_LAYOUT) return null
  const name = entry.name.trim()
  const list = Array.isArray(entry.members) ? entry.members : []
  const members: SetMember[] = []
  const seen = new Set<string>()
  let dropped = 0
  for (const raw of list) {
    const member = readMember(raw)
    if (!member || seen.has(memberRef(member)) || members.length >= MOST_SET_MEMBERS) {
      dropped += 1
      continue
    }
    seen.add(memberRef(member))
    members.push(member)
  }
  const colour = typeof entry.colour === 'number' && Number.isFinite(entry.colour) ? Math.min(SET_COLOURS - 1, Math.max(0, Math.round(entry.colour))) : 0
  const by = entry.by === 'agent' ? 'agent' : 'person'
  return {
    set: {
      id: entry.id,
      name,
      slug: slugOf(name),
      comment: typeof entry.comment === 'string' ? entry.comment.slice(0, SET_COMMENT_MAX) : '',
      colour,
      layout: entry.layout,
      by,
      ...(by === 'agent' && entry.proposed === true ? { proposed: true as const } : {}),
      members,
      createdAt: typeof entry.createdAt === 'string' && !Number.isNaN(Date.parse(entry.createdAt)) ? entry.createdAt : new Date(0).toISOString()
    },
    dropped
  }
}

/** A member with only the fields its kind has; null when it is not one. A bad selector or type is left off, and the member stays. */
function readMember(raw: unknown): SetMember | null {
  if (!isRecord(raw)) return null
  if (typeof raw.stroke === 'string') return STROKE_REF.test(raw.stroke) ? { stroke: raw.stroke } : null
  if (typeof raw.part === 'string') return raw.part !== '' && raw.part.length <= MAX_LAYOUT && parseSetRef(raw.part)?.kind === 'part' ? { part: raw.part, ...(raw.state === 'lost' ? { state: 'lost' as const } : {}) } : null
  const face = typeof raw.face === 'string'
  const ref = face ? raw.face : raw.edge
  if (typeof ref !== 'string') return null
  const parsed = parseSetRef(ref)
  if (parsed?.kind !== (face ? 'face' : 'edge')) return null
  const point = finiteVec3(raw.point)
  if (!point) return null
  const normal = raw.normal === undefined ? undefined : finiteVec3(raw.normal)
  if (face && normal === null) return null
  const arranged = raw.arranged === undefined ? undefined : (finiteVec3(raw.arranged) ?? undefined)
  const selector = parseSelectorForm(raw.selector, face ? 'face' : 'edge') ?? undefined
  const type = typeof raw.type === 'string' && GEOM_TYPES.includes(raw.type) ? raw.type : undefined
  const common = { ...(type === undefined ? {} : { type }), ...(selector === undefined ? {} : { selector }), point: point as Vec3, ...(arranged === undefined ? {} : { arranged }), state: raw.state === 'lost' ? ('lost' as const) : ('ok' as const) }
  if (!face) return { edge: ref, ...common }
  return { face: ref, ...common, ...(normal ? { normal } : {}) }
}

/** Where the ids of a fresh list start after a file that could not be read: past its `next` and every `N<n>` its text names. */
function salvagedNext(text: string, parsed: unknown): number {
  let next = (isRecord(parsed) ? idNumber(parsed.next) : undefined) ?? 1
  for (const match of text.matchAll(/"next"\s*:\s*(\d+)/g)) next = Math.max(next, idNumber(Number(match[1])) ?? 1)
  for (const match of text.matchAll(/"N(\d+)"/g)) next = Math.max(next, (idNumber(Number(match[1])) ?? 0) + 1)
  return next
}

/** A number an id can have, or a file can say is next: a whole one from 1 that still counts exactly. */
function idNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value < Number.MAX_SAFE_INTEGER ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
