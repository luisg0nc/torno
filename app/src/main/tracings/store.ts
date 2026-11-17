import { isDeepStrictEqual } from 'node:util'
import { number } from '../../shared/format'
import { type LineupPair, type LineupSnap, MOST_PAIRS, SIMILAR_NEEDS, STRAIGHT_NEEDS, fitSimilar, fitStraight, transformKey } from '../../shared/lineup'
import type { Vec3 } from '../../shared/marks'
import { faceLabel } from '../../shared/planes'
import {
  LAYER_COLOURS,
  MAX_LAYER_NAME,
  MAX_TRACING_NAME,
  MOST_LAYERS,
  MOST_SHAPES,
  MOST_TRACINGS,
  MOST_TRACING_POINTS,
  TRACING_ID,
  type Layer,
  type LayerColour,
  type LayerShape,
  type PlaneSnap,
  type Tracing,
  type TracingPlane,
  type TracingsFile,
  pointCount
} from '../../shared/tracings'
import { Refusal } from '../refusal'
import { dropPhotos } from './dropped'
import { diskText, loadTracingsFile, readPlane, readShape, saveTracingsFile, textOf } from './file'
import { savePhoto } from './photos'

interface TracingEvents {
  /** The tracings of a project changed: the whole file, as it now is. */
  changed: { objectId: string; file: TracingsFile }
  /** Something about a project's tracings file the person should know, as a sentence. Said once; `problem()` answers it afterwards. */
  problem: { objectId: string; message: string }
}

/** The bounds of the outline in `uv`, which a layer's numbers are held to: none further than ten diagonals off. */
export interface OutlineBounds {
  min: [number, number]
  max: [number, number]
}

export type LayerChange =
  | { make: Pick<Layer, 'name' | 'colour' | 'shapes'> }
  | { edit: number; name?: string; colour?: LayerColour; shapes?: LayerShape[] }
  | { remove: number }
  /** Puts back a layer of its own that was removed in this run (the last `REMOVED_KEPT` of its project), with its number. */
  | { restore: number }

export interface TracingStoreDeps {
  dirOf(objectId: string): string | undefined
  now?(): Date
}

/** How many removed tracings `restore` can bring back, per project: the last this many. */
export const REMOVED_KEPT = 20
/** How far a number of a layer may be from the outline, in diagonals of its bounds. */
const MOST_DIAGONALS = 10
const MOST_PARTS = 500
const MAX_TEXT = 200
/** How far a snapped point of a line-up may be from the kernel's point it says it snapped to, mm. */
const SNAP_WITHIN = 0.01
/** The reference a photo was taken from, as the window names it: a file of the project's `reference/`. */
const REFERENCE_PHOTO = /^reference\/[^/\\\0]{1,200}$/

const finitePair = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && v.every((c) => typeof c === 'number' && Number.isFinite(c))

/**
 * What a point of a line-up that says it was snapped is held to: the kernel's own point of the last build's outline (`snaps`), found
 * by what the snap names (a corner by its place, a hole centre by its edge's ref or its place, a vertex by its ref) and no more than
 * `SNAP_WITHIN` from the point the window gave. The point and the snap are then the kernel's, not the window's.
 */
function snappedPoint(n: number, uv: [number, number], raw: LineupSnap, snaps: readonly PlaneSnap[] | undefined): { uv: [number, number]; snap: LineupSnap } {
  const where = `Point ${n}`
  if (snaps === undefined) throw new Refusal(`${where} says what it was snapped to, and there is no outline of this tracing on a build to check that against: build the model first.`)
  const nearest = <T extends PlaneSnap>(list: T[], to: readonly [number, number]): T | undefined => list.reduce<T | undefined>((best, one) => (best === undefined || Math.hypot(one.uv[0] - to[0], one.uv[1] - to[1]) < Math.hypot(best.uv[0] - to[0], best.uv[1] - to[1]) ? one : best), undefined)
  const given = raw as Record<string, unknown>
  const kinds = (['corner', 'centre', 'vertex'] as const).filter((k) => k in given)
  if (kinds.length !== 1) throw new Refusal(`${where} was snapped to a corner, a centre or a vertex: one of them.`)
  let found: PlaneSnap | undefined
  let snap: LineupSnap
  let what: string
  if (kinds[0] === 'corner') {
    if (!finitePair(given.corner)) throw new Refusal(`${where} says it is a corner, and a corner is a place [u, v] in millimetres.`)
    found = nearest(snaps.filter((s) => s.kind === 'corner'), given.corner)
    what = 'a corner of the cut'
    snap = { corner: found?.uv ?? given.corner }
  } else if (kinds[0] === 'centre') {
    const centres = snaps.filter((s) => s.kind === 'centre')
    if (typeof given.centre === 'string') {
      const ref = given.centre
      found = nearest(centres.filter((s) => s.edge === ref), uv)
      what = `the hole centre of ${ref}`
      snap = { centre: ref }
    } else if (finitePair(given.centre)) {
      found = nearest(centres, given.centre)
      what = 'a hole centre'
      snap = { centre: found?.uv ?? given.centre }
    } else throw new Refusal(`${where} says it is a hole centre, and that is named by its edge or given as a place [u, v].`)
  } else {
    if (typeof given.vertex !== 'string' || given.vertex === '' || given.vertex.length > MAX_TEXT) throw new Refusal(`${where} says it is a vertex, and a vertex is named by its ref.`)
    const ref = given.vertex
    const there = snaps.filter((s) => s.kind === 'vertex' && s.ref === ref)
    found = nearest(there, uv)
    if (found?.kind === 'vertex' && found.projected) throw new Refusal(`${where}: ${ref} is not in the tracing's plane, so a point of the photo cannot be lined up with it.`)
    what = `the vertex ${ref}`
    snap = { vertex: ref }
  }
  if (found === undefined) throw new Refusal(`${where}: the outline of this tracing on the last build has no ${what.replace(/^(?:a|the) /, '')}.`)
  const off = Math.hypot(found.uv[0] - uv[0], found.uv[1] - uv[1])
  if (off > SNAP_WITHIN) throw new Refusal(`${where} says it was snapped to ${what}, and it is ${number(off)} mm from it: the kernel's point is at ${number(found.uv[0])}, ${number(found.uv[1])}.`)
  return { uv: [found.uv[0], found.uv[1]], snap }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const finiteVec3 = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every((c) => typeof c === 'number' && Number.isFinite(c))

/** A name that is one line of at most `max` characters, trimmed; empty when none is given and `required` is not set. */
function nameOf(value: unknown, max: number, what: string, required = false): string {
  if (value === undefined && !required) return ''
  if (typeof value !== 'string') throw new Refusal(`The name of ${what} must be text.`)
  if (/[\r\n]/.test(value)) throw new Refusal(`The name of ${what} must be one line.`)
  const name = value.trim()
  if (required && name === '') throw new Refusal(`${what[0].toUpperCase()}${what.slice(1)} needs a name.`)
  if (name.length > max) throw new Refusal(`The name of ${what} is ${name.length} characters long, and at most ${max} are kept.`)
  return name
}

function partsOf(value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || !value.every((p) => typeof p === 'string' && p !== '' && p.length <= MAX_TEXT)) throw new Refusal('The parts of a tracing are a list of part names.')
  if (value.length === 0) throw new Refusal('Name at least one part, or leave the parts out to draw them all.')
  if (value.length > MOST_PARTS) throw new Refusal(`A tracing names at most ${MOST_PARTS} parts.`)
  return [...new Set(value as string[])]
}

