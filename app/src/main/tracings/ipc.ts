import type { Described, Sectioned } from '../../shared/geometry'
import type { Vec3 } from '../../shared/marks'
import type { MainAxis } from '../../shared/planes'
import type { Scene } from '../../shared/scene'
import { expandTag, splitTagRef, tagOfRef } from '../../shared/tags'
import { type LayerColour, type LayerShape, type Tracing, type TracingCut, type TracingPlane, type TracingsFile, TRACING_ID, planeOfFrom } from '../../shared/tracings'
import type { SectionPlane, ViewState } from '../../shared/view'
import type { ObjectInfo } from '../../shared/workspace'
import { NO_SECTION } from '../export/section'
import { Refusal } from '../refusal'
import { readPhoto, sha256Of } from './photos'
import type { Outlines } from './outline'
import { faceFrame, planarFace, sectionFrame } from './planes'
import type { LayerChange, OutlineBounds, TracingStore } from './store'

// What the window may ask of the tracings (`tracings:list`, `:make`, `:edit`, `:remove`, `:restore`, `:layer`, `:outline`,
// `:shown`, `:problem`, `:dismissProblem`, and of the photo `:photo`, `:lineUp`, `:look`, `:straightened`, `:photoBytes`, `:removePhoto`), as handlers that do not need Electron (`main/ipc.ts` registers them). Everything the
// window says is untrusted: a project is one that is open, a tracing is `T<n>`, a layer is a whole number, and what only main says
// of a tracing or a layer (`id`, `by`, `nextLayer`, `lost`, a layer's `id` and `by`, the photo's file, size and hash and its line-up: `transform`, `scale`,
// `angle`, `fit`, `straightened`) is never taken from it: of a photo the window sends only its bytes, the pairs of points and a method: a key that is not part of what is asked is left out. Main makes the plane, from a main axis and an offset, from the
// kernel's `describe` of a face, or from the section on screen with the axes the kernel's `section` gives. What the window makes
// is the person's.

export interface TracingIpcDeps {
  tracings: Pick<TracingStore, 'list' | 'make' | 'edit' | 'remove' | 'restore' | 'layer' | 'hideLayer' | 'problem' | 'dismissProblem' | 'setPhoto' | 'lineUp' | 'setLook' | 'setStraightened' | 'removePhoto'>
  outlines: Pick<Outlines, 'cut' | 'shown'>
  /** A project of the open workspace. */
  object(objectId: string): ObjectInfo | undefined
  /** The last successful build of a project: its number and its scene. */
  build(objectId: string): { revision: number; scene: Scene } | undefined
  /** What the window last reported of a project (`latestView`): the section on screen. */
  view(objectId: string): ViewState | undefined
  /** `Builds.query`, never having the project built again to be answered. */
  query<T = unknown>(objectId: string, name: string, args: object): Promise<T>
}

