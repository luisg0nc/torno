import { cameraOf } from '../marks/file'
import type { Mark, NewMark, OffsetMark, SpanEnd, SpanMark } from '../../shared/marks'
import { MAX_NOTE } from '../../shared/marks'
import { type TracingCut, type TracingsFile, TRACING_ID, offsetWords, referencePoint, toObject } from '../../shared/tracings'
import type { MarkStore } from '../marks/store'
import { Refusal } from '../refusal'
import { checkOnTracing } from './marks'
import { type GivenEnd, spanValue } from './spans'

// The two marks that only a tracing has: a measure (`span`) and "should be here" (`offset`). The window says what the person did (two
// ends, or a shape and how far it was dragged); main finds the rest from its own numbers (the kernel's points of the last build, the
// layer and its shape, the plane's frame) and keeps the mark. Neither carries a review intent, joins a round or is judged by a build.

export interface MeasureDeps {
  tracings: { list(objectId: string): Promise<TracingsFile> }
  marks: Pick<MarkStore, 'addSpan' | 'saveOffset'>
  /** The outline of a tracing on the last build, with the points it can be snapped to. */
  outlines: { cut(objectId: string, id: string): Promise<TracingCut | Refusal> }
  /** The last successful build of the project: its number. None before the first. */
  revision(objectId: string): number | undefined
  /** The history id of the build of this run with this number (`h41`), or none when the history keeps no such build. */
  historyId(objectId: string, revision: number): Promise<string | undefined>
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** What the two tools share: the project's tracing, the camera the mark is made from and the note, as far as a mark of the person's has them. */
function common(input: unknown, file: TracingsFile): { given: Record<string, unknown>; tracing: TracingsFile['tracings'][number]; camera: NonNullable<ReturnType<typeof cameraOf>>; note: string } {
  if (!isRecord(input)) throw new Refusal('That is not a mark.')
  const id = input.tracing
  if (typeof id !== 'string' || !TRACING_ID.test(id)) throw new Refusal(`${String(id)} is no tracing id; tracings: ${file.tracings.map((t) => t.id).join(', ') || 'none'}`)
  const tracing = file.tracings.find((t) => t.id === id)
  if (!tracing) throw new Refusal(`no tracing ${id}; tracings: ${file.tracings.map((t) => t.id).join(', ') || 'none'}`)
  const camera = cameraOf(input.camera)
  if (!camera) throw new Refusal('A mark is made from a view: the camera is missing or has a number that is not finite.')
  const note = typeof input.note === 'string' ? input.note.replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE) : ''
  return { given: input, tracing, camera, note }
}

const lastBuild = (deps: MeasureDeps, objectId: string): number => {
  const revision = deps.revision(objectId)
  if (revision === undefined) throw new Refusal('The project has no build yet: build the model first.')
  return revision
}

/**
 * A measure the person made on a tracing, between two ends in its plane. Main takes the points and the value from the kernel's own
 * numbers of the last build where an end is snapped (`spanValue`), says whether it is exact and how it was found, and keeps it: the
 * window's own value, exactness and build are never taken. A snapped end needs the tracing's outline on that build.
 */
export async function makeSpan(deps: MeasureDeps, objectId: string, input: unknown): Promise<Mark> {
  const file = await deps.tracings.list(objectId)
  const { given, tracing, camera, note } = common(input, file)
  const asked = [given.a, given.b]
  if (!asked.every(isRecord)) throw new Refusal('A measure has two ends, each a point of the tracing.')
  const ends = asked as unknown as [GivenEnd, GivenEnd]
  const snapped = ends.some((e) => e.snap !== undefined)
  let revision: number
  let snaps: TracingCut['snaps'] | undefined
  if (snapped) {
    const cut = await deps.outlines.cut(objectId, tracing.id)
    if (cut instanceof Refusal) throw cut
    revision = cut.revision
    snaps = cut.snaps
  } else {
    revision = lastBuild(deps, objectId)
  }
  // The build is named by its history id: this run's number means nothing in the next.
  const build = await deps.historyId(objectId, revision)
  const worked = spanValue(ends[0], ends[1], snaps, tracing.photo, build)
  const at = (e: GivenEnd): SpanEnd => ({ uv: e.uv, point: toObject(tracing.plane, e.uv), on: e.on, ...(e.snap === undefined ? {} : { snap: e.snap }) })
  const [a, b] = [at(worked.a), at(worked.b)]
  const span = { kind: 'span', author: 'user', note, layout: tracing.layout, revision, camera, tracing: tracing.id, uv: [a.uv, b.uv], a, b, value: worked.value, exact: worked.exact, how: worked.how, ...(build === undefined ? {} : { build }), measuredOn: revision } satisfies Omit<SpanMark, 'id' | 'status' | 'anchorState' | 'createdAt'>
  const refusal = checkOnTracing(span as unknown as NewMark, file)
  if (refusal) throw refusal
  return deps.marks.addSpan(objectId, span as unknown as NewMark)
}

/**
 * "Should be here": the person dragged shape `shape` of layer `layer` by `by` (`[du, dv]` mm along the tracing's axes). Main finds the
 * shape as it is now (kept as `was`), the layer's name and revision, and the reference point before and after in the object frame. The
 * person's draft offset of the same shape is changed to this one. Never exact, never checked against a build.
 */
export async function makeOffset(deps: MeasureDeps, objectId: string, input: unknown): Promise<Mark> {
  const file = await deps.tracings.list(objectId)
  const { given, tracing, camera, note } = common(input, file)
  const layer = tracing.layers.find((l) => l.id === given.layer)
  if (!layer) throw new Refusal(`no layer ${String(given.layer)} in ${tracing.id}; layers: ${tracing.layers.map((l) => l.id).join(', ') || 'none'}`)
  const index = given.shape
  const shape = typeof index === 'number' && Number.isSafeInteger(index) && index >= 0 ? layer.shapes[index] : undefined
  if (!shape || typeof index !== 'number') throw new Refusal(`no shape ${typeof index === 'number' ? index + 1 : String(index)} in the layer ${layer.name}, which has ${layer.shapes.length}`)
  const by = given.by
  if (!Array.isArray(by) || by.length !== 2 || !by.every((c) => typeof c === 'number' && Number.isFinite(c))) throw new Refusal('A shape is moved by two finite numbers, [du, dv] in millimetres.')
  if (offsetWords([by[0], by[1]]) === '0 mm') throw new Refusal('A shape moved by nothing is no "should be here": remove the mark instead.')
  const revision = lastBuild(deps, objectId)
  const ref = referencePoint(shape)
  const offset = {
    kind: 'offset',
    author: 'user',
    note,
    layout: tracing.layout,
    revision,
    camera,
    tracing: tracing.id,
    layer: { id: layer.id, name: layer.name, revision: layer.revision },
    shape: { index, name: shape.kind === 'label' ? '' : (shape.name ?? '') },
    was: structuredClone(shape),
    by: [by[0], by[1]],
    from: toObject(tracing.plane, ref),
    to: toObject(tracing.plane, [ref[0] + by[0], ref[1] + by[1]]),
    uv: [ref, [ref[0] + by[0], ref[1] + by[1]]]
  } satisfies Omit<OffsetMark, 'id' | 'status' | 'anchorState' | 'createdAt'>
  const refusal = checkOnTracing(offset as unknown as NewMark, file)
  if (refusal) throw refusal
  return deps.marks.saveOffset(objectId, offset as unknown as NewMark)
}
