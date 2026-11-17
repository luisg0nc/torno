import { isDeepStrictEqual } from 'node:util'
import type { Mark, Vec3 } from '../../shared/marks'
import type { Part, Scene } from '../../shared/scene'
import {
  MOST_SET_MEMBERS,
  SET_COLOURS,
  SET_COMMENT_MAX,
  SET_ID,
  STROKE_REF,
  type MemberAsk,
  type NamedSet,
  type NewSet,
  type SelectorFound,
  type SetEdit,
  type SetMember,
  type SetsFile,
  finiteVec3,
  isLost,
  memberRef,
  parseSelectorForm,
  parseSetRef,
  setNameError,
  slugOf,
  GEOM_TYPES
} from '../../shared/sets'
import { Refusal } from '../refusal'
import { loadSetsFile, saveSetsFile } from './file'

/** What the last successful build of an object says that a set is checked against: its number, and the parts of each layout. */
export interface LastBuild {
  revision: number
  scene: { layouts: Scene['layouts']; parts: Array<Pick<Part, 'name' | 'layout' | 'faceCount' | 'edgeCount' | 'bbox' | 'arranged'>> }
}

export interface SetStoreDeps {
  dirOf(objectId: string): string | undefined
  now?(): Date
  /** The last successful build of an object, or undefined when it has none. */
  scene(objectId: string): LastBuild | undefined
  /** The marks of an object, for a stroke a set names. Absent: no stroke can be checked, and none is taken. */
  marks?(objectId: string): Promise<readonly Mark[]>
}

/** What a refind made of the members of one set: they are written only if the set still has `was`. */
export type Refound = { id: string; was: SetMember[]; members: SetMember[] }

interface SetEvents {
  /** The sets of an object changed: the whole list, as it now is. */
  changed: { objectId: string; sets: NamedSet[] }
  /** Something about an object's sets file the person should know. Said once; `problem()` answers it afterwards. */
  problem: { objectId: string; message: string }
  /** Sets were refound against a build that is newer than the one their refs were of: told even when nothing was written. */
  refound: { objectId: string; revision: number }
  /** A set was written whose refs are older than the last build (or of none known): the sets of the object are to be refound. */
  behind: { objectId: string }
}

/** What an edit returns when it changed nothing. */
const UNCHANGED = Symbol('unchanged')

const EDIT_KEYS = ['name', 'comment', 'colour', 'add', 'take', 'repick'] as const
const NEW_KEYS = ['name', 'comment', 'colour', 'layout', 'members'] as const

/**
 * The named sets of the objects of the open workspace, and the only writer of their `.torno/sets.json`. An object's sets
 * are read once and kept in memory; what is done to them is done one thing at a time per object, each change written
 * (atomically) before it is told. Every method rejects for an object whose folder is not known, and refuses in words what
 * cannot be done (`Refusal`).
 */
export class SetStore {
  /** By object folder: the sets file as last read or written. */
  private files = new Map<string, SetsFile>()
  /** By object folder: the last thing asked of its sets, which the next waits for. */
  private turns = new Map<string, Promise<unknown>>()
  /** By object folder: what was last found wrong with its sets file, until the person dismisses it. */
  private problems = new Map<string, string>()
  /** By object id: the set removed last, kept in memory for `restore`, with the build its refs were of. */
  private deleted = new Map<string, { set: NamedSet; refs: number | undefined }>()
  /** By object id, then set id: the build each set's refs are of. In memory only, as a mark's `checkedRevision` is: build numbers are of a session. */
  private refsAt = new Map<string, Map<string, number>>()
  /** Counts `forget`: what was read before one is not kept after it. */
  private epoch = 0
  private listeners: { [E in keyof SetEvents]: Array<(m: SetEvents[E]) => void> } = { changed: [], problem: [], refound: [], behind: [] }

  constructor(private deps: SetStoreDeps) {}