const NOT_OPEN = 'That project is not open.'
const MAX_TEXT = 200
const MAIN_AXES: readonly MainAxis[] = ['XY', 'XZ', 'YZ']

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export function tracingHandlers(deps: TracingIpcDeps) {
  const project = (objectId: unknown): ObjectInfo => {
    const obj = typeof objectId === 'string' ? deps.object(objectId) : undefined
    if (!obj) throw new Refusal(NOT_OPEN)
    return obj
  }

  const tracingId = (id: unknown): string => {
    if (typeof id !== 'string' || !TRACING_ID.test(id)) throw new Refusal(`${typeof id === 'string' ? id : 'That'} is not a tracing: a tracing is T1, T2, …`)
    return id
  }

  /** The layout the window names, and the parts it names of it, checked against the last build when there is one. */
  const layoutAndParts = (obj: ObjectInfo, rawLayout: unknown, rawParts: unknown): { layout: string; parts?: string[] } => {
    if (typeof rawLayout !== 'string' || rawLayout === '' || rawLayout.length > MAX_TEXT) throw new Refusal('A layout is text: name the layout the tracing is of')
    const parts = checkedParts(obj, rawLayout, rawParts)
    return { layout: rawLayout, ...(parts === undefined ? {} : { parts }) }
  }

  const checkedParts = (obj: ObjectInfo, layout: string, raw: unknown): string[] | undefined => {
    const last = deps.build(obj.id)
    if (last && !last.scene.layouts.includes(layout)) throw new Refusal(`${obj.name} has no layout ${layout} (layouts: ${last.scene.layouts.join(', ')})`)
    if (raw === undefined || raw === null) return undefined
    if (!Array.isArray(raw) || !raw.every((p) => typeof p === 'string' && p !== '' && p.length <= MAX_TEXT)) throw new Refusal('The parts of a tracing are a list of part names.')
    const has = last?.scene.parts.filter((p) => p.layout === layout).map((p) => p.name)
    for (const name of raw) if (has && !has.includes(name)) throw new Refusal(`${obj.name} has no part ${name} in the ${layout} layout (parts: ${has.join(', ') || 'none'})`)
    return raw as string[]
  }

  const lastBuilt = (obj: ObjectInfo): { revision: number; scene: Scene } => {
    const last = deps.build(obj.id)
    if (!last) throw new Refusal(`${obj.name} has not been built successfully yet, so a tracing cannot be laid on it`)
    return last
  }

  /** The kernel's answer to a query that may fail, as a refusal that says what was being asked. */
  const asked = async <T>(obj: ObjectInfo, what: string, name: string, args: object): Promise<T> => {
    try {
      return await deps.query<T>(obj.id, name, args)
    } catch (e) {
      throw new Refusal(`The kernel could not say ${what}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const onFace = async (obj: ObjectInfo, layout: string, raw: unknown): Promise<TracingPlane> => {
    if (typeof raw !== 'string' || raw === '' || raw.length > MAX_TEXT) throw new Refusal('A face is a ref of the project: block/F12')
    const last = lastBuilt(obj)
    const inLayout = last.scene.parts.filter((p) => p.layout === layout)
    // A tag that names one face is that face.
    let ref = raw
    if (splitTagRef(raw)) {
      const expanded = expandTag(inLayout, raw)
      if (expanded && 'error' in expanded) throw new Refusal(expanded.error)
      const faces = expanded?.refs.filter((r) => /\/F\d+$/.test(r)) ?? []
      if (faces.length !== 1 || expanded?.refs.length !== 1) throw new Refusal(`${raw} names ${expanded?.refs.length ?? 0} faces and edges, and a tracing lies on one face`)
      ref = faces[0]
    }
    const match = /^(.+)\/F(?:0|[1-9]\d{0,8})$/.exec(ref)
    if (!match) throw new Refusal(`${raw} is not a face: name a face of a part, as block/F12`)
    const part = inLayout.find((p) => p.name === match[1])
    if (!part) throw new Refusal(`${obj.name} has no part ${match[1]} in the ${layout} layout (parts: ${inLayout.map((p) => p.name).join(', ') || 'none'})`)
    const described = await asked<Described>(obj, `what ${ref} is`, 'describe', { ref: `${layout}:${ref}` })
    if (deps.build(obj.id)?.revision !== last.revision) throw new Refusal(`A new build landed while ${ref} was looked at: ask again`)
    planarFace(ref, described)
    // A point ON the face: `describe`'s centre of a face with a hole at its centre is in the hole, where the face is not found again.
    const found = await asked<{ selectors?: Array<{ ref?: unknown; center?: unknown }> }>(obj, `a point on ${ref}`, 'selectors', { layout, refs: [ref] })
    const on = found?.selectors?.find((one) => one?.ref === ref)?.center
    if (deps.build(obj.id)?.revision !== last.revision) throw new Refusal(`A new build landed while ${ref} was looked at: ask again`)
    if (!Array.isArray(on) || on.length !== 3 || !on.every((c) => typeof c === 'number' && Number.isFinite(c))) throw new Refusal(`The kernel gave no point on ${ref}, so a tracing cannot be laid on it`)
    const frame = faceFrame(ref, described, on as Vec3)
    const tag = tagOfRef(part, ref)
    return { ...frame, from: { kind: 'face', ref, ...(tag === undefined ? {} : { tag }), revision: last.revision } }
  }

  /** The section on screen, as it is now. */
  const onScreenSection = (obj: ObjectInfo, layout: string): SectionPlane => {
    const view = deps.view(obj.id)
    const section = view?.section
    if (!view || !section) throw new Refusal(NO_SECTION)
    if (view.layout !== layout) throw new Refusal(`The section on screen is of the ${view.layout} layout, not ${layout}: show ${layout} first`)
    return section
  }

  /** A plane frozen where it is: the kernel gives its axes, so that the tracing matches a section export of that plane. */
  const onSection = async (obj: ObjectInfo, layout: string, section: SectionPlane): Promise<TracingPlane> => {
    const last = lastBuilt(obj)
    // The kernel's axes for that plane do not depend on what is cut: one part is enough to have them.
    const first = last.scene.parts.find((p) => p.layout === layout)
    if (!first) throw new Refusal(`${obj.name} has no parts in the ${layout} layout`)
    const cut = await asked<Sectioned>(obj, 'the axes of the section plane', 'section', { layout, plane: { origin: section.origin, normal: section.normal }, parts: [first.name] })
    if (!cut?.plane) throw new Refusal('The kernel did not answer with a section')
    if (deps.build(obj.id)?.revision !== last.revision) throw new Refusal('A new build landed while the section was looked at: ask again')
    const frame = sectionFrame(section, cut.plane)
    return { ...frame, from: { kind: 'section', origin: [section.origin[0], section.origin[1], section.origin[2]], normal: [section.normal[0], section.normal[1], section.normal[2]] } }
  }

  /** Where the tracing is laid: exactly one of a main plane (`main`, with its `offset`), a `face`, the `section` on screen, or a plane given by its `origin` and `normal`. */
  const plane = async (obj: ObjectInfo, layout: string, raw: unknown): Promise<TracingPlane> => {
    if (!isRecord(raw)) throw new Refusal('Say which plane the tracing is laid on: a main plane, a face, a point and a normal, or the section on screen')
    // A plane given by a point and a normal is one kind, and its two keys are not a plane apart.
    const pointed = raw.origin !== undefined || raw.normal !== undefined
    const kinds = (['main', 'face', 'section'] as const).filter((k) => raw[k] !== undefined)
    if (kinds.length + (pointed ? 1 : 0) !== 1) throw new Refusal('A tracing is laid on one plane: one of a main plane (main, offset), a face, a point and a normal (origin, normal), or the section on screen')
    if (pointed) {
      const triple = (v: unknown): Vec3 | null => (Array.isArray(v) && v.length === 3 && v.every((c) => typeof c === 'number' && Number.isFinite(c)) ? [v[0], v[1], v[2]] : null)
      const origin = triple(raw.origin)
      const normal = triple(raw.normal)
      const length = normal === null ? 0 : Math.hypot(...normal)
      if (origin === null || normal === null || !(length > 1e-9)) throw new Refusal('A plane given by a point and a normal is origin [x, y, z] and normal [x, y, z] in mm in the frame of the layout, the normal not all zeros')
      return onSection(obj, layout, { origin, normal: [normal[0] / length, normal[1] / length, normal[2] / length] })
    }
    if (kinds[0] === 'face') return onFace(obj, layout, raw.face)
    if (kinds[0] === 'section') {
      if (raw.section !== true) throw new Refusal('section is true: the section plane on screen')
      return onSection(obj, layout, onScreenSection(obj, layout))
    }
    const axis = MAIN_AXES.find((a) => a === raw.main)
    if (!axis) throw new Refusal(`A main plane is XY, XZ or YZ: the plane two of the model's axes span`)
    const offset = raw.offset === undefined ? 0 : raw.offset
    if (typeof offset !== 'number' || !Number.isFinite(offset)) throw new Refusal('The offset of a main plane is a number of millimetres')
    const made = planeOfFrom({ kind: 'main', axis, offset })
    if (!made) throw new Error('a main plane has a frame')
    return made
  }

  /** A change to a layer as the window may ask it: a clean copy with the keys of its kind and no others. */
  const layerChange = (raw: unknown): LayerChange | { hide: number; hidden: boolean } => {
    if (!isRecord(raw)) throw new Refusal('That is not a change to a layer.')
    const kinds = (['make', 'edit', 'remove', 'restore', 'hide'] as const).filter((k) => k in raw)
    if (kinds.length !== 1) throw new Refusal('A change to a layer is make, edit, remove, restore or hide: one of them.')
    if ('make' in raw) {
      const given = isRecord(raw.make) ? raw.make : {}
      return { make: { name: given.name as string, colour: given.colour as LayerColour, shapes: given.shapes as LayerShape[] } }
    }
    if ('edit' in raw) {
      return { edit: raw.edit as number, ...(raw.name === undefined ? {} : { name: raw.name as string }), ...(raw.colour === undefined ? {} : { colour: raw.colour as LayerColour }), ...(raw.shapes === undefined ? {} : { shapes: raw.shapes as LayerShape[] }) }
    }
    if ('remove' in raw) return { remove: raw.remove as number }
    if ('restore' in raw) return { restore: raw.restore as number }
    return { hide: raw.hide as number, hidden: raw.hidden as boolean }
  }

  /** The least diagonal a box of parts is counted as, in mm, so that tiny parts do not forbid a drawing beside them (as `add_sketch`). */
  const LEAST_DIAGONAL_MM = 100

  /** The box of the parts a tracing draws, in its own `u` and `v` (the corners of their boxes in the object frame, projected on its axes). */
  const partsBounds = async (objectId: string, id: string): Promise<OutlineBounds | undefined> => {
    const scene = deps.build(objectId)?.scene
    const t = (await deps.tracings.list(objectId)).tracings.find((one) => one.id === id)
    if (!scene || !t) return undefined
    const parts = scene.parts.filter((p) => p.layout === t.layout && (t.parts === undefined || t.parts.includes(p.name)))
    if (parts.length === 0) return undefined
    const { origin, x, y } = t.plane
    const min: [number, number] = [Infinity, Infinity]
    const max: [number, number] = [-Infinity, -Infinity]
    for (const p of parts) {
      for (const cx of [p.bbox.min[0], p.bbox.max[0]]) {
        for (const cy of [p.bbox.min[1], p.bbox.max[1]]) {
          for (const cz of [p.bbox.min[2], p.bbox.max[2]]) {
            const d = [cx - origin[0], cy - origin[1], cz - origin[2]]
            const at = [d[0] * x[0] + d[1] * x[1] + d[2] * x[2], d[0] * y[0] + d[1] * y[1] + d[2] * y[2]]
            for (const axis of [0, 1] as const) {
              min[axis] = Math.min(min[axis], at[axis])
              max[axis] = Math.max(max[axis], at[axis])
            }
          }
        }
      }
    }
    if (![...min, ...max].every(Number.isFinite)) return undefined
    const diagonal = Math.hypot(max[0] - min[0], max[1] - min[1])
    if (diagonal >= LEAST_DIAGONAL_MM) return { min, max }
    // Grown about its middle to the least diagonal.
    const k = diagonal === 0 ? 0 : LEAST_DIAGONAL_MM / diagonal
    const half = (axis: 0 | 1): number => (diagonal === 0 ? LEAST_DIAGONAL_MM / 2 / Math.SQRT2 : ((max[axis] - min[axis]) / 2) * k)
    const middle = (axis: 0 | 1): number => (min[axis] + max[axis]) / 2
    return { min: [middle(0) - half(0), middle(1) - half(1)], max: [middle(0) + half(0), middle(1) + half(1)] }
  }

  /**
   * The bounds a layer's numbers are held to: those of a tracing's outline on the last build, or, when it cannot be cut, the box of the
   * parts it draws, ten diagonals of it either way; none only when there is no build to say.
   */
  const outlineBounds = async (objectId: string, id: string): Promise<OutlineBounds | undefined> => {
    const cut = await deps.outlines.cut(objectId, id)
    return cut instanceof Refusal || !cut.cut.bounds ? partsBounds(objectId, id) : cut.cut.bounds
  }

  const make = async (objectId: string, raw: unknown, by: 'person' | 'agent'): Promise<Tracing> => {
    const obj = project(objectId)
    if (!isRecord(raw)) throw new Refusal('That is not a tracing: it names a plane, a layout and, if it has them, a name and parts.')
    const { layout, parts } = layoutAndParts(obj, raw.layout, raw.parts)
    const laid = await plane(obj, layout, raw.on)
    const revision = deps.build(obj.id)?.revision
    return deps.tracings.make(obj.id, { name: raw.name as string, layout, plane: laid, ...(parts === undefined ? {} : { parts }), ...(revision === undefined ? {} : { revision }) }, by)
  }

  return {
    async list(objectId: string): Promise<TracingsFile> {
      return deps.tracings.list(project(objectId).id)
    },

    /** Makes the person's tracing: main makes the plane, takes the build it is made on, and gives the number. */
    async make(objectId: string, raw: unknown): Promise<Tracing> {
      return make(objectId, raw, 'person')
    },

    /** Makes Claude's tracing, as `make` does and with the same checks: the tool names a plane, a layout and a name, and nothing else is taken. */
    async agentMake(objectId: string, raw: unknown): Promise<Tracing> {
      return make(objectId, raw, 'agent')
    },

    /** Removes a tracing of Claude's: one of the person's is refused by its owner's name. */
    async agentRemove(objectId: string, id: string): Promise<Tracing> {
      return deps.tracings.remove(project(objectId).id, tracingId(id), 'agent')
    },

    /**
     * Claude's change to a layer of any tracing: `{ make }` makes or replaces (by name) a layer of its own, `{ remove }` takes one of
     * its own away; the person's layers are refused by the owner's name. Shapes are held to the outline's bounds when it can be cut.
     */
    async agentLayer(objectId: string, id: string, raw: unknown): Promise<Tracing> {
      const obj = project(objectId)
      const named = tracingId(id)
      if (!isRecord(raw) || (('make' in raw) === ('remove' in raw)) || Object.keys(raw).length !== 1) throw new Refusal('Claude changes a layer with make or remove: one of them.')
      const change = layerChange(raw)
      return deps.tracings.layer(obj.id, named, change as LayerChange, 'agent', 'make' in change ? await outlineBounds(obj.id, named) : undefined)
    },

    /** Renames a tracing, or changes which parts it draws (`null`: all). Whatever else is said is left out. */
    async edit(objectId: string, id: string, raw: unknown): Promise<Tracing> {
      const obj = project(objectId)
      const named = tracingId(id)
      if (!isRecord(raw)) throw new Refusal('That is not a change to a tracing.')
      const patch: { name?: string; parts?: string[] | null } = {}
      if (raw.name !== undefined) patch.name = raw.name as string
      if (raw.parts === null) patch.parts = null
      else if (raw.parts !== undefined) {
        const layout = (await deps.tracings.list(obj.id)).tracings.find((t) => t.id === named)?.layout
        patch.parts = layout === undefined ? (raw.parts as string[]) : checkedParts(obj, layout, raw.parts)
      }
      return deps.tracings.edit(obj.id, named, patch)
    },

    /** The person removes a tracing, any of them. */
    async remove(objectId: string, id: string): Promise<void> {
      await deps.tracings.remove(project(objectId).id, tracingId(id), 'person')
    },

    /** Puts back the tracing removed in this run, whole and with its number, once. */
    async restore(objectId: string, id: string): Promise<Tracing> {
      return deps.tracings.restore(project(objectId).id, tracingId(id))
    },

    /**
     * The person's change to a layer of a tracing: make, edit, remove, or `{ hide, hidden }` (any layer may be hidden).
     * Shapes are held to the outline's bounds when it can be cut. Answers the tracing.
     */
    async layer(objectId: string, id: string, raw: unknown): Promise<Tracing> {
      const obj = project(objectId)
      const named = tracingId(id)
      const change = layerChange(raw)
      if ('hide' in change) return deps.tracings.hideLayer(obj.id, named, change.hide, change.hidden)
      const shaped = 'make' in change || ('edit' in change && change.shapes !== undefined)
      return deps.tracings.layer(obj.id, named, change, 'person', shaped ? await outlineBounds(obj.id, named) : undefined)
    },

    /** What Claude reads of a tracing's outline: the cut, or the sentence that says why there is none (no build, a layout the build lacks, a kernel that could not). */
    async agentOutline(objectId: string, id: string): Promise<{ cut: TracingCut } | { why: string }> {
      const cut = await deps.outlines.cut(project(objectId).id, tracingId(id))
      return cut instanceof Refusal ? { why: cut.message } : { cut }
    },

    /** The outline of a tracing on the last good build, or null when there is none to be had (not built yet, a layout the build lacks). */
    async outline(objectId: string, id: string): Promise<TracingCut | null> {
      const cut = await deps.outlines.cut(project(objectId).id, tracingId(id))
      return cut instanceof Refusal ? null : cut
    },

    /** The window says which tracings it shows: those are cut again after each build. A project that is not open is ignored. */
    shown(objectId: string, ids: string[]): void {
      if (typeof objectId !== 'string' || !deps.object(objectId)) return
      deps.outlines.shown(objectId, ids)
    },

    /** Keeps a photo for a tracing (its bytes, and the reference it was taken from, if any): main checks, names and hashes it. A swap clears the photo side of the pairs. */
    async photo(objectId: string, id: string, bytes: unknown, from?: unknown): Promise<Tracing> {
      return deps.tracings.setPhoto(project(objectId).id, tracingId(id), bytes, from === null ? undefined : (from as string | undefined))
    },

    /**
     * Lines the photo up: the pairs of points (a point of the photo, a point of the tracing, what it was snapped to) and a method,
     * `similar` or `straight`. Main works out the transform, scale, angle and fit itself, from the kernel's points where a point says it
     * was snapped; no other key of a pair or of the call is taken.
     */
    async lineUp(objectId: string, id: string, pairs: unknown, method: unknown): Promise<Tracing> {
      const obj = project(objectId)
      const named = tracingId(id)
      const clean = Array.isArray(pairs) ? pairs.map((p) => (isRecord(p) ? { photo: p.photo, uv: p.uv, ...(p.snap === undefined || p.snap === null ? {} : { snap: p.snap }) } : p)) : pairs
      const snapped = Array.isArray(clean) && clean.some((p) => isRecord(p) && p.snap !== undefined)
      // The outline is asked before the store's turn, which it waits for itself: for the points it can be snapped to, and for its middle,
      // where a straightening's scale and angle are told (a similarity has one scale everywhere).
      const cut = snapped || method === 'straight' ? await deps.outlines.cut(obj.id, named) : undefined
      const found = cut === undefined || cut instanceof Refusal ? undefined : cut
      const bounds = found?.cut.bounds
      const centre: [number, number] | undefined = bounds ? [(bounds.min[0] + bounds.max[0]) / 2, (bounds.min[1] + bounds.max[1]) / 2] : undefined
      return deps.tracings.lineUp(obj.id, named, clean, method, found?.snaps, centre)
    },

    /** The person's look of the photo: its fade (0 to 1) and whether it is hidden. */
    async look(objectId: string, id: string, raw: unknown): Promise<Tracing> {
      const given = isRecord(raw) ? raw : {}
      return deps.tracings.setLook(project(objectId).id, tracingId(id), { ...(given.fade === undefined ? {} : { fade: given.fade as number }), ...(given.hidden === undefined ? {} : { hidden: given.hidden as boolean }) })
    },

    /** Keeps the copy the window straightened, for the photo and the line-up it names (`of`). Refused when either is not the tracing's now. */
    async straightened(objectId: string, id: string, bytes: unknown, of: unknown): Promise<Tracing> {
      const given = isRecord(of) ? of : {}
      return deps.tracings.setStraightened(project(objectId).id, tracingId(id), bytes, { sha256: given.sha256 as string, transform: given.transform as string })
    },

    /** The bytes of a tracing's photo, or of its straightened copy: null when the file is not on this computer, or is another file than the tracing names (its hash). */
    async photoBytes(objectId: string, id: string, which: unknown): Promise<Uint8Array | null> {
      const obj = project(objectId)
      const named = tracingId(id)
      if (which !== 'photo' && which !== 'straightened') throw new Refusal("A tracing's photo is asked for as 'photo' or 'straightened'.")
      const photo = (await deps.tracings.list(obj.id)).tracings.find((t) => t.id === named)?.photo
      const file = which === 'photo' ? photo?.file : photo?.straightened
      if (photo === undefined || file === undefined) return null
      const bytes = await readPhoto(obj.dir, file)
      if (bytes === null) return null
      return which === 'photo' && sha256Of(bytes) !== photo.sha256 ? null : bytes
    },

    /** Takes the photo off a tracing, with its line-up. */
    async removePhoto(objectId: string, id: string): Promise<Tracing> {
      return deps.tracings.removePhoto(project(objectId).id, tracingId(id))
    },

    problem(objectId: string): Promise<string | null> {
      return deps.tracings.problem(project(objectId).id)
    },

    dismissProblem(objectId: string): Promise<void> {
      return deps.tracings.dismissProblem(project(objectId).id)
    }
  }
}
