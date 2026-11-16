import { copyFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { verdictOf } from '../../shared/dimension'
import { MOST_CUTS_TOLD, MOST_REFS_TOLD, MOST_SCANS_TOLD, type StrokeUnder } from '../../shared/drawing'
import type { Anchor, DimensionMark, Mark, MarksFile, NoteLabel, NoteMark, NoteReference, Quat, RegionMark, ShapeKind, StrokeMark, Vec3 } from '../../shared/marks'
import type { Camera } from '../../shared/view'
import { MAX_LABEL, MAX_REFERENCE_COMMENT, MAX_STROKE_POINTS, MIN_SHAPE_SIZE, MOST_LABELS, MOST_NOTE_ERASES, MOST_NOTE_REFERENCES, MOST_NOTE_STROKES, NOTE_INK, NOTE_PICTURE, NOTE_REFERENCE } from '../../shared/marks'
import { TAG_NAME } from '../../shared/tags'
import { FOLDER, ownTorno, writeOwn } from '../own'

const NAME = 'marks.json'

/** The longest note a mark keeps, in characters. */
export const MAX_NOTE = 2000
export { MAX_STROKE_POINTS }

/**
 * The marks of the object in `dir`. A missing file is an empty list, and
 * nothing is written. A file that cannot be read at all is an error.
 *
 * A file that is not a marks file is copied aside, as
 * `marks.json.corrupt-<time>` beside it, and an empty list started whose ids
 * go on from the highest the old file is seen to have given out. A file some
 * of whose marks are not marks this version can keep is copied aside, as
 * `marks.json.dropped-<time>`, and the others kept. Either way the file is
 * rewritten at once and `problem` says what happened: once, since the next
 * read finds a file with nothing wrong.
 */
export async function loadMarksFile(dir: string, now: () => Date = () => new Date()): Promise<{ file: MarksFile; problem?: string }> {
  const path = join(dir, FOLDER, NAME)
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { file: { next: 1, marks: [] } }
    throw e
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    // not JSON
  }
  const read = readMarksFile(parsed)
  if (read && read.dropped === 0) return { file: read.file }

  const stamp = now().toISOString().replace(/[:.]/g, '-')
  await ownTorno(dir)
  if (!read) {
    const aside = `${NAME}.corrupt-${stamp}`
    // Copied, not moved: were the write below to fail, the next read must find the bad file again, and its ids with it.
    await copyFile(path, join(dir, FOLDER, aside))
    const file: MarksFile = { next: salvagedNext(text, parsed), marks: [] }
    await writeOwn(dir, NAME, textOf(file))
    return { file, problem: `The marks file of this project could not be read. It was kept as ${FOLDER}/${aside}, and a new list was started.` }
  }
  const aside = `${NAME}.dropped-${stamp}`
  await copyFile(path, join(dir, FOLDER, aside))
  await writeOwn(dir, NAME, textOf(read.file))
  const what = read.dropped === 1 ? '1 mark in the marks file of this project was' : `${read.dropped} marks in the marks file of this project were`
  return { file: read.file, problem: `${what} not of a kind this version of torno can read, and left out. The file as it was is kept as ${FOLDER}/${aside}.` }
}

/** Writes `<dir>/.torno/marks.json`, creating the folder. Readers see the old file or the new one, never half of one. */
export function saveMarksFile(dir: string, file: MarksFile): Promise<void> {
  return writeOwn(dir, NAME, textOf(sanitiseMarksFile(file) ?? { next: 1, marks: [] }))
}

function textOf(file: MarksFile): string {
  return `${JSON.stringify(file, null, 2)}\n`
}

/**
 * Keeps what a marks file may hold: the marks that are whole, each id once,
 * and a `next` past every id in it. Null when the value is not a marks file.
 */
export function sanitiseMarksFile(value: unknown): MarksFile | null {
  return readMarksFile(value)?.file ?? null
}