  on<E extends keyof SetEvents>(event: E, cb: (m: SetEvents[E]) => void): void {
    this.listeners[event].push(cb)
  }

  /** Forget what was read, as when the workspace is left. Files are read again when next asked for. */
  forget(): void {
    this.epoch += 1
    this.deleted.clear()
    this.files.clear()
    this.refsAt.clear()
  }

  /** Null when nothing asked of the sets is under way; else a promise that resolves once it is all written or failed. For the app, when it quits. */
  settled(): Promise<void> | null {
    if (this.turns.size === 0) return null
    const wait = async (): Promise<void> => {
      while (this.turns.size > 0) await Promise.allSettled([...this.turns.values()])
    }
    return wait()
  }

  /** The sets of an object, as they are now. */
  list(objectId: string): Promise<NamedSet[]> {
    return this.turn(objectId, (file) => structuredClone(file.sets))
  }

  /** What is wrong with the sets file of an object, as a sentence, or null: told once as a `problem` event, and the same here until dismissed. */
  problem(objectId: string): Promise<string | null> {
    return this.turn(objectId, (_file, dir) => this.problems.get(dir) ?? null)
  }

  dismissProblem(objectId: string): Promise<void> {
    return this.turn(objectId, (_file, dir) => {
      this.problems.delete(dir)
    })
  }

  /**
   * Makes a set, with the next number. Its refs are checked against the layout's last build (a part, `F<i>` below its
   * face count, `E<i>` below its edge count) and its strokes against the marks. A set made by the agent is a proposal. A
   * name whose ref is in use is refused, naming the set that has it. The selectors are asked for afterwards
   * (`withSelectors`): until then a face is held by its point and normal. `refsOf` is the build the refs given are of (the
   * window's, or the one Claude read): when that is not the last build, the sets are to be refound (`behind`).
   */
  async make(objectId: string, ask: NewSet, by: 'person' | 'agent', refsOf?: number): Promise<NamedSet> {
    const given = isRecord(ask) ? ask : {}
    for (const key of Object.keys(given)) if (!(NEW_KEYS as readonly string[]).includes(key)) throw new Refusal(`${key} is not part of a named set that is asked for`)
    const { name, comment, colour, layout, members } = given as Partial<NewSet>
    const error = typeof name !== 'string' ? 'A named set needs a name.' : setNameError(name, [])
    if (error) throw new Refusal(error)
    if (comment !== undefined && typeof comment !== 'string') throw new Refusal('The comment of a named set is text.')
    if (colour !== undefined) colourOf(colour)
    if (typeof layout !== 'string' || layout === '') throw new Refusal('A named set is of a layout: name it.')
    if (!Array.isArray(members) || members.length === 0) throw new Refusal('A named set needs at least one member.')
    const marks = await this.marksFor(objectId, members.some(isStroke))
    return this.write(objectId, (file) => {
      const clash = file.sets.find((s) => s.slug === slugOf(name as string))
      if (clash) throw new Refusal(`#${clash.slug} is taken (${clash.id})`)
      const last = this.deps.scene(objectId)
      const made: SetMember[] = []
      add(made, members, layout, last, marks)
      const set: NamedSet = {
        id: `N${file.next}`,
        name: (name as string).trim(),
        slug: slugOf(name as string),
        comment: (comment ?? '').slice(0, SET_COMMENT_MAX),
        colour: colour === undefined ? file.sets.length % SET_COLOURS : colourOf(colour),
        layout,
        by,
        ...(by === 'agent' ? { proposed: true as const } : {}),
        members: made,
        createdAt: this.now().toISOString()
      }
      file.next += 1
      file.sets.push(set)
      return set
    }, (set) => this.stamped(objectId, set.id, refsOf ?? this.deps.scene(objectId)?.revision))
  }

