import { offEdgeReason, verdictOf } from '../../shared/dimension'
import type { MeasureArgs, MeasureProbe, MeasureTarget, MeasuredOnce } from '../../shared/geometry'
import type { Anchor, DimensionMark, Mark, Measurement, NewMark, Vec3 } from '../../shared/marks'
import type { Scene } from '../../shared/scene'
import type { Builds } from '../builds'
import { KernelError, isBusy } from '../kernel/client'
import { Refusal } from '../refusal'
import { sanitiseMark } from './file'
import { spreadApart, spreadReason } from './spread'
import type { MarkStore, Remeasured } from './store'
import { type NearEdge, edgeIsUnder, edgeOfPin, tolerance } from './tolerance'

/** How long a new dimension waits for its value before it appears without one, to be given it when it comes. */
export const APPEARS_AFTER_MS = 300

export interface MeasureDeps {
  query: Builds['query']
  /** The last successful build of an object. */
  scene(objectId: string): { revision: number; scene: Scene } | undefined
}

/**
 * An end of a measurement as the kernel takes it: a ref with the layout in
 * front, and the point it is measured at; without a ref, the point as a point
 * of the layout.
 */
function target(layout: string, end: MeasureTarget): object {
  const point = end.point ? { point: [end.point[0], end.point[1], end.point[2]] } : {}
  return typeof end.ref === 'string' && end.ref !== '' ? { ref: `${layout}:${end.ref}`, ...point } : { layout, ...point }
}

/** `measure` as it goes to the kernel (`kernel/src/torno_kernel/measure.py`). */
export function wire(args: MeasureArgs): object {
  return { kind: args.kind, a: target(args.layout, args.a), ...(args.b ? { b: target(args.layout, args.b) } : {}), ...(args.density === undefined ? {} : { density: args.density }) }
}

/** What the kernel said, as the person reads it: its refs without the layout in front, as they are everywhere in the window. */
export function plain(e: unknown, layout: string): string {
  const message = e instanceof Error ? e.message : String(e)
  return layout ? message.replaceAll(`${layout}:`, '') : message
}

/**
 * What the kernel is asked of a dimension: its kind of measurement, and each
 * end by the ref it has (a face, an edge or a part), with the layout in
 * front, and the point it was put at; an end with no ref is the point alone.
 * A second end goes only where the measurement is taken between two.
 */
export function measureRequest(mark: Pick<DimensionMark, 'measure' | 'layout' | 'a' | 'b'>): object {
  const end = (anchor: Anchor): MeasureTarget => ({ ...(anchor.ref === undefined ? {} : { ref: anchor.ref }), point: anchor.point })
  const between = mark.measure === 'distance' || mark.measure === 'angle'
  return wire({ kind: mark.measure, layout: mark.layout, a: end(mark.a), ...(between && mark.b ? { b: end(mark.b) } : {}) })
}

const isPoint = (value: unknown): value is Vec3 => Array.isArray(value) && value.length === 3 && value.every((c) => typeof c === 'number' && Number.isFinite(c))

/**
 * Measures a dimension on the build `revision` of its object, the one its
 * ends' refs are of: the kernel is asked with each end's ref and point, and
 * what comes back is the value in full, how it was taken, the points it was
 * taken between, that revision, and the verdict against what the mark
 * expects. A wall's thickness is asked at the point of the face nearest to
 * the end (`onItsFace`); the end itself stays where it was put.
 *
 * The kernel measures the feature a ref names, so nothing is asked through a
 * ref that is not of the build asked:
 *
 * - when the last build is not `revision`, before the kernel is asked or by
 *   the time it has answered, this rejects. It is never asked again on the
 *   newer build: the refs are not of that one.
 * - a dimension whose end the build moved (`anchorState: 'drifted'`) is
 *   measured from the face its end names now, which the check of the marks
 *   refreshed. An end on an edge keeps the edge it was put on when that is
 *   no longer under it, to be found again should it come back, and that
 *   number may be another edge's now, or the same edge somewhere else: it
 *   is asked first whether the edge is under the end (`offItsEdge`, by the
 *   rule the check judged it by), and when it is not there is no value, and
 *   `refused` says so. Nothing is measured from the face under it instead:
 *   that would be another measurement.
 *
 * Whether its part is still there is the caller's to know. When the kernel
 * says the thing cannot be measured (an end names nothing in this build, or
 * the kind of measurement is not one of such ends), there is no value, and
 * `refused` is why. Anything else that goes wrong (no build, a kernel that
 * does not answer) rejects, with a plain message: nothing is known of the
 * dimension then.
 */