/**
 * `sanitiseMarksFile`, and how many entries of `marks` it left out. `next` is
 * past the id of every entry that has one, kept or not: an id that was given
 * out is never given out again.
 */
function readMarksFile(value: unknown): { file: MarksFile; dropped: number } | null {
  if (!isRecord(value) || !Array.isArray(value.marks)) return null
  const marks: Mark[] = []
  const seen = new Set<string>()
  let next = idNumber(value.next) ?? 1
  for (const raw of value.marks) {
    const given = isRecord(raw) && typeof raw.id === 'string' ? idNumber(Number(/^M(\d+)$/.exec(raw.id)?.[1])) : undefined
    if (given !== undefined) next = Math.max(next, given + 1)
    const mark = sanitiseMark(raw)
    if (!mark || seen.has(mark.id)) continue
    seen.add(mark.id)
    marks.push(mark)
  }
  return { file: { next, marks }, dropped: value.marks.length - marks.length }
}

/**
 * Where the ids of a fresh list start after a file that could not be read:
 * past its `next` and past every mark id that can be made out in its text.
 */
function salvagedNext(text: string, parsed: unknown): number {
  let next = (isRecord(parsed) ? idNumber(parsed.next) : undefined) ?? 1
  for (const match of text.matchAll(/"next"\s*:\s*(\d+)/g)) next = Math.max(next, idNumber(Number(match[1])) ?? 1)
  for (const match of text.matchAll(/"M(\d+)"/g)) next = Math.max(next, (idNumber(Number(match[1])) ?? 0) + 1)
  return next
}

/** A number an id can have, or a file can say is next: a whole one from 1 that still counts exactly. */
function idNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value < Number.MAX_SAFE_INTEGER ? value : undefined
}

/**
 * A mark with only the fields a mark has, or null when the value is not one:
 * a kind this version does not know, a field missing or of the wrong sort, a
 * number that is not finite. Notes and strokes are cut to their limits.
 */
export function sanitiseMark(value: unknown): Mark | null {
  if (!isRecord(value)) return null
  const camera = cameraOf(value.camera)
  if (
    typeof value.id !== 'string' ||
    !/^M[1-9]\d{0,14}$/.test(value.id) ||
    !oneOf(value.author, ['user', 'agent'] as const) ||
    typeof value.note !== 'string' ||
    !oneOf(value.status, ['draft', 'sent', 'resolved'] as const) ||
    !oneOf(value.anchorState, ['ok', 'drifted', 'orphaned'] as const) ||
    typeof value.layout !== 'string' ||
    !isNumber(value.revision) ||
    !camera ||
    typeof value.createdAt !== 'string'
  ) {
    return null
  }
  const base = {
    id: value.id,
    author: value.author,
    note: value.note.slice(0, MAX_NOTE),
    status: value.status,
    anchorState: value.anchorState,
    layout: value.layout,
    revision: value.revision,
    camera,
    createdAt: value.createdAt,
    ...(typeof value.resolvedNote === 'string' ? { resolvedNote: value.resolvedNote.slice(0, MAX_NOTE) } : {}),
    // What main alone says of a mark. A file written before there were any has none, and is whole without.
    ...(value.status === 'resolved' && oneOf(value.resolvedBy, ['user', 'agent'] as const) ? { resolvedBy: value.resolvedBy } : {}),
    ...(value.status === 'resolved' && value.resolvedBy === 'agent' && value.acknowledged === true ? { acknowledged: true as const } : {}),
    ...(value.sentBefore === true ? { sentBefore: true as const } : {}),
    ...(value.status === 'draft' && value.reopened === true ? { reopened: true as const } : {}),
    ...(isNumber(value.checkedRevision) ? { checkedRevision: value.checkedRevision } : {})
  }
  const anchor = anchorOf(value.anchor)
  switch (value.kind) {
    case 'pin':
      return anchor ? { ...base, kind: 'pin', anchor } : null
    case 'pick':
      return anchor && oneOf(value.target, ['face', 'edge', 'part'] as const) ? { ...base, kind: 'pick', target: value.target, anchor } : null
    case 'arrow': {
      const from = anchorOf(value.from)
      const to = tuple<Vec3>(value.to, 3)
      return from && to ? { ...base, kind: 'arrow', from, to } : null
    }
    case 'stroke':
      return anchor ? strokeOf(base, anchor, value) : null
    case 'shape': {
      const position = tuple<Vec3>(value.position, 3)
      const rotation = tuple<Quat>(value.rotation, 4)
      const size = tuple<Vec3>(value.size, 3)
      if (!oneOf(value.shape, ['box', 'cylinder', 'sphere', 'plane'] as const)) return null
      if (!oneOf(value.intent, ['add', 'remove', 'keep-out', 'reference'] as const)) return null
      if (!position || !rotation || !size) return null
      return { ...base, kind: 'shape', shape: value.shape, intent: value.intent, position, rotation, size: shapeSize(value.shape, size), ...(anchor ? { anchor } : {}) }
    }
    case 'dimension':
      return dimensionOf(base, value)
    case 'region':
      return regionOf(base, value)
    case 'note':
      return noteOf(base, anchor, value)
    default:
      return null
  }
}