  /**
   * Changes a set: its name, comment and colour; members taken (`take`, by ref, each of which must be in the set) and added
   * (`add`, a ref already there leaves one); and `repick`, which replaces the members that are lost by the selection
   * given. Members are checked as `make` checks them, against the set's own layout. A proposal stays one: only `accept` clears that.
   * Members added come of the build `refsOf` says (the last build when none is): the set's refs are then of the older of that and
   * the build they were of.
   */
  async edit(objectId: string, id: string, edit: SetEdit, refsOf?: number): Promise<NamedSet> {
    if (typeof edit !== 'object' || edit === null || Array.isArray(edit)) throw new Refusal('That is not a change to a named set.')
    for (const key of Object.keys(edit)) if (!(EDIT_KEYS as readonly string[]).includes(key)) throw new Refusal(`${key} of a named set cannot be changed this way`)
    if (edit.name !== undefined && typeof edit.name !== 'string') throw new Refusal('A named set needs a name.')
    if (edit.comment !== undefined && typeof edit.comment !== 'string') throw new Refusal('The comment of a named set is text.')
    if (edit.colour !== undefined) colourOf(edit.colour)
    if (edit.take !== undefined && (!Array.isArray(edit.take) || !edit.take.every((t) => typeof t === 'string'))) throw new Refusal('take is a list of refs of members.')
    const asked = [...(edit.add ?? []), ...(edit.repick ?? [])]
    if ((edit.add !== undefined && !Array.isArray(edit.add)) || (edit.repick !== undefined && !Array.isArray(edit.repick))) throw new Refusal('add and repick are lists of members.')
    // The marks say which strokes are there, for the strokes asked for and for those a re-pick finds lost.
    const marks = await this.marksFor(objectId, asked.some(isStroke) || edit.repick !== undefined)
    let refs: number | undefined
    const changed = await this.change(objectId, (file) => {
      const set = setOf(file, id)
      const name = edit.name?.trim()
      if (edit.name !== undefined) {
        const error = setNameError(edit.name, [])
        if (error) throw new Refusal(error)
        const clash = file.sets.find((s) => s.id !== set.id && s.slug === slugOf(edit.name as string))
        if (clash) throw new Refusal(`#${clash.slug} is taken (${clash.id})`)
      }
      const before = JSON.stringify(set)
      if (name !== undefined) {
        set.name = name
        set.slug = slugOf(name)
      }
      if (edit.comment !== undefined) set.comment = edit.comment.slice(0, SET_COMMENT_MAX)
      if (edit.colour !== undefined) set.colour = colourOf(edit.colour)
      for (const ref of edit.take ?? []) {
        const at = set.members.findIndex((m) => memberRef(m) === ref)
        if (at < 0) throw new Refusal(`${ref} is not in #${set.slug}`)
        set.members.splice(at, 1)
      }
      const last = this.deps.scene(objectId)
      if (edit.repick !== undefined) {
        const lost = set.members.filter((m) => isLost(m, marks))
        if (lost.length === 0) throw new Refusal(`nothing lost in #${set.slug}: there is nothing to re-pick`)
        set.members = set.members.filter((m) => !lost.includes(m))
        add(set.members, edit.repick, set.layout, last, marks)
      }
      if (edit.add !== undefined) add(set.members, edit.add, set.layout, last, marks)
      // What is kept of the refs a set had is as old as the oldest of them: a member of a later build does not make the rest later.
      const had = this.refsAt.get(objectId)?.get(set.id)
      const came = refsOf ?? last?.revision
      refs = edit.add !== undefined || edit.repick !== undefined ? (had === undefined || came === undefined ? undefined : Math.min(had, came)) : had
      return JSON.stringify(set) === before ? UNCHANGED : set
    }, (done) => {
      if (done !== UNCHANGED) this.stamped(objectId, id, refs)
    })
    return changed === UNCHANGED ? setIn(await this.list(objectId), id) : changed
  }

