import { MOST_SET_MEMBERS, SET_ID, SET_COLOURS, type MemberAsk, type NamedSet, type NewSet, type SelectorFound, type SetEdit, finiteVec3, memberRef, parseSetRef } from '../../shared/sets'
import type { ObjectInfo } from '../../shared/workspace'
import { Refusal } from '../refusal'
import type { LastBuild, SetStore } from './store'

// What the window may ask of the named sets (`sets:list`, `sets:make`, `sets:edit`, `sets:remove`, `sets:restore`,
// `sets:accept`, `sets:dismiss`), as handlers that do not need Electron (`main/ipc.ts` registers them). Everything the window
// says is untrusted: a project is one that is open, a set is `N<n>`, an ask has exactly the keys it may have, a colour is a
// whole number from 0 to 7. What only main says of a set or a member (`by`, `proposed`, `state`, `type`, `selector`,
// `arranged`, the slug) is never taken from the window. A set the window makes is the person's; only the agent proposes one.

export interface SetIpcDeps {
  sets: Pick<SetStore, 'list' | 'make' | 'edit' | 'remove' | 'restore' | 'accept' | 'dismiss' | 'withSelectors'>
  /** A project of the open workspace. */
  object(objectId: string): ObjectInfo | undefined
  /** The last successful build of a project: its number and its scene. */
  build(objectId: string): LastBuild | undefined
  /** `Builds.query`: asks the kernel about the last build. */
  query<T = unknown>(objectId: string, name: string, args: object): Promise<T>
}

const NOT_OPEN = 'That project is not open.'
const NEW_KEYS = ['name', 'comment', 'colour', 'layout', 'members']
const EDIT_KEYS = ['name', 'comment', 'colour', 'add', 'take', 'repick']
const MAX_TEXT = 4000

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** The faces and edges of a set that the kernel has not yet told a type of, by part, each part's refs in order. */
function unanswered(set: NamedSet): Map<string, string[]> {
  const byPart = new Map<string, string[]>()
  for (const m of set.members) {
    if (!('face' in m || 'edge' in m) || m.type !== undefined || m.state !== 'ok') continue
    const ref = memberRef(m)
    const part = parseSetRef(ref)?.part
    if (part === undefined) continue
    byPart.set(part, [...(byPart.get(part) ?? []), ref])
  }
  return byPart
}

