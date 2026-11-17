import { useMemo } from 'react'
import { useStore as useZustand } from 'zustand'
import { createStore } from 'zustand/vanilla'
import type { Mark, Vec3 } from '../../shared/marks'
import { type MemberAsk, type NamedSet, type NewSet, type SetEdit, type SetMember, SET_COLOURS, STROKE_REF, memberRef, parseSetRef, setNameError, strokeLive } from '../../shared/sets'
import { describeWhole } from './descriptors'
import { sketchStore } from './sketching'
import { actions, store } from './store'

// The named sets in the window: the project's sets as main last told them (`.torno/sets.json`, which main alone writes), whether the
// popover of Ctrl+G is open, which set the pointer is on (lit in the view), and which set is being re-picked. A set is main's; what
// is here is what main said, and what the person has under way. Nothing here changes with a pointer move but `hovered`, which the
// viewport follows without React.

export interface SetsState {
  /** The project the sets are of; null while none is open. */
  objectId: string | null
  sets: NamedSet[]
  /** Ctrl+G was pressed with something selected: the popover is open. */
  making: boolean
  /** The set the pointer is on, in its row of Layers or in the view: its members are lit in its colour. By `N<n>`. */
  hovered: string | null
  /** The set whose lost members are being picked again: the selection is what replaces them. By `N<n>`. */
  repicking: string | null
  /** The set deleted last, which can be put back for a while (the marks list's Undo). */
  removed: { id: string; name: string } | null
  /** One line for the status line, for a moment: why Ctrl+G did nothing. */
  said: string | null
  /** Why main refused the last change, in its words. */
  refused: string | null
}

const INITIAL: SetsState = { objectId: null, sets: [], making: false, hovered: null, repicking: null, removed: null, said: null, refused: null }

export const setsStore = createStore<SetsState>(() => INITIAL)

export function useSets<T>(select: (s: SetsState) => T): T {
  return useZustand(setsStore, select)
}

const state = (): SetsState => setsStore.getState()
const set = (patch: Partial<SetsState>): void => setsStore.setState(patch)

/** How long "Undo" is offered after a delete, and how long the status line keeps a sentence. */
export const UNDO_MS = 10_000
export const SAID_MS = 4000
export const NOTHING_SELECTED = 'Select faces, edges, parts or strokes first'

/** What main refused or failed at, in its words. */
const said = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** The slugs of the sets of the project: what the chat finds `#deck` by. The same array while the sets are the same. */
export function useSetSlugs(): readonly string[] {
  const sets = useSets((s) => s.sets)
  return useMemo(() => sets.map((s) => s.slug), [sets])
}

/** The sets of the layout shown, oldest first. */
export function setsOfLayout(sets: readonly NamedSet[], layout: string): NamedSet[] {
  return sets.filter((s) => s.layout === layout)
}

/** Does a set hold the face, edge or part `ref` names? A part held whole holds each of its faces and edges. A lost member holds nothing. */
export function holds(set: Pick<NamedSet, 'members'>, ref: string): boolean {
  const parsed = parseSetRef(ref)
  if (parsed === null) return false
  return set.members.some((m: SetMember) => {
    if ('stroke' in m || m.state === 'lost') return false
    if ('part' in m) return m.part === parsed.part
    return memberRef(m) === ref
  })
}

/** The sets that hold a face, an edge or a part of the layout shown, oldest first. */
export function setsHolding(sets: readonly NamedSet[], layout: string, ref: string): NamedSet[] {
  return setsOfLayout(sets, layout).filter((s) => holds(s, ref))
}

/** The ref a set is named by: `#deck`. */
export const refOfSet = (s: Pick<NamedSet, 'slug'>): string => `#${s.slug}`

/** What the select tool takes of a set: its members the last build has, as the selection holds them. Strokes are the sketch's. */
export function selectableMembers(s: Pick<NamedSet, 'members'>): string[] {
  return s.members.filter((m) => !('stroke' in m) && m.state !== 'lost').map(memberRef)
}

/**
 * What the view lights for a set the pointer is on: its members the last build found (faces, edges, parts) and its strokes that
 * are still there, in its colour, dashed for a proposal. Null for no set, or one of another layout.
 */
