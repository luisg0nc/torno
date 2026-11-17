import { count as counted, number, numberWithin, scanNumber } from '../../shared/format'
import { expectedText, lastValue, measuredValue, notMeasuredText, offBy, onBuild, standingOf, valueText } from '../../shared/dimension'
import { type Anchor, type DimensionMark, type Mark, type NoteMark, type RegionMark, type ShapeMark, type SketchMark, type StrokeMark, isUnchecked, markAnchors, markIntent } from '../../shared/marks'
import type { Scene } from '../../shared/scene'
import { isFlat, regionInLayout } from '../../shared/regions'
import { type ScanInfo, alignmentOf } from '../../shared/scans'
import { alignmentSaid } from '../scans/said'

/** Marks the note of a mark the last build moved off its surface, or left without its part. */
const ANCHOR_SUFFIX = { ok: '', drifted: ' [moved since it was placed: check it]', orphaned: ' [its part is gone]' } as const

export { number }

/** What the intent of a mark is called to the agent. */
const INTENT_SAID = { want: 'want', dont: "don't want" } as const

/**
 * How far across the thing is whose coordinates and sizes are being told, in millimetres: set while one mark is
 * described (`describeMark`, which is given the scene), 0 otherwise. What is under a millionth of it is told as
 * 0 (`numberWithin`). Describing is one synchronous run, so the one variable serves.
 */
let across = 0
const told = (value: number): string => numberWithin(value, across)

/** The diagonal of the box of the part a mark is on in its layout; of the whole layout for a mark on no part; 0 when nothing is known. */
function extentOf(mark: Mark, scene: Scene | undefined): number {
  if (!scene) return 0
  const of = markAnchors(mark)[0]?.part
  const parts = scene.parts.filter((part) => part.layout === mark.layout && (of === undefined || part.name === of))
  let span = 0
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const { bbox } of parts) for (let i = 0; bbox && i < 3; i++) {
    min[i] = Math.min(min[i], bbox.min[i])
    max[i] = Math.max(max[i], bbox.max[i])
  }
  if (parts.length > 0) span = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2])
  return Number.isFinite(span) ? span : 0
}

/** `(12, 40.5, 20)` */
export function vector(v: readonly number[]): string {
  return `(${v.map(told).join(', ')})`
}

/** A point or a size taken from a scan, to the tenth of a millimetre (`scanNumber`): `(12, 40.5, 20)`, `40 × 30.1 × 5`. */
export const scanVector = (v: readonly number[]): string => `(${v.map(scanNumber).join(', ')})`
const scanSizes = (v: readonly number[]): string => v.map(scanNumber).join(' × ')

/** `40 × 30 × 5` */
export function sizes(v: readonly number[]): string {
  return v.map(told).join(' × ')
}

/**
 * A mark in one line, for the agent: its number, what kind it is, what it is
 * on and where, in millimetres in the object frame of its layout, and the
 * note. It says so when the mark is the agent's own, and when the last build
 * moved the surface it was on or dropped its part. `tag` is said before it,
 * in brackets: what the line is news of (`changed`). Given the `revision` of
 * the last build that worked, it says so when nothing has checked the mark
 * against that build: what it says of the ref is then of an older one. A
 * dimension gives its value only as that of the build of `revision`
 * (`dimension`): without one it is told as not measured. A region of a scan
 * is told where the scan's alignment in the layout asked (`layout`: the one
 * on show, or the one a tool was asked in) puts it (`region`): that takes the
 * `scans` of the object, and without them it has no place.
 */