/** The shapes a layer is asked to hold, each with only its own keys: whole, finite, within the caps and (given the bounds of the outline) within ten diagonals of it. */
function checkedShapes(value: unknown, bounds: OutlineBounds | undefined): LayerShape[] {
  if (!Array.isArray(value)) throw new Refusal('The shapes of a layer are a list.')
  if (value.length > MOST_SHAPES) throw new Refusal(`A layer holds at most ${MOST_SHAPES} shapes, and this has ${value.length}.`)
  const reach = bounds === undefined ? Infinity : MOST_DIAGONALS * (Math.hypot(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1]) || 1)
  const within = (n: number, axis: 0 | 1): boolean => bounds === undefined || (n >= bounds.min[axis] - reach && n <= bounds.max[axis] + reach)
  const shapes: LayerShape[] = []
  value.forEach((raw, i) => {
    const read = readShape(raw)
    if ('problem' in read) throw new Refusal(`Shape ${i + 1} ${read.problem}.`)
    const s = read.shape
    const points: Array<[number, number]> = s.kind === 'polyline' ? s.points : s.kind === 'circle' ? [s.centre] : [s.at]
    if (!points.every(([u, v]) => within(u, 0) && within(v, 1)) || (s.kind === 'circle' && s.radius > reach)) {
      throw new Refusal(`Shape ${i + 1} reaches further than ten diagonals of the outline (millimetres, in the tracing's own u and v): check its numbers.`)
    }
    shapes.push(s)
  })
  return shapes
}

function colourOf(value: unknown): LayerColour {
  const colour = LAYER_COLOURS.find((c) => c === value)
  if (!colour) throw new Refusal(`A layer's colour is one of ${LAYER_COLOURS.join(', ')}.`)
  return colour
}

function tracingOf(file: TracingsFile, id: unknown): Tracing {
  if (typeof id !== 'string' || !TRACING_ID.test(id)) throw new Refusal(`${String(id)} is not a tracing: a tracing is T1, T2, …`)
  const found = file.tracings.find((t) => t.id === id)
  if (!found) throw new Refusal(`no tracing ${id}; tracings: ${file.tracings.map((t) => t.id).join(', ') || 'none'}`)
  return found
}

function layerOf(t: Tracing, id: unknown): Layer {
  const found = typeof id === 'number' ? t.layers.find((l) => l.id === id) : undefined
  if (!found) throw new Refusal(`no layer ${String(id)} in ${t.id}; layers: ${t.layers.map((l) => l.id).join(', ') || 'none'}`)
  return found
}

const owner = (by: 'person' | 'agent'): string => (by === 'agent' ? "Claude's" : "the person's")

/** Each of the person and Claude changes and removes only their own layers: a layer of the other's is refused by the owner's name. */
function ownLayer(t: Tracing, layer: Layer, by: 'person' | 'agent'): void {
  if (layer.by === by) return
  throw new Refusal(`Layer ${layer.id} (${layer.name}) of ${t.id} is ${owner(layer.by)}: ${by === 'agent' ? 'Claude changes only its own layers' : 'the person changes only their own layers'}.`)
}

const checkedBy = (by: unknown): 'person' | 'agent' => {
  if (by !== 'person' && by !== 'agent') throw new Error(`a tracing is changed by the person or the agent, not ${String(by)}`)
  return by
}