export function litSet(sets: readonly NamedSet[], id: string | null, layout: string, marks: readonly Mark[]): { refs: string[]; colour: number; proposed: boolean } | null {
  const found = id === null ? undefined : sets.find((s) => s.id === id)
  if (!found || found.layout !== layout) return null
  const strokes = found.members.flatMap((m) => ('stroke' in m && strokeLive(m.stroke, marks) ? [m.stroke] : []))
  return { refs: [...selectableMembers(found), ...strokes], colour: found.colour, proposed: found.proposed === true }
}

/** The colour a new set takes: the one after the colour of the set made last, so that they come in turn. */
export function nextColour(sets: readonly Pick<NamedSet, 'id' | 'colour'>[]): number {
  if (sets.length === 0) return 0
  const last = sets.reduce((a, b) => (Number(b.id.slice(1)) > Number(a.id.slice(1)) ? b : a))
  return (last.colour + 1) % SET_COLOURS
}

const FACE_TYPES = new Set(['plane', 'cylinder', 'cone', 'sphere', 'torus', 'bezier', 'bspline', 'revolution', 'extrusion', 'offset'])
const EDGE_TYPES = new Set(['line', 'circle', 'ellipse', 'hyperbola', 'parabola'])

/**
 * A name for a set from what the kernel says of its first member: `plane, normal +Z, z = 20, 1180 mm²` is `plane +Z face`,
 * `circle, radius 4, 25.13 mm` is `circle edge`. With nothing said, `New set`. Made unique among `taken` by ` 2`, ` 3`, …
 */
export function suggestName(descriptor: string | undefined, taken: readonly string[]): string {
  const word = descriptor === undefined ? '' : (/^[a-z]+/i.exec(descriptor.trim())?.[0].toLowerCase() ?? '')
  const normal = descriptor === undefined ? null : /normal ([+-][XYZ])\b/.exec(descriptor)?.[1]
  let base = 'New set'
  if (word === 'part') base = 'Part set'
  else if (EDGE_TYPES.has(word)) base = `${word} edge`
  else if (FACE_TYPES.has(word)) base = `${word}${normal ? ` ${normal}` : ''} face`
  else if (word !== '') base = `${word} set`
  const free = (name: string): boolean => setNameError(name, taken) === null
  if (free(base)) return base
  for (let n = 2; n < 1000; n++) {
    const name = `${base} ${n}`
    if (free(name)) return name
  }
  return base
}

/** Is a ref a stroke of a sketch (`M7/k3`)? */
export const isStrokeRef = (ref: string): boolean => STROKE_REF.test(ref)

type Picked = Record<string, { point: Vec3; normal: Vec3 | null }>

/**
 * The members asked for from what is selected. A face or an edge goes with where it was picked (point and normal), so that no
 * member is held at the middle of its part's box; one that was selected without a pick (from the chat, from Layers) is asked
 * of the kernel for its middle and normal. A stroke is its own. `describeAt` says what the kernel knows of a ref, and null when
 * it cannot: that member is then sent bare, and main finds its place.
 */
export async function asksFor(selection: readonly string[], picked: Picked, describeAt: (ref: string) => Promise<{ center?: Vec3; normal?: Vec3 | null } | null>): Promise<MemberAsk[]> {
  const asks: MemberAsk[] = []
  for (const ref of selection) {
    if (isStrokeRef(ref)) {
      asks.push({ stroke: ref })
      continue
    }
    const parsed = parseSetRef(ref)
    if (parsed === null) continue
    if (parsed.kind === 'part') {
      asks.push({ ref })
      continue
    }
    const at = picked[ref]
    if (at) {
      asks.push(parsed.kind === 'face' && at.normal ? { ref, point: at.point, normal: at.normal } : { ref, point: at.point })
      continue
    }
    const found = await describeAt(ref)
    if (found?.center) asks.push(parsed.kind === 'face' && found.normal ? { ref, point: found.center, normal: found.normal } : { ref, point: found.center })
    else asks.push({ ref })
  }
  return asks
}