export function describeMark(mark: Mark, opts: { tag?: string; revision?: number; layout?: string; scans?: readonly ScanInfo[]; /** The last build's scene: with it, what is nothing within the part the mark is on is told as 0. */ scene?: Scene; /** The slugs of the project's named sets: with them, a label of a set that is gone says so. */ sets?: readonly string[] } = {}): string {
  const tags = [mark.author === 'agent' ? 'yours' : '', opts.tag ?? ''].filter(Boolean).join(', ')
  const note = mark.note.replace(/\s+/g, ' ').trim()
  const unchecked = isUnchecked(mark, opts.revision) ? ` [not checked against r${opts.revision}]` : ''
  // A dimension that lost its part says so in place of its value, not after its note.
  // So does a region that lost its scan: it is on no part.
  const suffix = mark.kind === 'region' ? regionDoubt(mark, opts) : mark.kind === 'dimension' && mark.anchorState === 'orphaned' ? '' : ANCHOR_SUFFIX[mark.anchorState]
  across = extentOf(mark, opts.scene)
  try {
    // A note is said as the person made it: what it holds, then the build it was drawn on.
    // A shape says its intent in its own line (`intent add`): it is not said twice.
    const intent = mark.kind === 'shape' ? null : markIntent(mark)
    const round = mark.round === undefined ? '' : ` [in ${mark.round}]`
    if (mark.kind === 'note') return `${tags ? `(${tags}) ` : ''}${mark.id}${intent === null ? '' : ` · ${INTENT_SAID[intent]}`} · view note · ${mark.status}${note ? `: "${note}"` : ''} ${noteHolds(mark)}${suffix}${unchecked}${round}`
    const said = what(mark, opts)
    // What a sketch says begins with its own dot: the intent is put before it, and the others get one.
    const head = intent === null ? `${mark.id} ` : `${mark.id} · ${INTENT_SAID[intent]} ${said.startsWith('· ') ? '' : '· '}`
    return `${tags ? `(${tags}) ` : ''}${head}${said}${note ? `: "${note}"` : ''}${suffix}${unchecked}${asMeasured(mark, opts.revision)}${round}`
  } finally {
    across = 0
  }
}

/** `(3 labels, 2 references, drawn on build 12)`: what a note holds besides its comment, and the build its picture is of. */
function noteHolds(mark: NoteMark): string {
  const of = (n: number, what: string): string[] => (n === 0 ? [] : [`${n} ${what}${n === 1 ? '' : 's'}`])
  return `(${[...of(mark.labels.length, 'label'), ...of(mark.references.length, 'reference'), `drawn on build ${mark.revision}`].join(', ')})`
}

/**
 * Said after a resolved dimension whose value is not of the build of `revision`: it is no longer measured, and what
 * it holds is of the build it was last measured on.
 */
function asMeasured(mark: Mark, revision: number | undefined): string {
  if (mark.kind !== 'dimension' || mark.status !== 'resolved' || lastValue(mark) === undefined) return ''
  if (revision !== undefined && mark.measuredRevision === revision) return ''
  return ` [as measured on ${onBuild(mark.measuredRevision)}]`
}

/**
 * A mark as data for the agent, beside its line. A dimension holds `value`,
 * `how`, `points` and `verdict` only when they are of the build of `revision`
 * (`measuredValue`): data is read before prose, and a value there would be
 * taken for the part's.
 *
 * - What it held on another build of this run is `wasValue`, of
 *   `wasRevision`, as its line says. What its file holds from a run before
 *   is of no build that can be named, and is not given.
 * - A resolved one is no longer measured: what it held when it was last
 *   measured is `resolvedValue` and `resolvedVerdict`, of `resolvedOnRevision`
 *   when that is known, whichever build is the last. Never `value`.
 *
 * A region holds `scan`, `triangles`, `area`, its `size` along its own axes
 * and whether it is `flat`, and, where its scan is aligned in the layout
 * asked (`toldIn`), `centroid`, `axes`, `bbox` and `plane` in the object
 * frame of that layout, with how that alignment stands in a word
 * (`alignment`: aligned, rough, in doubt, not checked). Never `local`: that is in the scan's own frame,
 * which is main's and the window's. One that is orphaned holds none of it.
 */
export function markData(mark: Mark, revision: number | undefined, scans?: readonly ScanInfo[], layout?: string): object {
  if (mark.kind === 'region') return regionData(mark, layout, scans, revision)
  if (mark.kind !== 'dimension') return mark
  if (mark.status !== 'resolved' && measuredValue(mark, revision) !== undefined) return mark
  const { value: _value, how: _how, points: _points, verdict: _verdict, ...rest } = mark
  const last = lastValue(mark)
  const on = (key: string): object => (mark.measuredRevision === undefined ? {} : { [key]: mark.measuredRevision })
  if (mark.status === 'resolved') {
    // Which build it was measured on is said once, as the build its resolved value is of.
    const { measuredRevision: _on, ...settled } = rest
    return last === undefined ? settled : { ...settled, resolvedValue: last, ...(mark.verdict ? { resolvedVerdict: mark.verdict } : {}), ...on('resolvedOnRevision') }
  }
  if (standingOf(mark, revision) !== 'unmeasured' || last === undefined || mark.measuredRevision === undefined) return rest
  return { ...rest, wasValue: last, ...on('wasRevision') }
}