export async function measureDimension(
  deps: MeasureDeps,
  objectId: string,
  mark: Pick<DimensionMark, 'measure' | 'layout' | 'a' | 'b' | 'expected' | 'tolerance'> & Partial<Pick<DimensionMark, 'anchorState'>>,
  revision: number | undefined
): Promise<Measurement> {
  const built = (): number | undefined => deps.scene(objectId)?.revision
  /** Throws unless the last build is the one the refs are of. */
  const stillThat = (): void => {
    const now = built()
    if (now === undefined) throw new Error(`there is no build of ${objectId} to measure on`)
    if (revision === undefined) throw new Error(`its ends have not been checked against r${now}`)
    if (now !== revision) throw new Error(`${objectId} was built again (r${now}) since its ends were found on r${revision}`)
  }
  stillThat()
  const between = mark.measure === 'distance' || mark.measure === 'angle'
  // How far apart two parts are that torno set side by side for display is no measurement of the model.
  const spread = mark.measure === 'distance' && mark.b ? spreadReason(deps.scene(objectId)!.scene, mark.layout, mark.a.part, mark.b.part) : null
  if (spread !== null && revision !== undefined) return { measuredRevision: revision, refused: spread }
  if (mark.anchorState === 'drifted') {
    for (const end of between && mark.b ? [mark.a, mark.b] : [mark.a]) {
      const edge = await offItsEdge(deps, objectId, mark.layout, end)
      stillThat()
      if (edge !== null && revision !== undefined) return { measuredRevision: revision, refused: offEdgeReason(edge, revision) }
    }
  }
  const request = measureRequest(mark.measure === 'thickness' ? { ...mark, a: await onItsFace(deps, objectId, mark.layout, mark.a) } : mark)
  let reply: Partial<Record<'value' | 'how' | 'points', unknown>> | null
  let refused: string | undefined
  try {
    reply = await deps.query(objectId, 'measure', request)
  } catch (e) {
    stillThat()
    if (!(e instanceof KernelError && (e.kind === 'bad_ref' || e.kind === 'bad_request'))) throw new Error(plain(e, mark.layout))
    reply = null
    refused = plain(e, mark.layout)
  }
  // A build that landed while the kernel was asked leaves it unsaid which the answer is of.
  stillThat()
  if (refused !== undefined) return { measuredRevision: revision, refused }
  if (typeof reply?.value !== 'number' || !Number.isFinite(reply.value) || typeof reply.how !== 'string') throw new Error('the kernel did not answer with a measurement')
  const { value, how, points } = reply
  const taken: { points?: [Vec3, Vec3] } = Array.isArray(points) && points.length === 2 && isPoint(points[0]) && isPoint(points[1]) ? { points: [points[0], points[1]] } : {}
  const verdict = verdictOf({ ...mark, value })
  return { value, how, ...taken, measuredRevision: revision, ...(verdict ? { verdict } : {}) }
}

/**
 * The edge an end is on (`edgeOfPin`, as it is judged) when that edge is not
 * under the end on the build there is; null when it is, or when the end is
 * on no edge. The kernel is asked (`nearest`, with the edge), and what it
 * says is held to the rule the check of the marks judges an end by
 * (`edgeIsUnder`). Throws when the kernel does not say: it is then not known
 * what the ref names.
 */
async function offItsEdge(deps: MeasureDeps, objectId: string, layout: string, end: Anchor): Promise<string | null> {
  const edge = edgeOfPin(end)
  if (edge === undefined) return null
  type Near = NearEdge & { found?: boolean; error?: unknown }
  let near: Near | null | undefined
  try {
    near = (await deps.query<{ anchors?: Array<Near | null> }>(objectId, 'nearest', { layout, anchors: [{ part: end.part, point: end.point, edge }] }))?.anchors?.[0]
  } catch (e) {
    throw new Error(plain(e, layout))
  }
  if (near?.found === false) return edge
  if (near?.found !== true || near.error !== undefined) throw new Error(`the kernel did not say whether ${edge} is under its end`)
  const bbox = deps.scene(objectId)?.scene.parts.find((p) => p.layout === layout && p.name === end.part)?.bbox
  return edgeIsUnder(near, edge, tolerance(bbox)) ? null : edge
}

