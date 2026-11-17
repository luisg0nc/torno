import * as THREE from 'three'
import { count } from '../../shared/format'
import type { RegionMark } from '../../shared/marks'
import { maskStem } from '../../shared/regions'
import { maskBits } from '../../shared/scans'
import type { Camera } from '../../shared/view'
import { NOTHING_PAINTED_STATE, radiusOf, regionStore, usualRadius } from '../state/region'
import { reviewActions } from '../state/review'
import { actions, store } from '../state/store'
import { setTool, toolStore } from '../state/tools'
import { TriangleSet, growFlat } from '../viewport/scanPaint'
import { meshOf } from '../viewport/scans'
import type { Viewport } from '../viewport/Viewport'
import type { ToolContext, ToolViewport } from './Tool'

// What is painted with the Region tool and not yet kept: the registry of paintings, by object, and what the
// bar, a mark's row and the tool (./regionTool) do with one.
//
// A painting is never lost by accident. Only "Clear" discards one, and Undo brings that back while the tool is
// in hand. Another tool, Escape, another object: the painting waits, of its object and its scan, and is there
// when the person comes back (in this run: it is not saved). It goes only with its scan, or with the mesh it
// was painted on, and then the bar says so.

export const NO_SCAN = 'Import a scan first'
export const NOT_INDEXED = 'The scan is still being indexed'
export const NOTHING_PAINTED = 'Paint some of the scan first: a region needs at least one triangle'
export const CHOOSE_SCAN = 'Press on the scan to paint on'
export const KEEPING = 'Keeping it: paint on once it is kept'
export const IN_HAND = 'Keep or clear the painting in hand first'
export const CLEARED = 'Cleared. Undo brings it back'
export function paintingOn(scan: string): string {
  return `Painting on ${scan}: keep or clear that first`
}
/** Said in the bar when a painting that waited is in hand again. */
export function waiting(triangles: number, scan: string): string {
  return `A painting of ${count(triangles)} ${triangles === 1 ? 'triangle' : 'triangles'} on ${scan} is waiting: Keep or Clear, or paint on`
}
function readAgain(scan: string): string {
  return `${scan} was read again: what was painted on it was of the mesh it had`
}
function scanGone(scan: string): string {
  return `${scan} is gone: what was painted on it went with it`
}

/** Grow to flat: how far off the plane, how far turned from it, how far it reaches in brush radii, and the most it adds. */
const GROW = { flat: 2, degrees: 15, reach: 2, most: 200_000 }

export type Painter = Pick<ToolViewport, 'paintScan' | 'scanTree' | 'showBrush'>
/** What one stroke, one box or one growing changed: taken back as one. */
export interface Step { added: number[]; removed: number[] }
export interface Painting {
  objectId: string
  scan: string
  /** Which mesh of that scan it is of (`meshOf`): read again, the scan has another. */
  mesh: string
  set: TriangleSet
  /** Its area in the scan's own millimetres. */
  area: number
  steps: Step[]
  /** The kept region it is a painting-again of, by its mark's number; absent for a new one. */
  editing?: string
}

/** What is painted and not yet kept, by object: one painting of one scan each, waiting while another object is on show. */
export const paintings = new Map<string, Painting>()
/** What "Clear" last put down, by object: Undo brings it back until something else is painted. */
export const cleared = new Map<string, Painting>()
/** The painting the viewport draws now, and what tells the tint that it changed. */
let drawn: { of: Painting; on: Painter; paint: { touched(): void } | null } | null = null
/** Main has been asked to keep it. */
let sending = false
/** "Grow to flat" is under way. */
let growing = false
export const GROWING = 'Growing…'
/** Once the window has drawn what was just said: before work that holds it. At once where there is no window to draw. */
const drawnOnce = (): Promise<void> => new Promise((resolve) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => setTimeout(resolve, 0)) : resolve()))
/** Where the pointer last was, for what is said from a key or a button. */
let lastClient: [number, number] = [0, 0]
/** The viewport that draws: the window's (`connectRegion`), or the one the last pointer event came from. */
let painter: Painter | null = null
let host: Pick<Viewport, 'getCamera'> | null = null

const a = new THREE.Vector3()
const b = new THREE.Vector3()
const c = new THREE.Vector3()

/** The area of a triangle of a geometry, in its own units. */
export function areaOf(geometry: THREE.BufferGeometry, triangle: number): number {
  const position = geometry.getAttribute('position')
  const index = geometry.index!.array
  a.fromBufferAttribute(position, index[triangle * 3])
  b.fromBufferAttribute(position, index[triangle * 3 + 1]).sub(a)
  c.fromBufferAttribute(position, index[triangle * 3 + 2]).sub(a)
  return b.cross(c).length() / 2
}

/**
 * The painting of the object on show, if it has one: it goes only when its scan is gone or is another mesh than
 * it was painted on, once the scans of that object are known (`scansKnown`), and the bar then says which.
 */