/**
 * `distance 6 mm between planes, base/F5 to base/F0`: the kind of measurement,
 * the value with how it was taken, and its ends; then what was expected and
 * the verdict, with how far off and which way when it fails. The value is
 * that of the build of `revision`, and is given as nothing else:
 *
 * - measured on another build, it says `not measured on r12 (was 6 mm on
 *   r11)`, and no verdict; on none this run, `not measured yet`;
 * - one the kernel could not measure on that build says `not measurable`,
 *   with the kernel's reason;
 * - one that lost the part of an end says only that.
 *
 * One whose end the build moved is measured between what its ends name now:
 * its line is as any other's, and the mark says after it that it moved.
 */
function dimension(mark: DimensionMark, revision: number | undefined): string {
  if (mark.anchorState === 'orphaned') return `${mark.measure}: not measurable, ${ANCHOR_SUFFIX.orphaned.trim()}`
  const standing = standingOf(mark, revision)
  const end = (anchor: Anchor): string => anchor.ref ?? vector(anchor.point)
  const ends = mark.measure === 'thickness' ? `${end(mark.a)}${mark.a.ref ? ` at ${vector(mark.a.point)}` : ''}` : mark.b ? `${end(mark.a)} to ${end(mark.b)}` : end(mark.a)
  const expected = mark.expected === undefined ? '' : ` (expected ${expectedText(mark)}`
  const shown = (value: number): string => valueText(mark.measure, value).replace(/^(⌀|R) /, '')
  if (standing === 'unmeasured') {
    const last = lastValue(mark)
    // What it held on a build that can be named. What its file holds from another run is of none: it is not measured yet.
    const was = last === undefined || mark.measuredRevision === undefined ? '' : ` (was ${shown(last)} on ${onBuild(mark.measuredRevision)})`
    return `${mark.measure}: ${notMeasuredText(mark, revision)}${was}, ${ends}${expected && `${expected})`}`
  }
  if (mark.value === undefined) return `${mark.measure}: not measurable${mark.refused ? ` (${mark.refused})` : ''}, ${ends}${expected && `${expected})`}`
  // Of a radius or a diameter the way is what the thing is, which its ref says already: said only when it says which radius.
  const round = mark.measure === 'radius' || mark.measure === 'diameter'
  const how = !mark.how ? '' : round ? (/^(cylinder|circle|sphere)$/.test(mark.how) ? '' : ` (${mark.how})`) : ` ${mark.how}`
  const verdict = mark.expected === undefined ? '' : `${expected}: ${mark.verdict === 'pass' ? 'pass' : `FAIL, ${offBy(mark.value, mark.expected)}`})`
  return `${mark.measure} ${shown(mark.value)}${how}, ${ends}${verdict}`
}

/** Said of everything a region is told with: it is of a scan. */
export const REGION_APPROXIMATE = 'a region is part of a scan, a mesh measured by a phone or a scanner: nothing of it is exact'

/** The layout a region is told in: the one asked, or, when none is, the one it was painted in. It is of its scan in every layout. */
const toldIn = (mark: RegionMark, opts: { layout?: string }): string => opts.layout ?? mark.layout

/** The scan a region is on, where it is aligned in a layout; null when it is not, or the scans are not known. */
function placeOf(mark: RegionMark, layout: string, scans: readonly ScanInfo[] | undefined): { scan: ScanInfo; there: ReturnType<typeof regionInLayout> } | null {
  const scan = scans?.find((one) => one.id === mark.scan)
  const alignment = scan ? alignmentOf(scan, layout) : null
  return scan && alignment ? { scan, there: regionInLayout(mark, alignment.transform) } : null
}

/** A direction as it is told: the way round that has its largest share positive, since a side runs both ways. */
function direction(axis: readonly number[]): string {
  return directionText(axis)
}

/**
 * A direction in words, to two decimals, which is all a side of something painted on a scan is known to: a
 * component that would be written 0.00 is what is left of nothing and is 0, the rest made a direction again
 * (`(-0.003691, 0, 1)` is `(0, 0, 1)`); the way round that has its largest share positive. The data keeps it in full.
 */