/**
 * An end as a wall is measured from it: at the point of its face nearest to
 * where it was put. The point clicked is on the mesh that is drawn, which on
 * a curved face lies a hair off the surface, and the kernel measures a wall
 * only from a point on the face. The end is left where it is when the kernel
 * does not say, or finds the nearest point of the part on another face: the
 * kernel's own refusal then says what is wrong.
 */
async function onItsFace(deps: Pick<MeasureDeps, 'query'>, objectId: string, layout: string, end: Anchor): Promise<Anchor> {
  if (end.part === undefined || end.ref === undefined) return end
  try {
    const reply = await deps.query<{ anchors?: Array<{ found?: boolean; ref?: unknown; point?: unknown } | null> }>(objectId, 'nearest', { layout, anchors: [{ part: end.part, point: end.point }] })
    const near = reply?.anchors?.[0]
    return near?.found === true && near.ref === end.ref && isPoint(near.point) ? { ...end, point: [near.point[0], near.point[1], near.point[2]] } : end
  } catch {
    return end
  }
}

type Marks = Pick<MarkStore, 'add' | 'measured' | 'remove' | 'list'>

/**
 * Throws unless what is to be measured, kept or not, can be measured on the last build: there is one, it is the
 * build the ends were placed on (its refs are of that build, and the kernel would measure whatever has those numbers
 * now), and a distance is not between two parts torno spread apart (that would be a check of torno's spacing). One
 * rule for a dimension kept (`addDimensionTold`) and a measurement that is not (`measureOnce`).
 */
function measurableOnLast(deps: MeasureDeps, objectId: string, probe: Pick<DimensionMark, 'measure' | 'layout' | 'revision' | 'a' | 'b'>): void {
  const last = deps.scene(objectId)
  if (last === undefined) throw new Error(`there is no build of ${objectId} to measure on`)
  const built = last.revision
  if (probe.revision !== built) throw new Refusal(`it was placed on r${probe.revision}, and the part has been built again since (r${built}): measure it again`)
  const apart = probe.measure === 'distance' ? spreadApart(last.scene, probe.layout, probe.a.part, probe.b?.part, 'the distance between') : null
  if (apart !== null) throw new Refusal(apart)
}

/** A camera for checking a probe as a dimension would be checked: a measurement not kept has no view of its own. */
const NO_CAMERA = { position: [0, 0, 1], target: [0, 0, 0], up: [0, 1, 0], ortho: false, fov: 35, zoom: 1 }

/**
 * A measurement the person takes and does not keep (`geometry:measure`): the kernel's value on the last build, with
 * the refusals of a dimension (`measurableOnLast`, the kernel's own reason), and nothing written. What is no
 * dimension (a kind it does not know, an end that is no point, a distance with one end) is refused before anything
 * is asked. When the kernel cannot be asked this rejects with a plain message: nothing is kept for later, unlike a
 * dimension.
 */
export async function measureOnce(deps: MeasureDeps, objectId: string, probe: MeasureProbe): Promise<MeasuredOnce> {
  const asked = typeof probe === 'object' && probe !== null ? { measure: probe.measure, layout: probe.layout, revision: probe.revision, a: probe.a, ...(probe.b === undefined ? {} : { b: probe.b }) } : {}
  const checked = sanitiseMark({ ...asked, kind: 'dimension', id: 'M1', author: 'user', note: '', status: 'draft', anchorState: 'ok', createdAt: '', camera: NO_CAMERA })
  const between = checked?.kind === 'dimension' && (checked.measure === 'distance' || checked.measure === 'angle')
  if (checked?.kind !== 'dimension' || (between && checked.b === undefined)) throw new Refusal('that is no measurement: a kind of measurement, a layout, a build and its ends are needed')
  measurableOnLast(deps, objectId, checked)
  const measured = await measureDimension(deps, objectId, checked, checked.revision)
  if (measured.refused !== undefined) throw new Refusal(measured.refused)
  return { value: measured.value!, how: measured.how!, revision: checked.revision }
}

/**
 * Keeps a new dimension, measured: the kernel is asked at once, and when it
 * answers within `APPEARS_AFTER_MS` the dimension is added with its value, in
 * one change. When it takes longer the dimension appears without one, and is
 * given it when it comes. Resolves with the mark as it then is.
 *
 * A dimension placed on another build than the last is refused before
 * anything is asked: its refs are of that build, and the kernel would measure
 * whatever has those numbers now. A dimension the kernel cannot measure is
 * not kept either (one that had appeared is taken away again), and the
 * promise rejects with the kernel's reason: two ends that have no angle
 * between them, a face with no radius. What is no dimension at all is the
 * store's to refuse, and the kernel is not asked.
 *
 * When the kernel could not be asked (it did not answer in time, or another
 * build landed), the dimension is kept without a value: it is the person's,
 * and says it is not measured until the check of the marks, which every new
 * mark sets off and which is tried again, has measured it (`remeasureAll`).
 */