  /** Takes a set away. The last one taken from each object is kept in memory, whole, for `restore`. */
  async remove(objectId: string, id: string): Promise<void> {
    await this.write(objectId, (file) => file.sets.splice(indexOf(file, id), 1)[0], (set) => {
      this.deleted.set(objectId, { set, refs: this.refsAt.get(objectId)?.get(set.id) })
      this.refsAt.get(objectId)?.delete(set.id)
    })
  }

  /** Puts back the set removed last, whole and with its number, where its number puts it. Only that one, and once. */
  async restore(objectId: string, id: string): Promise<NamedSet> {
    const held = this.deleted.get(objectId)
    if (!held || held.set.id !== id) throw new Refusal(`${id} cannot be put back: only the set deleted last can be, and only once`)
    const kept = held.set
    // Its refs are the ones it had when it was taken away: a build since has not refound it, and it is asked to be.
    const set = await this.write(objectId, (file) => {
      if (file.sets.some((s) => s.id === id || s.slug === kept.slug)) throw new Refusal(`${id} is there already, or its name is taken`)
      const number = (s: NamedSet): number => Number(s.id.slice(1))
      const at = file.sets.findIndex((s) => number(s) > number(kept))
      file.sets.splice(at < 0 ? file.sets.length : at, 0, structuredClone(kept))
      return kept
    }, () => this.stamped(objectId, id, held.refs))
    if (this.deleted.get(objectId)?.set.id === id) this.deleted.delete(objectId)
    return structuredClone(set)
  }

  /** The person accepts the agent's proposal: it is theirs, and no longer proposed. Refused for a set that is not proposed. */
  accept(objectId: string, id: string): Promise<NamedSet> {
    return this.write(objectId, (file) => {
      const set = setOf(file, id)
      if (set.proposed !== true) throw new Refusal(`#${set.slug} (${set.id}) is not a proposal: there is nothing to accept`)
      set.by = 'person'
      delete set.proposed
      return set
    })
  }

  /** The person turns the agent's proposal down: it is deleted. Refused for a set that is not proposed. */
  async dismiss(objectId: string, id: string): Promise<void> {
    await this.write(objectId, (file) => {
      const at = indexOf(file, id)
      if (file.sets[at].proposed !== true) throw new Refusal(`#${file.sets[at].slug} (${id}) is not a proposal: there is nothing to dismiss`)
      file.sets.splice(at, 1)
      return null
    }, () => this.refsAt.get(objectId)?.delete(id))
  }

  /**
   * What the kernel said of the faces and edges of a set (the second change after `make`): their types, selector forms, and
   * the point and normal it answers. Dropped, with nothing written, and null, when the build is no longer `revision`, the
   * set is gone, or no member of it is any of the refs (it was taken away or repicked meanwhile). A form that is no form is
   * left off, and the member stays.
   */
  async withSelectors(objectId: string, id: string, revision: number, found: readonly SelectorFound[]): Promise<NamedSet | null> {
    const result = await this.change(objectId, (file) => {
      if (this.deps.scene(objectId)?.revision !== revision) return UNCHANGED
      const set = file.sets.find((s) => s.id === id)
      if (!set) return UNCHANGED
      const before = JSON.stringify(set.members)
      for (const answer of found) {
        if (!isRecord(answer) || typeof answer.ref !== 'string') continue
        const member = set.members.find((m) => ('face' in m || 'edge' in m) && memberRef(m) === answer.ref)
        if (!member || !('point' in member) || member.state !== 'ok') continue
        const type = typeof answer.type === 'string' && GEOM_TYPES.includes(answer.type) ? answer.type : undefined
        const center = finiteVec3(answer.center)
        // No answer of the face (a ref it no longer has, or no time): what the member has stays.
        if (type === undefined || center === null) continue
        member.type = type
        member.point = center
        delete member.held
        if ('face' in member) {
          const normal = finiteVec3(answer.normal)
          if (normal) member.normal = normal
        }
        const form = isRecord(answer.selector) ? parseSelectorForm(answer.selector.form, 'face' in member ? 'face' : 'edge') : null
        if (form) member.selector = form
        else delete member.selector
      }
      return JSON.stringify(set.members) === before ? UNCHANGED : set
    })
    return result === UNCHANGED ? null : result
  }

