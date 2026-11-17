import { isDeepStrictEqual } from 'node:util'
import type { Described } from '../../shared/geometry'
import { type Anchor, type AnchorState, type Mark, type NewMark, type Replacement, type Vec3, markAnchors, strokeSamples, translated } from '../../shared/marks'
import type { Scene } from '../../shared/scene'
import { type NamedSet, setLabelFor } from '../../shared/sets'
import { tagOfRef, tagRefs } from '../../shared/tags'
import type { Builds } from '../builds'
import { KernelError, isBusy } from '../kernel/client'
import { type RemeasureDeps, remeasureAll } from './measure'
import { EDGE_TOLERANCE_MM, edgeIsUnder, edgeOfPin, tolerance } from './tolerance'
import type { MarkStore, Reanchored } from './store'

/**
 * What the kernel's `nearest` says of one anchor: the point of its part's
 * surface nearest to it, the face that point is on (`lid/F12`, no layout in
 * front), and how far the two are apart; that the layout has no such part; or
 * that the part is there and nothing could be said of this point (`error`).
 *
 * `support` is what the nearest point lies on. On an edge, `edgeUnder` is that
 * edge (`lid/E40`), `edgeUnderDescriptor` what it is and `between` the faces
 * that meet there.
 *
 * For an anchor sent with the `edge` it was put on (`lid/E3`), also whether
 * the part has an edge of that number and, if so, how far the anchor's point
 * is from it, what it is, and the faces that meet at it.
 */
export type NearestAnchor = FoundAnchor | { part: string; found: true; error: string } | { part: string; found: false }

export type FoundAnchor = {
  part: string
  found: true
  error?: undefined
  point: Vec3
  normal: Vec3 | null
  ref: string
  distance: number
  descriptor: string | null
  support?: 'face' | 'edge' | 'vertex'
  edgeUnder?: string
  edgeUnderDescriptor?: string | null
  between?: string[]
} & EdgeOfAnchor &
  FaceOfAnchor

type EdgeOfAnchor = { edgeFound?: undefined } | { edgeFound: false } | { edgeFound: true; edgeDistance: number; edgeDescriptor: string | null; edgeBetween?: string[]; edgePoint?: Vec3 }

/** For an anchor sent with the face a tag names now (`face`): whether the part has it, and how far the point is from it. */
type FaceOfAnchor = { faceFound?: undefined } | { faceFound: false } | { faceFound: true; faceDistance: number; faceDescriptor: string | null; faceNormal: Vec3 | null; facePoint?: Vec3 }

/** Whether the kernel found the part and could say where on it the anchor is. */
export function answered(one: NearestAnchor | undefined): one is FoundAnchor {
  return one?.found === true && one.error === undefined
}

/** An anchor as `nearest` is asked about it. */
export type AskedAnchor = { part: string; point: Vec3; edge?: string; face?: string }

export type Judged = { anchor: Anchor; state: AnchorState }

// Where these are kept, for whoever judges an anchor and whoever measures from one.
export { EDGE_TOLERANCE_MM, edgeIsUnder, edgeOfPin, tolerance }
const WORST_FIRST: AnchorState[] = ['orphaned', 'drifted', 'ok']
/**
 * A stroke on the surface may run from one part onto the next, and its points
 * do not say which part each is on: each is asked about against every part of
 * the layout, while the layout has no more parts than this. Beyond it, against
 * the part the stroke began on only.
 */
const STROKE_PARTS = 8

/**
 * An anchor as a new build leaves it. Its part gone: orphaned, and kept as it
 * was, so that it is found again if the part comes back. Otherwise its ref,
 * normal and descriptor are those of the face now nearest, and it is drifted
 * when that face is further away than `tolerance`. The point is never moved
 * from where the person put it on the part, nor what the anchor says of how
 * its part is spread.
 */
export function judge(anchor: Anchor, nearest: FoundAnchor | { part: string; found: false }, tolerance: number): Judged {
  if (!nearest.found) return { anchor, state: 'orphaned' }
  const refreshed: Anchor = { point: anchor.point, part: anchor.part, ref: nearest.ref }
  // Without them rather than with the old ones, which were said of another face.
  if (nearest.normal) refreshed.normal = nearest.normal
  if (typeof nearest.descriptor === 'string') refreshed.descriptor = nearest.descriptor
  if (anchor.arranged) refreshed.arranged = anchor.arranged
  return { anchor: refreshed, state: nearest.distance <= tolerance ? 'ok' : 'drifted' }
}