export function addDimension(deps: MeasureDeps & { marks: Marks; log?(message: string): void }, objectId: string, mark: NewMark, status: 'draft' | 'sent' = 'draft'): Promise<Mark> {
  return addDimensionTold(deps, objectId, mark, status).then((added) => added.mark)
}

/**
 * Why a dimension that was kept has no value of the last build: `rebuilt`
 * when another build landed while it was measured, so that its refs are not
 * of the build there is; `unanswered` when the kernel could not be asked or
 * did not answer in time.
 */
export type Unmeasured = 'rebuilt' | 'unanswered'

/**
 * `addDimension`, for whoever must say what came of it: the mark as it was
 * kept, and, when it was kept without a value of the last build, why
 * (`unmeasured`). Whoever is told of the mark is then not left to take
 * "not measured" for a measurement.
 */
export async function addDimensionTold(
  deps: MeasureDeps & { marks: Marks; log?(message: string): void },
  objectId: string,
  mark: NewMark,
  status: 'draft' | 'sent' = 'draft'
): Promise<{ mark: Mark; unmeasured?: Unmeasured; reason?: string }> {
  const probe = sanitiseMark({ ...Object(mark), id: 'M1', status: 'draft', anchorState: 'ok', createdAt: '' })
  if (probe?.kind !== 'dimension') return { mark: await deps.marks.add(objectId, mark, status) }
  /** What went wrong asking the kernel, when it gave no answer. */
  let reason: string | undefined
  /** The mark as it was kept, and why it has no value of the build there now is, if it has none. */
  const told = (kept: Mark): { mark: Mark; unmeasured?: Unmeasured; reason?: string } => {
    const now = deps.scene(objectId)?.revision
    if (kept.kind !== 'dimension' || (now !== undefined && kept.measuredRevision === now)) return { mark: kept }
    if (now !== probe.revision) return { mark: kept, unmeasured: 'rebuilt' }
    return { mark: kept, unmeasured: 'unanswered', ...(reason === undefined ? {} : { reason }) }
  }
  measurableOnLast(deps, objectId, probe)

  /** What the kernel said; null when it could not be asked. Throws its reason when it refused. */
  const measuring: Promise<Measurement | null> = measureDimension(deps, objectId, probe, probe.revision).then(
    (measured) => measured,
    (e: unknown) => {
      reason = e instanceof Error ? e.message : String(e)
      ;(deps.log ?? console.error)(`cannot measure a new dimension of ${objectId} yet: ${reason}`)
      return null
    }
  )
  const kept = (measured: Measurement | null): Measurement | undefined => {
    if (measured?.refused !== undefined) throw new Refusal(measured.refused)
    return measured ?? undefined
  }

  let timer: NodeJS.Timeout | undefined
  const quick = await Promise.race([measuring.then((measured) => ({ measured })), new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), APPEARS_AFTER_MS)))])
  clearTimeout(timer)
  if (quick) return told(await deps.marks.add(objectId, mark, status, kept(quick.measured)))

  const added = await deps.marks.add(objectId, mark, status)
  let measured: Measurement | undefined
  try {
    measured = kept(await measuring)
  } catch (e) {
    await deps.marks.remove(objectId, added.id).catch(() => {})
    throw e
  }
  const written = measured ? await deps.marks.measured(objectId, added.id, probe, measured) : null
  // Not written: the check of the marks has refreshed its ends or measured it meanwhile. As it is now, then.
  return told(written ?? (await deps.marks.list(objectId)).find((m) => m.id === added.id) ?? added)
}

/**
 * Whether a dimension is to be measured at once after a change of what it
 * should be (`expected`, `tolerance`): when it has no value of the last
 * build, `revision`, to be judged anew from. Only one whose ends the check of
 * that build has judged, and found their parts: until then its refs are of
 * an older build, where the kernel would measure whatever has those numbers
 * now, and the check, still to come or being tried again, measures it
 * itself (`remeasureAll`).
 */