  /**
   * What a refind made of the sets after a build (`refind.ts`), written as one change: an item for each set it looked at, with
   * the members it read (`was`) and what it made of them. A set whose members are no longer `was` (it was edited meanwhile) is
   * passed over, as is everything when the last build is no longer `revision`. Answers the sets that were written. `whole` says
   * the refind looked at every member it could (it did not run out of time, and no layout went unasked): only then are the sets
   * it looked at, written or not, said to have refs of `revision`, which they are told of as `refound` (`refsOf`).
   */
  async refound(objectId: string, revision: number, changes: readonly Refound[], whole = true): Promise<NamedSet[]> {
    const epoch = this.epoch
    const written: NamedSet[] = []
    const looked: string[] = []
    let current = false
    await this.change(
      objectId,
      (file) => {
        current = this.deps.scene(objectId)?.revision === revision
        if (!current) return UNCHANGED
        for (const change of changes) {
          const set = file.sets.find((s) => s.id === change.id)
          if (!set || !isDeepStrictEqual(set.members, change.was)) continue
          looked.push(set.id)
          if (isDeepStrictEqual(change.was, change.members)) continue
          set.members = structuredClone(change.members)
          written.push(set)
        }
        return written.length === 0 ? UNCHANGED : written
      },
      // Said once what was found is written (or there was nothing to write), and to the workspace it was asked in.
      () => {
        if (!current || !whole || epoch !== this.epoch) return
        let told = false
        for (const id of looked) {
          const had = this.refsAt.get(objectId)?.get(id)
          if (had === undefined || revision > had) {
            this.stamp(objectId, id, revision)
            told = true
          }
        }
        if (told) this.emit('refound', { objectId, revision })
      }
    )
    return structuredClone(written)
  }

  /** The build each set of an object has its refs of, by set id. A set refound or made since torno opened the project is there; one read from the file is not, until it is refound. */
  refsOf(objectId: string): Readonly<Record<string, number>> {
    return Object.fromEntries(this.refsAt.get(objectId) ?? [])
  }

  private stamp(objectId: string, id: string, revision: number | undefined): void {
    const of = this.refsAt.get(objectId) ?? new Map<string, number>()
    if (revision === undefined) of.delete(id)
    else of.set(id, revision)
    this.refsAt.set(objectId, of)
  }

  /** A set was written with refs of `revision`: kept, and the sets are asked to be refound when that is older than the last build. */
  private stamped(objectId: string, id: string, revision: number | undefined): void {
    this.stamp(objectId, id, revision)
    const last = this.deps.scene(objectId)?.revision
    if (last !== undefined && (revision === undefined || revision < last)) this.emit('behind', { objectId })
  }

  /** The marks of an object when a stroke is to be judged (asked for, or lost), else none: nothing else of a set needs them. */
  private async marksFor(objectId: string, needed: boolean): Promise<readonly Mark[]> {
    return needed && this.deps.marks ? this.deps.marks(objectId) : []
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date()
  }