/**
 * The anchor of a pin as a new build leaves it: as `judge` says, and on an
 * edge when its point is on one. That is the edge the kernel found the point
 * on, whichever the pin names; else the edge it names, while that is under
 * its point (`edgeIsUnder`: within `EDGE_TOLERANCE_MM` of the edge of that
 * number). The anchor then names the edge as its ref, with
 * the faces that meet there when they are two, and has no normal: an edge has
 * no one normal. A pin that was on an edge and is on none now has drifted,
 * and keeps the edge it was put on, so that a build which puts the edge back
 * finds the pin on it again.
 */
export function judgePin(anchor: Anchor, nearest: FoundAnchor | { part: string; found: false }, tolerance: number): Judged {
  const onFace = judge(anchor, nearest, tolerance)
  if (!nearest.found) return onFace
  const named = edgeOfPin(anchor)
  const on = (edge: string, between: string[] | undefined, descriptor: string | null | undefined): Judged => ({
    anchor: {
      point: anchor.point,
      part: anchor.part,
      ref: edge,
      edge,
      ...(between?.length === 2 ? { between: [between[0], between[1]] } : {}),
      ...(typeof descriptor === 'string' ? { descriptor } : {}),
      ...(anchor.arranged ? { arranged: anchor.arranged } : {})
    },
    state: 'ok'
  })
  // The edge the kernel found the point on, before the one named: two edges may both be within the
  // tolerance (those of a narrow chamfer), and the point is on one of them.
  if (nearest.support === 'edge' && typeof nearest.edgeUnder === 'string' && onFace.state === 'ok') return on(nearest.edgeUnder, nearest.between, nearest.edgeUnderDescriptor)
  // The edge named, when it is under the point: found on it by the kernel is the case above, so by its distance.
  if (named !== undefined && edgeIsUnder(nearest, named, tolerance) && nearest.edgeFound === true) return on(named, nearest.edgeBetween, nearest.edgeDescriptor)
  return named === undefined ? onFace : { anchor, state: 'drifted' }
}

/** The last successful build of an object: its scene, and the revision it is. */
type LastBuild = { revision: number; scene: Scene }

const NOT_SPREAD: Vec3 = [0, 0, 0]

/** How far a part of a layout was spread by the build, or null when the layout has no such part. */
function spreadOf(scene: Scene, layout: string, part: string): Vec3 | null {
  const found = scene.parts.find((p) => p.layout === layout && p.name === part)
  return found ? (found.arranged ?? NOT_SPREAD) : null
}

/** An anchor that says how far its part is spread; null for one that says nothing of it. */
const withSpread = (anchor: Anchor, arranged: Vec3 | null): Anchor => {
  const { arranged: _was, ...rest } = anchor
  return arranged ? { ...rest, arranged: [arranged[0], arranged[1], arranged[2]] } : rest
}

/** A mark, or what a mark is put on again, with `change` made to the anchor that ties it to the geometry: to both ends of a dimension. */
function withAnchor<M extends Mark | NewMark>(mark: M, change: (anchor: Anchor) => Anchor): M {
  if (mark.kind === 'arrow') return { ...mark, from: change(mark.from) }
  if (mark.kind === 'dimension') return { ...mark, a: change(mark.a), ...(mark.b ? { b: change(mark.b) } : {}) }
  if (mark.kind === 'region') return mark
  return mark.anchor ? { ...mark, anchor: change(mark.anchor) } : mark
}

/**
 * A mark as main keeps it when it is placed: its anchor says how far its part
 * is spread on the build it was placed on (zeros for a part that was not
 * moved), when that is the last build, which is the only one main knows.
 * Whatever the placer said of it is not kept. Of a mark placed on another
 * build, or on no part of the layout, nothing is said, and the first check
 * takes the mark to be where it is.
 */
export function asPlaced<M extends Mark | NewMark>(mark: M, last: LastBuild | undefined, sets?: readonly NamedSet[]): M {
  return withAnchor(mark, (anchor) => placedAnchor(anchor, mark.layout, mark.revision, last, sets))
}

