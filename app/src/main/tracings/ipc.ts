import type { Described, Sectioned } from '../../shared/geometry'
import type { MainAxis } from '../../shared/planes'
import type { Scene } from '../../shared/scene'
import { expandTag, splitTagRef, tagOfRef } from '../../shared/tags'
import { type LayerColour, type LayerShape, type Tracing, type TracingCut, type TracingPlane, type TracingsFile, TRACING_ID, planeOfFrom } from '../../shared/tracings'
import type { ViewState } from '../../shared/view'
import type { ObjectInfo } from '../../shared/workspace'
import { NO_SECTION } from '../export/section'
import { Refusal } from '../refusal'
import type { Outlines } from './outline'
import { faceFrame, sectionFrame } from './planes'
import type { LayerChange, TracingStore } from './store'

// What the window may ask of the tracings (`tracings:list`, `:make`, `:edit`, `:remove`, `:restore`, `:layer`, `:outline`,
// `:shown`, `:problem`, `:dismissProblem`), as handlers that do not need Electron (`main/ipc.ts` registers them). Everything the
// window says is untrusted: a project is one that is open, a tracing is `T<n>`, a layer is a whole number, and what only main says
// of a tracing or a layer (`id`, `by`, `nextLayer`, `lost`, a layer's `id` and `by`, the photo and its line-up) is never taken
// from it: a key that is not part of what is asked is left out. Main makes the plane, from a main axis and an offset, from the
// kernel's `describe` of a face, or from the section on screen with the axes the kernel's `section` gives. What the window makes
// is the person's.

export interface TracingIpcDeps {
  tracings: Pick<TracingStore, 'list' | 'make' | 'edit' | 'remove' | 'restore' | 'layer' | 'hideLayer' | 'problem' | 'dismissProblem'>
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
    const frame = faceFrame(ref, described)
    const tag = tagOfRef(part, ref)
    return { ...frame, from: { kind: 'face', ref, ...(tag === undefined ? {} : { tag }), revision: last.revision } }
  }

  const onSection = async (obj: ObjectInfo, layout: string): Promise<TracingPlane> => {
    const view = deps.view(obj.id)
    const section = view?.section
    if (!view || !section) throw new Refusal(NO_SECTION)
    if (view.layout !== layout) throw new Refusal(`The section on screen is of the ${view.layout} layout, not ${layout}: show ${layout} first`)
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

  /** Where the tracing is laid: exactly one of a main plane (`main`, with its `offset`), a `face` and the `section` on screen. */
  const plane = async (obj: ObjectInfo, layout: string, raw: unknown): Promise<TracingPlane> => {
    if (!isRecord(raw)) throw new Refusal('Say which plane the tracing is laid on: a main plane, a face, or the section on screen')
    const kinds = (['main', 'face', 'section'] as const).filter((k) => raw[k] !== undefined)
    if (kinds.length !== 1) throw new Refusal('A tracing is laid on one plane: one of a main plane (main, offset), a face, or the section on screen')
    if (kinds[0] === 'face') return onFace(obj, layout, raw.face)
    if (kinds[0] === 'section') {
      if (raw.section !== true) throw new Refusal('section is true: the section plane on screen')
      return onSection(obj, layout)
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
    const kinds = (['make', 'edit', 'remove', 'hide'] as const).filter((k) => k in raw)
    if (kinds.length !== 1) throw new Refusal('A change to a layer is make, edit, remove or hide: one of them.')
    if ('make' in raw) {
      const given = isRecord(raw.make) ? raw.make : {}
      return { make: { name: given.name as string, colour: given.colour as LayerColour, shapes: given.shapes as LayerShape[] } }
    }
    if ('edit' in raw) {
      return { edit: raw.edit as number, ...(raw.name === undefined ? {} : { name: raw.name as string }), ...(raw.colour === undefined ? {} : { colour: raw.colour as LayerColour }), ...(raw.shapes === undefined ? {} : { shapes: raw.shapes as LayerShape[] }) }
    }
    if ('remove' in raw) return { remove: raw.remove as number }
    return { hide: raw.hide as number, hidden: raw.hidden as boolean }
  }

  return {
    async list(objectId: string): Promise<TracingsFile> {
      return deps.tracings.list(project(objectId).id)
    },

    /** Makes the person's tracing: main makes the plane, takes the build it is made on, and gives the number. */
    async make(objectId: string, raw: unknown): Promise<Tracing> {
      const obj = project(objectId)
      if (!isRecord(raw)) throw new Refusal('That is not a tracing: it names a plane, a layout and, if it has them, a name and parts.')
      const { layout, parts } = layoutAndParts(obj, raw.layout, raw.parts)
      const laid = await plane(obj, layout, raw.on)
      const revision = deps.build(obj.id)?.revision
      return deps.tracings.make(obj.id, { name: raw.name as string, layout, plane: laid, ...(parts === undefined ? {} : { parts }), ...(revision === undefined ? {} : { revision }) }, 'person')
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
      const cut = shaped ? await deps.outlines.cut(obj.id, named) : undefined
      const bounds = cut && !(cut instanceof Refusal) && cut.cut.bounds ? cut.cut.bounds : undefined
      return deps.tracings.layer(obj.id, named, change, 'person', bounds)
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

    problem(objectId: string): Promise<string | null> {
      return deps.tracings.problem(project(objectId).id)
    },

    dismissProblem(objectId: string): Promise<void> {
      return deps.tracings.dismissProblem(project(objectId).id)
    }
  }
}