/**
 * The tracings of the projects of the open workspace, and the only writer of their `.torno/tracings.json`. A project's file is
 * read once and kept in memory; what is done to it is done one thing at a time per project, each change written (atomically)
 * before it is told. Before a change the file is compared with the text main last read or wrote: when it was changed from
 * outside (a git pull) the disk's file is the base the change is made on. Every method rejects for a project whose folder is
 * not known, and refuses in words what cannot be done (`Refusal`).
 *
 * `id`, `by`, `nextLayer`, `lost` of a tracing, and a layer's `id` and `by`, are main's: nothing the window or a tool says of
 * them is taken. Numbers are given from `next` and `nextLayer` and never again, not after a removal, an undo or a pull.
 */
export class TracingStore {
  /** By project folder: the file as last read or written. */
  private files = new Map<string, TracingsFile>()
  /** By project folder: the text of the file as main last read or wrote it (null: no file, or none it may read). A file that is other than this was changed from outside. */
  private disk = new Map<string, string | null>()
  /** By project folder: the tracings removed in this run (the last `REMOVED_KEPT`), whole, which `restore` may bring back. */
  private removed = new Map<string, Tracing[]>()
  /** By project folder: the layers removed in this run (the last `REMOVED_KEPT`), whole, which `{ restore }` may bring back to their tracing. */
  private removedLayers = new Map<string, Array<{ tracing: string; layer: Layer }>>()
  /** By project folder: what was wrong with its file when it was read, until it is dismissed. */
  private problems = new Map<string, string>()
  /** By project folder: the last thing asked of its tracings, which the next waits for. */
  private turns = new Map<string, Promise<unknown>>()
  /** Counts `forget`: what was read before one is not kept after it, and what waited out one is not told. */
  private epoch = 0
  private listeners: { [E in keyof TracingEvents]: Array<(m: TracingEvents[E]) => void> } = { changed: [], problem: [] }

  constructor(private deps: TracingStoreDeps) {}

  on<E extends keyof TracingEvents>(event: E, cb: (m: TracingEvents[E]) => void): void {
    this.listeners[event].push(cb)
  }

  /** Forget what was read and what was removed, as when the workspace is left. Files are read again when next asked for. */
  forget(): void {
    this.epoch += 1
    this.files.clear()
    this.disk.clear()
    this.removed.clear()
    this.removedLayers.clear()
  }

  /** Null when nothing asked of the tracings is under way; else a promise that resolves once it is all written or failed. For the app, when it quits. */
  settled(): Promise<void> | null {
    if (this.turns.size === 0) return null
    const wait = async (): Promise<void> => {
      while (this.turns.size > 0) await Promise.allSettled([...this.turns.values()])
    }
    return wait()
  }

  /** The tracings file of a project, as it is now. */
  list(objectId: string): Promise<TracingsFile> {
    return this.turn(objectId, (file) => structuredClone(file))
  }

  /** What is wrong with the tracings file of a project, as a sentence, or null: told once as a `problem` event, and the same here until dismissed. */
  problem(objectId: string): Promise<string | null> {
    return this.turn(objectId, (_file, dir) => this.problems.get(dir) ?? null)
  }

  dismissProblem(objectId: string): Promise<void> {
    return this.turn(objectId, (_file, dir) => {
      this.problems.delete(dir)
    })
  }

  /**
   * Makes a tracing, with the next number. Its name, layout, plane, parts and the build it was made on are taken; the id, the
   * author, the layers and everything else main says are not, whatever is asked. Refused past `MOST_TRACINGS`.
   */
  async make(objectId: string, ask: Pick<Tracing, 'name' | 'layout' | 'plane' | 'parts' | 'revision' | 'build'>, by: 'person' | 'agent'): Promise<Tracing> {
    checkedBy(by)
    const given: Record<string, unknown> = isRecord(ask) ? ask : {}
    const name = nameOf(given.name, MAX_TRACING_NAME, 'a tracing')
    if (typeof given.layout !== 'string' || given.layout === '' || given.layout.length > MAX_TEXT) throw new Refusal('A tracing is of a layout: name it.')
    const plane = readPlane(given.plane)
    if (!plane) throw new Refusal('The plane of a tracing is a point and two unit axes at right angles, and how it was made.')
    const parts = partsOf(given.parts)
    if (given.revision !== undefined && (typeof given.revision !== 'number' || !Number.isSafeInteger(given.revision) || given.revision < 1)) throw new Refusal('The build a tracing was made on is a whole number from 1.')
    const build = given.build
    if (build !== undefined && !(isRecord(build) && typeof build.id === 'string' && typeof build.sources === 'string')) throw new Refusal('The build of a tracing is its id and its sources.')
    const layout = given.layout
    const revision = given.revision as number | undefined
    return this.change(objectId, (file) => {
      if (file.tracings.length >= MOST_TRACINGS) throw new Refusal(`A project keeps at most ${MOST_TRACINGS} tracings: remove one first.`)
      const made: Tracing = {
        id: `T${file.next}`,
        by,
        name,
        layout,
        createdAt: this.now().toISOString(),
        ...(revision === undefined ? {} : { revision }),
        ...(build === undefined ? {} : { build: { id: (build as { id: string }).id, sources: (build as { sources: string }).sources } }),
        plane,
        ...(parts === undefined ? {} : { parts }),
        layers: [],
        nextLayer: 1
      }
      file.next += 1
      file.tracings.push(made)
      return made
    })
  }