export function setHandlers(deps: SetIpcDeps) {
  const project = (objectId: unknown): ObjectInfo => {
    const obj = typeof objectId === 'string' ? deps.object(objectId) : undefined
    if (!obj) throw new Refusal(NOT_OPEN)
    return obj
  }

  const setId = (id: unknown): string => {
    if (typeof id !== 'string' || !SET_ID.test(id)) throw new Refusal(`${typeof id === 'string' ? id : 'That'} is not a named set of the project: a named set is N1, N2, …`)
    return id
  }

  const colour = (value: unknown): number => {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value >= SET_COLOURS) throw new Refusal(`A colour is a whole number from 0 to ${SET_COLOURS - 1}.`)
    return value
  }

  const text = (value: unknown, what: string): string => {
    if (typeof value !== 'string' || value.length > MAX_TEXT) throw new Refusal(`${what} is text of at most ${MAX_TEXT} characters.`)
    return value
  }

  /** One member asked for: a ref with where it was pointed, or a stroke, and nothing else. */
  const memberAsk = (raw: unknown): MemberAsk => {
    if (!isRecord(raw)) throw new Refusal('A member of a named set is a ref, or a stroke.')
    const keys = Object.keys(raw)
    if (keys.length === 1 && keys[0] === 'stroke') return { stroke: text(raw.stroke, 'A stroke') }
    for (const key of keys) if (key !== 'ref' && key !== 'point' && key !== 'normal') throw new Refusal(`${key} is not part of a member of a named set: it is a ref, with the point and normal it was pointed at.`)
    const ref = text(raw.ref, 'A ref')
    const out: { ref: string; point?: [number, number, number]; normal?: [number, number, number] } = { ref }
    if (raw.point !== undefined) {
      const point = finiteVec3(raw.point)
      if (!point) throw new Refusal(`The point of ${ref} is three numbers.`)
      out.point = point
    }
    if (raw.normal !== undefined) {
      const normal = finiteVec3(raw.normal)
      if (!normal) throw new Refusal(`The normal of ${ref} is three numbers.`)
      out.normal = normal
    }
    return out
  }

  const memberAsks = (raw: unknown, what: string): MemberAsk[] => {
    if (!Array.isArray(raw) || raw.length > MOST_SET_MEMBERS) throw new Refusal(`${what} is a list of at most ${MOST_SET_MEMBERS} members.`)
    return raw.map(memberAsk)
  }

  /** The follow-up of a change, which is not waited for: tests and the app's quit wait for `idle`. */
  const pending = new Set<Promise<void>>()

  /**
   * The second change after a set is made or given members: the kernel's `selectors` for each part's new faces and edges (one
   * query for each part), then `withSelectors`. The build is read before the asking: a build that lands meanwhile makes the
   * answer one the store drops. A kernel that cannot say leaves the members held by their point and normal.
   */
  const askSelectors = async (obj: ObjectInfo, revision: number | undefined, set: NamedSet): Promise<void> => {
    if (revision === undefined) return
    const found: SelectorFound[] = []
    try {
      for (const [, refs] of unanswered(set)) {
        const reply = await deps.query<{ selectors?: SelectorFound[] }>(obj.id, 'selectors', { layout: set.layout, refs })
        if (Array.isArray(reply.selectors)) found.push(...reply.selectors)
      }
      if (found.length > 0) await deps.sets.withSelectors(obj.id, set.id, revision, found)
    } catch {
      // The kernel could not say (or the project was left): the members are held by where they were pointed, and refound by that.
    }
  }

  const followed = (obj: ObjectInfo, revision: number | undefined, set: NamedSet): void => {
    const run = askSelectors(obj, revision, set).finally(() => pending.delete(run))
    pending.add(run)
  }

  return {
    async list(objectId: string): Promise<NamedSet[]> {
      return deps.sets.list(project(objectId).id)
    },

    /** Makes the person's set at once, and then asks for the selectors of its faces and edges and writes them in a second change. */
    async make(objectId: string, raw: NewSet): Promise<NamedSet> {
      const obj = project(objectId)
      if (!isRecord(raw)) throw new Refusal('That is not a named set.')
      for (const key of Object.keys(raw)) if (!NEW_KEYS.includes(key)) throw new Refusal(`${key} is not part of a named set that is made: the name, comment, colour, layout and members are.`)
      const ask: NewSet = {
        name: text(raw.name, 'A name'),
        comment: raw.comment === undefined ? '' : text(raw.comment, 'A comment'),
        ...(raw.colour === undefined ? {} : { colour: colour(raw.colour) }),
        layout: text(raw.layout, 'A layout'),
        members: memberAsks(raw.members, 'members')
      }
      const revision = deps.build(obj.id)?.revision
      const set = await deps.sets.make(obj.id, ask, 'person')
      followed(obj, revision, set)
      return set
    },

    /** Changes a set: the name, the comment, the colour, members added and taken, lost ones re-picked. What was added gets its selectors. */
    async edit(objectId: string, id: string, raw: SetEdit): Promise<NamedSet> {
      const obj = project(objectId)
      const named = setId(id)
      if (!isRecord(raw)) throw new Refusal('That is not a change to a named set.')
      for (const key of Object.keys(raw)) if (!EDIT_KEYS.includes(key)) throw new Refusal(`${key} of a named set cannot be changed: the name, comment, colour and members can.`)
      const edit: SetEdit = {}
      if (raw.name !== undefined) edit.name = text(raw.name, 'A name')
      if (raw.comment !== undefined) edit.comment = text(raw.comment, 'A comment')
      if (raw.colour !== undefined) edit.colour = colour(raw.colour)
      if (raw.add !== undefined) edit.add = memberAsks(raw.add, 'add')
      if (raw.repick !== undefined) edit.repick = memberAsks(raw.repick, 'repick')
      if (raw.take !== undefined) {
        if (!Array.isArray(raw.take) || raw.take.length > MOST_SET_MEMBERS || !raw.take.every((t) => typeof t === 'string' && t.length <= MAX_TEXT)) throw new Refusal('take is a list of the refs of members.')
        edit.take = [...(raw.take as string[])]
      }
      const revision = deps.build(obj.id)?.revision
      const set = await deps.sets.edit(obj.id, named, edit)
      if (edit.add !== undefined || edit.repick !== undefined) followed(obj, revision, set)
      return set
    },

    async remove(objectId: string, id: string): Promise<void> {
      await deps.sets.remove(project(objectId).id, setId(id))
    },

    /** Puts back the set deleted last, whole and with its number. Only that one, and once. */
    async restore(objectId: string, id: string): Promise<NamedSet> {
      return deps.sets.restore(project(objectId).id, setId(id))
    },

    /** The person accepts the agent's proposal. Refused for a set that is not one. */
    async accept(objectId: string, id: string): Promise<NamedSet> {
      return deps.sets.accept(project(objectId).id, setId(id))
    },

    /** The person turns the proposal down: the set is deleted. Refused for a set that is not one. */
    async dismiss(objectId: string, id: string): Promise<void> {
      await deps.sets.dismiss(project(objectId).id, setId(id))
    },

    /** Resolves once every follow-up asked for the selectors has ended. */
    async idle(): Promise<void> {
      while (pending.size > 0) await Promise.allSettled([...pending])
    }
  }
}