/** What a mark is put on again, said the same way (`asPlaced`). */
export function asReplaced(placed: Replacement, layout: string, last: LastBuild | undefined, sets?: readonly NamedSet[]): Replacement {
  const anchor = (placed as Replacement | null)?.anchor
  if (typeof anchor !== 'object' || anchor === null) return placed
  return { ...placed, anchor: placedAnchor(anchor, layout, placed.revision, last, sets) }
}

function placedAnchor(anchor: Anchor, layout: string, revision: number, last: LastBuild | undefined, sets?: readonly NamedSet[]): Anchor {
  const spread = withSpread(anchor, last?.revision === revision && typeof anchor.part === 'string' ? spreadOf(last.scene, layout, anchor.part) : null)
  return withSet(withTag(spread, last?.revision === revision ? last.scene.parts.find((p) => p.layout === layout && p.name === anchor.part) : undefined), layout, sets)
}

/**
 * The anchor with the label of the named set it was placed on (`Anchor.set`), kept only when the set of that name, in the
 * mark's layout, holds the face, edge or part the anchor is on; whatever the placer said of it is otherwise not kept. A check
 * never changes it (`reanchorAll`): a set dismissed or deleted later leaves the label on the mark.
 */
export function withSet(anchor: Anchor, layout: string, sets: readonly NamedSet[] | undefined): Anchor {
  const { set: said, ...rest } = anchor
  const label = setLabelFor(sets, layout, anchor.ref, said)
  return label === undefined ? rest : { ...rest, set: label }
}

/**
 * The anchor with the tag the model gives the face or edge it is on, when it gives one to that one alone: main says
 * it, from the build the ref is of, and whatever the placer said of it is not kept.
 */
export function withTag(anchor: Anchor, part: Parameters<typeof tagOfRef>[0]): Anchor {
  const { tag: _said, ...rest } = anchor
  const tag = anchor.ref === undefined ? undefined : tagOfRef(part, anchor.ref)
  return tag === undefined ? rest : { ...rest, tag }
}

/**
 * How far a mark has to move to stay where it was put on its part, now that
 * the build spreads that part by `now`: the difference to the spread its
 * anchor records. Nothing for an anchor that records none: the mark comes
 * from before spreads were recorded, or was placed on a build main no longer
 * had, and is taken to be where it is.
 */
function shiftOf(primary: Anchor, now: Vec3): Vec3 | null {
  const was = primary.arranged
  if (was === undefined) return null
  const by: Vec3 = [now[0] - was[0], now[1] - was[1], now[2] - was[2]]
  return by.some((c) => c !== 0) ? by : null
}

export interface ReanchorDeps {
  marks: Pick<MarkStore, 'list' | 'reanchor'>
  query: Builds['query']
  /** The last successful build of an object: a new one has another scene. */
  scene(objectId: string): LastBuild | undefined
  /** Told, once per call, what could not be checked. */
  log?(message: string): void
}

/**
 * Check the unresolved marks of an object against its last successful build:
 * one `nearest` query per layout, for every anchor that names a part, and one
 * write of what changed. An anchor that names no part (a point in space) is
 * always ok; a mark is as bad as the worst of its anchors. Every mark that
 * could be judged then says it was checked against that build
 * (`checkedRevision`). Resolves false when some could not be.
 *
 * Before it is judged, a mark on a part that the build spread otherwise than
 * the mark's anchor records (`Anchor.arranged`: a print layout sets its parts
 * side by side, and an earlier part that grows pushes the later ones along)
 * is moved by the difference, with everything it holds, and judged there: it
 * stays where it was put on its part. A mark with no part, or whose part is
 * gone, is not moved.
 *
 * A query that fails, or an anchor the kernel cannot answer for, leaves the
 * marks it was about as they were, not moved either, and is logged, once for
 * the whole call. When a newer build arrives meanwhile (`scene` answers
 * another) everything is dropped: the answers were about geometry that is no
 * longer shown, and that build has its own call. What is written says what
 * each mark was judged from: the store passes over a mark that was put
 * somewhere else meanwhile, and the check that follows that is of where it is.
 *
 * A pick of a whole part keeps the part as its ref. A pick of an edge keeps
 * its edge ref, and is ok only while the build has an edge of that number
 * within the tolerance of the mark's point: the kernel measures that distance.
 * Otherwise it is drifted, whatever the surface did. A pin on an edge:
 * `judgePin`; each end of a dimension is judged as a pin is.
 *
 * A stroke on the surface is anchored by its first point, and is more than
 * that point: a few points along it (`strokeSamples`) are asked about in the
 * same query, and it is drifted when one of them is on no surface any more,
 * though its first point is. Its anchor is still refreshed from the first.
 */
