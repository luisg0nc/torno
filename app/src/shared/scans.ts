import { fitNumber, number } from './format'
import type { Quat, Vec3 } from './marks'

export type ScanUnit = 'mm' | 'cm' | 'm' | 'in'
export type ScanUp = 'y' | 'z'
export const UNIT_MM: Record<ScanUnit, number> = { mm: 1, cm: 10, m: 1000, in: 25.4 }
export const SCAN_FORMATS = ['.glb', '.gltf', '.obj', '.ply', '.stl'] as const
export const MAX_SCAN_TRIANGLES = 2_000_000

/** Scan frame (mm, Z up, as imported) to the object frame of one layout: p' = s · R(q) · p + t. `s` is 1 unless a fit was made with scale. */
export interface ScanTransform { t: Vec3; q: Quat; s: number }
export const IDENTITY: ScanTransform = { t: [0, 0, 0], q: [0, 0, 0, 1], s: 1 }

export type AlignStep = 'floor' | 'pairs' | 'nudge' | 'typed'
/** What an alignment rests on. */
export type AlignBasis = 'pairs' | 'floor' | 'hand'
/** The most pairs an alignment keeps. */
export const MAX_PAIRS = 64
/** One pair of an alignment: a point of the scan, in the scan frame, and where it belongs, in the object frame of the layout. */
export interface ScanPair { scan: Vec3; model: Vec3; part?: string /* the part the model point was clicked on */; residual: number /* mm, after the fit */ }
export interface ScanAlignment {
  transform: ScanTransform
  /** How it came to be, in order: `['floor', 'pairs', 'nudge']`. Never empty. */
  steps: AlignStep[]
  pairs?: ScanPair[]
  /** Of the last fit: of the pairs, or of the floor patch about its plane. mm. */
  rms?: number
  /** The fit changed the scan's size. */
  scaled?: boolean
  /** The floor was laid on a face of this part, at this point of it (object frame). */
  floor?: { part?: string; point: Vec3 }
  /** `Part.arranged` of every part of the layout when it was aligned, zeros for a part that was not moved. */
  frame: Record<string, Vec3>
  at: string // ISO
  /** The build it was made on. Of this run: dropped when the file is read, like a mark's `checkedRevision`. */
  revision?: number
  /**
   * How well its pairs were fitted (rms, mm) by the last fit of pairs it rests on: set by main when the last
   * step is a fit, and carried unchanged through every move by hand after it. `rms` is where the pairs are now:
   * the two are one number until a hand moves the scan, and are never said as one after. Main's alone.
   */
  fitRms?: number
  /**
   * Why its fit of pairs is doubtful, when it is: fewer than three pairs, pairs in or almost in a line, or pairs
   * the fit left further apart than `ROUGH_RMS_MM` (`roughOf` in `shared/align.ts`: judged on `fitRms`, so it
   * stays through moves by hand). Worked out by main, and kept only once the person said yes to it. Whatever
   * reports the scan says so. A floor alone, or a scan placed by hand, is not rough: it is what it rests on
   * (`basisOf`, worked out from the steps and the pairs wherever it is said, never stored).
   */
  rough?: string
  /**
   * The person looked and said it still holds ("Still right"): when, on which build of this run (dropped when the
   * file is read), and where the model was then under each point it is tied to (`anchoredPoints`, in order: the
   * point of the part nearest to it), null for one whose part was not there. A later build is judged against
   * that: by how far the model has moved from where it was confirmed. Main's alone; gone when it is aligned
   * anew, kept through a move by hand that leaves the tied points as they are.
   */
  confirmed?: { revision?: number; at: string; held: Array<Vec3 | null> }
  /** The scan was imported again from a source that was no longer the file it was aligned with. Until it is aligned again, or the person says it still holds. */
  sourceChanged?: true
  /** The alignment this one took the place of, for one undo: null when the scan was not aligned there before. Absent when there is nothing to undo. */
  before?: Omit<ScanAlignment, 'before'> | null
}
/** What only main says of an alignment: never taken from the window or from a tool's arguments. */
export const ALIGNMENT_MAIN_ONLY = ['frame', 'at', 'revision', 'fitRms', 'rough', 'sourceChanged', 'confirmed', 'before'] as const
/** What a caller gives to align: main adds the rest. */
export type NewAlignment = Omit<ScanAlignment, (typeof ALIGNMENT_MAIN_ONLY)[number]>
/**
 * What goes with an alignment to be kept: the build it was fitted on, and what the person said yes to. An
 * alignment that is rough, or that changes the scan's size, is kept only with that yes.
 */
export interface AlignMade { revision: number; rough?: boolean; scaled?: boolean }