  /**
   * Change the sets of an object: `edit` is given a copy of the file. A change that throws, or a write that fails, leaves
   * the sets as they were. One that returns UNCHANGED writes and tells nothing.
   */
  private change<T>(objectId: string, edit: (file: SetsFile) => T | typeof UNCHANGED, done?: (result: T | typeof UNCHANGED) => void): Promise<T | typeof UNCHANGED> {
    return this.turn(objectId, async (current, dir, epoch) => {
      const file = structuredClone(current)
      const result = edit(file)
      if (result !== UNCHANGED) await saveSetsFile(dir, file)
      // Told only to the workspace it was asked in: the write of one that has been left lands, and is not broadcast. `done` is
      // still in this turn, so that nothing else is done to the sets between the write and what is kept of it.
      if (epoch === this.epoch) {
        if (result !== UNCHANGED) this.files.set(dir, file)
        done?.(result)
        if (result !== UNCHANGED) this.emit('changed', { objectId, sets: structuredClone(file.sets) })
      }
      return result === UNCHANGED ? UNCHANGED : structuredClone(result)
    })
  }

  /** `change` of an edit that always changes something. */
  private write<T>(objectId: string, edit: (file: SetsFile) => T, done?: (result: T) => void): Promise<T> {
    return this.change(objectId, edit, done && ((result) => done(result as T))) as Promise<T>
  }

  /** Do one thing with the sets file of an object, after whatever was asked of it before. */
  private turn<T>(objectId: string, task: (file: SetsFile, dir: string, epoch: number) => T | Promise<T>): Promise<T> {
    const dir = this.deps.dirOf(objectId)
    if (dir === undefined) return Promise.reject(new Error(`no project named ${objectId} in the open workspace`))
    // As of the asking: the workspace may be left while this waits its turn.
    const epoch = this.epoch
    const turn = (this.turns.get(dir) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        let file = this.files.get(dir)
        if (!file) {
          const loaded = await loadSetsFile(dir, () => this.now())
          file = loaded.file
          if (loaded.problem) this.problems.set(dir, loaded.problem)
          if (epoch === this.epoch) {
            this.files.set(dir, file)
            if (loaded.problem) this.emit('problem', { objectId, message: loaded.problem })
          }
        }
        return task(file, dir, epoch)
      })
      .finally(() => {
        if (this.turns.get(dir) === turn) this.turns.delete(dir)
      })
    this.turns.set(dir, turn)
    return turn
  }

  private emit<E extends keyof SetEvents>(event: E, message: SetEvents[E]): void {
    for (const cb of this.listeners[event]) cb(message)
  }
}

const isStroke = (ask: unknown): boolean => isRecord(ask) && 'stroke' in ask

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function colourOf(colour: unknown): number {
  if (typeof colour !== 'number' || !Number.isInteger(colour) || colour < 0 || colour >= SET_COLOURS) throw new Refusal(`A colour of a named set is a whole number from 0 to ${SET_COLOURS - 1}.`)
  return colour
}

function setOf(file: SetsFile, id: string): NamedSet {
  if (typeof id !== 'string' || !SET_ID.test(id)) throw new Refusal(`${String(id)} is not a named set: a named set is N1, N2, …`)
  const set = file.sets.find((s) => s.id === id)
  if (!set) throw new Refusal(`no named set ${id}; named sets: ${file.sets.map((s) => s.id).join(', ') || 'none'}`)
  return set
}

function indexOf(file: SetsFile, id: string): number {
  setOf(file, id)
  return file.sets.findIndex((s) => s.id === id)
}

function setIn(all: NamedSet[], id: string): NamedSet {
  const set = all.find((s) => s.id === id)
  if (!set) throw new Refusal(`no named set ${id}`)
  return set
}

/**
 * Adds the members asked for to `members`, each checked against the layout's last build: a part of the layout, `F<i>` below
 * its face count, `E<i>` below its edge count; a stroke against `marks`. A ref already in `members` leaves the one there.
 * What only main says (`type`, `selector`, `state`) is never taken from what is asked.
 */