export function directionText(axis: readonly number[]): string {
  const kept = axis.map((c) => (Math.abs(c) < 0.005 ? 0 : c))
  const length = Math.hypot(...kept)
  const unit = length > 0 ? kept.map((c) => c / length) : [...axis]
  const most = unit.reduce((at, c, i) => (Math.abs(c) > Math.abs(unit[at]) ? i : at), 0)
  return `(${unit.map((c) => number(Math.round((unit[most] < 0 ? -c : c) * 100) / 100 + 0)).join(', ')})`
}

/** `≈ 200 × 10 × 2 mm, its long side along (0.71, 0.71, 0)`: the size a region has along its own axes, and which way its longest runs when one is. */
function ownSize(box: RegionMark['local']['box'], directed: boolean): string {
  const [long, middle] = box.half
  return `≈ ${scanSizes(box.half.map((half) => 2 * half))} mm${directed && long > 1.2 * middle ? `, its long side along ${direction(box.axes[0])}` : ''}`
}

/** Why an orphaned region is one: its scan is gone, or is another mesh; which of the two only when the scans are known. */
function lost(mark: RegionMark, scans: readonly ScanInfo[] | undefined): string {
  if (scans === undefined) return '[its scan is gone, or is no longer the mesh it was painted on]'
  return scans.some((one) => one.id === mark.scan) ? '[the mesh of its scan is no longer the one it was painted on: the user paints it again]' : '[its scan is gone]'
}

/**
 * `region on scan S1: 4,812 triangles, ≈ 31000 mm², centre ≈ (-120, 85, 40), ≈ 200 × 10 × 2 mm, its long side
 * along (0.71, 0.71, 0), within a box of ≈ 150 × 150 × 2 mm, flat about a plane with normal ≈ (0, 0, 1)`: what the
 * person painted, in the object frame of the layout asked, where the scan's alignment there puts it. Its size is
 * that of its own box, along its own axes; the box along the layout's axes is told as what it lies within. Flat
 * is said of a region that is thin against its lesser side (`isFlat`). Where the scan is not aligned in that
 * layout it has no place, and only its size is told; one whose scan is gone, or is no longer the mesh it was
 * painted on, says that and nothing of what it was.
 */
function region(mark: RegionMark, opts: { layout?: string; scans?: readonly ScanInfo[] }): string {
  const head = `region on scan ${mark.scan}`
  if (mark.anchorState === 'orphaned') return `${head} ${lost(mark, opts.scans)}`
  const layout = toldIn(mark, opts)
  const size = (area: number): string => `${counted(mark.triangles)} triangle${mark.triangles === 1 ? '' : 's'}, ≈ ${number(area)} mm²`
  const placed = placeOf(mark, layout, opts.scans)
  // The scans could not be read: that is not "not aligned".
  if (!placed && opts.scans === undefined) return `${head} (its scan could not be read just now, so where it stands is not told): ${size(mark.area)}, ${ownSize(mark.local.box, false)}, ${isFlat(mark.local.box) ? 'flat' : 'not flat'}`
  if (!placed) return `${head} (not aligned in ${layout}, so it has no place in the model’s frame): ${size(mark.area)}, ${ownSize(mark.local.box, false)}, ${isFlat(mark.local.box) ? 'flat' : 'not flat'}`
  const { there } = placed
  const within = scanSizes(there.bbox.max.map((c, axis) => c - there.bbox.min[axis]))
  const plane = there.flat ? `flat about a plane with normal ≈ ${direction(there.box.axes[2])}` : 'not flat'
  return `${head}: ${size(there.area)}, centre ≈ ${scanVector(there.centroid)}, ${ownSize(there.box, true)}, within a box of ≈ ${within} mm, ${plane}`
}

/** Said after a region whose place rests on an alignment that is rough, in doubt or not checked against the build: where it is told is only as good as that. */
function regionDoubt(mark: RegionMark, opts: { revision?: number; layout?: string; scans?: readonly ScanInfo[] }): string {
  const layout = toldIn(mark, opts)
  const placed = mark.anchorState === 'orphaned' ? null : placeOf(mark, layout, opts.scans)
  if (!placed) return ''
  const said = alignmentSaid(placed.scan, layout, opts.revision)
  const doubts = [...(said.note ? [said.note] : []), ...(said.data.rough ? [`${mark.scan} is only roughly aligned: ${said.data.rough}`] : [])]
  return doubts.length > 0 ? ` [${doubts.join('; ')}]` : ''
}