  /**
   * The person's one door onto a tracing: its name, and which parts it draws (`null` for all of them). It works on any
   * tracing, the agent's too. Whatever else the patch says is ignored.
   */
  async edit(objectId: string, id: string, patch: { name?: string; parts?: string[] | null }): Promise<Tracing> {
    if (!isRecord(patch)) throw new Refusal('That is not a change to a tracing.')
    const name = patch.name === undefined ? undefined : nameOf(patch.name, MAX_TRACING_NAME, 'a tracing')
    const parts = patch.parts === null ? null : partsOf(patch.parts)
    return this.change(objectId, (file) => {
      const t = tracingOf(file, id)
      if (name !== undefined) t.name = name
      if (parts === null) delete t.parts
      else if (parts !== undefined) t.parts = parts
      return t
    })
  }

  /** Removes a tracing: the person's removes any, and the agent's only its own, refused by the owner's name. Kept whole in memory for `restore`. */
  async remove(objectId: string, id: string, by: 'person' | 'agent'): Promise<Tracing> {
    checkedBy(by)
    const taken: { tracing?: Tracing } = {}
    const removed = await this.change(
      objectId,
      (file) => {
        const t = tracingOf(file, id)
        if (by === 'agent' && t.by !== 'agent') throw new Refusal(`${t.id} is ${owner(t.by)}: Claude removes only its own tracings.`)
        if (by === 'agent') {
          // Removing a tracing takes what is on it: the person's photo and layers are theirs even on Claude's tracing.
          const theirs = t.layers.filter((l) => l.by === 'person').map((l) => `"${l.name}"`)
          if (t.photo !== undefined || theirs.length > 0) {
            const things = [...(t.photo === undefined ? [] : ["the person's photo"]), ...(theirs.length === 0 ? [] : [`the layer${theirs.length === 1 ? '' : 's'} ${theirs.length === 1 ? theirs[0] : `${theirs.slice(0, -1).join(', ')} and ${theirs.at(-1)}`}`])]
            throw new Refusal(`${t.id} holds ${things.join(' and ')}: Claude removes a tracing only when it holds nothing of the person's.`)
          }
        }
        file.tracings.splice(file.tracings.indexOf(t), 1)
        taken.tracing = structuredClone(t)
        return t
      },
      (_result, dir) => {
        const gone = taken.tracing
        if (gone === undefined) return
        const kept = (this.removed.get(dir) ?? []).filter((t) => t.id !== gone.id)
        kept.push(gone)
        while (kept.length > REMOVED_KEPT) kept.shift()
        this.removed.set(dir, kept)
      },
      // Its photo and straightened copy are what torno dropped: the sweep of a later run takes them, unless an undo has brought the tracing back.
      (_result, dir) => dropPhotos(dir, filesOf(taken.tracing?.photo))
    )
    return removed
  }

  /** Puts back a tracing removed in this run (the last `REMOVED_KEPT` of its project), whole and with its number, once. */
  async restore(objectId: string, id: string): Promise<Tracing> {
    return this.change(
      objectId,
      (file, dir) => {
        const back = typeof id === 'string' ? this.removed.get(dir)?.find((t) => t.id === id) : undefined
        if (!back) throw new Refusal(`There is nothing to put back for ${String(id)}: only a tracing removed in this run can be.`)
        if (file.tracings.some((t) => t.id === back.id)) throw new Refusal(`${back.id} is already there.`)
        if (file.tracings.length >= MOST_TRACINGS) throw new Refusal(`A project keeps at most ${MOST_TRACINGS} tracings: remove one first.`)
        const whole = structuredClone(back)
        const number = (t: Tracing): number => Number(t.id.slice(1))
        const at = file.tracings.findIndex((t) => number(t) > number(whole))
        file.tracings.splice(at === -1 ? file.tracings.length : at, 0, whole)
        file.next = Math.max(file.next, number(whole) + 1)
        return whole
      },
      (result, dir) => {
        this.removed.set(dir, (this.removed.get(dir) ?? []).filter((t) => t.id !== result.id))
      }
    )
  }

