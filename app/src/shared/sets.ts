import type { Mark, Vec3 } from './marks'

// Named sets: faces, edges, parts and sketch strokes the person (or Claude, as a proposal) gathers under a name. The rules
// here are the pure ones both sides use: what a set is, what a name may be, what a member's ref is and how many are lost.
// Main keeps them (`main/sets/store.ts`, `.torno/sets.json`) and is their only writer.

/** A set's id: `N1`, `N2`, … given by main only and never given again. */
export const SET_ID = /^N[1-9]\d{0,14}$/
/** The longest name, in characters. */
export const SET_NAME_MAX = 40
/** How many colours a set takes from (`--set-1` to `--set-8`). */
export const SET_COLOURS = 8
/** The longest comment, in characters. */
export const SET_COMMENT_MAX = 2000
/** The most members a set holds. */
export const MOST_SET_MEMBERS = 2000
/** A stroke of a sketch as a set names it: the sketch's mark and the stroke's own id, `M7/k3`. */
export const STROKE_REF = /^M[1-9]\d{0,14}\/k[1-9]\d{0,14}$/

/** The names of the kernel's surface and curve types (`GeomType`): what a stored selector's `type` may be. */
export const GEOM_TYPES: readonly string[] = ['PLANE', 'CYLINDER', 'CONE', 'SPHERE', 'TORUS', 'BEZIER', 'BSPLINE', 'REVOLUTION', 'EXTRUSION', 'OFFSET', 'LINE', 'CIRCLE', 'ELLIPSE', 'HYPERBOLA', 'PARABOLA', 'OTHER']

/**
 * The structured form of a selector, as the kernel makes it (`selectors.py`): the same pairs of a prefix and a terminal the
 * search writes as text. It is data, never a program: the kernel writes the text from it itself. A selector that is made by
 * order has no form and is never stored.
 */
export type SelectorPrefix =
  | { by: 'type'; type: string }
  | { by: 'axis'; axis: number }
  | { by: 'at'; type: string; center: Vec3 }
  | { by: 'radius'; type: string; radius: number }
  | { by: 'size'; type: string; size: number; within: number }
export type SelectorTerminal = { only: true } | { end: number; at: number } | { group: number; at: number; then: number; thenAt: number }
export interface SelectorForm {
  of: 'faces' | 'edges'
  prefix: SelectorPrefix
  terminal: SelectorTerminal
}

export type SetMember =
  | { part: string; state?: 'lost' }
  | { face: string; type?: string; selector?: SelectorForm; point: Vec3; normal?: Vec3; arranged?: Vec3; state: 'ok' | 'lost' }
  | { edge: string; type?: string; selector?: SelectorForm; point: Vec3; arranged?: Vec3; state: 'ok' | 'lost' }
  | { stroke: string }

export interface NamedSet {
  id: string
  name: string
  /** `slugOf(name)`: the set's ref is `#<slug>`. Main's, kept beside the name. */
  slug: string
  comment: string
  /** Which of the 8 colours, 0 to 7. */
  colour: number
  /** The layout its points are in: a set belongs to one layout. */
  layout: string
  by: 'person' | 'agent'
  /** Claude's proposal, not yet accepted. Only the person's accept clears it. */
  proposed?: true
  members: SetMember[]
  createdAt: string
}

export interface SetsFile {
  next: number
  sets: NamedSet[]
}

/** A member asked for: a part, face or edge by its ref (with where the person pointed), or a stroke of a sketch. */
export type MemberAsk = { ref: string; point?: Vec3; normal?: Vec3 } | { stroke: string }

/** What the person may change of a set. `repick` replaces the members that are lost by the selection given. */
export interface SetEdit {
  name?: string
  comment?: string
  colour?: number
  add?: MemberAsk[]
  take?: string[]
  repick?: MemberAsk[]
}

/** What a named set is made of when it is asked for. */
export interface NewSet {
  name: string
  comment: string
  colour?: number
  layout: string
  members: MemberAsk[]
}