function regionData(mark: RegionMark, layout: string | undefined, scans: readonly ScanInfo[] | undefined, revision: number | undefined): object {
  // What only main reads: where it is in its scan's own frame, which mesh it is of, which file holds it.
  const { local, mesh: _mesh, mask: _mask, ...rest } = mark
  if (mark.anchorState === 'orphaned') {
    // Of a mesh that is gone: how many triangles it had, and their area, are of nothing that can be asked about.
    const { triangles: _triangles, area: _area, ...gone } = rest
    return { ...gone, lost: lost(mark, scans).slice(1, -1) }
  }
  const told = layout ?? mark.layout
  const placed = placeOf(mark, told, scans)
  const size = local.box.half.map((half) => 2 * half)
  if (!placed) return { ...rest, toldIn: told, aligned: false, size, flat: isFlat(local.box), approximate: REGION_APPROXIMATE }
  const { there } = placed
  // How far its place is to be relied on, in a word, as every tool says it of that alignment: its line says why.
  return { ...rest, toldIn: told, aligned: true, alignment: alignmentSaid(placed.scan, told, revision).state, area: there.area, centroid: there.centroid, size: there.box.half.map((half) => 2 * half), axes: there.box.axes, bbox: there.bbox, bboxOf: 'a box along the axes of the layout that the region lies within: not its size', plane: there.plane, flat: there.flat, approximate: REGION_APPROXIMATE }
}

function what(mark: Mark, opts: { revision?: number; layout?: string; scans?: readonly ScanInfo[]; sets?: readonly string[] }): string {
  const { revision } = opts
  const settled = mark.anchorState === 'ok'
  switch (mark.kind) {
    case 'pin':
      return `pin ${on(mark.anchor, settled, opts.sets)}at ${vector(mark.anchor.point)}`
    case 'pick':
      // A pick is of the thing itself; where it was clicked says nothing more, unless nothing names the thing.
      if (!mark.anchor.ref) return `pick at ${vector(mark.anchor.point)}`
      return settled ? `pick of ${named(mark.anchor)}${onSet(mark.anchor, opts.sets)}` : `pick placed on ${mark.anchor.ref}${onSet(mark.anchor, opts.sets)}`
    case 'arrow': {
      const by = mark.to.map((c, i) => c - mark.from.point[i])
      const from = !mark.from.ref ? 'from ' : settled ? `from ${named(mark.from)}${onSet(mark.from, opts.sets)} at ` : `placed on ${mark.from.ref}${onSet(mark.from, opts.sets)}, from `
      return `arrow ${from}${vector(mark.from.point)} by ${vector(by)}, ${number(Math.hypot(...by))} mm`
    }
    case 'stroke':
      return stroke(mark)
    case 'shape':
      return shape(mark)
    case 'dimension':
      return dimension(mark, revision)
    case 'region':
      return region(mark, opts)
    case 'note':
      return 'view note'
    case 'sketch':
      return sketch(mark)
  }
}

/**
 * `· sketch "Breather hose route" · flow ⌀19 mm · 3 strokes on 2 planes and the surface · draft, drawn on build 41`: what
 * a sketch is and holds in one line, after its number; its strokes, planes and points are `sketchText`'s.
 */