export function current(): Painting | null {
  const s = store.getState()
  const mine = s.objectId === null ? undefined : paintings.get(s.objectId)
  if (!mine) return null
  const scan = s.scans.find((one) => one.id === mine.scan)
  // An object just opened has no scans yet, known or not: what main says of them comes after it is on show.
  if ((scan && meshOf(scan) === mine.mesh) || (!scan && !s.scansKnown)) return mine
  paintings.delete(mine.objectId)
  regionStore.setState({ notice: scan ? readAgain(mine.scan) : scanGone(mine.scan), refused: null })
  return null
}

/** Has the viewport draw the painting of the object on show while the tool is in hand, and none otherwise: it waits unseen. */
export function show(): void {
  const wanted = toolStore.getState().tool === 'region' ? current() : null
  if (drawn && (drawn.of !== wanted || drawn.on !== painter)) {
    drawn.on.paintScan?.(null, null)
    drawn = null
  }
  if (wanted && !drawn && painter) drawn = { of: wanted, on: painter, paint: painter.paintScan?.(wanted.scan, wanted.set) ?? null }
}

/** Says in the bar how much is painted: once a stroke has ended, never during one. */
export function publish(): void {
  const mine = current()
  show()
  const objectId = store.getState().objectId
  const back = objectId !== null && cleared.has(objectId)
  if (!mine) return regionStore.setState({ ...NOTHING_PAINTED_STATE, editing: null, canUndo: back })
  const scale = painter?.scanTree?.(mine.scan)?.built.group.scale.x ?? 1
  regionStore.setState({ scan: mine.scan, count: mine.set.count, area: mine.area * scale * scale, canUndo: mine.steps.length > 0, editing: mine.editing ?? null })
}

/** Puts down what is painted, without keeping it: "Clear", the one way a painting is discarded. Undo brings it back. */
export function clearRegion(): void {
  const mine = current()
  if (!mine) return
  paintings.delete(mine.objectId)
  if (mine.set.count > 0) cleared.set(mine.objectId, mine)
  regionStore.setState({ refused: null, notice: mine.set.count > 0 ? CLEARED : null })
  publish()
}

/** Takes back the last stroke, box or growing; with nothing painted, what "Clear" last put down. */
export function undoStroke(): void {
  const mine = current()
  const objectId = store.getState().objectId
  if (!mine) {
    const back = objectId === null ? undefined : cleared.get(objectId)
    if (!back) return
    cleared.delete(back.objectId)
    paintings.set(back.objectId, back)
    regionStore.setState({ notice: null })
    return publish()
  }
  const step = mine.steps.pop()
  if (!step) return
  const geometry = painter?.scanTree?.(mine.scan)?.built.mesh.geometry
  for (const t of step.added) if (mine.set.delete(t) && geometry) mine.area -= areaOf(geometry, t)
  for (const t of step.removed) if (mine.set.add(t) && geometry) mine.area += areaOf(geometry, t)
  if (mine.set.count === 0) mine.area = 0
  drawn?.paint?.touched()
  publish()
}

/** The brush's radius on a scan, in millimetres of the view: the one chosen, or the usual share of the scan's size as it stands. */
export function brushRadius(scan: string, viewport: Painter): number {
  const chosen = radiusOf(regionStore.getState().radius)
  if (chosen !== null) return chosen
  const info = store.getState().scans.find((one) => one.id === scan)
  return info ? usualRadius(info, viewport.scanTree?.(scan)?.built.group.scale.x ?? 1) : 1
}

/** Grows what is painted over what lies flat with it: "Grow to flat". One step, taken back as one. Says when it stopped at the most it adds at once. */
export async function growRegion(): Promise<void> {
  const mine = current()
  if (!mine || mine.set.count === 0) return void regionStore.setState({ notice: NOTHING_PAINTED })
  const found = painter?.scanTree?.(mine.scan)
  if (!found || !painter || growing) return
  // On a large patch of a large scan this holds the window for a moment: it says so first, and is drawn saying it.
  growing = true
  regionStore.setState({ notice: GROWING, refused: null })
  await drawnOnce()
  growing = false
  if (current() !== mine || painter === null) return void regionStore.setState({ notice: null })
  const scale = found.built.group.scale.x
  const step: Step = { added: [], removed: [] }
  const grown = growFlat(found.tree, found.built.mesh.geometry, mine.set, {
    flat: GROW.flat / scale,
    degrees: GROW.degrees,
    reach: (GROW.reach * brushRadius(mine.scan, painter)) / scale,
    most: GROW.most,
    each: (t) => {
      step.added.push(t)
      mine.area += areaOf(found.built.mesh.geometry, t)
    }
  })
  if (step.added.length > 0) mine.steps.push(step)
  drawn?.paint?.touched()
  regionStore.setState({ notice: grown >= GROW.most ? `Grew by ${count(grown)} triangles, the most at once: grow again to go on` : grown === 0 ? 'Nothing flat with it is within reach' : null })
  publish()
}