/**
 * A region of a scan: the scan's number, how many triangles it has (one at least), their area, and where they
 * are in the scan's own frame. Its triangles themselves are no part of a mark: they are the mask beside the mesh.
 */
function regionOf(base: Omit<RegionMark, 'kind' | 'scan' | 'triangles' | 'area' | 'local'>, value: Record<string, unknown>): RegionMark | null {
  if (typeof value.scan !== 'string' || !/^S[1-9]\d{0,14}$/.test(value.scan)) return null
  if (!isNumber(value.triangles) || !Number.isSafeInteger(value.triangles) || value.triangles < 1) return null
  if (!isNumber(value.area) || value.area < 0) return null
  const local = isRecord(value.local) ? value.local : {}
  const bbox = isRecord(local.bbox) ? local.bbox : {}
  const plane = isRecord(local.plane) ? local.plane : {}
  const centroid = tuple<Vec3>(local.centroid, 3)
  const min = tuple<Vec3>(bbox.min, 3)
  const max = tuple<Vec3>(bbox.max, 3)
  const origin = tuple<Vec3>(plane.origin, 3)
  const normal = tuple<Vec3>(plane.normal, 3)
  if (!centroid || !min || !max || !origin || !normal || !isNumber(plane.rms) || plane.rms < 0) return null
  // Its own box. A mark kept before there was one has the box of the scan's frame for it: within it, if not its size.
  const own = isRecord(local.box) ? local.box : null
  const axes = own && Array.isArray(own.axes) && own.axes.length === 3 ? own.axes.map((axis) => tuple<Vec3>(axis, 3)) : null
  const centre = own ? tuple<Vec3>(own.centre, 3) : null
  const half = own ? tuple<Vec3>(own.half, 3) : null
  if (own && !(centre && half && axes?.every((axis) => axis !== null) && half.every((h) => h >= 0))) return null
  const box: RegionMark['local']['box'] = own
    ? { centre: centre!, axes: axes as [Vec3, Vec3, Vec3], half: half! }
    : { centre: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], half: [(max[0] - min[0]) / 2, (max[1] - min[1]) / 2, (max[2] - min[2]) / 2] }
  return {
    ...base,
    kind: 'region',
    scan: value.scan,
    triangles: value.triangles,
    area: value.area,
    local: { centroid, bbox: { min, max }, plane: { origin, normal, rms: plane.rms }, box },
    ...(typeof value.mesh === 'string' && value.mesh !== '' && value.mesh.length <= 200 ? { mesh: value.mesh } : {}),
    ...(isNumber(value.mask) && Number.isSafeInteger(value.mask) && value.mask >= 1 && value.mask < 1e9 ? { mask: value.mask } : {})
  }
}