export async function reanchorAll(deps: ReanchorDeps, objectId: string): Promise<Checked> {
  const last = deps.scene(objectId)
  if (!last) return true
  const { scene, revision } = last
  const superseded = (): boolean => deps.scene(objectId)?.scene !== scene
  const listed = (await deps.marks.list(objectId)).filter((mark) => mark.status !== 'resolved')
  if (superseded()) return true

  /**
   * Each mark as listed, how far it is moved first, and as it is judged: moved, its anchor saying the spread of this
   * build. A mark moves with the part of its anchor. A dimension has two, which may be on two parts: each end moves
   * with its own (`shiftB` is the second's), and one that is a bare point, on no part, stays.
   */
  const checked = listed.map((original): { original: Mark; shift: Vec3 | null; shiftB: Vec3 | null; mark: Mark } => {
    const spread = (anchor: Anchor | undefined): Vec3 | null => (anchor?.part === undefined ? null : spreadOf(scene, original.layout, anchor.part))
    const moved = (anchor: Anchor | undefined): Vec3 | null => {
      const now = spread(anchor)
      return anchor && now ? shiftOf(anchor, now) : null
    }
    const [primary, second] = markAnchors(original)
    const shift = moved(primary)
    const shiftB = original.kind === 'dimension' ? moved(second) : null
    if (!primary || (spread(primary) === null && spread(second) === null)) return { original, shift: null, shiftB: null, mark: original }
    const where = shift || shiftB ? translated(original, shift ?? NOT_SPREAD, original.kind === 'dimension' ? (shiftB ?? NOT_SPREAD) : (shift ?? NOT_SPREAD)) : original
    // An end whose part is gone keeps what it says of how that was spread, to move by all that changed when it is back.
    return { original, shift, shiftB, mark: withAnchor(where, (anchor) => (anchor.part !== undefined && spread(anchor) === null ? anchor : withSpread(anchor, spread(anchor)))) }
  })
  const marks = checked.map((one) => one.mark)

  const failures: string[] = []
  /** Whether what could not be asked was only because the worker is still busy with an earlier query. */
  let busy = false
  /** By anchor, as judged: how the build leaves it. Without an entry it could not be asked about. */
  const judged = new Map<Anchor, Judged>()
  const toleranceOf = (layout: string, part: string | undefined): number =>
    tolerance(scene.parts.find((p) => p.layout === layout && p.name === part)?.bbox)

  /** By anchor: what the kernel said of it. */
  const nearest = new Map<Anchor, FoundAnchor | { part: string; found: false }>()
  const byLayout = new Map<string, Array<{ mark: Mark; anchor: Anchor; asked: AskedAnchor; followed?: Followed }>>()
  /** The anchors found again by their tag on this build. */
  const byTag = new Set<Anchor>()
  /** By layout: the points along its strokes, each with the parts it is asked about against, and the stroke it is of. */
  const alongStrokes = new Map<string, Array<{ id: string; asked: AskedAnchor[] }>>()
  for (const mark of marks) {
    for (const anchor of markAnchors(mark)) {
      if (anchor.part === undefined) continue
      const entries = byLayout.get(mark.layout) ?? []
      byLayout.set(mark.layout, entries)
      const followed = followedTag(scene, mark.layout, anchor)
      const edge = followed?.kind === 'E' ? followed.ref : likePin(mark) ? edgeOfPin(anchor) : edgeRef(mark)
      const asked: AskedAnchor = { part: anchor.part, point: anchor.point, ...(edge === undefined ? {} : { edge }), ...(followed?.kind === 'F' ? { face: followed.ref } : {}) }
      entries.push({ mark, anchor, asked, ...(followed ? { followed } : {}) })
      const names = scene.parts.filter((p) => p.layout === mark.layout).map((p) => p.name)
      const parts = names.length <= STROKE_PARTS && names.includes(anchor.part) ? names : [anchor.part]
      // The points of a sketch, which may run over many parts, are asked of those whose box they are within reach of, when the layout has too many to ask them of all.
      const reaching = (point: Vec3): string[] => {
        const near = scene.parts.filter((p) => p.layout === mark.layout && point.every((c, i) => c >= p.bbox.min[i] - tolerance(p.bbox) && c <= p.bbox.max[i] + tolerance(p.bbox))).map((p) => p.name)
        return near.length > 0 ? near : [anchor.part as string]
      }
      const samples = strokeSamples(mark).map((point) => ({ id: mark.id, asked: (mark.kind === 'sketch' && names.length > STROKE_PARTS ? reaching(point) : parts).map((part) => ({ part, point })) }))
      if (samples.length > 0) alongStrokes.set(mark.layout, [...(alongStrokes.get(mark.layout) ?? []), ...samples])
    }
  }
  /** The strokes with a point that is on no surface any more, and those with a point nothing could be said of. */
  const offSurface = new Set<string>()
  const unanswered = new Set<string>()
  for (const [layout, entries] of byLayout) {
    if (!scene.layouts.includes(layout)) {
      // The kernel would refuse the layout; the scene already says none of its parts is there.
      for (const { anchor, asked } of entries) judged.set(anchor, judge(anchor, { part: asked.part, found: false }, 0))
      continue
    }
    let found: NearestAnchor[]
    const samples = alongStrokes.get(layout) ?? []
    try {
      const asked = [...entries.map((entry) => entry.asked), ...samples.flatMap((sample) => sample.asked)]
      found = nearestReply(await deps.query(objectId, 'nearest', { layout, anchors: asked }), asked)
    } catch (e) {
      if (superseded()) return true
      if (isBusy(e)) busy = true
      failures.push(`layout ${layout}: ${messageOf(e)}`)
      continue
    }
    if (superseded()) return true
    entries.forEach(({ mark, anchor, followed }, i) => {
      const said = found[i]
      if (said.found && said.error !== undefined) {
        failures.push(`${mark.id}: ${said.error}`)
        return
      }
      nearest.set(anchor, said)
      // The tag the model gives it, while the build has it, before the nearest-point rule.
      const byName = followed && said.found && said.error === undefined ? followTag(anchor, said, followed, toleranceOf(layout, anchor.part)) : null
      if (byName) {
        byTag.add(anchor)
        judged.set(anchor, byName)
        return
      }
      const judgedByPoint = (likePin(mark) ? judgePin : judge)(anchor, said, toleranceOf(layout, anchor.part))
      // A tag the build has lost stays on the anchor, so that a build that gives it back finds the mark by it.
      judged.set(anchor, anchor.tag === undefined ? judgedByPoint : { ...judgedByPoint, anchor: { ...judgedByPoint.anchor, tag: anchor.tag } })
    })
    let at = entries.length
    for (const sample of samples) {
      const answers = found.slice(at, at + sample.asked.length)
      at += sample.asked.length
      if (answers.some((one) => answered(one) && one.distance <= toleranceOf(layout, one.part))) continue
      // A point the kernel could say nothing of may be on the surface: the stroke is not said to have left it.
      const failed = answers.find((one) => one.found && one.error !== undefined)
      if (failed?.found && failed.error !== undefined) {
        if (!unanswered.has(sample.id)) failures.push(`${sample.id}: ${failed.error}`)
        unanswered.add(sample.id)
      } else offSurface.add(sample.id)
    }
  }

  // `nearest` names faces. What a pick of an edge or of a whole part points at is not a face.
  const picks = marks.filter((mark) => mark.kind === 'pick' && mark.target !== 'face' && nearest.get(mark.anchor)?.found === true && !byTag.has(mark.anchor))
  await Promise.all(
    picks.map(async (mark) => {
      if (mark.kind !== 'pick') return
      const { anchor: old, layout } = mark
      const onFace = judged.get(old)!
      const part = old.part!
      if (mark.target === 'edge') {
        const edge = edgeRef(mark)
        const said = nearest.get(old)
        if (edge === undefined || said?.found !== true) {
          // It never named an edge: all that can be said is what face is there.
          judged.set(old, { anchor: onFace.anchor, state: 'drifted' })
        } else {
          // Only the descriptor is refreshed. An edge has no one normal, so the anchor is given none.
          // The ref is kept even when its number is no longer that of the edge under the point (of no
          // edge now, or of one somewhere else): the mark is then said to have drifted, and a build
          // that puts the edge back under the point finds the mark on it again. The descriptor is
          // then of the face under the point: it never describes an edge the mark is not on.
          const onEdge = said.edgeFound === true && said.edgeDistance <= EDGE_TOLERANCE_MM
          const what = onEdge ? said.edgeDescriptor : onFace.anchor.descriptor
          const { descriptor: _old, ...rest } = old
          judged.set(old, { anchor: { ...rest, ...(typeof what === 'string' ? { descriptor: what } : {}) }, state: onEdge ? onFace.state : 'drifted' })
        }
        return
      }
      let described: Described | null = null
      try {
        described = await deps.query<Described>(objectId, 'describe', { ref: `${layout}:${part}` })
      } catch (e) {
        // `bad_ref` cannot be, of a part `nearest` has just found. Anything else, and it is not known what is there.
        if (!(e instanceof KernelError && e.kind === 'bad_ref')) {
          if (isBusy(e)) busy = true
          judged.delete(old)
          failures.push(`${mark.id}: ${messageOf(e)}`)
          return
        }
      }
      const { descriptor: _ofTheFace, ...rest } = onFace.anchor
      const descriptor = described?.kind === 'part' && typeof described.descriptor === 'string' ? { descriptor: described.descriptor } : {}
      judged.set(old, { anchor: { ...rest, ref: part, ...descriptor }, state: onFace.state })
    })
  )
  if (superseded()) return true

  const changes: Reanchored[] = []
  for (const { original, shift, shiftB, mark } of checked) {
    if (unanswered.has(mark.id)) continue
    const anchors = markAnchors(mark)
    // The label of a named set is the mark's own: a check judges the anchor and leaves it as it was.
    const now = anchors.map((anchor): Judged | undefined => {
      const one = anchor.part === undefined ? { anchor, state: 'ok' as const } : judged.get(anchor)
      return one && anchor.set !== undefined && one.anchor.set === undefined ? { ...one, anchor: { ...one.anchor, set: anchor.set } } : one
    })
    if (!now.every((j) => j !== undefined)) continue
    const ofAnchors = WORST_FIRST.find((state) => now.some((j) => j.state === state)) ?? 'ok'
    // A region is on a scan: no build moves it or loses it, and what its scan made of it stands.
    const anchorState = mark.kind === 'region' ? original.anchorState : ofAnchors === 'ok' && offSurface.has(mark.id) ? 'drifted' : ofAnchors
    const was = markAnchors(original)
    if (anchorState === original.anchorState && original.checkedRevision === revision && shift === null && shiftB === null && now.every((j, i) => isDeepStrictEqual(j.anchor, was[i]))) continue
    changes.push({ id: mark.id, judged: was, anchors: now.map((j) => j.anchor), anchorState, ...(shift ? { shift } : {}), ...(shiftB ? { shiftB } : {}), checkedRevision: revision })
  }
  if (changes.length > 0) await deps.marks.reanchor(objectId, changes)
  if (failures.length > 0) (deps.log ?? console.error)(`cannot check the marks of ${objectId} against its last build: ${failures.join('; ')}`)
  return failures.length === 0 ? true : busy ? 'busy' : false
}

