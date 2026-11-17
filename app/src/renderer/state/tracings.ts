import { useStore as useZustand } from 'zustand'
import { createStore } from 'zustand/vanilla'
import type { SpanEndDraft } from '../../shared/bridge'
import type { BoardFile, Card } from '../../shared/board'
import type { HistoryList } from '../../shared/history'
import { lineupSaid, type LineupPair, photoRect, transformKey } from '../../shared/lineup'
import type { MainAxis } from '../../shared/planes'
import { parseSetRef } from '../../shared/sets'
import type { TracingExtras } from '../../shared/tracingSvg'
import type { Layer, LayerColour, LayerShape, Tracing, TracingCut, TracingsFile } from '../../shared/tracings'
import type { Prepared } from '../ui/onboard/images'
import { imageType } from '../ui/onboard/images'
import { preparePhoto } from '../ui/tracings/preparePhoto'
import type { InkPen } from '../ui/tracings/inkTool'
import { pinMark } from '../ui/tracings/pinTool'
import { type Hit, canRemove } from '../ui/tracings/selectTool'
import type { TraceMode } from '../ui/tracings/traceTool'
import { warp } from '../ui/tracings/warp'
import { boardActions, boardStore, type Shown } from './board'
import { reviewActions, withIntent } from './review'
import { sketchHere } from './sketching'
import { actions, store } from './store'
import { setTool } from './tools'

// The tracings of the open project in the window: what main last said of the file (`.torno/tracings.json`, which main alone
// writes), which tracing is open in the view, the kernel's outline of each one that has been asked for, and what the person
// has under way (a tracing on a face waits for the face). A tracing is main's; what is here is what main said. Nothing here
// changes with a pan, a zoom or a pointer move: those are the sheet's, on its own elements (`ui/tracings/Sheet.ts`).

/** What the pointer does on the sheet. */
export type TracingTool = 'select' | 'trace' | 'pin' | 'ink' | 'measure' | 'offset'

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
  /** What the pointer does on the sheet: Select moves around it and selects a mark or a shape, Trace puts shapes into the person's layer, Pin leaves a note on a point, Ink draws in the plane, Measure measures between two points and Should be here drags a shape to where it belongs. */
  tool: TracingTool
  /** The mark or the shape of a layer that Select has selected. */
  selected: Hit | null
  /** The pen Ink draws with. */
  ink: InkPen
  /** The mark of the person's that Delete removed last, which Undo puts back while this stays. */
  markRemoved: string | null
  /** What the Trace tool puts down: a line, a circle or a label. */
  trace: TraceMode
  /** The person's layer the Trace tool puts shapes into, chosen in the panel; null for their last (`traceTarget`). */
  into: number | null
  /** The person's layer removed last, with its shapes, which Undo puts back while this stays. */
  layerRemoved: { tracing: string; layer: Layer } | null
  /** The pictures of the photos the window holds, by file name (`p-…` the photo, `s-…` its straightened copy): an object URL, or that the file is not on this computer. */
  photos: Record<string, PhotoEntry>
  /** The tracing whose photo is being lined up: the split view is on; null when none is. */
  lining: string | null
}

export type PhotoEntry = { url: string } | { missing: true }

const NONE: TracingsState = { objectId: null, file: null, open: null, cuts: {}, building: false, refused: null, facing: false, removed: null, problem: null, tool: 'select', selected: null, ink: 'free', markRemoved: null, trace: 'line', into: null, layerRemoved: null, photos: {}, lining: null }

export const tracingsStore = createStore<TracingsState>(() => NONE)

export function useTracings<T>(select: (s: TracingsState) => T): T {
  return useZustand(tracingsStore, select)
}

const state = (): TracingsState => tracingsStore.getState()
const set = (patch: Partial<TracingsState>): void => tracingsStore.setState(patch)