export function dueAfterEdit(patch: unknown, changed: Mark, revision: number | undefined): changed is DimensionMark {
  const asked = typeof patch === 'object' && patch !== null ? (patch as { expected?: unknown; tolerance?: unknown }) : {}
  if (asked.expected === undefined && asked.tolerance === undefined) return false
  if (changed.kind !== 'dimension' || changed.status === 'resolved' || changed.anchorState === 'orphaned') return false
  return revision !== undefined && changed.measuredRevision !== revision && changed.checkedRevision === revision
}

/**
 * Measures a dimension again, on the build its ends were last checked
 * against, and writes what the kernel says: its value, or that it is not
 * measurable and why. When the kernel could not be asked, or that build is
 * no longer the last, the dimension is left as it is, and that is logged:
 * the check of the newer build measures it.
 */
export async function remeasure(deps: MeasureDeps & { marks: Pick<MarkStore, 'measured'>; log?(message: string): void }, objectId: string, mark: DimensionMark): Promise<void> {
  try {
    await deps.marks.measured(objectId, mark.id, mark, await measureDimension(deps, objectId, mark, mark.checkedRevision))
  } catch (e) {
    ;(deps.log ?? console.error)(`cannot measure ${mark.id} of ${objectId}: ${e instanceof Error ? e.message : String(e)}`)
  }
}

export interface RemeasureDeps extends MeasureDeps {
  marks: Pick<MarkStore, 'list' | 'remeasured'>
  /** Told, once per call, what could not be measured. */
  log?(message: string): void
}

/**
 * Measures every unresolved dimension of an object on its last successful
 * build, in every layout, and writes what the kernel said in one write: they
 * are the person's checks of the part, and each build is held against them.
 * It follows the check of the marks against that build (`reanchorAll`), and
 * measures from the ends as that left them: a dimension whose end the build
 * moved is measured between the features its ends name now, and says that
 * it moved. Resolves false when some dimension could not be measured that
 * should have been, and `busy` when that was because the kernel's worker was
 * still busy with an earlier query.
 *
 * - One whose ends that check could not judge (`checkedRevision` is of
 *   another build) is not measured: its refs may name other faces by now.
 *   It stays not measured on this build, as that check has already reported.
 * - One already measured on this build is not asked about again.
 * - One that lost the part of an end is not measurable, and the kernel is not
 *   asked; nor is one the kernel refuses, which keeps the kernel's reason, nor
 *   one with an end on an edge that is no longer under it (`measureDimension`).
 *   Each has no value from then on.
 * - One the kernel could not be asked about (no answer, a timeout) keeps the
 *   value it had, which stays that of the build it was measured on: it is
 *   then not measured on this one. That is logged, once for the whole call.
 *
 * When a newer build arrives meanwhile (`scene` answers another) everything
 * is dropped: that build has its own call. What is written says what each
 * dimension was measured from, and the store passes over one that changed
 * underneath.
 */
export async function remeasureAll(deps: RemeasureDeps, objectId: string): Promise<boolean | 'busy'> {
  const last = deps.scene(objectId)
  if (!last) return true
  const { scene, revision } = last
  const superseded = (): boolean => deps.scene(objectId)?.scene !== scene
  const due = (await deps.marks.list(objectId)).filter(
    (mark): mark is DimensionMark => mark.kind === 'dimension' && mark.status !== 'resolved' && mark.checkedRevision === revision && mark.measuredRevision !== revision
  )
  const changes: Remeasured[] = []
  const failures: string[] = []
  /** Whether what could not be measured was only because the worker is still busy with an earlier query: worth asking again (`retrying`). */
  let busy = false
  for (const mark of due) {
    if (superseded()) return true
    const of = { measure: mark.measure, a: mark.a, ...(mark.b ? { b: mark.b } : {}), ...(mark.expected === undefined ? {} : { expected: mark.expected }), ...(mark.tolerance === undefined ? {} : { tolerance: mark.tolerance }) }
    if (mark.anchorState === 'orphaned') {
      changes.push({ id: mark.id, of, result: { measuredRevision: revision } })
      continue
    }
    try {
      changes.push({ id: mark.id, of, result: await measureDimension(deps, objectId, mark, revision) })
    } catch (e) {
      if (isBusy(e)) busy = true
      failures.push(`${mark.id}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  if (superseded()) return true
  if (changes.length > 0) await deps.marks.remeasured(objectId, changes)
  if (failures.length > 0) (deps.log ?? console.error)(`cannot measure the dimensions of ${objectId} on its last build: ${failures.join('; ')}`)
  return failures.length === 0 ? true : busy ? 'busy' : false
}