/**
 * What is done with the marks of an object for its last successful build, in
 * one pass: they are checked against it (`reanchorAll`), and then, with their
 * ends as that leaves them, its dimensions are measured on it
 * (`remeasureAll`). Resolves false when some mark could not be checked or
 * some dimension not measured, for the pass to be tried again (`retrying`).
 */
export async function checkMarks(deps: ReanchorDeps & RemeasureDeps, objectId: string): Promise<Checked> {
  const anchored = await reanchorAll(deps, objectId)
  const measured = await remeasureAll(deps, objectId)
  if (anchored === true && measured === true) return true
  return anchored === 'busy' || measured === 'busy' ? 'busy' : false
}

/** Whether a mark's anchors are judged as a pin's is (`judgePin`): a pin, and each end of a dimension, which is on a face or on an edge as a pin is. */
function likePin(mark: Mark): boolean {
  return mark.kind === 'pin' || mark.kind === 'dimension'
}

/** The edge a mark was put on, as its anchor names it: of a pick of an edge whose ref is one of its part's edges. */
function edgeRef(mark: Mark): string | undefined {
  if (mark.kind !== 'pick' || mark.target !== 'edge') return undefined
  const { part, ref } = mark.anchor
  return part !== undefined && ref !== undefined && /^E\d+$/.test(ref.slice(part.length + 1)) && ref.startsWith(`${part}/`) ? ref : undefined
}