  /**
   * A change to one layer of a tracing, by the person or by the agent. `make` gives a new layer with the next number, or, when
   * a layer of the name is there (case apart), replaces that one, keeping its id; `edit` replaces what it gives of a layer by
   * id; `remove` takes one away, and `restore` puts one removed in this run back whole, with the number it had (what a mark or an
   * offset names), in its place. A layer replaced has its `revision` bumped. Each edits and removes only their own layers: one
   * of the other's is refused by its owner's name. The caps hold (20 layers, 500 shapes a layer, 20 000 points a tracing), every
   * number is finite and, when the outline's `bounds` are given, within ten diagonals of them. Answers the tracing.
   */
  async layer(objectId: string, id: string, change: LayerChange, by: 'person' | 'agent', bounds?: OutlineBounds): Promise<Tracing> {
    checkedBy(by)
    if (!isRecord(change)) throw new Refusal('That is not a change to a layer.')
    const kinds = (['make', 'edit', 'remove', 'restore'] as const).filter((k) => k in change)
    if (kinds.length !== 1) throw new Refusal('A change to a layer is make, edit, remove or restore: one of them.')
    if ('make' in change) {
      const given: Record<string, unknown> = isRecord(change.make) ? change.make : {}
      const name = nameOf(given.name, MAX_LAYER_NAME, 'a layer', true)
      const colour = colourOf(given.colour)
      const shapes = checkedShapes(given.shapes, bounds)
      return this.change(objectId, (file) => {
        const t = tracingOf(file, id)
        const same = t.layers.find((l) => l.name.toLowerCase() === name.toLowerCase())
        if (same) {
          ownLayer(t, same, by)
          Object.assign(same, { name, colour, shapes })
          same.revision += 1
        } else {
          if (t.layers.length >= MOST_LAYERS) throw new Refusal(`A tracing holds at most ${MOST_LAYERS} layers.`)
          t.layers.push({ id: t.nextLayer, name, colour, by, shapes, revision: 1 })
          t.nextLayer += 1
        }
        tooManyPoints(t)
        return t
      })
    }
    if ('edit' in change) {
      const name = change.name === undefined ? undefined : nameOf(change.name, MAX_LAYER_NAME, 'a layer', true)
      const colour = change.colour === undefined ? undefined : colourOf(change.colour)
      const shapes = change.shapes === undefined ? undefined : checkedShapes(change.shapes, bounds)
      return this.change(objectId, (file) => {
        const t = tracingOf(file, id)
        const layer = layerOf(t, change.edit)
        ownLayer(t, layer, by)
        const clash = name === undefined ? undefined : t.layers.find((l) => l.id !== layer.id && l.name.toLowerCase() === name.toLowerCase())
        if (clash) throw new Refusal(`The name ${name} is taken by layer ${clash.id} of ${t.id}.`)
        const next = { name: name ?? layer.name, colour: colour ?? layer.colour, shapes: shapes ?? layer.shapes }
        if (next.name === layer.name && next.colour === layer.colour && isDeepStrictEqual(next.shapes, layer.shapes)) return t
        Object.assign(layer, next)
        layer.revision += 1
        tooManyPoints(t)
        return t
      })
    }
    if ('restore' in change) {
      const wanted = change.restore
      return this.change(
        objectId,
        (file, dir) => {
          const t = tracingOf(file, id)
          const back = typeof wanted === 'number' ? this.removedLayers.get(dir)?.find((r) => r.tracing === t.id && r.layer.id === wanted)?.layer : undefined
          if (!back) throw new Refusal(`There is nothing to put back for layer ${String(wanted)} of ${t.id}: only a layer removed in this run can be.`)
          ownLayer(t, back, by)
          if (t.layers.some((l) => l.id === back.id)) throw new Refusal(`Layer ${back.id} of ${t.id} is already there.`)
          const clash = t.layers.find((l) => l.name.toLowerCase() === back.name.toLowerCase())
          if (clash) throw new Refusal(`The name ${back.name} is taken by layer ${clash.id} of ${t.id}.`)
          if (t.layers.length >= MOST_LAYERS) throw new Refusal(`A tracing holds at most ${MOST_LAYERS} layers.`)
          const whole = structuredClone(back)
          const at = t.layers.findIndex((l) => l.id > whole.id)
          t.layers.splice(at === -1 ? t.layers.length : at, 0, whole)
          t.nextLayer = Math.max(t.nextLayer, whole.id + 1)
          tooManyPoints(t)
          return t
        },
        (result, dir) => {
          this.removedLayers.set(dir, (this.removedLayers.get(dir) ?? []).filter((r) => !(r.tracing === result.id && r.layer.id === wanted)))
        }
      )
    }
    const taken: { layer?: Layer } = {}
    return this.change(
      objectId,
      (file) => {
        const t = tracingOf(file, id)
        const layer = layerOf(t, change.remove)
        ownLayer(t, layer, by)
        t.layers.splice(t.layers.indexOf(layer), 1)
        taken.layer = structuredClone(layer)
        return t
      },
      (result, dir) => {
        if (taken.layer === undefined) return
        const kept = (this.removedLayers.get(dir) ?? []).filter((r) => !(r.tracing === result.id && r.layer.id === taken.layer?.id))
        kept.push({ tracing: result.id, layer: taken.layer })
        while (kept.length > REMOVED_KEPT) kept.shift()
        this.removedLayers.set(dir, kept)
      }
    )
  }

  /** Hides or shows a layer: the person's, on any layer, the agent's too. It travels, and is not a change of the layer's shapes. */
  async hideLayer(objectId: string, id: string, layer: number, hidden: boolean): Promise<Tracing> {
    if (typeof hidden !== 'boolean') throw new Refusal('A layer is hidden or shown.')
    return this.change(objectId, (file) => {
      const t = tracingOf(file, id)
      const found = layerOf(t, layer)
      if (hidden) found.hidden = true
      else delete found.hidden
      return t
    })
  }

