import { useStore as useZustand } from 'zustand'
import { createStore } from 'zustand/vanilla'
import type { HistoryList } from '../../shared/history'
import type { MainAxis } from '../../shared/planes'
import { parseSetRef } from '../../shared/sets'
import type { Tracing, TracingCut, TracingsFile } from '../../shared/tracings'
import { boardActions, boardStore, type Shown } from './board'
import { actions, store } from './store'
import { setTool } from './tools'

// The tracings of the open project in the window: what main last said of the file (`.torno/tracings.json`, which main alone
// writes), which tracing is open in the view, the kernel's outline of each one that has been asked for, and what the person
// has under way (a tracing on a face waits for the face). A tracing is main's; what is here is what main said. Nothing here
// changes with a pan, a zoom or a pointer move: those are the sheet's, on its own elements (`ui/tracings/Sheet.ts`).

export interface TracingsState {
  /** The project the tracings are of; null while none is open. */
  objectId: string | null
  /** As main last told it; null until it has. */
  file: TracingsFile | null
  /** The tracing the view shows, by `T<n>`; null with none. */
  open: string | null
  /** The outline of each tracing asked for, on the build it was cut on. Absent for a tracing with no build of this run to cut. */
  cuts: Record<string, TracingCut>
  /** Whether a build is running. */
  building: boolean
  /** Why main refused the last thing the person did, in its words. */
  refused: string | null
  /** A tracing on a face is being made: the view is at the model, and the next flat face selected is the tracing's. */
  facing: boolean
  /** The tracing removed last, which can be put back while this stays. */
  removed: { id: string; name: string } | null
  /** What main found wrong with the tracings file (it was set aside, and where), until the person has read it. */
  problem: string | null
}

const NONE: TracingsState = { objectId: null, file: null, open: null, cuts: {}, building: false, refused: null, facing: false, removed: null, problem: null }

export const tracingsStore = createStore<TracingsState>(() => NONE)

export function useTracings<T>(select: (s: TracingsState) => T): T {
  return useZustand(tracingsStore, select)
}

const state = (): TracingsState => tracingsStore.getState()
const set = (patch: Partial<TracingsState>): void => tracingsStore.setState(patch)

/** What main refused or failed at, in its words (the bridge has already taken Electron's wrapping off). */
const said = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** Which tracings main is told are shown: the open one while the main area is on a tracing; none otherwise. */
export function shownIds(shown: Shown, open: string | null): string[] {
  return shown === 'tracing' && open !== null ? [open] : []
}

/**
 * The parts a tracing draws once `name` is switched on or off: `null` for all of them (the tracing then names none), the
 * names in the layout's order otherwise, or `last` for the one part left, which cannot be taken off (a tracing of no part draws nothing).
 */
export function nextPartsOf(current: readonly string[] | undefined, all: readonly string[], name: string, on: boolean): string[] | null | 'last' {
  const now = new Set(current ?? all)
  if (on) now.add(name)
  else now.delete(name)
  const next = all.filter((part) => now.has(part))
  if (next.length === 0) return 'last'
  return next.length === all.length ? null : next
}

/** The build a cut was made on, as the person knows it: its history id (`h41`) when the history has it, else its revision of this run (`r3`). */
export function buildName(list: HistoryList | null | undefined, revision: number): string {
  const entry = list?.entries.findLast((e) => e.revision === revision && e.run === list.run && e.failed !== true) ?? list?.entries.findLast((e) => e.revision === revision && e.failed !== true)
  return entry ? entry.id : `r${revision}`
}

/** The face a selection is, when it is one face and nothing else (`block/F12`); null otherwise. */
export function facePicked(selection: readonly string[]): string | null {
  if (selection.length !== 1) return null
  const parsed = parseSetRef(selection[0])
  return parsed?.kind === 'face' ? selection[0] : null
}

/** What decides whether the outline is cut again: the layout, the plane and the parts. A rename or a layer is no reason. */
const cutKey = (t: Tracing | undefined): string => (t === undefined ? '' : JSON.stringify([t.layout, t.plane, t.parts ?? null]))

/** `next` with each tracing that is as it was in `prev` kept as that very object: what comes across the bridge is all new objects. */
function sharing(prev: TracingsFile | null, next: TracingsFile): TracingsFile {
  if (prev === null) return next
  const was = new Map(prev.tracings.map((t) => [t.id, t]))
  return { ...next, tracings: next.tracings.map((t) => ((w) => (w !== undefined && JSON.stringify(w) === JSON.stringify(t) ? w : t))(was.get(t.id))) }
}