/** What main found when it checked an alignment against a build (`main/scans/alignCheck.ts`). Never stored: revisions are of this run. */
export interface AlignmentCheck { revision: number; of: number; off: number; worst: number; moved: string[] }

export interface ScanSource { path: string /* absolute */; bytes: number; mtimeMs: number; sha256: string }
export interface ScanImport {
  unit: ScanUnit
  up: ScanUp
  /** Whether each was assumed from the format and the size, not chosen by the person. */
  assumed: { unit: boolean; up: boolean }
  vertices: number
  triangles: number
  colours: 'texture' | 'vertex' | 'none'
  bbox: { min: Vec3; max: Vec3 } // scan frame
  area: number // mm²
  reduced?: { from: number; cell: number }
  at: string
  /** The file of its mesh in the scan's folder, when that is not `mesh.bin`: a conversion writes another, and this is what says it was made. Main's alone. */
  mesh?: string
}
/** A scan as `scans.json` keeps it. */
export interface Scan {
  id: string // 'S1'
  name: string
  source: ScanSource
  imported: ScanImport
  alignments: Record<string, ScanAlignment> // by layout
}
export interface ScansFile { next: number; scans: Scan[] }

/** A scan as main tells it: with what it found on the disk and at the last build. */
export interface ScanInfo extends Scan {
  sourceState: 'present' | 'missing' | 'changed'
  meshState: 'ok' | 'missing'
  checks: Record<string, AlignmentCheck> // by layout; absent for one not checked in this run
  /** By layout: why the last check of that alignment could say nothing (the kernel could not be asked), and of which build. Gone once a check says something. */
  unchecked?: Record<string, { revision: number; reason: string }>
}

/**
 * What came of importing a scan again from its source, into the id it has. `sourceChanged`: the file is not the one
 * that was read before (another hash): each of its alignments then says so (`ScanAlignment.sourceChanged`) until it
 * is made again or said to hold. `meshChanged`: the mesh has other vertex or triangle counts. Its name and its
 * alignments stay, and so does what the last build's check found of them: that is of the model's points, and says
 * nothing of the mesh.
 */
export interface Reimported { scan: ScanInfo; sourceChanged: boolean; meshChanged: boolean }

/** The least a scan is thinned to: under it, it could not be found again. */
export const MIN_SCAN_OPACITY = 0.05

/** How a scan is looked at: view state, kept in scene.json by scan id. */
export interface ScanView { visible?: boolean; opacity?: number; colour?: 'own' | 'plain' }

export interface ScanMesh { vertices: Float32Array; colours: Uint8Array | null; triangles: Uint32Array; bbox: { min: Vec3; max: Vec3 } }

// The layout of a `mesh.bin` and of a `.mask`: `kernel/src/torno_kernel/scanfile.py` writes and reads the same.
/** No coordinate of a scan is past this, in mm: a thousand kilometres. */
const MAX_SCAN_COORDINATE = 1e9
const MESH_MAGIC = 'TORNOSCN'
const MASK_MAGIC = 'TORNOMSK'
const VERSION = 1
const MESH_HEADER = 64
const MASK_HEADER = 16

const ascii = (bytes: Uint8Array): string => String.fromCharCode(...bytes)

/** Views into a `mesh.bin`; nothing is copied. Throws a RangeError that says what is wrong with the bytes. */
export function parseScanMesh(blob: ArrayBuffer): ScanMesh {
  if (blob.byteLength < MESH_HEADER || ascii(new Uint8Array(blob, 0, 8)) !== MESH_MAGIC) throw new RangeError(`${blob.byteLength} bytes is not a scan torno wrote`)
  const header = new DataView(blob, 0, MESH_HEADER)
  const version = header.getUint32(8, true)
  if (version !== VERSION) throw new RangeError(`a scan of version ${version}: this torno reads version ${VERSION}`)
  const coloured = (header.getUint32(12, true) & 1) === 1
  const v = header.getUint32(16, true)
  const t = header.getUint32(20, true)
  const expected = MESH_HEADER + 12 * v + (coloured ? 4 * v : 0) + 12 * t
  if (blob.byteLength !== expected) throw new RangeError(`the scan has ${blob.byteLength} bytes, and its header says ${expected}`)
  const vertices = new Float32Array(blob, MESH_HEADER, 3 * v)
  const colours = coloured ? new Uint8Array(blob, MESH_HEADER + 12 * v, 4 * v) : null
  const triangles = new Uint32Array(blob, MESH_HEADER + 12 * v + (coloured ? 4 * v : 0), 3 * t)
  let highest = -1
  for (let n = 0; n < triangles.length; n++) if (triangles[n] > highest) highest = triangles[n]
  if (highest >= v) throw new RangeError(`a triangle names vertex ${highest}, and there are ${v}`)
  const corner = (at: number): Vec3 => [header.getFloat32(at, true), header.getFloat32(at + 4, true), header.getFloat32(at + 8, true)]
  // The box is taken on the file's word (no pass over the vertices): it must at least be one, of a size a scan can have.
  const bbox = { min: corner(24), max: corner(36) }
  if (![...bbox.min, ...bbox.max].every((c) => Number.isFinite(c) && Math.abs(c) <= MAX_SCAN_COORDINATE) || bbox.min.some((c, axis) => c > bbox.max[axis])) throw new RangeError('the scan is damaged: its header gives no box')
  return { vertices, colours, triangles, bbox }
}