function sketch(mark: SketchMark): string {
  const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`
  const on = [...(mark.planes.length > 0 ? [plural(mark.planes.length, 'plane')] : []), ...(mark.strokes.some((s) => s.plane === undefined) ? ['the surface'] : [])]
  const take = `${mark.take}${mark.diameter === undefined ? '' : ` ⌀${number(mark.diameter)} mm`}`
  const name = mark.name === '' ? `Sketch ${mark.id}` : `sketch "${mark.name}"`
  return `· ${name} · ${take} · ${plural(mark.strokes.length, 'stroke')}${on.length > 0 ? ` on ${on.join(' and ')}` : ''} · ${mark.status}, drawn on build ${mark.revision}`
}

/** `lid/F12 (plane, normal +Z, z = 20, 1180 mm²)`, or the ref alone when the kernel has said nothing of it. */
function named(anchor: Anchor): string {
  return anchor.descriptor ? `${anchor.ref} (${anchor.descriptor})` : `${anchor.ref}`
}

/**
 * What a mark is on, before where it is. Of a mark the last build moved off
 * its surface or left without its part, only what it was placed on: that ref
 * may name other geometry now, and what the kernel says of it is not said.
 */
function on(anchor: Anchor, settled: boolean, sets?: readonly string[]): string {
  if (!anchor.ref) return ''
  if (!settled) return `placed on ${anchor.ref}${onSet(anchor, sets)} `
  if (anchor.edge === undefined) return `on ${named(anchor)}${onSet(anchor, sets)} `
  // On an edge: which, the two faces that meet there, and what the edge is.
  const between = anchor.between ? ` between ${anchor.between[0]} and ${anchor.between[1]}` : ''
  return `on the edge ${anchor.edge}${between}${anchor.descriptor ? ` (${anchor.descriptor})` : ''}${onSet(anchor, sets)} `
}

/**
 * ` (on #deck)`: the named set the mark was placed on, said after what it is on. A label does not follow the set: given the
 * `sets` of the project (their slugs), one that names none says ` (on #deck, no longer a named set)`.
 */
function onSet(anchor: Anchor, sets?: readonly string[]): string {
  if (anchor.set === undefined) return ''
  const gone = sets !== undefined && !sets.includes(anchor.set.slice(1).toLowerCase())
  return ` (on ${anchor.set}${gone ? ', no longer a named set' : ''})`
}

function stroke(mark: StrokeMark): string {
  if (mark.space === 'plane' && mark.plane) {
    const points = mark.points2d ?? []
    return `stroke on plane ${mark.plane.label}, ${count(points.length)}, ${sizes(extent(points, 2))} mm`
  }
  const points = mark.points ?? []
  return `stroke ${on(mark.anchor, mark.anchorState === 'ok')}from ${vector(mark.anchor.point)}, ${count(points.length)}, ${sizes(extent(points, 3))} mm`
}

function shape(mark: ShapeMark): string {
  const [x, y, z] = mark.size
  const size =
    mark.shape === 'box'
      ? `box ${sizes([x, y, z])} mm`
      : mark.shape === 'cylinder'
        ? `cylinder diameter ${number(x)}, height ${number(z)} mm`
        : mark.shape === 'sphere'
          ? `sphere diameter ${number(x)} mm`
          : `plane ${sizes([x, y])} mm`
  const angles = eulerDegrees(mark.rotation)
  const turned = angles.every((a) => Math.abs(a) < 1e-4) ? '' : `, rotated ${vector(angles)}°`
  // Its position is where its middle is, not a corner or its base.
  return `${size} centred at ${vector(mark.position)}${turned}, intent ${mark.intent}`
}

/**
 * A rotation as the angles the window shows for it: degrees about the shape's
 * own X, then Y, then Z (three.js's Euler order 'XYZ', as `eulerOf` in
 * src/renderer/tools/shapeTool.ts).
 */
export function eulerDegrees([qx, qy, qz, qw]: readonly number[]): [number, number, number] {
  const length = Math.hypot(qx, qy, qz, qw) || 1
  const [x, y, z, w] = [qx / length, qy / length, qz / length, qw / length]
  // The entries of the rotation's matrix that the angles are read from.
  const m11 = 1 - 2 * (y * y + z * z)
  const m12 = 2 * (x * y - z * w)
  const m13 = 2 * (x * z + y * w)
  const m22 = 1 - 2 * (x * x + z * z)
  const m23 = 2 * (y * z - x * w)
  const m32 = 2 * (y * z + x * w)
  const m33 = 1 - 2 * (x * x + y * y)
  const about = Math.asin(Math.min(Math.max(m13, -1), 1))
  // Turned a quarter about Y, turning about X and about Z are one: all of it is said of X.
  const [first, last] = Math.abs(m13) < 0.9999999 ? [Math.atan2(-m23, m33), Math.atan2(-m12, m11)] : [Math.atan2(m32, m22), 0]
  const degrees = (radians: number): number => (radians * 180) / Math.PI + 0
  return [degrees(first), degrees(about), degrees(last)]
}

function count(points: number): string {
  return `${points} point${points === 1 ? '' : 's'}`
}

/** How far the points reach along each of their axes. */
function extent(points: ReadonlyArray<readonly number[]>, axes: number): number[] {
  return Array.from({ length: axes }, (_, axis) => {
    if (points.length === 0) return 0
    const along = points.map((p) => p[axis])
    return Math.max(...along) - Math.min(...along)
  })
}

