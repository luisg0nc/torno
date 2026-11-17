import { isDeepStrictEqual } from 'node:util'
import type { Vec3 } from '../../shared/marks'
import { GEOM_TYPES, type NamedSet, type SelectorFound, type SetMember, finiteVec3 } from '../../shared/sets'
import type { Builds } from '../builds'
import { isBusy } from '../kernel/client'
import { EDGE_TOLERANCE_MM, tolerance } from '../marks/tolerance'
import type { Checked } from '../marks/reanchor'
import type { LastBuild, Refound, SetStore } from './store'

export type { Refound }

export interface RefindDeps {
  sets: Pick<SetStore, 'list' | 'refound' | 'withSelectors' | 'refsOf'>
  query: Builds['query']
  /** The last successful build of an object: a new one has another scene. */
  scene(objectId: string): LastBuild | undefined
  /** Told, once per call, what could not be checked. */
  log?(message: string): void
}

/** What the kernel is asked of one face or edge of a set (`refind` in `kernel/src/torno_kernel/refind.py`). */
interface AskedMember {
  part: string
  kind: 'face' | 'edge'
  type?: string
  form?: unknown
  point: Vec3
  normal?: Vec3
  within: number
}

/** A member that is asked about: where it is in its set, and how far its part is now spread. */
interface Asking {
  set: number
  member: number
  asked: AskedMember
  spread: Vec3
}

const NOT_SPREAD: Vec3 = [0, 0, 0]
/** An answer within this of what was stored is the same place: float noise is not a move, and writes nothing. */
const SAME = 1e-6

/**
 * Find the members of the named sets of an object again on its last successful build: one `refind` query per layout that
 * has sets, for every face and edge of the sets of that layout, and one write of what changed (`SetStore.refound`). A set
 * belongs to one layout, so it is asked of that layout alone.
 *
 * A member of a part that the build spread otherwise than the member records (`arranged`: a print layout sets its parts
 * side by side) is asked about at its point moved by the difference, as `reanchorAll` moves a mark, and is written
 * recording the spread it was found in. A face is told with how far the kernel may look (`tolerance` of its part's box), an
 * edge with `EDGE_TOLERANCE_MM`. What the kernel says is `selector` or `nearest` for a member it found (the ref is that of
 * the build now, and the member is `ok`), or `lost`: then it keeps its last point and normal, and the build that gives its
 * face back finds it again. A member the kernel ran out of time for (`unchecked`) keeps what it had, and is not said to be
 * lost.
 *
 * Not asked, and judged here: a part, which is `ok` while its layout has a part of that name; a face or edge of a part that
 * the layout lacks, or of a layout the build lacks, which is `lost`. A stroke is judged from the marks, never here. A face
 * or edge asked for with no point (`held`) is looked for only once the kernel has said where it is.
 *
 * A query that fails, or an answer that is not for every member, leaves the members it was about as they were and is
 * logged, once for the whole call. When a newer build arrives meanwhile everything is dropped, as for the marks; and the
 * store passes over a set that was edited meanwhile. Resolves true when every member could be looked at (the sets are then
 * refound against the build: `SetStore.refoundRevision`), and false, or `busy` when that was because the worker was
 * still busy, when some could not.
 */