/** The bytes of a `.mask` for a bitset over `triangles` triangles. Throws a RangeError for a bitset of another length. */
export function maskFile(bits: Uint8Array, triangles: number): Uint8Array {
  const length = Math.ceil(triangles / 8)
  if (bits.length !== length) throw new RangeError(`a region of a mesh of ${triangles} triangles is ${length} bytes of bits, not ${bits.length}`)
  const file = new Uint8Array(MASK_HEADER + length)
  for (let n = 0; n < 8; n++) file[n] = MASK_MAGIC.charCodeAt(n)
  const header = new DataView(file.buffer)
  header.setUint32(8, VERSION, true)
  header.setUint32(12, triangles, true)
  file.set(bits, MASK_HEADER)
  return file
}

/** The bitset of a `.mask`, as a view into it. Throws a RangeError for a file of another length or count. */
export function maskBits(file: Uint8Array, triangles: number): Uint8Array {
  if (file.length < MASK_HEADER || ascii(file.subarray(0, 8)) !== MASK_MAGIC) throw new RangeError(`${file.length} bytes is not a region torno wrote`)
  const header = new DataView(file.buffer, file.byteOffset, MASK_HEADER)
  const version = header.getUint32(8, true)
  if (version !== VERSION) throw new RangeError(`a region of version ${version}: this torno reads version ${VERSION}`)
  const count = header.getUint32(12, true)
  if (count !== triangles) throw new RangeError(`a region of a mesh of ${count} triangles, not ${triangles}`)
  const expected = MASK_HEADER + Math.ceil(count / 8)
  if (file.length !== expected) throw new RangeError(`the region has ${file.length} bytes, and its header says ${expected}`)
  return file.subarray(MASK_HEADER)
}

/** `aligned` | `not aligned`: whether the scan has a transform for the layout. */
export function alignmentOf(scan: Pick<Scan, 'alignments'>, layout: string): ScanAlignment | null {
  return Object.hasOwn(scan.alignments, layout) ? scan.alignments[layout] : null
}

/** Said of what was not checked against the build there is: that a check is still to come, or why the last one could say nothing. */
const notChecked = (unchecked: { revision: number; reason?: string }): string =>
  unchecked.reason === undefined ? `it was not checked against r${unchecked.revision}` : `it could not be checked against r${unchecked.revision}: ${unchecked.reason}`

/**
 * Why an alignment may no longer hold, as a sentence, or null: what the last check against a build found,
 * whether the scan itself was read again from a changed source since, and, with `unchecked`, that it was not
 * checked against that build (with why, once a check has failed). One notion, with its reasons.
 */
export function staleText(check: AlignmentCheck | undefined, alignment?: Pick<ScanAlignment, 'sourceChanged'> | null, unchecked?: { revision: number; reason?: string }): string | null {
  const why: string[] = []
  if (alignment?.sourceChanged) why.push('the scan was imported again from a source that had changed since it was aligned')
  if (check && check.moved.length > 0) why.push(`torno has moved ${check.moved.join(', ')} for display since it was aligned`)
  if (check && check.off > 0) why.push(`the model is no longer under ${count(check.off)} of its ${count(check.of)} points (worst ${number(check.worst)} mm off) on r${check.revision}`)
  if (unchecked !== undefined) {
    // By itself it is no call to look, only to wait: the check is tried again.
    if (why.length === 0) return notChecked(unchecked)
    why.push(notChecked(unchecked))
  }
  return why.length > 0 ? `${why.join(', and ')}: check the alignment` : null
}