/** `file` with `made` in it, where a change main told of has not yet come. */
const withTracing = (file: TracingsFile | null, made: Tracing): TracingsFile => {
  const rest = (file?.tracings ?? []).filter((t) => t.id !== made.id)
  return { next: Math.max(file?.next ?? 1, Number(made.id.slice(1)) + 1), tracings: [...rest, made].sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1))) }
}

/** The tracing that is open, or undefined. */
export function openTracing(s: Pick<TracingsState, 'file' | 'open'> = state()): Tracing | undefined {
  return s.open === null ? undefined : s.file?.tracings.find((t) => t.id === s.open)
}

/** Whether the project has a tracing: what `Ctrl+Tab` goes by. */
export const hasTracing = (s: Pick<TracingsState, 'file'> = state()): boolean => (s.file?.tracings.length ?? 0) > 0

export const tracingActions = {
  /** The project the window shows: the tracings of another are no longer shown. */
  openProject(objectId: string | null): void {
    if (state().objectId === objectId) return
    tracingsStore.setState({ ...NONE, objectId, building: store.getState().build?.status === 'building' }, true)
  },

  /** The outline of a tracing on the last good build, asked of main; what comes back is kept, and none (no build of this run) is let go. */
  async refreshCut(id: string): Promise<void> {
    const objectId = state().objectId
    if (objectId === null) return
    try {
      const cut = await window.torno.tracings.outline(objectId, id)
      if (state().objectId !== objectId) return
      if (cut === null) {
        if (state().cuts[id] === undefined) return
        const { [id]: _gone, ...rest } = state().cuts
        set({ cuts: rest })
      } else tracingActions.cutTold({ objectId, cut })
    } catch {
      // Main could not cut it now: what was shown stays, and the next build tells again.
    }
  },

  /** A shown tracing cut again on a new build, as main tells it. */
  cutTold(m: { objectId: string; cut: TracingCut }): void {
    const s = state()
    if (m.objectId !== s.objectId) return
    set({ cuts: { ...s.cuts, [m.cut.tracing]: m.cut } })
  },

  /** What main told of a project's tracings: kept when it is the project the window has. The tracing open that is gone is left for the first, or for none. */
  told(m: { objectId: string; file: TracingsFile }): void {
    const s = state()
    if (m.objectId !== s.objectId) return
    const file = sharing(s.file, m.file)
    const ids = new Set(file.tracings.map((t) => t.id))
    const open = s.open !== null && ids.has(s.open) ? s.open : (file.tracings[0]?.id ?? null)
    const cuts = Object.fromEntries(Object.entries(s.cuts).filter(([id]) => ids.has(id)))
    const wasOpen = s.file?.tracings.find((t) => t.id === open)
    const now = file.tracings.find((t) => t.id === open)
    set({ file, open, cuts, removed: s.removed !== null && ids.has(s.removed.id) ? null : s.removed })
    if (open !== null && (open !== s.open || cutKey(wasOpen) !== cutKey(now))) void tracingActions.refreshCut(open)
    // A project that was left on a tracing and has none when it is first read (it was removed on another branch): the model. One whose last tracing is removed now stays on the view that offers the next.
    if (s.file === null && file.tracings.length === 0) boardActions.leaveTracing()
  },

  /** Shows the tracing, and asks for its outline. */
  open(id: string): void {
    set({ open: id, refused: null })
    void tracingActions.refreshCut(id)
  },

  /**
   * Makes a tracing in the layout shown, on a main plane, a face or the section on screen, and shows it. The tracing made is
   * returned; null when main refused, and `refused` says why.
   */
  async make(on: { main: MainAxis; offset?: number } | { face: string } | { section: true }, name?: string): Promise<Tracing | null> {
    const objectId = state().objectId
    if (objectId === null) return null
    try {
      const made = await window.torno.tracings.make(objectId, { on, ...(name === undefined || name.trim() === '' ? {} : { name: name.trim() }), layout: store.getState().layout })
      if (state().objectId !== objectId) return made
      set({ file: withTracing(state().file, made), facing: false })
      tracingActions.open(made.id)
      boardActions.show('tracing')
      return made
    } catch (e) {
      set({ refused: said(e) })
      return null
    }
  },

  async rename(id: string, name: string): Promise<boolean> {
    return tracingActions.change(id, { name })
  },

  /** Which parts the tracing draws: `null` for every part of the layout. */
  async setParts(id: string, parts: string[] | null): Promise<boolean> {
    return tracingActions.change(id, { parts })
  },

  async change(id: string, patch: { name?: string; parts?: string[] | null }): Promise<boolean> {
    const objectId = state().objectId
    if (objectId === null) return false
    try {
      const made = await window.torno.tracings.edit(objectId, id, patch)
      if (state().objectId === objectId) set({ file: withTracing(state().file, made), refused: null })
      return true
    } catch (e) {
      set({ refused: said(e) })
      return false
    }
  },

  /** Takes a tracing away, the agent's too; it can be put back (`undoRemove`) until another is removed or the project is left. */
  async remove(id: string): Promise<boolean> {
    const objectId = state().objectId
    if (objectId === null) return false
    const was = state().file?.tracings.find((t) => t.id === id)
    try {
      await window.torno.tracings.remove(objectId, id)
      if (state().objectId === objectId) set({ removed: { id, name: was?.name ?? '' }, refused: null })
      return true
    } catch (e) {
      set({ refused: said(e) })
      return false
    }
  },

  /** Puts back the tracing removed last, whole and with its number. */
  async undoRemove(): Promise<boolean> {
    const objectId = state().objectId
    const removed = state().removed
    if (objectId === null || removed === null) return false
    set({ removed: null })
    try {
      const back = await window.torno.tracings.restore(objectId, removed.id)
      if (state().objectId === objectId) set({ file: withTracing(state().file, back), refused: null })
      return true
    } catch (e) {
      set({ refused: said(e) })
      return false
    }
  },

  /** A tracing on a face: the view goes to the model with Select in hand, and the next flat face selected is the one. */
  pickFace(): void {
    set({ facing: true, refused: null })
    boardActions.show('model')
    setTool('select')
    actions.setSelection([])
  },

  cancelFace(): void {
    if (state().facing) set({ facing: false, refused: null })
  },

  say(text: string | null): void {
    if (state().refused !== text) set({ refused: text })
  },

  problemTold(m: { objectId: string; message: string }): void {
    if (m.objectId === state().objectId) set({ problem: m.message })
  },

  /** The Undo of a removal is offered for a while only. */
  forgetRemoved(): void {
    if (state().removed !== null) set({ removed: null })
  },

  dismissProblem(): void {
    const objectId = state().objectId
    if (state().problem === null) return
    set({ problem: null })
    if (objectId !== null) void window.torno.tracings.dismissProblem(objectId).catch(() => {})
  }
}