  /**
   * Main's own, after a build: moves the plane's origin (along its normal, for a face tracing: the axes never change, so the
   * photo, the layers and every `uv` stay) and says in `lost` that a face is no longer in it, or clears that when none is.
   * `face` is the ref the face has now, and the build that is of, which a face tracing keeps in place of the ref it was made with
   * (the model may number its faces otherwise); a ref that is the same changes nothing, so no build writes the file for it.
   */
  async movePlane(objectId: string, id: string, plane: Pick<TracingPlane, 'origin'>, lost?: string, face?: { ref: string; revision: number }): Promise<Tracing> {
    if (!isRecord(plane) || !finiteVec3(plane.origin)) throw new Refusal('The origin of a plane is three finite numbers.')
    if (lost !== undefined && (typeof lost !== 'string' || lost === '' || lost.length > 500)) throw new Refusal('What is lost of a plane is a sentence.')
    if (face !== undefined && !(isRecord(face) && typeof face.ref === 'string' && face.ref !== '' && face.ref.length <= MAX_TEXT && Number.isSafeInteger(face.revision) && face.revision >= 1)) throw new Refusal('The face a plane follows is its ref and the build that is of.')
    const origin = plane.origin
    return this.change(objectId, (file) => {
      const t = tracingOf(file, id)
      t.plane.origin = [origin[0], origin[1], origin[2]]
      if (face !== undefined && t.plane.from.kind === 'face' && t.plane.from.ref !== face.ref) {
        t.plane.from = { ...t.plane.from, ref: face.ref, revision: face.revision }
        // The label names the face: it says the face it has now.
        t.plane.label = faceLabel(face.ref, 0, t.plane.x, t.plane.y)
      }
      if (lost === undefined) delete t.lost
      else t.lost = lost
      return t
    })
  }

  /**
   * Keeps a photo for a tracing: main checks the bytes (`checkedPhoto`: a PNG or a JPEG of at most 4000 px and 25 MB), names the file
   * `p-<12 hex>.jpg|png` and holds its `sha256`, `width` and `height`. `from` is the reference it was taken from (`reference/photo-2.jpg`),
   * named by the window and never read. A photo already there is swapped: the tracing side of its pairs is kept and their photo
   * side is cleared (the clicks on the new photo are asked afresh), the line-up and the straightened copy go, the person's fade
   * stays, and the old file and the copy are listed in `dropped.json`. A file whose change then failed is listed too.
   */
  async setPhoto(objectId: string, id: string, bytes: unknown, from?: string): Promise<Tracing> {
    if (from !== undefined && (typeof from !== 'string' || !REFERENCE_PHOTO.test(from))) throw new Refusal('A photo taken from a reference is named as reference/<file>.')
    const dir = this.dirOrReject(objectId)
    const kept = await savePhoto(dir, bytes)
    const letGo: string[] = []
    try {
      return await this.change(
        objectId,
        (file) => {
          const t = tracingOf(file, id)
          const old = t.photo
          letGo.push(...filesOf(old))
          t.photo = {
            file: kept.file,
            sha256: kept.sha256,
            width: kept.width,
            height: kept.height,
            ...(from === undefined ? {} : { from }),
            pairs: (old?.pairs ?? []).map((p) => ({ uv: p.uv, ...(p.snap === undefined ? {} : { snap: p.snap }) })),
            method: old?.method ?? 'similar',
            fade: old?.fade ?? 0.5,
            ...(old?.hidden ? { hidden: true as const } : {})
          }
          return t
        },
        undefined,
        (_result, where) => dropPhotos(where, letGo)
      )
    } catch (e) {
      await dropPhotos(dir, [kept.file])
      throw e
    }
  }

  /**
   * Lines the photo up with the tracing from 2 to 8 pairs, each a point of the photo (px of the kept file, within it) and a point of
   * the tracing (`uv`, mm), `similar` from 2 or more and `straight` from 4 or more. Main fits them itself (`fitSimilar`, `fitStraight`)
   * and keeps what it works out (`transform`, `scale`, `angle`, `fit`); the window's keys other than a pair's own are left out. A point
   * that says what it snapped to is checked against `snaps`, the kernel's points of the tracing's outline on the last build, and
   * replaced by the kernel's own point: one more than 0.01 mm from it is refused, and so is every snap when `snaps` is not given.
   * A homography's scale and angle are told at `centre`, the middle of the tracing's outline (its clicks' own middle when none is given).
   * The straightened copy is out of date and goes (listed as dropped).
   */
  async lineUp(objectId: string, id: string, pairs: unknown, method: unknown, snaps?: readonly PlaneSnap[], centre?: readonly [number, number]): Promise<Tracing> {
    if (method !== 'similar' && method !== 'straight') throw new Refusal("A photo is lined up 'similar' (2 points or more) or 'straight' (4 points or more).")
    const needs = method === 'similar' ? SIMILAR_NEEDS : STRAIGHT_NEEDS
    if (!Array.isArray(pairs) || pairs.length < needs || pairs.length > MOST_PAIRS) throw new Refusal(`A ${method === 'similar' ? 'line-up' : 'straightening'} is made of ${needs} to ${MOST_PAIRS} points on the photo and the same on the tracing.${Array.isArray(pairs) ? ` There ${pairs.length === 1 ? 'is 1' : `are ${pairs.length}`}.` : ''}`)
    const clean: LineupPair[] = pairs.map((raw, i) => {
      if (!isRecord(raw) || !finitePair(raw.photo) || !finitePair(raw.uv)) throw new Refusal(`Point ${i + 1} is a point of the photo and a point of the tracing, each two finite numbers.`)
      if (raw.snap === undefined || raw.snap === null) return { photo: [raw.photo[0], raw.photo[1]], uv: [raw.uv[0], raw.uv[1]] }
      if (!isRecord(raw.snap)) throw new Refusal(`Point ${i + 1} says what it was snapped to as a corner, a centre or a vertex.`)
      const { uv, snap } = snappedPoint(i + 1, raw.uv, raw.snap as LineupSnap, snaps)
      return { photo: [raw.photo[0], raw.photo[1]], uv, snap }
    })
    if (centre !== undefined && !finitePair(centre)) throw new Refusal('The centre of a tracing is a place [u, v] in millimetres.')
    const letGo: string[] = []
    return this.change(
      objectId,
      (file) => {
        const t = tracingOf(file, id)
        const photo = t.photo
        if (!photo) throw new Refusal(`${t.id} has no photo to line up: add one first.`)
        clean.forEach((p, i) => {
          if (p.photo[0] < 0 || p.photo[0] > photo.width || p.photo[1] < 0 || p.photo[1] > photo.height) throw new Refusal(`Point ${i + 1} is outside the photo, which is ${photo.width} × ${photo.height} px.`)
        })
        // Fitted here, where the photo's size is known: its four corners must lie in front of a homography's vanishing line.
        const fitted = method === 'similar' ? fitSimilar(clean) : fitStraight(clean, { size: [photo.width, photo.height], ...(centre === undefined ? {} : { centre }) })
        if ('error' in fitted) throw new Refusal(`The points do not line the photo up: ${fitted.error}.`)
        if (photo.straightened !== undefined) letGo.push(photo.straightened)
        photo.pairs = clean
        photo.method = method
        photo.transform = fitted.transform
        photo.scale = fitted.scale
        photo.angle = fitted.angle
        if (fitted.fit === undefined) delete photo.fit
        else photo.fit = fitted.fit
        delete photo.straightened
        return t
      },
      undefined,
      (_result, dir) => dropPhotos(dir, letGo)
    )
  }