/** What an alignment rests on, from how it came to be: the last fit of pairs it keeps, else a floor, else a hand; and whether a hand moved it after that. */
export function basisOf(alignment: Pick<ScanAlignment, 'steps' | 'pairs'>): { basis: AlignBasis; movedByHand: boolean } {
  const { steps } = alignment
  const fitted = (alignment.pairs?.length ?? 0) > 0 ? steps.lastIndexOf('pairs') : -1
  const at = fitted >= 0 ? fitted : steps.lastIndexOf('floor')
  if (at < 0) return { basis: 'hand', movedByHand: false }
  return { basis: fitted >= 0 ? 'pairs' : 'floor', movedByHand: steps.slice(at + 1).some((step) => step === 'nudge' || step === 'typed') }
}

/** A fit of pairs that a hand moved afterwards: how well it fitted and where its pairs are now, two numbers, each named. */
function movedFit(alignment: Pick<ScanAlignment, 'rms' | 'fitRms'>, fit: (rms: string) => string, figure: (mm: number) => string = fitNumber): { fitted: string; now: string } {
  return { fitted: alignment.fitRms === undefined ? '' : ` (${fit(figure(alignment.fitRms))})`, now: alignment.rms === undefined ? '' : `: the pairs are now ${figure(alignment.rms)} mm apart` }
}

/**
 * How an alignment was made, short: `floor only`, `by hand`, `4 pairs, RMS 0.8 mm`; a fit or a floor that was
 * moved by hand says so, and of a fit both how well it fitted and where its pairs are now: `4 pairs (fit RMS
 * 0.8 mm), then moved by hand: the pairs are now 20 mm apart`. For a row and a caption: `figure` writes each
 * length, to the thousandth for the person's row, to a tenth for a caption the agent reads (`tenth`).
 */
export function basisText(alignment: Pick<ScanAlignment, 'steps' | 'pairs' | 'rms' | 'fitRms' | 'scaled'>, figure: (mm: number) => string = fitNumber): string {
  const { basis, movedByHand } = basisOf(alignment)
  const scaled = alignment.scaled ? ', scaled' : ''
  if (basis !== 'pairs') return `${basis === 'hand' ? 'by hand' : 'floor only'}${scaled}${movedByHand ? ', then moved by hand' : ''}`
  const pairs = alignment.pairs?.length ?? 0
  const many = `${count(pairs)} ${pairs === 1 ? 'pair' : 'pairs'}`
  if (!movedByHand) return `${many}${alignment.rms === undefined ? '' : `, RMS ${figure(alignment.rms)} mm`}${scaled}`
  const { fitted, now } = movedFit(alignment, (rms) => `fit RMS ${rms} mm`, figure)
  return `${many}${fitted}${scaled}, then moved by hand${now}`
}

/** How many points of the model an alignment is tied to: the model ends of its pairs that were clicked on a part, and a floor laid on a face. */
export function tiedPoints(alignment: Pick<ScanAlignment, 'pairs' | 'floor'>): number {
  return (alignment.pairs ?? []).filter((pair) => pair.part !== undefined).length + (alignment.floor?.part !== undefined ? 1 : 0)
}

/** Said of an alignment no build can be asked about. A note, not a doubt. */
export const TIED_TO_NOTHING = 'tied to no point of the model: not checked against builds'

/**
 * How the alignment of a scan in a layout stands, for whatever reports the scan: what it rests on (`basis`),
 * why its fit is doubtful (`rough`), why it may no longer hold (`stale`: `staleText`), and what else is to be
 * known of it (`note`: that no build can say anything of it, that the person confirmed it). `unchecked`: it was
 * not checked against the last build; `waiting`: that is all `stale` says, so there is nothing to look at, only
 * a check to wait for (`failed`: the last one could say nothing, and `stale` says why).
 */
export interface Standing { aligned: boolean; basis: string | null; rough: string | null; stale: string | null; unchecked: boolean; waiting: boolean; failed: boolean; note: string | null }

/**
 * `revision` is the last build, 0 or absent for none: an alignment whose check is missing, or of another build,
 * was not checked against it, and says so, as an unchecked mark does.
 */