export async function refindAll(deps: RefindDeps, objectId: string): Promise<Checked> {
  const last = deps.scene(objectId)
  if (!last) return true
  const { scene, revision } = last
  const superseded = (): boolean => deps.scene(objectId)?.scene !== scene
  const sets = await deps.sets.list(objectId)
  if (superseded()) return true
  // A set whose refs are of an earlier build than this one has any member still held on it for a build it has been through.
  const refs = deps.sets.refsOf(objectId)

  const parts = (layout: string, name: string) => scene.parts.find((p) => p.layout === layout && p.name === name)
  const failures: string[] = []
  let busy = false
  let unchecked = 0

  /** Each set's members as this build leaves them, to be refined by what the kernel answers. */
  const next: SetMember[][] = sets.map((set) => set.members.map((m) => judgedHere(set, m, scene, (refs[set.id] ?? -1) < revision)))
  /** By set, the members the kernel gave an answer for in this run: only those have the refs of this build. */
  const answeredOf: Array<Set<number>> = sets.map(() => new Set<number>())
  const askings = new Map<string, Asking[]>()
  sets.forEach((set, s) => {
    if (!scene.layouts.includes(set.layout)) return
    set.members.forEach((member, m) => {
      const asked = asking(member, parts(set.layout, partOf(member) ?? ''))
      if (asked) askings.set(set.layout, [...(askings.get(set.layout) ?? []), { set: s, member: m, ...asked }])
    })
  })

  for (const [layout, entries] of askings) {
    let said: unknown[]
    try {
      const reply = await deps.query(objectId, 'refind', { layout, members: entries.map((e) => e.asked) })
      const members = (reply as { members?: unknown } | null)?.members
      if (!Array.isArray(members) || members.length !== entries.length) throw new Error('the kernel did not answer for each member')
      said = members
    } catch (e) {
      if (superseded()) return true
      if (isBusy(e)) busy = true
      failures.push(`layout ${layout}: ${messageOf(e)}`)
      continue
    }
    if (superseded()) return true
    entries.forEach((entry, i) => {
      const old = sets[entry.set].members[entry.member]
      const found = refound(old, entry, said[i])
      if (found === 'unchecked') unchecked += 1
      else if (typeof found === 'string') failures.push(`${sets[entry.set].id} ${refOf(old)}: ${found}`)
      else {
        next[entry.set][entry.member] = found
        answeredOf[entry.set].add(entry.member)
      }
    })
  }
  if (superseded()) return true

  // Every set it looked at, written or not: the store says which are of this build (`refsOf`) and writes those that changed.
  const changes: Refound[] = sets.map((set, s) => ({ id: set.id, was: set.members, members: next[s] }))
  const whole = failures.length === 0 && unchecked === 0
  const written = await deps.sets.refound(objectId, revision, changes, whole)
  // A member found at another ref, or moved, is of another face: the form it had was made of the face it was. Its selector is asked for again.
  const wrote = new Set(written.map((s) => s.id))
  const found = sets.flatMap((set, s) => (wrote.has(set.id) || isDeepStrictEqual(next[s], set.members) ? [{ set, was: set.members, now: next[s], answered: answeredOf[s] }] : []))
  try {
    await selectorsAgain(deps, objectId, revision, found, superseded)
  } catch (e) {
    if (!superseded()) failures.push(`selectors: ${messageOf(e)}`)
  }
  const told = [...failures, ...(unchecked > 0 ? [`${unchecked} ${unchecked === 1 ? 'member was' : 'members were'} not looked at, the query ran out of time`] : [])]
  if (told.length > 0) (deps.log ?? console.error)(`cannot refind the named sets of ${objectId} against its last build: ${told.join('; ')}`)
  return whole ? true : busy ? 'busy' : false
}

/**
 * The second change after a refind: for each set looked at that was not edited meanwhile, the members that are now at another ref
 * than they were (found `nearest`, or by a selector that gives another face), or that moved, or that the kernel was never asked
 * for (made on an earlier build, so that their refs were not asked about then), and that the kernel answered for in this run, have the kernel's `selectors` asked of them, one
 * query for each layout and part, and the answers are written with `withSelectors`, as when a set is made: a member that is given
 * no form has none. The store drops an answer for a build that is no longer the last. Not asked for a member that was lost.
 */
async function selectorsAgain(
  deps: RefindDeps,
  objectId: string,
  revision: number,
  found: ReadonlyArray<{ set: NamedSet; was: readonly SetMember[]; now: readonly SetMember[]; answered: ReadonlySet<number> }>,
  superseded: () => boolean
): Promise<void> {
  /** By layout and part, the refs to ask of. */
  const wanted = new Map<string, { layout: string; refs: Set<string> }>()
  /** By set id, the refs of it that were asked. */
  const ofSet = new Map<string, Set<string>>()
  const near = (a: readonly number[], b: readonly number[]): boolean => a.every((c, i) => Math.abs(c - b[i]) <= SAME)
  for (const { set, was, now, answered } of found) {
    now.forEach((member, i) => {
      // A member the kernel gave no answer for (the query failed, it ran out of time) has the refs of an earlier build: never asked about.
      if (!answered.has(i)) return
      const old = was[i]
      if (!old || !('face' in member || 'edge' in member) || member.state !== 'ok') return
      const ref = refOf(member)
      const same = ref === refOf(old) && 'point' in old && near(member.point, old.point)
      // Never asked for: the kernel gave no type of it (it was made on an earlier build than the one its refs were read on).
      if (same && 'type' in old && old.type !== undefined) return
      const part = partOf(member) as string
      const key = `${set.layout}\0${part}`
      const one = wanted.get(key) ?? { layout: set.layout, refs: new Set<string>() }
      one.refs.add(ref)
      wanted.set(key, one)
      ofSet.set(set.id, (ofSet.get(set.id) ?? new Set<string>()).add(ref))
    })
  }
  const answers: SelectorFound[] = []
  for (const { layout, refs } of wanted.values()) {
    if (superseded()) return
    const reply = await deps.query<{ selectors?: unknown }>(objectId, 'selectors', { layout, refs: [...refs] })
    if (Array.isArray(reply?.selectors)) answers.push(...(reply.selectors as SelectorFound[]))
  }
  if (superseded()) return
  for (const [id, refs] of ofSet) {
    const mine = answers.filter((one) => typeof one?.ref === 'string' && refs.has(one.ref))
    if (mine.length > 0) await deps.sets.withSelectors(objectId, id, revision, mine)
  }
}

/** Has the sets of an object found again whenever one is written with refs older than the last build (`SetStore` `behind`): after a build that landed just before it, or a restore. `refind` may coalesce. */
export function followSets(store: Pick<SetStore, 'on'>, refind: (objectId: string) => void): void {
  store.on('behind', ({ objectId }) => refind(objectId))
}