  /** The person's look of the photo: how faded it is (0 to 1; 0.5 when none was said) and whether it is hidden. It travels. */
  async setLook(objectId: string, id: string, look: { fade?: number; hidden?: boolean }): Promise<Tracing> {
    if (!isRecord(look)) throw new Refusal('That is not a look of a photo: a fade from 0 to 1, and hidden or not.')
    const { fade, hidden } = look
    if (fade !== undefined && (typeof fade !== 'number' || !Number.isFinite(fade) || fade < 0 || fade > 1)) throw new Refusal('The fade of a photo is a number from 0 to 1.')
    if (hidden !== undefined && typeof hidden !== 'boolean') throw new Refusal('A photo is hidden or shown.')
    return this.change(objectId, (file) => {
      const t = tracingOf(file, id)
      if (!t.photo) throw new Refusal(`${t.id} has no photo.`)
      if (fade !== undefined) t.photo.fade = fade
      if (hidden === true) t.photo.hidden = true
      else if (hidden === false) delete t.photo.hidden
      return t
    })
  }

  /**
   * Keeps the straightened copy the window warped from the photo through the line-up (`s-<12 hex>.jpg|png`, checked as a photo is).
   * It is taken only for the photo (`of.sha256`) and the matrix (`of.transform`, `transformKey`) it was made from: a copy made
   * for another photo or line-up is refused, and its file listed as dropped. The copy it replaces is listed.
   */
  async setStraightened(objectId: string, id: string, bytes: unknown, of: { sha256: string; transform: string }): Promise<Tracing> {
    if (!isRecord(of) || typeof of.sha256 !== 'string' || typeof of.transform !== 'string' || of.transform.length > 1000) throw new Refusal('A straightened copy says the photo and the line-up it was made from.')
    const made = { sha256: of.sha256, transform: of.transform }
    const current = (t: Tracing): void => {
      if (!t.photo?.transform) throw new Refusal(`${t.id} has no line-up to straighten the photo by.`)
      if (t.photo.sha256 !== made.sha256 || transformKey(t.photo.transform) !== made.transform) throw new Refusal(`That copy was made of another photo or another line-up than ${t.id} has now, so it is not kept.`)
    }
    // Looked at before a file is written: a copy that is out of date is no file at all.
    current(tracingOf(await this.list(objectId), id))
    const dir = this.dirOrReject(objectId)
    const kept = await savePhoto(dir, bytes, 's')
    const letGo: string[] = []
    try {
      return await this.change(
        objectId,
        (file) => {
          const t = tracingOf(file, id)
          current(t)
          const photo = t.photo as NonNullable<Tracing['photo']>
          if (photo.straightened !== undefined) letGo.push(photo.straightened)
          photo.straightened = kept.file
          return t
        },
        undefined,
        (_result, where) => dropPhotos(where, letGo)
      )
    } catch (e) {
      await dropPhotos(dir, [kept.file])
      throw e
    }
  }

  /** Takes the photo off a tracing, with its line-up: the file and the straightened copy are listed as dropped. The pairs go with it. */
  async removePhoto(objectId: string, id: string): Promise<Tracing> {
    const letGo: string[] = []
    return this.change(
      objectId,
      (file) => {
        const t = tracingOf(file, id)
        if (!t.photo) throw new Refusal(`${t.id} has no photo.`)
        letGo.push(...filesOf(t.photo))
        delete t.photo
        return t
      },
      undefined,
      (_result, dir) => dropPhotos(dir, letGo)
    )
  }

  /**
   * In the turn of a project's tracings, what the sweep of its photos is told: the photo files the tracings name now (`live`), those
   * named by a tracing removed in this run (`kept`: an undo brings those back), the folder of the project, and what was wrong with
   * the tracings file (a sweep that is told so leaves the files alone: the file kept aside may name them).
   */
  withPhotos<T>(objectId: string, task: (held: { live: Set<string>; kept: Set<string> }, dir: string, problem: string | null) => Promise<T>): Promise<T> {
    return this.turn(objectId, async (current, dir, epoch) => {
      // Of the file as it is on the disk now: a pull may have brought tracings that name photos this run has never heard of.
      const file = await this.current(objectId, current, dir, epoch)
      const live = new Set(file.tracings.flatMap((t) => filesOf(t.photo)))
      const kept = new Set((this.removed.get(dir) ?? []).flatMap((t) => filesOf(t.photo)))
      return task({ live, kept }, dir, this.problems.get(dir) ?? null)
    })
  }