export function standingOf(scan: Pick<ScanInfo, 'alignments' | 'checks' | 'unchecked'>, layout: string, revision?: number, figure?: (mm: number) => string): Standing {
  const alignment = alignmentOf(scan, layout)
  if (!alignment) return { aligned: false, basis: null, rough: null, stale: null, unchecked: false, waiting: false, failed: false, note: null }
  const found = Object.hasOwn(scan.checks, layout) ? scan.checks[layout] : undefined
  const built = revision !== undefined && revision > 0
  const check = built && found?.revision !== revision ? undefined : found
  const unchecked = built && check === undefined
  const failure = unchecked && scan.unchecked && Object.hasOwn(scan.unchecked, layout) && scan.unchecked[layout].revision === revision ? scan.unchecked[layout].reason : undefined
  const stale = staleText(check, alignment, unchecked ? { revision: revision!, ...(failure === undefined ? {} : { reason: failure }) } : undefined)
  const waiting = unchecked && staleText(check, alignment) === null
  const notes = [
    ...(tiedPoints(alignment) === 0 ? [TIED_TO_NOTHING] : []),
    // Until the next doubt: what was confirmed is then in question again.
    ...(alignment.confirmed && (stale === null || waiting) ? [`confirmed by the user${alignment.confirmed.revision === undefined ? '' : ` on r${alignment.confirmed.revision}`}`] : [])
  ]
  // `figure` writes the lengths of what it rests on (`basisText`): to a tenth for a caption, which the agent reads.
  return { aligned: true, basis: basisText(alignment, figure), rough: alignment.rough ?? null, stale, unchecked, waiting, failed: failure !== undefined, note: notes.length > 0 ? notes.join('; ') : null }
}

/**
 * How an alignment was made, at length: `by floor + 4 pairs (RMS 2.1 mm, worst 3.4 mm)`, `by hand (typed values)`,
 * `by floor only (plane RMS 0.8 mm): its place in that plane is as imported`; with `, then moved by hand` when
 * a fit or a floor was: `by 4 pairs (fit RMS 0.8 mm), then moved by hand: the pairs are now 20 mm apart`.
 * `figure` writes each length, less its unit: to the thousandth for the person who clicked the points, coarser
 * for whoever reads it beside what is taken from the scan (`alignmentSaid`).
 */
export function alignmentText(alignment: ScanAlignment, figure: (mm: number) => string = fitNumber): string {
  const { basis, movedByHand } = basisOf(alignment)
  const pairs = alignment.pairs ?? []
  const rms = alignment.rms === undefined ? null : `RMS ${figure(alignment.rms)} mm`
  const moved = movedByHand ? ', then moved by hand' : ''
  const word = (step: AlignStep): string => (step === 'typed' ? 'typed values' : step)
  if (basis === 'hand') return `by hand (${[...new Set(alignment.steps.filter((step) => step === 'nudge' || step === 'typed'))].map(word).join(' + ') || 'handles'})`
  // A floor says how high the scan stands and how it leans, and nothing of where it is on that floor.
  if (basis === 'floor') return `by floor only${rms ? ` (plane ${rms})` : ''}${moved}: its place in that plane is ${movedByHand ? 'as it was put by hand' : 'as imported'}`
  const many = `${count(pairs.length)} ${pairs.length === 1 ? 'pair' : 'pairs'}`
  const before = alignment.steps.slice(0, alignment.steps.lastIndexOf('pairs')).includes('floor') ? 'floor + ' : ''
  const scaled = alignment.scaled ? ', scaled' : ''
  if (!movedByHand) return `by ${before}${many} (${[...(rms ? [rms] : []), `worst ${figure(Math.max(...pairs.map((pair) => pair.residual)))} mm`].join(', ')})${scaled}`
  // How well it fitted, and where a hand left its pairs: two numbers, never one.
  const { fitted, now } = movedFit(alignment, (was) => `fit RMS ${was} mm`, figure)
  return `by ${before}${many}${fitted}${scaled}${moved}${now}`
}

/** The size of a scan, in mm, had it been read with this unit and up axis: what the read sheet says before Apply. */
export function sizeAs(imported: Pick<ScanImport, 'unit' | 'up' | 'bbox'>, as: { unit: ScanUnit; up: ScanUp }): Vec3 {
  const { min, max } = imported.bbox
  const k = UNIT_MM[as.unit] / UNIT_MM[imported.unit]
  const [x, y, z] = max.map((c, axis) => (c - min[axis]) * k)
  // The kernel turns Y up to Z up as (x, y, z) -> (x, -z, y), and back as (x, z, -y): the extents only swap Y and Z.
  return as.up === imported.up ? [x, y, z] : [x, z, y]
}

/** `2518 × 2351 × 1494 mm, from m, Y up (assumed)`. */
export function importText(imported: ScanImport): string {
  const { min, max } = imported.bbox
  const size = max.map((c, axis) => number(c - min[axis])).join(' × ')
  const assumed = imported.assumed.unit && imported.assumed.up ? ' (assumed)' : imported.assumed.unit ? ' (unit assumed)' : imported.assumed.up ? ' (up assumed)' : ''
  const reduced = imported.reduced ? `, reduced from ${count(imported.reduced.from)} triangles` : ''
  return `${size} mm, from ${imported.unit}, ${imported.up.toUpperCase()} up${assumed}${reduced}`
}

const count = (n: number): string => n.toLocaleString('en-US')
