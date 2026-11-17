import { type BuildIdentity, identitySaid } from '../../shared/git'
import type { Sectioned } from '../../shared/geometry'
import { lineupSaid, photoRect } from '../../shared/lineup'
import type { DimensionMark, Mark } from '../../shared/marks'
import type { Scene } from '../../shared/scene'
import type { SceneFile } from '../../shared/scenefile'
import { type TracingExtras, type TracingSvg, tracingSvg } from '../../shared/tracingSvg'
import type { Tracing } from '../../shared/tracings'
import type { FileFormat } from '../../shared/exportdata'
import type { ObjectInfo } from '../../shared/workspace'
import { SECTION_DEFLECTION } from '../mcp/readTools'
import { checkedPhoto } from '../tracings/photos'
import { NOT_BUILT, NO_OBJECT, partColors } from './build'
import { NEW_BUILD } from './model'
import { defaultExportPath } from './save'

// A drawing of a tracing, for someone who will make the part (`export:saveTracing`): main asks the kernel for the outlines of
// the tracing's own plane (its axes, its layout, the parts it draws), within `SECTION_DEFLECTION`, and lays them out with what
// the sheet ticked (the layers, the marks on it, the photo) as an SVG at true scale (`tracingSvg`, the one drawing the window's
// view of a tracing is made by too). It is made from the last good build of this run, like every export, and the window names
// ids and ticks: never a path, never bytes.

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
  /** The bytes of a photo or straightened copy of the project's tracings by its file name, or null when it is not on this computer. */
  photoBytes?(objectId: string, file: string): Promise<Uint8Array | null>
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

/**
 * The straightened copy of the tracing's photo as a drawing carries it: its bytes as a `data:` image (read by main from its folder, never
 * a path or a link), the box in mm it is placed by, the person's fade, and the line-up in words. A hidden photo is drawn too: the tick is the
 * person's, and hiding is how the view looks. Throws a sentence for a photo that is not there, not lined up, or whose copy is not on this computer.
 */
async function photoOf(deps: TracingDrawingDeps, objectId: string, t: Tracing): Promise<{ placed: NonNullable<TracingExtras['photo']>; said: string } | undefined> {
  const photo = t.photo
  if (photo === undefined) throw new Error(`${t.id} has no photo to put in the drawing`)
  if (photo.transform === undefined || photo.scale === undefined) throw new Error(`The photo of ${t.id} is not lined up yet, so it has no place in the drawing: line it up first`)
  const bytes = photo.straightened === undefined ? null : ((await deps.photoBytes?.(objectId, photo.straightened)) ?? null)
  if (bytes === null) throw new Error(`The straightened photo of ${t.id} is not on this computer: open ${t.id} in the window to make it again, then export`)
  const image = checkedPhoto(bytes)
  if (!image) throw new Error(`The straightened photo of ${t.id} is not a picture torno can draw`)
  const rect = photoRect(photo.transform, photo.width, photo.height)
  if (rect === null) throw new Error(`The photo of ${t.id} has no place on the tracing: line it up again`)
  return { placed: { href: `data:${image.mediaType};base64,${Buffer.from(image.bytes).toString('base64')}`, rect, fade: photo.fade }, said: lineupSaid(photo) }
}

/** The drawing of tracing `id` of the last good build, with what was ticked. Throws a sentence for the window. */
export async function makeTracingDrawing(deps: TracingDrawingDeps, objectId: string, id: string, ticks: TracingTicks): Promise<TracingFile> {
  const obj = deps.object(objectId)
  if (!obj) throw new Error(NO_OBJECT)
  const last = deps.last(objectId)
  if (!last) throw new Error(NOT_BUILT)
  const all = await deps.tracings(objectId)
  const t = all.find((one) => one.id === id)
  if (!t) throw new Error(`no tracing ${String(id)}; tracings: ${all.map((one) => one.id).join(', ') || 'none'}`)
  const photo = ticks.photo ? await photoOf(deps, objectId, t) : undefined
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
      ...(photo ? { photoSaid: photo.said } : {}),
      ...(identity ? { source: identitySaid(identity) } : {})
    },
    { ...(ticks.layers ? { layers: t.layers } : {}), ...(onIt.length > 0 ? { marks: onIt } : {}), ...(photo ? { photo: photo.placed } : {}) }
  )
  return { ...drawn, objectId, name: obj.name, id: t.id, revision }
}

/** Where the dialog opens for the drawing: `<project>/.torno/exports/<project>-T1-r<revision>.svg`. */
export const tracingExportPath = (dir: string, file: Pick<TracingFile, 'name' | 'id' | 'revision'>, format: Extract<FileFormat, 'svg' | 'pdf'>): string =>
  defaultExportPath(dir, `${file.name}-${file.id}`, file.revision, format)