/**
 * A note: files of main's by the names main gives them, a picture size, ink and labels in pixels of the picture, and
 * what the ink lies over. One with a file named otherwise, or more labels or references than a note keeps, or a longer
 * label or comment, is no note this version keeps. Its anchor is optional: the ink may have lain over no face.
 */
function noteOf(base: Omit<NoteMark, 'kind' | 'anchor' | 'picture' | 'ink' | 'size' | 'strokes' | 'inkColour' | 'labels' | 'under' | 'references'>, anchor: Anchor | null, value: Record<string, unknown>): NoteMark | null {
  if (typeof value.picture !== 'string' || !NOTE_PICTURE.test(value.picture)) return null
  if (typeof value.ink !== 'string' || !NOTE_INK.test(value.ink)) return null
  const size = isRecord(value.size) ? value.size : {}
  if (!isNumber(size.w) || !isNumber(size.h) || !(size.w > 0) || !(size.h > 0)) return null
  if (typeof value.inkColour !== 'string' || !/^#[0-9a-f]{6}$/i.test(value.inkColour)) return null
  if (!Array.isArray(value.strokes) || !Array.isArray(value.labels) || !Array.isArray(value.under) || !Array.isArray(value.references)) return null
  if (value.labels.length > MOST_LABELS || value.references.length > MOST_NOTE_REFERENCES) return null
  const strokes: NoteMark['strokes'] = []
  // Pen strokes and eraser strokes (`erase: true`, kept in order) are cut to their caps apart.
  let pens = 0
  let erases = 0
  for (const raw of value.strokes.slice(0, MOST_NOTE_STROKES + MOST_NOTE_ERASES)) {
    if (!isRecord(raw) || !isNumber(raw.width) || !(raw.width > 0) || !Array.isArray(raw.points)) return null
    const erase = raw.erase === true
    if (erase ? ++erases > MOST_NOTE_ERASES : ++pens > MOST_NOTE_STROKES) continue
    strokes.push({ width: raw.width, points: tuples<[number, number]>(raw.points, 2), ...(erase ? { erase: true as const } : {}) })
  }
  const labels: NoteLabel[] = []
  for (const raw of value.labels) {
    const label = labelOf(raw)
    if (!label) return null
    labels.push(label)
  }
  const references: NoteReference[] = []
  for (const raw of value.references) {
    if (!isRecord(raw) || typeof raw.file !== 'string' || !NOTE_REFERENCE.test(raw.file) || typeof raw.comment !== 'string' || raw.comment.length > MAX_REFERENCE_COMMENT) return null
    references.push({ file: raw.file, comment: raw.comment })
  }
  // One for each stroke and then one for each label with an arrow: no more than there is ink to lie over something.
  if (value.under.length > MOST_NOTE_STROKES + MOST_LABELS) return null
  const under: StrokeUnder[] = []
  for (const raw of value.under) {
    const one = underOf(raw)
    if (!one) return null
    under.push(one)
  }
  return { ...base, kind: 'note', ...(anchor ? { anchor } : {}), picture: value.picture, ink: value.ink, size: { w: size.w, h: size.h }, strokes, inkColour: value.inkColour, labels, under, references }
}

function labelOf(value: unknown): NoteLabel | null {
  if (!isRecord(value) || !isNumber(value.x) || !isNumber(value.y) || typeof value.text !== 'string' || value.text.length > MAX_LABEL) return null
  if (value.to === undefined) return { x: value.x, y: value.y, text: value.text }
  if (!isRecord(value.to) || !isNumber(value.to.x) || !isNumber(value.to.y)) return null
  return { x: value.x, y: value.y, text: value.text, to: { x: value.to.x, y: value.to.y } }
}

/** What one stroke lies over, as a note keeps it: the box, the faces (each with the kernel's line when it had one), the cut parts, the scans and whether some of it lies over nothing. */
function underOf(value: unknown): StrokeUnder | null {
  if (!isRecord(value) || !Array.isArray(value.refs) || !Array.isArray(value.cuts) || !Array.isArray(value.scans) || typeof value.bare !== 'boolean') return null
  const box = tuple<[number, number, number, number]>(value.box, 4)
  if (!box || value.refs.length > MOST_REFS_TOLD || value.cuts.length > MOST_CUTS_TOLD || value.scans.length > MOST_SCANS_TOLD) return null
  const cuts = value.cuts
  const scans = value.scans
  if (!cuts.every((c): c is string => typeof c === 'string' && c.length <= 200) || !scans.every((c): c is string => typeof c === 'string' && c.length <= 200)) return null
  const refs: StrokeUnder['refs'] = []
  for (const one of value.refs) {
    if (!isRecord(one) || typeof one.ref !== 'string' || one.ref.length > 200) return null
    refs.push(typeof one.descriptor === 'string' ? { ref: one.ref, descriptor: one.descriptor.slice(0, 300) } : { ref: one.ref })
  }
  const more = isNumber(value.moreRefs) && Number.isSafeInteger(value.moreRefs) && value.moreRefs > 0
  return { box, refs, ...(more ? { moreRefs: value.moreRefs as number } : {}), cuts: [...cuts], scans: [...scans], bare: value.bare }
}

/** The longest account of how a value was taken that a dimension keeps. */
export const MAX_HOW = 120
/** The longest reason for having no value that it keeps. */
export const MAX_REFUSED = 300

/**
 * A dimension: a kind of measurement this version knows, its first end, and a
 * second where the measurement is taken between two (any other has one end,
 * and a second is left out). What was measured is kept as far as it can be
 * what it says: the way and the points only with a value, why there is none
 * only without. The verdict is not
 * read: it is what the value, the expectation and the tolerance make it.
 */
function dimensionOf(base: Omit<DimensionMark, 'kind' | 'measure' | 'a'>, value: Record<string, unknown>): DimensionMark | null {
  if (!oneOf(value.measure, ['distance', 'angle', 'radius', 'diameter', 'thickness'] as const)) return null
  const a = anchorOf(value.a)
  const between = value.measure === 'distance' || value.measure === 'angle'
  const b = between ? anchorOf(value.b) : null
  if (!a || (between && !b)) return null
  const mark: DimensionMark = { ...base, kind: 'dimension', measure: value.measure, a, ...(b ? { b } : {}) }
  if (isNumber(value.value)) {
    mark.value = value.value
    if (typeof value.how === 'string') mark.how = value.how.slice(0, MAX_HOW)
    const from = Array.isArray(value.points) && value.points.length === 2 ? tuple<Vec3>(value.points[0], 3) : null
    const to = from ? tuple<Vec3>((value.points as unknown[])[1], 3) : null
    if (from && to) mark.points = [from, to]
  } else if (typeof value.refused === 'string' && value.refused !== '') mark.refused = value.refused.slice(0, MAX_REFUSED)
  if (isNumber(value.measuredRevision)) mark.measuredRevision = value.measuredRevision
  if (isNumber(value.expected)) mark.expected = value.expected
  if (isNumber(value.tolerance) && value.tolerance >= 0) mark.tolerance = value.tolerance
  const verdict = verdictOf(mark)
  if (verdict) mark.verdict = verdict
  return mark
}

/**
 * The size of a shape as its kind has it, whoever asked for it: a box three
 * sides, a cylinder one diameter (twice) and a height, a sphere one diameter
 * (three times), a plane a width and a height and no thickness. Nothing it
 * has is less than a tenth of a millimetre.
 */
export function shapeSize(shape: ShapeKind, [x, y, z]: Vec3): Vec3 {
  const least = (side: number): number => Math.max(side, MIN_SHAPE_SIZE)
  if (shape === 'cylinder') return [least(x), least(x), least(z)]
  if (shape === 'sphere') return [least(x), least(x), least(x)]
  if (shape === 'plane') return [least(x), least(y), 0]
  return [least(x), least(y), least(z)]
}

/** A stroke has the points of its space: 3D points on a surface, or a plane and 2D points on it. */
function strokeOf(base: Omit<StrokeMark, 'kind' | 'space' | 'anchor'>, anchor: Anchor, value: Record<string, unknown>): StrokeMark | null {
  if (value.space === 'surface') {
    if (!Array.isArray(value.points)) return null
    return { ...base, kind: 'stroke', space: 'surface', anchor, points: tuples<Vec3>(value.points, 3) }
  }
  if (value.space === 'plane') {
    const plane = isRecord(value.plane) ? value.plane : {}
    const origin = tuple<Vec3>(plane.origin, 3)
    const x = tuple<Vec3>(plane.x, 3)
    const y = tuple<Vec3>(plane.y, 3)
    if (!origin || !x || !y || typeof plane.label !== 'string' || !Array.isArray(value.points2d)) return null
    return { ...base, kind: 'stroke', space: 'plane', anchor, plane: { origin, x, y, label: planeLabel(plane.label) }, points2d: tuples<[number, number]>(value.points2d, 2) }
  }
  return null
}

/** An anchor needs its point; what else it says is kept when it is of the right sort. */
export function anchorOf(value: unknown): Anchor | null {
  if (!isRecord(value)) return null
  const point = tuple<Vec3>(value.point, 3)
  if (!point) return null
  const anchor: Anchor = { point }
  const normal = tuple<Vec3>(value.normal, 3)
  if (normal) anchor.normal = normal
  if (typeof value.part === 'string') anchor.part = value.part
  if (typeof value.ref === 'string') anchor.ref = value.ref
  if (typeof value.descriptor === 'string') anchor.descriptor = value.descriptor
  const arranged = tuple<Vec3>(value.arranged, 3)
  if (arranged) anchor.arranged = arranged
  if (typeof value.edge === 'string') anchor.edge = value.edge
  if (Array.isArray(value.between) && value.between.length === 2 && value.between.every((ref) => typeof ref === 'string')) anchor.between = [value.between[0], value.between[1]]
  if (typeof value.tag === 'string' && TAG_NAME.test(value.tag)) anchor.tag = value.tag
  return anchor
}

function cameraOf(value: unknown): Camera | null {
  if (!isRecord(value)) return null
  const position = tuple<Vec3>(value.position, 3)
  const target = tuple<Vec3>(value.target, 3)
  const up = tuple<Vec3>(value.up, 3)
  if (!position || !target || !up || typeof value.ortho !== 'boolean' || !isNumber(value.fov) || !isNumber(value.zoom)) return null
  return { position, target, up, ortho: value.ortho, fov: value.fov, zoom: value.zoom }
}

/** A copy of `value` when it is exactly `length` finite numbers. */
function tuple<T extends number[]>(value: unknown, length: T['length']): T | null {
  return Array.isArray(value) && value.length === length && value.every(isNumber) ? ([...value] as T) : null
}

/** The points of a stroke that are points, up to the most a stroke keeps. */
function tuples<T extends number[]>(values: unknown[], length: T['length']): T[] {
  const kept: T[] = []
  for (const value of values) {
    if (kept.length === MAX_STROKE_POINTS) break
    const point = tuple<T>(value, length)
    if (point) kept.push(point)
  }
  return kept
}

function oneOf<const T extends readonly string[]>(value: unknown, allowed: T): value is T[number] {
  return typeof value === 'string' && allowed.includes(value)
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The longest label a plane keeps. */
export const MAX_PLANE_LABEL = 120

/** A plane's label as it is kept: on one line and no longer than `MAX_PLANE_LABEL`. The agent is given it as it is. */
function planeLabel(label: string): string {
  return label.replace(/\s*[\r\n\u0085\u2028\u2029]+\s*/g, ' ').trim().slice(0, MAX_PLANE_LABEL)
}