/** The selection as members asked for, in the open project's layout. */
export function selectionAsks(): Promise<MemberAsk[]> {
  const { selection, picked, objectId, revision, layout } = store.getState()
  return asksFor(selection, picked, async (ref) => {
      const found = objectId === null ? null : await describeWhole(objectId, revision, layout, ref)
      return found !== null && found.kind !== 'part' ? { center: found.center, normal: found.kind === 'face' ? found.normal : null } : null
    })
}

let undoTimer: ReturnType<typeof setTimeout> | undefined
let saidTimer: ReturnType<typeof setTimeout> | undefined

export const setActions = {
  /** The project the window shows: the sets of another are no longer shown. */
  open(objectId: string | null): void {
    if (state().objectId === objectId) return
    clearTimeout(undoTimer)
    set({ ...INITIAL, objectId })
  },

  /** What main told of a project's sets: kept when it is the project the window has. What was hovered or re-picked and is gone is let go. */
  told(m: { objectId: string; sets: NamedSet[] }): void {
    const s = state()
    if (m.objectId !== s.objectId) return
    set({
      sets: m.sets,
      hovered: s.hovered !== null && m.sets.some((x) => x.id === s.hovered) ? s.hovered : null,
      repicking: s.repicking !== null && m.sets.some((x) => x.id === s.repicking) ? s.repicking : null
    })
  },

  /** Ctrl+G: the popover, with a selection to name; without one, the status line says what to do. */
  startMake(): boolean {
    const s = store.getState()
    if (s.objectId === null) return false
    if (s.selection.length === 0) {
      setActions.say(NOTHING_SELECTED)
      return false
    }
    set({ making: true, refused: null })
    return true
  },

  cancelMake(): void {
    if (state().making) set({ making: false })
  },

  /** A sentence for the status line, for a moment. */
  say(text: string | null): void {
    clearTimeout(saidTimer)
    set({ said: text })
    if (text !== null) saidTimer = setTimeout(() => set({ said: null }), SAID_MS)
  },

  hover(id: string | null): void {
    if (state().hovered !== id) set({ hovered: id })
  },

  /** Makes the set at once: main keeps it, finds each face's selector after, and tells every window. Rejects with main's words. */
  async make(ask: NewSet): Promise<NamedSet> {
    const objectId = state().objectId
    if (objectId === null) throw new Error('No project is open')
    const made = await window.torno.sets.make(objectId, ask)
    setActions.told({ objectId, sets: [...state().sets.filter((x) => x.id !== made.id), made] })
    set({ making: false, refused: null })
    return made
  },

  /** Renames, recolours, comments, adds, takes away or re-picks. Says why in `refused` when main will not. */
  async edit(id: string, edit: SetEdit): Promise<boolean> {
    const objectId = state().objectId
    if (objectId === null) return false
    try {
      const made = await window.torno.sets.edit(objectId, id, edit)
      setActions.told({ objectId, sets: state().sets.map((x) => (x.id === made.id ? made : x)) })
      set({ refused: null })
      return true
    } catch (e) {
      set({ refused: said(e) })
      return false
    }
  },

  /** The selection is added to the set. */
  async addSelection(id: string): Promise<boolean> {
    const add = await selectionAsks()
    if (add.length === 0) {
      set({ refused: NOTHING_SELECTED })
      return false
    }
    return setActions.edit(id, { add })
  },

  /** The selection is taken away from the set: the members of it that are selected. */
  async takeSelection(id: string): Promise<boolean> {
    const mine = state().sets.find((x) => x.id === id)
    if (!mine) return false
    const have = new Set(mine.members.map(memberRef))
    const take = store.getState().selection.filter((ref) => have.has(ref))
    if (take.length === 0) {
      set({ refused: 'None of what is selected is in this set' })
      return false
    }
    return setActions.edit(id, { take })
  },

  /** Deletes a set; it can be put back with `undo` for a while. */
  async remove(id: string): Promise<void> {
    const { objectId, sets } = state()
    const gone = sets.find((x) => x.id === id)
    if (objectId === null || !gone) return
    try {
      await window.torno.sets.remove(objectId, id)
    } catch (e) {
      return set({ refused: said(e) })
    }
    setActions.told({ objectId, sets: state().sets.filter((x) => x.id !== id) })
    clearTimeout(undoTimer)
    set({ removed: { id, name: gone.name }, refused: null })
    undoTimer = setTimeout(() => set({ removed: null }), UNDO_MS)
  },

  /** Puts back the set deleted last. */
  async undo(): Promise<void> {
    const { objectId, removed } = state()
    if (objectId === null || removed === null) return
    clearTimeout(undoTimer)
    set({ removed: null })
    try {
      const back = await window.torno.sets.restore(objectId, removed.id)
      setActions.told({ objectId, sets: [...state().sets.filter((x) => x.id !== back.id), back].sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1))) })
    } catch (e) {
      set({ refused: said(e) })
    }
  },

  /** Claude's proposal becomes the person's. */
  async accept(id: string): Promise<void> {
    const objectId = state().objectId
    if (objectId === null) return
    try {
      const made = await window.torno.sets.accept(objectId, id)
      setActions.told({ objectId, sets: state().sets.map((x) => (x.id === made.id ? made : x)) })
      set({ refused: null })
    } catch (e) {
      set({ refused: said(e) })
    }
  },

  /** Claude's proposal is turned down: the set is deleted, with no undo. */
  async dismiss(id: string): Promise<void> {
    const objectId = state().objectId
    if (objectId === null) return
    try {
      await window.torno.sets.dismiss(objectId, id)
      setActions.told({ objectId, sets: state().sets.filter((x) => x.id !== id) })
      set({ refused: null })
    } catch (e) {
      set({ refused: said(e) })
    }
  },

  /** Re-pick, first press: the selection is cleared, and what is selected next replaces the members that are lost. */
  startRepick(id: string): void {
    if (!state().sets.some((x) => x.id === id)) return
    actions.setSelection([])
    set({ repicking: id, refused: null })
  },

  cancelRepick(): void {
    if (state().repicking !== null) set({ repicking: null })
  },

  /** Re-pick, second press: the selection is sent as `repick`, which takes the place of every member that is lost. */
  async repick(id: string): Promise<boolean> {
    const repick = await selectionAsks()
    if (repick.length === 0) {
      set({ refused: NOTHING_SELECTED })
      return false
    }
    const done = await setActions.edit(id, { repick })
    if (done) set({ repicking: null })
    return done
  },

  /** The sets that hold a face, an edge or a part of the layout shown, oldest first. */
  setsAt(ref: string): NamedSet[] {
    return setsHolding(state().sets, store.getState().layout, ref)
  }
}