type Keeper = Pick<ToolContext, 'layout' | 'revision' | 'camera' | 'openNote' | 'readout'>

/**
 * Has main keep what is painted: "Keep", and Enter. A new painting becomes a region mark, whose note then
 * opens; a painting-again of a kept region becomes that region's triangles. Main is sent the bits and says the
 * rest. A set with no triangle is not sent. What main refuses is said, at the pointer and in the bar, and what
 * was painted stays in hand.
 */
export async function keepRegion(ctx?: Keeper): Promise<void> {
  if (sending) return
  const say = (text: string): void => {
    ctx?.readout.say(lastClient, text)
  }
  const hand = current()
  if (!hand || hand.set.count === 0) {
    regionStore.setState({ notice: NOTHING_PAINTED })
    return say(NOTHING_PAINTED)
  }
  const s = store.getState()
  const camera: Camera | undefined = ctx?.camera ?? host?.getCamera()
  if (!camera) return
  sending = true
  regionStore.setState({ sending: true, refused: null, notice: null })
  try {
    const bits = hand.set.bits.slice()
    const layout = ctx?.layout ?? s.layout
    // What the bar of an open review says of a region made now (a region painted again keeps what it was).
    const intent = reviewActions.intentForNew(layout)
    const mark = hand.editing ? await window.torno.marks.repaintRegion(hand.objectId, hand.editing, bits) : await window.torno.marks.addRegion(hand.objectId, { scan: hand.scan, note: '', layout, revision: ctx?.revision ?? s.revision, camera, bits, ...(intent ? { intent } : {}) })
    sending = false
    regionStore.setState({ sending: false })
    // What was in hand went into it.
    if (paintings.get(hand.objectId) === hand) paintings.delete(hand.objectId)
    cleared.delete(hand.objectId)
    publish()
    if (hand.editing) return
    // A region is of its scan in every layout: its note opens in the one on show.
    if (ctx) ctx.openNote(mark)
    else actions.openNote({ objectId: hand.objectId, layout: store.getState().layout, id: mark.id })
  } catch (e) {
    sending = false
    const message = e instanceof Error ? e.message : String(e)
    regionStore.setState({ sending: false, refused: message })
    say(message)
  }
}

/**
 * Takes a kept region in hand to paint it again: "Edit" on its row. Its triangles, asked of main, are the
 * painting; "Keep" then makes them the region's. Not while another painting is in hand.
 */
export async function editRegion(mark: RegionMark): Promise<void> {
  const s = store.getState()
  const { objectId } = s
  if (!objectId || sending) return
  if ((current()?.set.count ?? 0) > 0) {
    setTool('region')
    return regionStore.setState({ notice: IN_HAND })
  }
  const scan = s.scans.find((one) => one.id === mark.scan)
  if (!scan || mark.anchorState === 'orphaned') return
  try {
    const bits = maskBits(new Uint8Array(await window.torno.scans.mask(objectId, mark.scan, maskStem(mark))), scan.imported.triangles)
    if (store.getState().objectId !== objectId || (current()?.set.count ?? 0) > 0) return
    paintings.set(objectId, { objectId, scan: mark.scan, mesh: meshOf(scan), set: new TriangleSet(scan.imported.triangles, bits), area: mark.area, steps: [], editing: mark.id })
    cleared.delete(objectId)
    regionStore.setState({ refused: null, notice: `Painting ${mark.id} again: Keep makes this the region, Clear leaves it as it was` })
    setTool('region')
    publish()
  } catch (e) {
    regionStore.setState({ refused: e instanceof Error ? e.message : String(e) })
  }
}


/** Whether main has been asked to keep the painting in hand: nothing is added to it meanwhile. */
export const isSending = (): boolean => sending

/** The painting drawn was changed: its tint is told. */
export function touched(): void {
  drawn?.paint?.touched()
}

/** Where the pointer last was, for what is said from a key or a button. */
export function pointerAt(client: [number, number]): void {
  lastClient = client
}

/** The viewport the last pointer or key event came from: it draws from now on. */
export function paintOn(viewport: Painter): void {
  painter = viewport
}

/** The window's viewport, which draws and gives the camera (`connectRegion`); with null it is left: what it drew of a painting is taken away. */
export function join(viewport: (Painter & Pick<Viewport, 'getCamera'>) | null): void {
  if (viewport === null && drawn) drawn.on.paintScan?.(null, null)
  if (viewport === null) drawn = null
  host = viewport
  painter = viewport
}


/** For tests: nothing is painted, cleared or waiting anywhere. */
export function forgetPaintings(): void {
  if (drawn) drawn.on.paintScan?.(null, null)
  drawn = null
  paintings.clear()
  cleared.clear()
  sending = false
  growing = false
  painter = null
}
