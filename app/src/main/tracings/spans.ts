import { number } from '../../shared/format'
import type { SpanMark } from '../../shared/marks'
import type { PlaneSnap, TracingPhoto } from '../../shared/tracings'
import { Refusal } from '../refusal'

// What main says of a measure on a tracing (`span`): its value from the kernel's own points when both ends are snapped to them, and
// how it was found when they are not. A span is worked out once, when it is made, and never measured again.

/** How far a snapped end may be from the kernel's point it says it snapped to, mm: as a line-up's points are held to. */
export const SPAN_SNAP_WITHIN = 0.01

/** An end as the window gives it: where it is in the tracing's `[u, v]`, where it was put, and the point of the outline it says it snapped to. */
export interface GivenEnd {
  uv: [number, number]
  on: 'tracing' | 'photo'
  snap?: PlaneSnap
}

const finitePair = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && v.every((c) => typeof c === 'number' && Number.isFinite(c))

/** What the end says it snapped to, in words, and how the kernel's own points of that sort are told apart. */
function same(snap: PlaneSnap, given: PlaneSnap): boolean {
  if (snap.kind !== given.kind || snap.part !== given.part) return false
  if (snap.kind === 'vertex' && given.kind === 'vertex') return snap.ref === given.ref
  if (snap.kind === 'centre' && given.kind === 'centre') return snap.edge === given.edge
  return true
}

const sort = (snap: PlaneSnap): string => (snap.kind === 'corner' ? 'a corner of the cut' : snap.kind === 'centre' ? 'a hole centre' : `the vertex ${snap.ref}`)

/** One end, checked: a snapped one is the kernel's point of the last build (within 0.01 mm of the window's), replaced by it. */
function checked(name: 'A' | 'B', end: GivenEnd, snaps: readonly PlaneSnap[] | undefined, photoShown: boolean): GivenEnd {
  if (!end || !finitePair(end.uv)) throw new Refusal(`End ${name} of the measure is not a point of the tracing: two finite numbers in millimetres.`)
  const on = end.on === 'photo' && end.snap === undefined && photoShown ? 'photo' : 'tracing'
  if (end.snap === undefined) return { uv: [end.uv[0], end.uv[1]], on }
  const given = end.snap
  if (snaps === undefined) throw new Refusal(`End ${name} says what it was snapped to, and there is no outline of this tracing on a build to check that against: build the model first.`)
  const candidates = snaps.filter((s) => same(s, given))
  const found = candidates.reduce<PlaneSnap | undefined>((best, s) => (best === undefined || Math.hypot(s.uv[0] - end.uv[0], s.uv[1] - end.uv[1]) < Math.hypot(best.uv[0] - end.uv[0], best.uv[1] - end.uv[1]) ? s : best), undefined)
  if (found === undefined) throw new Refusal(`End ${name} says it was snapped to ${sort(given)}, and the outline of this tracing on the last build has no ${sort(given).replace(/^(?:a|the) /, '')}.`)
  if (found.kind === 'vertex' && found.projected) throw new Refusal(`End ${name}: ${found.ref} is not in the tracing's plane, so a measure cannot end on it.`)
  const off = Math.hypot(found.uv[0] - end.uv[0], found.uv[1] - end.uv[1])
  if (off > SPAN_SNAP_WITHIN) throw new Refusal(`End ${name} says it was snapped to ${sort(given)}, and it is ${number(off)} mm from it: the kernel's point is at ${number(found.uv[0])}, ${number(found.uv[1])}.`)
  return { uv: [found.uv[0], found.uv[1]], on: 'tracing', snap: found }
}

/**
 * The value of a measure between two ends in the tracing's plane, and how it was found. Each snapped end is checked against the last
 * build's points (`snaps`, within 0.01 mm) and replaced by the kernel's point; it is exact only when both are snapped and both on the
 * outline, and says `exact on build h41` (`build`, the build's history id, which is the same in every run; none when the history did not keep it). Any other is `≈`: `on the photo, lined up with fit 0.4 mm` when an end is on the
 * photo, `freehand` when not. The value is in full, and is never taken again.
 */
export function spanValue(a: GivenEnd, b: GivenEnd, snaps: readonly PlaneSnap[] | undefined, photo: TracingPhoto | undefined, build: string | undefined): Pick<SpanMark, 'value' | 'exact' | 'how'> & { a: GivenEnd; b: GivenEnd } {
  const shown = photo !== undefined && photo.hidden !== true
  const ends = [checked('A', a, snaps, shown), checked('B', b, snaps, shown)] as const
  const value = Math.hypot(ends[1].uv[0] - ends[0].uv[0], ends[1].uv[1] - ends[0].uv[1])
  const exact = ends.every((e) => e.snap !== undefined && e.on === 'tracing')
  if (exact) return { a: ends[0], b: ends[1], value, exact, how: build === undefined ? 'exact on a build the history does not keep' : `exact on build ${build}` }
  if (shown && ends.some((e) => e.on === 'photo')) {
    const lined = photo.fit !== undefined ? `fit ${number(photo.fit)} mm` : `${photo.pairs.length} point${photo.pairs.length === 1 ? '' : 's'}`
    return { a: ends[0], b: ends[1], value, exact, how: `on the photo, lined up ${photo.fit !== undefined ? 'with' : 'by'} ${lined}` }
  }
  return { a: ends[0], b: ends[1], value, exact, how: 'freehand' }
}