/** What a tag of an anchor names in this build: the one face or edge, by its ref. */
type Followed = { kind: 'F' | 'E'; ref: string }

/** The face or edge the anchor's tag names in the scene's part, when it names exactly one. */
function followedTag(scene: Scene, layout: string, anchor: Anchor): Followed | undefined {
  if (anchor.tag === undefined || anchor.part === undefined) return undefined
  const part = scene.parts.find((p) => p.layout === layout && p.name === anchor.part)
  const refs = part && tagRefs(part, anchor.tag)
  if (refs?.length !== 1) return undefined
  return { kind: refs[0].slice(anchor.part.length + 1).startsWith('F') ? 'F' : 'E', ref: refs[0] }
}

/**
 * An anchor as its tag leaves it: on the face or edge the tag names now, which is `ok` however far that has moved,
 * the model having named it. Its point stays where the person put it while that is within reach of the face (the
 * surface's tolerance is not known here: within `EDGE_TOLERANCE_MM` of an edge, `tolerance` of a face), else
 * it is set on the nearest point of what the tag names. Null when the kernel could not say.
 */
function followTag(anchor: Anchor, said: FoundAnchor, followed: Followed, reach: number): Judged | null {
  const { part, arranged, tag } = anchor
  const kept = { ...(arranged ? { arranged } : {}), ...(tag === undefined ? {} : { tag }) }
  if (followed.kind === 'F') {
    if (said.faceFound !== true) return null
    const point = said.faceDistance <= reach || !said.facePoint ? anchor.point : said.facePoint
    return {
      anchor: { point, part, ref: followed.ref, ...(said.faceNormal ? { normal: said.faceNormal } : {}), ...(typeof said.faceDescriptor === 'string' ? { descriptor: said.faceDescriptor } : {}), ...kept },
      state: 'ok'
    }
  }
  if (said.edgeFound !== true) return null
  const point = said.edgeDistance <= EDGE_TOLERANCE_MM || !said.edgePoint ? anchor.point : said.edgePoint
  return {
    anchor: {
      point,
      part,
      ref: followed.ref,
      ...(anchor.edge === undefined ? {} : { edge: followed.ref }),
      ...(said.edgeBetween?.length === 2 ? { between: [said.edgeBetween[0], said.edgeBetween[1]] as [string, string] } : {}),
      ...(typeof said.edgeDescriptor === 'string' ? { descriptor: said.edgeDescriptor } : {}),
      ...kept
    },
    state: 'ok'
  }
}