function add(members: SetMember[], asked: readonly MemberAsk[], layout: string, last: LastBuild | undefined, marks: readonly Mark[]): void {
  if (!last) throw new Refusal('This project has not been built yet, so a named set cannot be checked against it.')
  if (!last.scene.layouts.includes(layout)) throw new Refusal(`no layout ${layout} in the build (layouts: ${last.scene.layouts.join(', ')})`)
  const parts = last.scene.parts.filter((p) => p.layout === layout)
  for (const ask of asked) {
    if (!isRecord(ask)) throw new Refusal('A member of a named set is a ref, or a stroke.')
    const member = 'stroke' in ask ? strokeMember(ask, marks) : placedMember(ask, layout, parts)
    if (members.some((m) => memberRef(m) === memberRef(member))) continue
    if (members.length >= MOST_SET_MEMBERS) throw new Refusal(`A named set holds at most ${MOST_SET_MEMBERS} members.`)
    members.push(member)
  }
}

function strokeMember(ask: Record<string, unknown>, marks: readonly Mark[]): SetMember {
  if (Object.keys(ask).length !== 1 || typeof ask.stroke !== 'string' || !STROKE_REF.test(ask.stroke)) throw new Refusal('A stroke of a named set is its sketch and its own id: M7/k3.')
  const [sketch, id] = ask.stroke.split('/')
  const mark = marks.find((m) => m.id === sketch)
  if (mark?.kind !== 'sketch') throw new Refusal(`${ask.stroke} is not a stroke: ${sketch} is not a sketch of this project`)
  if (!mark.strokes.some((s) => (s as { id?: string }).id === id)) throw new Refusal(`${ask.stroke} is not a stroke of ${sketch}`)
  return { stroke: ask.stroke }
}

function placedMember(ask: Record<string, unknown>, layout: string, parts: LastBuild['scene']['parts']): SetMember {
  for (const key of Object.keys(ask)) if (key !== 'ref' && key !== 'point' && key !== 'normal') throw new Refusal(`${key} is not part of a member of a named set`)
  if (typeof ask.ref !== 'string') throw new Refusal('A member of a named set is a ref, or a stroke.')
  const parsed = parseSetRef(ask.ref)
  if (!parsed) throw new Refusal(`${ask.ref} is not a part, a face or an edge: a named set holds those and strokes`)
  const point = ask.point === undefined ? undefined : finiteVec3(ask.point)
  if (point === null) throw new Refusal(`The point of ${ask.ref} is three numbers.`)
  const normal = ask.normal === undefined ? undefined : finiteVec3(ask.normal)
  if (normal === null) throw new Refusal(`The normal of ${ask.ref} is three numbers.`)
  const part = parts.find((p) => p.name === parsed.part)
  if (!part) throw new Refusal(`no part '${parsed.part}' in layout ${layout} (parts: ${parts.map((p) => p.name).join(', ') || 'none'})`)
  if (parsed.kind === 'part') return { part: part.name }
  const count = parsed.kind === 'face' ? part.faceCount : part.edgeCount
  const letter = parsed.kind === 'face' ? 'F' : 'E'
  if (parsed.index >= count) {
    const what = parsed.kind === 'face' ? 'faces' : 'edges'
    throw new Refusal(count === 0 ? `${part.name} has no ${what}: there is no ${letter}${parsed.index}` : `${part.name} has ${count} ${what}, ${letter}0 to ${letter}${count - 1}: there is no ${letter}${parsed.index}`)
  }
  // Where the person pointed; a member given none is held at the middle of its part until the kernel says where the face is.
  const at: Vec3 = point ?? [(part.bbox.min[0] + part.bbox.max[0]) / 2, (part.bbox.min[1] + part.bbox.max[1]) / 2, (part.bbox.min[2] + part.bbox.max[2]) / 2]
  const arranged: Vec3 = part.arranged ? [part.arranged[0], part.arranged[1], part.arranged[2]] : [0, 0, 0]
  const held = point === undefined ? { held: true as const } : {}
  if (parsed.kind === 'face') return { face: ask.ref, point: at, ...(normal ? { normal } : {}), arranged, ...held, state: 'ok' }
  return { edge: ask.ref, point: at, arranged, ...held, state: 'ok' }
}