/** What the kernel's `selectors` query says of one face or edge: where it is, its type, and its selector with the form. */
export interface SelectorFound {
  ref: string
  type?: string
  center?: Vec3
  normal?: Vec3
  selector: { expression?: string; form?: unknown } | null
  selectorWhy?: string
}

/** What a set's ref says of a name: lower case, runs of white space made one `-`. `Deck face` is `#deck-face`. */
export function slugOf(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '-')
}

/**
 * Why a name will not do, in words, or null. A name is 1 to 40 characters on one line, starts with a letter and has no
 * `/`, `#` or `@`. `taken` are the names of the other sets: two names that make one ref (`Deck` and `deck`) are one name.
 */
export function setNameError(name: string, taken: readonly string[]): string | null {
  if (typeof name !== 'string') return 'A named set needs a name.'
  const trimmed = name.trim()
  if (trimmed === '') return 'A named set needs a name.'
  if (trimmed.length > SET_NAME_MAX) return `A name has at most ${SET_NAME_MAX} characters.`
  if (/[/#@]/.test(trimmed)) return 'A name has no "/", "#" or "@" in it.'
  if (/\p{C}/u.test(trimmed)) return 'A name is on one line, with no control characters.'
  if (!/^\p{L}/u.test(trimmed)) return 'A name must start with a letter.'
  const slug = slugOf(trimmed)
  if (taken.some((other) => slugOf(other) === slug)) return `#${slug} is taken`
  return null
}

/** A ref of a part, a face or an edge, taken apart. Null for any other (a tag, a set, a mark's, a stroke). */
export function parseSetRef(ref: string): { part: string; kind: 'part' } | { part: string; kind: 'face' | 'edge'; index: number } | null {
  if (typeof ref !== 'string' || ref === '') return null
  const found = /^(.+)\/([FE])(0|[1-9]\d{0,8})$/.exec(ref)
  if (found) return { part: found[1], kind: found[2] === 'F' ? 'face' : 'edge', index: Number(found[3]) }
  if (/[/#@]/.test(ref) || /^M\d+$/.test(ref)) return null
  return { part: ref, kind: 'part' }
}

/** The ref a member names: `block`, `block/F12`, `block/E40` or `M7/k3`. */
export function memberRef(m: SetMember): string {
  if ('face' in m) return m.face
  if ('edge' in m) return m.edge
  if ('stroke' in m) return m.stroke
  return m.part
}

/** Is the stroke of a member among the strokes of the marks? A stroke is lost when its sketch or its own id is not. */
export function strokeLive(stroke: string, marks: readonly Mark[]): boolean {
  const [sketch, id] = stroke.split('/')
  const mark = marks.find((m) => m.id === sketch)
  return mark?.kind === 'sketch' && mark.strokes.some((s) => (s as { id?: string }).id === id)
}

/** Is the member lost: found by no build (a part, a face, an edge), or a stroke that is no longer there? */
export function isLost(m: SetMember, marks: readonly Mark[]): boolean {
  if ('stroke' in m) return !strokeLive(m.stroke, marks)
  return m.state === 'lost'
}

export interface LostCount {
  faces: number
  edges: number
  parts: number
  strokes: number
}

/** How many members of each kind are lost: a count, not a measure. Strokes are judged by `marks`; the rest say so themselves. */
export function lostCount(set: Pick<NamedSet, 'members'>, marks: readonly Mark[]): LostCount {
  const count: LostCount = { faces: 0, edges: 0, parts: 0, strokes: 0 }
  for (const m of set.members) {
    if (!isLost(m, marks)) continue
    if ('face' in m) count.faces += 1
    else if ('edge' in m) count.edges += 1
    else if ('stroke' in m) count.strokes += 1
    else count.parts += 1
  }
  return count
}

/** `2 of 5 faces lost`, a clause for each kind that has any lost; null when nothing is. */
export function lostText(set: Pick<NamedSet, 'members'>, marks: readonly Mark[]): string | null {
  const lost = lostCount(set, marks)
  const total: LostCount = { faces: 0, edges: 0, parts: 0, strokes: 0 }
  for (const m of set.members) {
    if ('face' in m) total.faces += 1
    else if ('edge' in m) total.edges += 1
    else if ('stroke' in m) total.strokes += 1
    else total.parts += 1
  }
  const noun: Record<keyof LostCount, [string, string]> = { faces: ['face', 'faces'], edges: ['edge', 'edges'], parts: ['part', 'parts'], strokes: ['stroke', 'strokes'] }
  const said = (Object.keys(noun) as Array<keyof LostCount>).filter((k) => lost[k] > 0).map((k) => `${lost[k]} of ${total[k]} ${noun[k][total[k] === 1 ? 0 : 1]} lost`)
  return said.length > 0 ? said.join(', ') : null
}

// What a form may hold is the kernel's list, checked again here so that a file edited by hand never reaches it.

const FARTHEST = 1e9
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= FARTHEST
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)
const isAxis = (v: unknown): v is number => isInt(v) && v >= 0 && v <= 2
const isEnd = (v: unknown): v is number => v === 0 || v === -1
const isType = (v: unknown): v is string => typeof v === 'string' && GEOM_TYPES.includes(v)
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const hasKeys = (v: unknown, keys: string[]): v is Record<string, unknown> => isRecord(v) && Object.keys(v).length === keys.length && keys.every((k) => k in v)

/** Three finite numbers, or null. */
export function finiteVec3(v: unknown): Vec3 | null {
  return Array.isArray(v) && v.length === 3 && v.every((c) => typeof c === 'number' && Number.isFinite(c)) ? [v[0], v[1], v[2]] : null
}

function parsePrefix(raw: unknown): SelectorPrefix | null {
  const by = isRecord(raw) ? raw.by : undefined
  if (by === 'type' && hasKeys(raw, ['by', 'type']) && isType(raw.type)) return { by, type: raw.type }
  if (by === 'axis' && hasKeys(raw, ['by', 'axis']) && isAxis(raw.axis)) return { by, axis: raw.axis }
  if (by === 'at' && hasKeys(raw, ['by', 'type', 'center']) && isType(raw.type)) {
    const c = raw.center
    if (Array.isArray(c) && c.length === 3 && c.every(isNumber)) return { by, type: raw.type, center: [c[0], c[1], c[2]] }
  }
  if (by === 'radius' && hasKeys(raw, ['by', 'type', 'radius']) && isType(raw.type) && isNumber(raw.radius)) return { by, type: raw.type, radius: raw.radius }
  if (by === 'size' && hasKeys(raw, ['by', 'type', 'size', 'within']) && isType(raw.type) && isNumber(raw.size) && isNumber(raw.within) && raw.within > 0) return { by, type: raw.type, size: raw.size, within: raw.within }
  return null
}

function parseTerminal(raw: unknown): SelectorTerminal | null {
  if (hasKeys(raw, ['only']) && raw.only === true) return { only: true }
  if (hasKeys(raw, ['end', 'at']) && isAxis(raw.end) && isEnd(raw.at)) return { end: raw.end, at: raw.at }
  if (hasKeys(raw, ['group', 'at', 'then', 'thenAt']) && isAxis(raw.group) && isAxis(raw.then) && raw.group !== raw.then && isEnd(raw.at) && isEnd(raw.thenAt)) {
    return { group: raw.group, at: raw.at, then: raw.then, thenAt: raw.thenAt }
  }
  return null
}

/**
 * `raw` as the form of a face's or an edge's selector, checked field by field against the kernel's grammar, or null. The
 * prefixes are `type`, `axis`, `at`, `radius` and `size`; the terminals `only`, `end` and `group`. A terminal by order is
 * none, and so is text where a name or a number goes. The answer is a copy. Never throws.
 */
export function parseSelectorForm(raw: unknown, kind: 'face' | 'edge'): SelectorForm | null {
  if (!hasKeys(raw, ['of', 'prefix', 'terminal'])) return null
  const of = kind === 'face' ? 'faces' : 'edges'
  if (raw.of !== of) return null
  const prefix = parsePrefix(raw.prefix)
  const terminal = parseTerminal(raw.terminal)
  return prefix && terminal ? { of, prefix, terminal } : null
}
