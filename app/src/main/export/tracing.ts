import { type BuildIdentity, identitySaid } from '../../shared/git'
import type { Sectioned } from '../../shared/geometry'
import type { DimensionMark, Mark } from '../../shared/marks'
import type { Scene } from '../../shared/scene'
import type { SceneFile } from '../../shared/scenefile'
import { type TracingSvg, tracingSvg } from '../../shared/tracingSvg'
import type { Tracing } from '../../shared/tracings'
import type { FileFormat } from '../../shared/exportdata'
import type { ObjectInfo } from '../../shared/workspace'
import { SECTION_DEFLECTION } from '../mcp/readTools'
import { NOT_BUILT, NO_OBJECT, partColors } from './build'
import { NEW_BUILD } from './model'
import { defaultExportPath } from './save'

// A drawing of a tracing, for someone who will make the part (`export:saveTracing`): main asks the kernel for the outlines of
// the tracing's own plane (its axes, its layout, the parts it draws), within `SECTION_DEFLECTION`, and lays them out with what
// the sheet ticked (the layers, the marks on it, the photo) as an SVG at true scale (`tracingSvg`, the one drawing the window's
// view of a tracing is made by too). It is made from the last good build of this run, like every export, and the window names
// ids and ticks: never a path, never bytes.

/** Said when the photo is ticked: it is not drawn yet. */
export const PHOTO_NOT_YET = 'The photo cannot be put in a drawing yet'

export interface TracingDrawingDeps {
  object(objectId: string): ObjectInfo | undefined
  last(objectId: string): { revision: number; scene: Scene } | undefined
  /** The tracings of the project, as the store holds them. */
  tracings(objectId: string): Promise<Tracing[]>
  /** The scene file's parts, for the colour of each part's tab. */
  sceneFile(objectId: string): Promise<SceneFile>
  marks(objectId: string): Promise<Mark[]>
  query<T>(objectId: string, name: string, args: Record<string, unknown>): Promise<T>
  now(): Date
  /** What the build of this revision was made from (sources hash, commit, changes), when torno knows it. */
  identity?(objectId: string, revision: number): BuildIdentity | undefined
}

/** What the export sheet ticked for a tracing. */
export interface TracingTicks {
  layers: boolean
  marks: boolean
  photo: boolean
}

export interface TracingFile extends TracingSvg {
  objectId: string
  /** The project's name. */
  name: string
  /** The tracing's ref, `T1`. */
  id: string
  revision: number
}

/** The mark's own tracing, when it names one (`MarkBase.tracing`). */
const tracingOf = (mark: Mark): string | undefined => (mark as { tracing?: string }).tracing

/** The drawing of tracing `id` of the last good build, with what was ticked. Throws a sentence for the window. */
export async function makeTracingDrawing(deps: TracingDrawingDeps, objectId: string, id: string, ticks: TracingTicks): Promise<TracingFile> {
  const obj = deps.object(objectId)
  if (!obj) throw new Error(NO_OBJECT)
  const last = deps.last(objectId)
  if (!last) throw new Error(NOT_BUILT)
  const all = await deps.tracings(objectId)
  const t = all.find((one) => one.id === id)
  if (!t) throw new Error(`no tracing ${String(id)}; tracings: ${all.map((one) => one.id).join(', ') || 'none'}`)
  if (ticks.photo) throw new Error(PHOTO_NOT_YET)
  const { scene, revision } = last
  if (!scene.layouts.includes(t.layout)) throw new Error(`The last build has no layout ${t.layout}, so ${t.id} cannot be drawn`)
  // The parts it draws: all of the layout, or those it names that the layout has.
  const inLayout = scene.parts.filter((part) => part.layout === t.layout)
  const names = t.parts === undefined ? undefined : inLayout.filter((part) => t.parts?.includes(part.name)).map((part) => part.name)
  const { plane } = t
  const normal: [number, number, number] = [plane.x[1] * plane.y[2] - plane.x[2] * plane.y[1], plane.x[2] * plane.y[0] - plane.x[0] * plane.y[2], plane.x[0] * plane.y[1] - plane.x[1] * plane.y[0]]
  let cut: Sectioned
  if (names !== undefined && names.length === 0) {
    cut = { plane: { origin: plane.origin, normal, x: plane.x, y: plane.y }, parts: [], bounds: null }
  } else {
    cut = await deps.query<Sectioned>(objectId, 'section', { layout: t.layout, plane: { origin: plane.origin, normal }, axes: { x: plane.x, y: plane.y }, ...(names === undefined ? {} : { parts: names }), deflection: SECTION_DEFLECTION })
    if (!Array.isArray(cut?.parts) || !cut.plane) throw new Error('The kernel did not answer with a section')
  }
  if (deps.last(objectId)?.revision !== revision) throw new Error(NEW_BUILD)
  const everything = await deps.marks(objectId)
  const dimensions = everything.filter((mark): mark is DimensionMark => mark.kind === 'dimension')
  const onIt = ticks.marks ? everything.filter((mark) => tracingOf(mark) === id && mark.layout === t.layout) : []
  const colours = partColors(scene, await deps.sceneFile(objectId))
  const identity = deps.identity?.(objectId, revision)
  const drawn = tracingSvg(
    cut,
    {
      object: obj.name,
      layout: t.layout,
      revision,
      date: deps.now(),
      marks: dimensions,
      tracing: { id: t.id, name: t.name, plane: plane.label },
      partColours: Object.fromEntries(colours),
      ...(identity ? { source: identitySaid(identity) } : {})
    },
    { ...(ticks.layers ? { layers: t.layers } : {}), ...(onIt.length > 0 ? { marks: onIt } : {}) }
  )
  return { ...drawn, objectId, name: obj.name, id: t.id, revision }
}

/** Where the dialog opens for the drawing: `<project>/.torno/exports/<project>-T1-r<revision>.svg`. */
export const tracingExportPath = (dir: string, file: Pick<TracingFile, 'name' | 'id' | 'revision'>, format: Extract<FileFormat, 'svg' | 'pdf'>): string =>
  defaultExportPath(dir, `${file.name}-${file.id}`, file.revision, format)