/**
 * Joins the tracings to the open project and to main: the file is read when a project opens, and follows what main tells (the
 * person's changes, the agent's, a pull, a new outline after a build). Tells main which tracing is shown. Returns what stops it.
 */
export function connectTracings(): () => void {
  const load = (objectId: string): void => {
    void window.torno.tracings.list(objectId).then(
      (file) => tracingActions.told({ objectId, file }),
      () => {} // a project with no folder yet has none
    )
    // What main found wrong with the file is told once, and this window may not have been listening then.
    void window.torno.tracings.problem(objectId).then(
      (message) => {
        if (message !== null) tracingActions.problemTold({ objectId, message })
      },
      () => {}
    )
  }
  const open = store.getState().objectId
  tracingActions.openProject(open)
  if (open !== null) load(open)

  const offStore = store.subscribe((s, prev) => {
    if (s.objectId !== prev.objectId) {
      tracingActions.openProject(s.objectId)
      if (s.objectId !== null) load(s.objectId)
    }
    const building = s.build?.status === 'building'
    if (building !== state().building) set({ building })
    // A flat face selected while one is waited for.
    if (s.selection !== prev.selection && state().facing) {
      const face = facePicked(s.selection)
      if (face !== null) void tracingActions.make({ face })
    }
  })

  // Main is told which tracing is shown, so that it cuts it again after each build; the one let go is told away.
  let told: { objectId: string; ids: string[] } | null = null
  const tell = (): void => {
    const objectId = state().objectId
    const ids = objectId === null ? [] : shownIds(boardStore.getState().shown, state().open)
    if (told !== null && told.objectId === objectId && told.ids.join() === ids.join()) return
    if (told !== null && told.objectId !== objectId && told.ids.length > 0) window.torno.tracings.shown(told.objectId, [])
    if (objectId !== null && (ids.length > 0 || (told !== null && told.objectId === objectId))) window.torno.tracings.shown(objectId, ids)
    told = objectId === null ? null : { objectId, ids }
  }
  const offBoard = boardStore.subscribe(tell)
  const offTracings = tracingsStore.subscribe((s, prev) => {
    if (s.open !== prev.open || s.objectId !== prev.objectId) tell()
  })
  const offChanged = window.torno.tracings.onChanged((m) => tracingActions.told(m))
  const offOutline = window.torno.tracings.onOutline((m) => tracingActions.cutTold(m))
  const offProblem = window.torno.tracings.onProblem((m) => tracingActions.problemTold(m))
  return () => {
    offStore()
    offBoard()
    offTracings()
    offChanged()
    offOutline()
    offProblem()
  }
}