/** What main refused or failed at, in its words (the bridge has already taken Electron's wrapping off). */
const said = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** Which tracings main is told are shown: the open one while the main area is on a tracing, the tracings of the cards that are on the board while it is shown, and those shown in the model view (`tracingsShown`). */
export function shownIds(shown: Shown, open: string | null, board?: BoardFile | null, inThree: readonly string[] = []): string[] {
  const seen = shown === 'board' ? (board?.cards ?? []).filter((c) => c.kind === 'tracing' && !c.hidden && c.source !== undefined).map((c) => c.source as string) : shown === 'tracing' && open !== null ? [open] : []
  // The tracings shown in the model view are cut again after a build as well, whichever view is on.
  return [...new Set([...seen, ...inThree])]
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
export const cutKey = (t: Tracing | undefined): string => (t === undefined ? '' : JSON.stringify([t.layout, t.plane, t.parts ?? null]))

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

/** What the Trace tool is told when the person has no layer of their own to draw into. */
export const NO_OWN_LAYER = 'Add a layer of your own to trace into'

/**
 * The layer the Trace tool puts shapes into: the one chosen in the panel when it is the person's and still there, else the
 * person's last layer; undefined when they have none. Claude's layers are never traced into.
 */
export function traceTarget(s: Pick<TracingsState, 'file' | 'open' | 'into'>): Layer | undefined {
  const layers = openTracing(s)?.layers.filter((l) => l.by === 'person') ?? []
  return layers.find((l) => l.id === s.into) ?? layers.at(-1)
}

/** Shapes and layer changes go to main one after the other, each built on the layer as the one before left it. */
let queue: Promise<unknown> = Promise.resolve()

/** Whether the project has a tracing: what `Ctrl+Tab` goes by. */
export const hasTracing = (s: Pick<TracingsState, 'file'> = state()): boolean => (s.file?.tracings.length ?? 0) > 0

/** The browser's part of the photo work, apart so that a test can stand in for it. */
export interface PhotoTools {
  prepare(bytes: Uint8Array, name: string): Promise<Prepared>
  makeUrl(bytes: Uint8Array): string
  revoke(url: string): void
  /** The photo's bytes straightened through `transform` at `scale` px per mm: a PNG. */
  straighten(photo: Uint8Array, transform: readonly number[], width: number, height: number, scale: number): Promise<Uint8Array>
}

const browserTools: PhotoTools = {
  prepare: preparePhoto,
  makeUrl: (bytes) => URL.createObjectURL(new Blob([bytes as BlobPart], { type: imageType(bytes) ?? 'application/octet-stream' })),
  revoke: (url) => URL.revokeObjectURL(url),
  async straighten(photo, transform, width, height, scale) {
    const rect = photoRect(transform, width, height)
    if (rect === null) throw new Error('the line-up sends a corner of the photo to infinity, so it cannot be straightened')
    const bitmap = await createImageBitmap(new Blob([photo as BlobPart], { type: imageType(photo) ?? 'image/jpeg' }), { imageOrientation: 'from-image' })
    const blob = await warp(bitmap, transform, rect, scale)
    return new Uint8Array(await blob.arrayBuffer())
  }
}
let tools: PhotoTools = browserTools

/** Stands something in for the browser's photo work (a test); with nothing, the browser's own. */
export function setPhotoTools(replacement?: PhotoTools): void {
  tools = replacement ?? browserTools
}

/** The runs of `sync` going, by project and tracing, and those asked again while they ran. */
const syncing = new Map<string, Promise<void>>()
const again = new Set<string>()
/** The runs that are to read the photo itself too (a card needs only its straightened copy). */
const wantsOriginal = new Set<string>()

/** Every file name the tracings of the project hold: the pictures of any other are let go. */
function prunePhotos(): void {
  const named = new Set((state().file?.tracings ?? []).flatMap((t) => (t.photo === undefined ? [] : [t.photo.file, ...(t.photo.straightened === undefined ? [] : [t.photo.straightened])])))
  const kept: Record<string, PhotoEntry> = {}
  let gone = false
  for (const [file, entry] of Object.entries(state().photos)) {
    if (named.has(file)) kept[file] = entry
    else {
      gone = true
      if ('url' in entry) tools.revoke(entry.url)
    }
  }
  if (gone) set({ photos: kept })
}

const keepPicture = (file: string, bytes: Uint8Array | null): void => {
  const was = state().photos[file]
  if (was !== undefined && 'url' in was) tools.revoke(was.url)
  set({ photos: { ...state().photos, [file]: bytes === null ? { missing: true } : { url: tools.makeUrl(bytes) } } })
}

/** A look of the photo (`fade`, `hidden`) as one change. */
async function look(patch: { fade?: number; hidden?: boolean }): Promise<boolean> {
  const objectId = state().objectId
  const id = state().open
  if (objectId === null || id === null) return false
  try {
    const made = await window.torno.tracings.look(objectId, id, patch)
    if (state().objectId === objectId) set({ file: withTracing(state().file, made), refused: null })
    return true
  } catch (e) {
    set({ refused: said(e) })
    return false
  }
}

/** One pass of `sync`: what the tracing's photo has now, read or made. */
async function syncOnce(objectId: string, id: string, wantOriginal: boolean): Promise<void> {
  const photoOf = (): NonNullable<Tracing['photo']> | undefined => (state().objectId === objectId ? state().file?.tracings.find((t) => t.id === id)?.photo : undefined)
  let photo = photoOf()
  if (photo === undefined) return
  const file = photo.file
  let original: Uint8Array | null = null
  /** The photo itself, read once into a picture of the window. */
  const readOriginal = async (): Promise<boolean> => {
    if (state().photos[file] === undefined) {
      original = await window.torno.tracings.photoBytes(objectId, id, 'photo').catch(() => null)
      if (photoOf()?.file !== file) return false
      keepPicture(file, original)
    }
    return true
  }
  if (wantOriginal && !(await readOriginal())) return
  photo = photoOf()
  if (photo === undefined || photo.transform === undefined || photo.scale === undefined) return
  const copy = photo.straightened
  if (copy !== undefined && state().photos[copy] === undefined) {
    const bytes = await window.torno.tracings.photoBytes(objectId, id, 'straightened').catch(() => null)
    if (photoOf()?.straightened !== copy) return
    if (bytes !== null) return keepPicture(copy, bytes)
  }
  const there = copy === undefined ? undefined : state().photos[copy]
  if (there !== undefined && 'url' in there) return
  // Made again here: the photo itself must be on this computer.
  if (!(await readOriginal())) return
  const here = state().photos[file]
  if (here === undefined || !('url' in here)) return
  photo = photoOf()
  if (photo === undefined || photo.transform === undefined || photo.scale === undefined) return
  const { transform, sha256, scale, width, height } = photo
  try {
    original ??= await window.torno.tracings.photoBytes(objectId, id, 'photo')
    if (original === null) return
    const made = await tools.straighten(original, transform, width, height, scale)
    const told = await window.torno.tracings.straightened(objectId, id, made, { sha256, transform: transformKey(transform) })
    if (state().objectId !== objectId) return
    set({ file: withTracing(state().file, told) })
    if (told.photo?.straightened !== undefined) keepPicture(told.photo.straightened, made)
    prunePhotos()
  } catch (e) {
    // A copy made for a line-up that has changed since is no failure: the change asks again.
    if (!/another photo or another line-up/.test(said(e))) set({ refused: `The photo could not be straightened: ${said(e)}` })
  }
}

/** The photo as it is drawn under the outline: the straightened copy by its rectangle in mm at the person's fade, and the line-up in words for the title block. Nothing for a hidden photo, one not lined up, or a copy not here. */
export function photoDrawn(t: Pick<Tracing, 'photo'>, photos: Readonly<Record<string, PhotoEntry>>): { photo: NonNullable<TracingExtras['photo']>; said: string } | undefined {
  const photo = t.photo
  if (photo === undefined || photo.hidden === true || photo.straightened === undefined || photo.transform === undefined) return undefined
  const entry = photos[photo.straightened]
  if (entry === undefined || !('url' in entry)) return undefined
  const rect = photoRect(photo.transform, photo.width, photo.height)
  return rect === null ? undefined : { photo: { href: entry.url, rect, fade: photo.fade }, said: lineupSaid(photo) }
}

/** The pictures of the project's `reference/` that a photo may be taken from: the cards of its references that name an image file. */
export const referencePhotos = (cards: readonly Pick<Card, 'kind' | 'source'>[]): string[] => cards.filter((c) => c.kind === 'reference' && c.source !== undefined && /\.(?:png|jpe?g|webp)$/i.test(c.source)).map((c) => c.source as string)

/** Keeps a measure or a "should be here" made through main, and selects the mark; `refused` says why when main would not (or there is no build on show: `nobuild`). */
async function keepMeasure(what: string, nobuild: string, make: (objectId: string, t: Tracing, here: NonNullable<ReturnType<typeof sketchHere>>) => Promise<{ id: string }>): Promise<boolean> {
  const objectId = state().objectId
  const t = openTracing()
  const here = sketchHere()
  if (objectId === null || t === undefined) return false
  if (here === null || here.objectId !== objectId) {
    set({ refused: nobuild })
    return false
  }
  try {
    const made = await make(objectId, t, here)
    if (state().objectId === objectId) set({ selected: { kind: 'mark', id: made.id }, refused: null })
    return true
  } catch (e) {
    set({ refused: `${what} was not kept: ${said(e)}` })
    return false
  }
}

export const tracingActions = {
  /** The project the window shows: the tracings of another are no longer shown. */
  openProject(objectId: string | null): void {
    if (state().objectId === objectId) return
    for (const entry of Object.values(state().photos)) if ('url' in entry) tools.revoke(entry.url)
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
    const lining = s.lining !== null && file.tracings.find((t) => t.id === s.lining)?.photo !== undefined && open === s.open ? s.lining : null
    set({ file, open, cuts, lining, removed: s.removed !== null && ids.has(s.removed.id) ? null : s.removed, ...(open === s.open ? {} : { tool: 'select' as const, selected: null, into: null, layerRemoved: null }) })
    prunePhotos()
    if (open !== null && (open !== s.open || cutKey(wasOpen) !== cutKey(now))) void tracingActions.refreshCut(open)
    // The photo of the tracing shown: its pictures read, and its straightened copy made when it has none here.
    if (open !== null && now?.photo !== undefined) void tracingActions.sync(open)
    // A project that was left on a tracing and has none when it is first read (it was removed on another branch): the model. One whose last tracing is removed now stays on the view that offers the next.
    if (s.file === null && file.tracings.length === 0) boardActions.leaveTracing()
  },

  /** Shows the tracing, and asks for its outline. */
  open(id: string): void {
    set({ open: id, refused: null, tool: 'select', selected: null, into: null, layerRemoved: null, lining: null })
    void tracingActions.refreshCut(id)
    if (openTracing()?.photo !== undefined) void tracingActions.sync(id)
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

  /** The tool in hand on the sheet. Trace with no layer of the person's says what it needs. */
  setTool(tool: TracingTool): void {
    set({ tool, ...(tool === 'select' ? {} : { selected: null }) })
    if (tool === 'trace' && traceTarget(state()) === undefined) set({ refused: NO_OWN_LAYER })
    else if (state().refused === NO_OWN_LAYER) set({ refused: null })
  },

  setTrace(trace: TraceMode): void {
    set({ trace })
  },

  /** The mark or shape Select selected, or none. */
  select(hit: Hit | null): void {
    set({ selected: hit })
  },

  /** The pen Ink draws with. */
  setInk(ink: InkPen): void {
    set({ ink })
  },

  /**
   * A pin of the person's with its note at `uv` of the tracing that is open: made through main (`marks:add`, which ties it to the face under it
   * when it is on the outline, checks it against the plane and works out its `uv`), with the bar of an open review saying what it is. It is
   * the mark selected after. True when main kept it; when it did not, `refused` says why.
   */
  async pin(uv: readonly [number, number], note: string): Promise<boolean> {
    const objectId = state().objectId
    const t = openTracing()
    const here = sketchHere()
    if (objectId === null || t === undefined) return false
    if (here === null || here.objectId !== objectId) {
      set({ refused: 'The project has no build to leave a pin on yet' })
      return false
    }
    try {
      const made = await window.torno.marks.add(objectId, withIntent(pinMark(t, uv, note, here), reviewActions.intentForNew(t.layout)))
      if (state().objectId === objectId) set({ selected: { kind: 'mark', id: made.id }, refused: null })
      return true
    } catch (e) {
      set({ refused: `The pin was not kept: ${said(e)}` })
      return false
    }
  },

  /**
   * A measure of the person's between two ends of the tracing that is open: made through main (`marks:span`), which takes the point of a
   * snapped end from the kernel's own, works out the value and says whether it is exact. It carries no word of a review: the bar of an open
   * review does not apply to it. It is the mark selected after. True when main kept it; when it did not, `refused` says why.
   */
  async span(a: SpanEndDraft, b: SpanEndDraft): Promise<boolean> {
    return keepMeasure('The measure', 'The project has no build to measure on yet', (objectId, t, here) => window.torno.marks.span(objectId, { tracing: t.id, a, b, camera: here.camera }))
  },

  /**
   * "Should be here": a shape of a layer of the tracing that is open dragged by `by` (`[du, dv]` mm along the tracing's axes). Made through
   * main (`marks:offset`), which finds the shape, the layer's revision and the points itself; dragging the same shape again changes the
   * draft. No word of a review goes with it. It is the mark selected after. True when main kept it.
   */
  async offset(layer: number, shape: number, by: [number, number]): Promise<boolean> {
    return keepMeasure('The "should be here"', 'The project has no build to leave a "should be here" on yet', (objectId, t, here) => window.torno.marks.offset(objectId, { tracing: t.id, layer, shape, by, camera: here.camera }))
  },

  /** Delete: the selected mark is removed when it is the person's, and put back by `undoMarkRemove` for a while. The agent's is left, and the sheet says so. */
  async removeSelected(): Promise<boolean> {
    const objectId = state().objectId
    const hit = state().selected
    if (objectId === null || hit === null) return false
    if (hit.kind !== 'mark') {
      set({ refused: 'Only a mark is removed with Delete: change a layer in its own panel' })
      return false
    }
    const mark = store.getState().marks.find((m) => m.id === hit.id)
    if (mark === undefined) return false
    if (!canRemove(mark)) {
      set({ refused: `${mark.id} is Claude's mark: it is Claude's to resolve` })
      return false
    }
    try {
      await window.torno.marks.remove(objectId, mark.id)
      if (state().objectId === objectId) set({ selected: null, markRemoved: mark.id, refused: null })
      return true
    } catch (e) {
      set({ refused: said(e) })
      return false
    }
  },

  /** Puts back the mark Delete removed last. */
  async undoMarkRemove(): Promise<boolean> {
    const objectId = state().objectId
    const id = state().markRemoved
    if (objectId === null || id === null) return false
    set({ markRemoved: null })
    try {
      const back = await window.torno.marks.restore(objectId, id)
      if (state().objectId === objectId) set({ selected: { kind: 'mark', id: back.id } })
      return true
    } catch (e) {
      set({ refused: said(e) })
      return false
    }
  },

  forgetMarkRemoved(): void {
    set({ markRemoved: null })
  },

  /** Chooses the person's layer the Trace tool draws into. */
  setInto(layer: number): void {
    set({ into: layer })
    if (state().refused === NO_OWN_LAYER) set({ refused: null })
  },

  /**
   * One finished shape into the person's layer: the layer as it now is with the shape after its own, as one change of that
   * layer. Shapes sent together are kept, each sent on the layer as the one before left it. True when main took it.
   */
  addShape(shape: LayerShape): Promise<boolean> {
    const objectId = state().objectId
    const tracing = state().open
    const target = traceTarget(state())
    if (objectId === null || tracing === null) return Promise.resolve(false)
    if (target === undefined) {
      set({ refused: NO_OWN_LAYER })
      return Promise.resolve(false)
    }
    const run = queue.then(async () => {
      const layer = state().file?.tracings.find((t) => t.id === tracing)?.layers.find((l) => l.id === target.id)
      if (layer === undefined || state().objectId !== objectId) return false
      try {
        const made = await window.torno.tracings.layer(objectId, tracing, { edit: layer.id, shapes: [...layer.shapes, shape] })
        if (state().objectId === objectId) set({ file: withTracing(state().file, made), refused: null })
        return true
      } catch (e) {
        set({ refused: said(e) })
        return false
      }
    })
    queue = run
    return run
  },

  /** A new, empty layer of the person's, traced into from then on. */
  async addLayer(name: string, colour: LayerColour): Promise<boolean> {
    const objectId = state().objectId
    const tracing = state().open
    if (objectId === null || tracing === null) return false
    try {
      const made = await window.torno.tracings.layer(objectId, tracing, { make: { name, colour, shapes: [] } })
      if (state().objectId !== objectId) return true
      const wanted = name.trim().toLowerCase()
      const layer = made.layers.find((l) => l.name.toLowerCase() === wanted)
      set({ file: withTracing(state().file, made), refused: null, ...(layer === undefined ? {} : { into: layer.id }) })
      return true
    } catch (e) {
      set({ refused: said(e) })
      return false
    }
  },

  /** Hides or shows a layer, whoever's it is. */
  async hideLayer(layer: number, hidden: boolean): Promise<boolean> {
    const objectId = state().objectId
    const tracing = state().open
    if (objectId === null || tracing === null) return false
    try {
      const made = await window.torno.tracings.layer(objectId, tracing, { hide: layer, hidden })
      if (state().objectId === objectId) set({ file: withTracing(state().file, made), refused: null })
      return true
    } catch (e) {
      set({ refused: said(e) })
      return false
    }
  },

  /** Takes one of the person's layers away, its shapes kept here so that `undoRemoveLayer` can put it back. Claude's is not the person's to remove. */
  async removeLayer(layer: number): Promise<boolean> {
    const objectId = state().objectId
    const tracing = state().open
    const was = openTracing()?.layers.find((l) => l.id === layer)
    if (objectId === null || tracing === null || was === undefined) return false
    if (was.by !== 'person') {
      set({ refused: `${was.name} is Claude's layer: Claude changes and removes its own` })
      return false
    }
    try {
      const made = await window.torno.tracings.layer(objectId, tracing, { remove: layer })
      if (state().objectId === objectId) set({ file: withTracing(state().file, made), layerRemoved: { tracing, layer: was }, refused: null })
      return true
    } catch (e) {
      set({ refused: said(e) })
      return false
    }
  },

  /** Puts the layer removed last back, as it was: main keeps it and gives it the number it had (what a mark or an offset names). */
  async undoRemoveLayer(): Promise<boolean> {
    const objectId = state().objectId
    const removed = state().layerRemoved
    if (objectId === null || removed === null) return false
    set({ layerRemoved: null })
    try {
      const made = await window.torno.tracings.layer(objectId, removed.tracing, { restore: removed.layer.id })
      if (state().objectId !== objectId) return true
      set({ file: withTracing(state().file, made), refused: null, ...(state().open !== removed.tracing ? {} : { into: removed.layer.id }) })
      return true
    } catch (e) {
      set({ refused: said(e) })
      return false
    }
  },

  forgetLayerRemoved(): void {
    if (state().layerRemoved !== null) set({ layerRemoved: null })
  },

  /**
   * Keeps a picture as the open tracing's photo: decoded with its turn applied and scaled to 4000 px here (`prepare`), checked and named by
   * main. The line-up opens for it (a swapped photo keeps the tracing side of the points and asks only for the photo's). True when main kept it;
   * what went wrong is in `refused`, in words.
   */
  async addPhoto(source: { name: string; bytes: () => Promise<Uint8Array>; from?: string }): Promise<boolean> {
    const objectId = state().objectId
    const id = state().open
    if (objectId === null || id === null) return false
    try {
      const prepared = await tools.prepare(await source.bytes(), source.name)
      const made = await window.torno.tracings.photo(objectId, id, prepared.image, source.from)
      if (state().objectId !== objectId) return true
      set({ file: withTracing(state().file, made), refused: null, ...(state().open === id ? { lining: id, tool: 'select' as const } : {}) })
      prunePhotos()
      // The bytes are in hand: the picture is kept without a read.
      if (made.photo !== undefined && state().photos[made.photo.file] === undefined) keepPicture(made.photo.file, prepared.image)
      void tracingActions.sync(id)
      return true
    } catch (e) {
      set({ refused: said(e) })
      return false
    }
  },

  /** The photo dialog: the first picture chosen becomes the open tracing's photo (a tracing has one). Nothing when it is cancelled. */
  async choosePhoto(): Promise<boolean> {
    let paths: string[]
    try {
      paths = await window.torno.objects.pickPhotos()
    } catch (e) {
      set({ refused: said(e) })
      return false
    }
    const path = paths[0]
    if (path === undefined) return false
    return tracingActions.addPhoto({ name: path.split(/[\\/]/).pop() ?? path, bytes: () => window.torno.objects.readPhoto(path) })
  },

  /** A photo of the project's `reference/` as the open tracing's photo: the copy is kept, and the reference is named so that the tracing says where it came from. */
  async addReference(file: string): Promise<boolean> {
    const objectId = state().objectId
    if (objectId === null) return false
    return tracingActions.addPhoto({
      name: file.replace(/^reference\//, ''),
      from: file,
      bytes: async () => {
        const got = await window.torno.board.reference(objectId, file)
        if (got === null) throw new Error(`${file} is not there any more`)
        return got.bytes
      }
    })
  },

  /** Opens the line-up of the open tracing's photo. */
  startLineUp(): void {
    const t = openTracing()
    if (t?.photo === undefined) return
    set({ lining: t.id, refused: null, tool: 'select' })
  },

  /** Closes the line-up and leaves what the photo had. */
  cancelLineUp(): void {
    if (state().lining !== null || state().refused !== null) set({ lining: null, refused: null })
  },

  /** Sends the clicks: main fits them itself and keeps the result. Closes the line-up when it did; says why when it would not. */
  async lineUp(pairs: LineupPair[], method: 'similar' | 'straight'): Promise<boolean> {
    const objectId = state().objectId
    const id = state().lining
    if (objectId === null || id === null) return false
    try {
      const made = await window.torno.tracings.lineUp(objectId, id, pairs, method)
      if (state().objectId !== objectId) return true
      set({ file: withTracing(state().file, made), refused: null, lining: null })
      prunePhotos()
      void tracingActions.sync(id)
      return true
    } catch (e) {
      set({ refused: said(e) })
      return false
    }
  },

  /** The photo's fade, 0 to 1, sent once. */
  setFade(fade: number): Promise<boolean> {
    return look({ fade })
  },

  setHidden(hidden: boolean): Promise<boolean> {
    return look({ hidden })
  },

  /** Takes the photo off the open tracing, with its line-up. */
  async removePhoto(): Promise<boolean> {
    const objectId = state().objectId
    const id = state().open
    if (objectId === null || id === null) return false
    try {
      const made = await window.torno.tracings.removePhoto(objectId, id)
      if (state().objectId !== objectId) return true
      set({ file: withTracing(state().file, made), refused: null, lining: null })
      prunePhotos()
      return true
    } catch (e) {
      set({ refused: said(e) })
      return false
    }
  },

  /**
   * Has the pictures of a tracing's photo: the photo itself (its thumbnail, and what the line-up is clicked on), and its straightened copy, which
   * is read when main has it and made here, from the photo through the line-up, when it has not (a line-up just made, or a copy that is not on this
   * computer). One run for a tracing at a time; asked again while it runs it does it once more at the end when the photo has changed meanwhile.
   */
  sync(id: string, original = true): Promise<void> {
    const objectId = state().objectId
    if (objectId === null) return Promise.resolve()
    const key = `${objectId}/${id}`
    const was = syncing.get(key)
    if (was !== undefined) {
      again.add(key)
      if (original) wantsOriginal.add(key)
      return was
    }
    if (original) wantsOriginal.add(key)
    const run = (async () => {
      do {
        again.delete(key)
        const wanted = wantsOriginal.delete(key)
        await syncOnce(objectId, id, wanted)
      } while (again.has(key) && state().objectId === objectId)
    })().finally(() => {
      syncing.delete(key)
      wantsOriginal.delete(key)
    })
    syncing.set(key, run)
    return run
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
    const ids = objectId === null ? [] : shownIds(boardStore.getState().shown, state().open, boardStore.getState().board, store.getState().tracingsShown)
    if (told !== null && told.objectId === objectId && told.ids.join() === ids.join()) return
    if (told !== null && told.objectId !== objectId && told.ids.length > 0) window.torno.tracings.shown(told.objectId, [])
    if (objectId !== null && (ids.length > 0 || (told !== null && told.objectId === objectId))) window.torno.tracings.shown(objectId, ids)
    told = objectId === null ? null : { objectId, ids }
  }
  const offBoard = boardStore.subscribe(tell)
  const offShownIn3D = store.subscribe((s, prev) => {
    if (s.tracingsShown !== prev.tracingsShown) tell()
  })
  const offTracings = tracingsStore.subscribe((s, prev) => {
    if (s.open !== prev.open || s.objectId !== prev.objectId) tell()
  })
  const offChanged = window.torno.tracings.onChanged((m) => tracingActions.told(m))
  const offOutline = window.torno.tracings.onOutline((m) => tracingActions.cutTold(m))
  const offProblem = window.torno.tracings.onProblem((m) => tracingActions.problemTold(m))
  return () => {
    offStore()
    offBoard()
    offShownIn3D()
    offTracings()
    offChanged()
    offOutline()
    offProblem()
  }
}