/**
 * The answers of a `nearest` reply, when there is one for each anchor asked
 * about, in order, and each that named an edge is told of it. Throws otherwise.
 */
export function nearestReply(reply: unknown, asked: AskedAnchor[]): NearestAnchor[] {
  const found = (reply as { anchors?: unknown } | null)?.anchors
  const whole =
    Array.isArray(found) &&
    found.length === asked.length &&
    found.every((one: Record<string, unknown> | null, i) => {
      if (one?.part !== asked[i].part) return false
      if (one.found === false) return true
      // The part is there, and the kernel could say nothing of this point.
      if (one.found === true && typeof one.error === 'string') return true
      if (one.found !== true || typeof one.ref !== 'string' || !isDistance(one.distance)) return false
      if (asked[i].face !== undefined && !(one.faceFound === false || (one.faceFound === true && isDistance(one.faceDistance)))) return false
      if (asked[i].edge === undefined) return true
      return one.edgeFound === false || (one.edgeFound === true && isDistance(one.edgeDistance))
    })
  if (!whole) throw new Error('the kernel did not answer for each anchor')
  return found as NearestAnchor[]
}

function isDistance(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * How a check of the marks went: all of it (true), or some could not be
 * checked or measured (false); `busy` when that was, for some of it, because
 * the kernel's worker was still busy with an earlier query and answered
 * nothing (`isBusy`). That says nothing against asking again.
 */
export type Checked = boolean | 'busy'

/** How long after a check of the marks that failed it is tried again: three times, then left until the next build, unless the kernel was only busy. */
export const RETRY_AFTER_MS = [2000, 10_000, 30_000]
/** How long after a check that found the kernel busy it is tried again, once the three times are up. */
export const RETRY_BUSY_MS = 30_000

/**
 * `check`, one at a time per object (`coalesced`), and again after a while
 * when it could not check everything (it resolves false, or rejects): after
 * each of `RETRY_AFTER_MS`, then no more; but for a check that says the
 * kernel was only `busy`, which is tried again every `RETRY_BUSY_MS` for as
 * long as it says so: a worker busy for minutes would otherwise leave every
 * dimension unmeasured until the next build. Asking anew, as for a newer
 * build or a mark just added, drops what was waiting and starts the count again.
 *
 * `check` is told whether it may have the object built again to be answered
 * (`Builds.query`): only in the run that was asked for with `restore`, as by
 * an act of the person. No run started here, on a timer, ever may: a kernel
 * that lost the build would be made to build it again for ever.
 *
 * `cancel` ends it, as when the workspace it checks for is closed: what was
 * waiting is dropped, and nothing is checked from then on, asked or not.
 */
export function retrying(check: (objectId: string, restore: boolean) => Promise<Checked>, log: (message: string) => void = console.error, what = RE_ANCHOR): Retrying {
  /** By object: how many times it has been tried again, and the wait for the next. */
  const waiting = new Map<string, { tried: number; timer?: NodeJS.Timeout }>()
  /** The objects whose next run was asked for by someone who may have the object built again. */
  const restoring = new Set<string>()
  let cancelled = false
  const run = coalesced(async (objectId) => {
    if (cancelled) return
    let went: Checked = false
    try {
      went = await check(objectId, restoring.delete(objectId))
    } finally {
      const state = waiting.get(objectId) ?? { tried: 0 }
      clearTimeout(state.timer)
      state.timer = undefined
      const after = state.tried < RETRY_AFTER_MS.length ? RETRY_AFTER_MS[state.tried] : went === 'busy' ? RETRY_BUSY_MS : undefined
      if (went === true || cancelled || after === undefined) waiting.delete(objectId)
      else {
        waiting.set(objectId, state)
        state.timer = setTimeout(() => {
          state.timer = undefined
          state.tried += 1
          run(objectId)
        }, after)
      }
    }
  }, log, what)
  const ask = (objectId: string, restore = false): void => {
    if (cancelled) return
    if (restore) restoring.add(objectId)
    clearTimeout(waiting.get(objectId)?.timer)
    waiting.delete(objectId)
    run(objectId)
  }
  const cancel = (): void => {
    cancelled = true
    for (const state of waiting.values()) clearTimeout(state.timer)
    waiting.clear()
    restoring.clear()
  }
  return Object.assign(ask, { cancel })
}

/** Asks for the marks of an object to be checked (`retrying`); `cancel` ends that for good. */
export type Retrying = ((objectId: string, restore?: boolean) => void) & { cancel(): void }

/** What a run that rejects is said to have failed at, unless whoever asks says otherwise. */
const RE_ANCHOR = 're-anchor the marks of'

/**
 * `run`, one at a time per object: asked for an object while it runs for that
 * one, it runs once more afterwards, however often it was asked. A run that
 * rejects is logged and nothing more.
 */
export function coalesced(run: (objectId: string) => Promise<void>, log: (message: string) => void = console.error, what = RE_ANCHOR): (objectId: string) => void {
  /** The objects it is running for, and whether it was asked again for them meanwhile. */
  const running = new Map<string, { again: boolean }>()
  return (objectId) => {
    const current = running.get(objectId)
    if (current) {
      current.again = true
      return
    }
    const mine = { again: false }
    running.set(objectId, mine)
    void (async () => {
      do {
        mine.again = false
        try {
          await run(objectId)
        } catch (e) {
          log(`cannot ${what} ${objectId}: ${messageOf(e)}`)
        }
      } while (mine.again)
      running.delete(objectId)
    })()
  }
}


/**
 * Have the marks of an object checked (`reanchor`) whenever the store says
 * some have not been against the build there is: a mark just added, which
 * carries the refs of whatever build its maker saw, and one reopened, which
 * no build since it was resolved has been asked about. What the check itself
 * writes is neither, so it does not call for another.
 */
export function followMarks(store: Pick<MarkStore, 'on'>, reanchor: (objectId: string, restore?: boolean) => void): void {
  // Someone placed or reopened a mark: the object may be built again to say what it is on.
  store.on('unchecked', ({ objectId }) => reanchor(objectId, true))
}