const partOf = (m: SetMember): string | undefined => ('part' in m ? m.part : 'face' in m ? m.face.slice(0, m.face.lastIndexOf('/')) : 'edge' in m ? m.edge.slice(0, m.edge.lastIndexOf('/')) : undefined)

const refOf = (m: SetMember): string => ('face' in m ? m.face : 'edge' in m ? m.edge : 'part' in m ? m.part : m.stroke)

/**
 * What the build alone says of a member, with nothing asked of the kernel: a part is `ok` while the layout has one of that
 * name; a face or an edge of a part that is not there, or in a layout that is not, is `lost` (and keeps its point). A stroke
 * is as it was. A member still held is too, while the set's refs are of this build; for a later one it is `lost` (`older`): it was
 * made without a point that the kernel never gave. A face or edge of a part that is there is as it was, to be asked about.
 */
function judgedHere(set: NamedSet, member: SetMember, scene: LastBuild['scene'], older: boolean): SetMember {
  if ('stroke' in member) return member
  const part = scene.parts.find((p) => p.layout === set.layout && p.name === partOf(member))
  if ('part' in member) {
    if (part) {
      if (member.state === undefined) return member
      return { part: member.part }
    }
    return member.state === 'lost' ? member : { ...member, state: 'lost' }
  }
  // Held for a build it was not made on: the kernel never said where it is, and no build will. It is offered to be picked again.
  if (member.held === true && older) {
    const { held: _held, ...rest } = member
    return { ...rest, state: 'lost' }
  }
  if (part || member.held === true) return member
  return member.state === 'lost' ? member : { ...member, state: 'lost' }
}

/** What the kernel is asked of a face or edge, or nothing: for a part, a stroke, a member still held, or one of a part not there. */
function asking(member: SetMember, part: LastBuild['scene']['parts'][number] | undefined): Pick<Asking, 'asked' | 'spread'> | null {
  if (!part || 'stroke' in member || 'part' in member || member.held === true) return null
  const spread: Vec3 = part.arranged ?? NOT_SPREAD
  const was = member.arranged
  const point: Vec3 = was ? [member.point[0] + spread[0] - was[0], member.point[1] + spread[1] - was[1], member.point[2] + spread[2] - was[2]] : member.point
  const face = 'face' in member
  return {
    spread,
    asked: {
      part: part.name,
      kind: face ? 'face' : 'edge',
      ...(member.type === undefined ? {} : { type: member.type }),
      ...(member.selector === undefined ? {} : { form: member.selector }),
      point,
      ...(face && member.normal ? { normal: member.normal } : {}),
      within: face ? tolerance(part.bbox) : EDGE_TOLERANCE_MM
    }
  }
}

/**
 * The member as the kernel's answer for it leaves it; `unchecked` when the kernel did not look; or why the answer cannot be
 * taken (then the member stays as it was).
 */
function refound(old: SetMember, entry: Asking, answer: unknown): SetMember | 'unchecked' | string {
  if ('part' in old || 'stroke' in old) return 'it is not a face or an edge'
  const said = typeof answer === 'object' && answer !== null && !Array.isArray(answer) ? (answer as Record<string, unknown>) : null
  if (!said) return 'the answer is not an object'
  if (said.found === 'lost') {
    if (said.unchecked === true) return 'unchecked'
    return old.state === 'lost' ? old : { ...old, state: 'lost' }
  }
  if (said.found !== 'selector' && said.found !== 'nearest') return `the answer says found: ${String(said.found)}`
  const face = 'face' in old
  const ref = said.ref
  const own = `${entry.asked.part}/`
  if (typeof ref !== 'string' || !ref.startsWith(own) || !(face ? /^F(0|[1-9]\d{0,8})$/ : /^E(0|[1-9]\d{0,8})$/).test(ref.slice(own.length))) return `the ref ${String(ref)} is not a ${face ? 'face' : 'edge'} of ${entry.asked.part}`
  const point = finiteVec3(said.point)
  if (!point) return 'the point is not three numbers'
  const sent = entry.asked.point
  const near = (a: readonly number[], b: readonly number[]): boolean => a.every((c, i) => Math.abs(c - b[i]) <= SAME)
  const type = typeof said.type === 'string' && GEOM_TYPES.includes(said.type) ? said.type : old.type
  const common = {
    ...(type === undefined ? {} : { type }),
    ...(old.selector === undefined ? {} : { selector: old.selector }),
    // A point the kernel gives back within float noise of the one it was asked about is that one: the file is not rewritten for it.
    point: near(point, sent) ? (near(sent, old.point) ? old.point : sent) : point,
    arranged: [entry.spread[0], entry.spread[1], entry.spread[2]] as Vec3,
    state: 'ok' as const
  }
  if (!face) return { edge: ref, ...common }
  const normal = finiteVec3(said.normal)
  const kept = 'normal' in old ? old.normal : undefined
  return { face: ref, ...common, ...(normal ? { normal: kept && near(normal, kept) ? kept : normal } : kept ? { normal: kept } : {}) }
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