  private dirOrReject(objectId: string): string {
    const dir = this.deps.dirOf(objectId)
    if (dir === undefined) throw new Error(`no project named ${objectId} in the open workspace`)
    return dir
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date()
  }

  /**
   * One change, written and told. `edit` is given a copy of the file, and the folder of the project: a change that throws, or a
   * write that fails, leaves the tracings as they were, and one that leaves the text as it was writes and tells nothing.
   * Before it, the file is compared with what main last read or wrote: when it was changed from outside (a git pull), the
   * disk's file is the base the change is made on, with `next` kept above what this run gave out, and the window is told.
   * `done` runs in the same turn once the change is written, and only then; `landed` too, and also when the workspace was left meanwhile
   * (it lists files that were let go of, which is true of the disk whoever looks at it). Neither is run for a change that changes nothing.
   */
  private change<R>(objectId: string, edit: (file: TracingsFile, dir: string) => R, done?: (result: R, dir: string) => void, landed?: (result: R, dir: string) => Promise<void>): Promise<R> {
    return this.turn(objectId, async (current, dir, epoch) => {
      const base = await this.current(objectId, current, dir, epoch)
      const file = structuredClone(base)
      const result = edit(file, dir)
      if (textOf(file) === textOf(base)) return structuredClone(result)
      // Written before it is kept or told: a write that fails leaves the tracings as they were.
      await saveTracingsFile(dir, file)
      // What the change let go of is listed once it is written, in this same turn, and whatever workspace is open now: the file is on this disk.
      await landed?.(result, dir)
      // Told only to the workspace it was asked in: the write of one that has been left lands, and is not broadcast.
      if (epoch === this.epoch) {
        this.files.set(dir, file)
        this.disk.set(dir, textOf(file))
        done?.(result, dir)
        this.emit('changed', { objectId, file: structuredClone(file) })
      }
      return structuredClone(result)
    })
  }

  /**
   * The file a turn builds on: the one in memory, or, when what the disk holds is not what main last read or wrote (a git pull), the
   * disk's, with `next` kept above what this run gave out and the builds' numbers kept; the window is told when that is another file.
   */
  private async current(objectId: string, current: TracingsFile, dir: string, epoch: number): Promise<TracingsFile> {
    if (!(epoch === this.epoch && this.disk.has(dir) && (await diskText(dir)) !== this.disk.get(dir))) return current
    const base = await this.load(objectId, dir, epoch)
    // A number given out in this run is not given again, whatever the file that came says is next; and a build number is this run's own.
    base.next = Math.max(base.next, current.next)
    for (const t of base.tracings) {
      const mine = current.tracings.find((c) => c.id === t.id)
      if (mine?.revision !== undefined) t.revision = mine.revision
      // A layer number given out in this run is not given again either.
      if (mine !== undefined) t.nextLayer = Math.max(t.nextLayer, mine.nextLayer)
    }
    if (epoch === this.epoch) {
      this.files.set(dir, base)
      if (textOf(base) !== textOf(current)) this.emit('changed', { objectId, file: structuredClone(base) })
    }
    return base
  }

  /** Reads the tracings file of a project again, keeping what it says and what was wrong with it. */
  private async load(objectId: string, dir: string, epoch: number): Promise<TracingsFile> {
    const loaded = await loadTracingsFile(dir, () => this.now())
    if (epoch === this.epoch) {
      this.files.set(dir, loaded.file)
      this.disk.set(dir, loaded.text)
      if (loaded.problem !== undefined) {
        this.problems.set(dir, loaded.problem)
        this.emit('problem', { objectId, message: loaded.problem })
      }
    }
    return loaded.file
  }

  /** Do one thing with the tracings file of a project, after whatever was asked of it before. */
  private turn<T>(objectId: string, task: (file: TracingsFile, dir: string, epoch: number) => T | Promise<T>): Promise<T> {
    const dir = this.deps.dirOf(objectId)
    if (dir === undefined) return Promise.reject(new Error(`no project named ${objectId} in the open workspace`))
    // As of the asking: the workspace may be left while this waits its turn.
    const epoch = this.epoch
    const turn = (this.turns.get(dir) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        const file = this.files.get(dir) ?? (await this.load(objectId, dir, epoch))
        return task(file, dir, epoch)
      })
      .finally(() => {
        if (this.turns.get(dir) === turn) this.turns.delete(dir)
      })
    this.turns.set(dir, turn)
    return turn
  }

  private emit<E extends keyof TracingEvents>(event: E, message: TracingEvents[E]): void {
    for (const cb of this.listeners[event]) cb(message)
  }
}

/** The files a tracing's photo names: the photo and its straightened copy. */
function filesOf(photo: Tracing['photo']): string[] {
  return photo === undefined ? [] : [photo.file, ...(photo.straightened === undefined ? [] : [photo.straightened])]
}

function tooManyPoints(t: Tracing): void {
  const points = pointCount(t)
  if (points > MOST_TRACING_POINTS) throw new Refusal(`A tracing holds at most ${MOST_TRACING_POINTS} points in its polylines, and this would have ${points}.`)
}