/**
 * A stroke of the open sketch is selected from the panel's list of its strokes: it alone, or with Shift added to (or taken out of)
 * what is selected. The selection holds `M7/k3` while the sketch is open, beside faces and edges.
 */
export function selectStroke(ref: string, additive = false): void {
  if (!isStrokeRef(ref)) return
  if (additive) actions.toggleSelection(ref)
  else actions.setSelection([ref])
}

/** The strokes of a sketch are selected only while it is open: with it closed, they are let go and the rest of the selection stays. */
export function dropStrokes(): void {
  const { selection } = store.getState()
  if (selection.some(isStrokeRef)) actions.setSelection(selection.filter((ref) => !isStrokeRef(ref)))
}

/**
 * Joins the sets to the open project and to main: they are read when a project opens and follow what main tells of them. A
 * selection that holds a stroke (`M7/k3`) does so while its sketch is open: when no sketch is, the strokes are let go.
 * Returns what stops it.
 */
export function connectSets(): () => void {
  const open = store.getState().objectId
  setActions.open(open)
  const load = (objectId: string): void => {
    void window.torno.sets.list(objectId).then(
      (sets) => setActions.told({ objectId, sets }),
      () => {} // a project with no folder yet has none
    )
  }
  if (open !== null) load(open)
  const offStore = store.subscribe((s, prev) => {
    if (s.objectId !== prev.objectId) {
      setActions.open(s.objectId)
      if (s.objectId !== null) load(s.objectId)
    }
  })
  const offSketch = sketchStore.subscribe((s, prev) => {
    if (prev.open !== null && s.open === null) dropStrokes()
  })
  const offSets = window.torno.sets.onChanged((m) => setActions.told(m))
  return () => {
    offStore()
    offSketch()
    offSets()
  }
}
