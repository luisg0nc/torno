import { copyFile, lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Vec3 } from '../../shared/marks'
import {
  LAYER_COLOURS,
  MAX_LABEL_TEXT,
  MAX_LAYER_NAME,
  MAX_SHAPE_NAME,
  MAX_TRACING_NAME,
  MOST_LAYERS,
  MOST_SHAPES,
  MOST_TRACINGS,
  MOST_TRACING_POINTS,
  TRACING_ID,
  type Layer,
  type LayerColour,
  type LayerShape,
  type LineupPair,
  type Matrix3,
  type Tracing,
  type TracingFrom,
  type TracingPhoto,
  type TracingPlane,
  type TracingsFile,
  validFrame
} from '../../shared/tracings'
import { FOLDER, ownTorno, writeOwn } from '../own'

const NAME = 'tracings.json'
/** The longest layout name, ref and tag a tracing may carry. */
const MAX_TEXT = 200
const MOST_PARTS = 500
const MOST_PAIRS = 8
const PHOTO_FILE = /^p-[0-9a-f]{12}\.(?:jpg|png)$/
const STRAIGHT_FILE = /^s-[0-9a-f]{12}\.(?:jpg|png)$/
const SHA256 = /^[0-9a-f]{64}$/

const withoutRun = (t: Tracing): Omit<Tracing, 'revision'> => {
  const { revision: _run, ...rest } = t
  return rest
}

/**
 * The text of a tracings file: what is written, and what a change is compared with. A tracing's `revision` is of a run and is
 * left out (a layer's is its own count and stays).
 */
export const textOf = (file: TracingsFile): string => `${JSON.stringify({ ...file, tracings: file.tracings.map(withoutRun) }, null, 2)}\n`

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
/** A number an id can have, or a file can say is next: a whole one from 1 that still counts exactly. */
const idNumber = (value: unknown): number | undefined => (typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value < Number.MAX_SAFE_INTEGER ? value : undefined)
const oneLine = (text: string): boolean => !/[\r\n]/.test(text)
const vec3 = (value: unknown): Vec3 | null => (Array.isArray(value) && value.length === 3 && value.every(finite) ? ([value[0], value[1], value[2]] as Vec3) : null)
const pair = (value: unknown): [number, number] | null => (Array.isArray(value) && value.length === 2 && value.every(finite) ? [value[0], value[1]] : null)

/**
 * A shape with only the keys its kind has, or a sentence that says what is wrong with it (the store refuses with it; a file
 * is read leaving the shape out). Every number is finite. A polyline has two points at least, and three when closed.
 */
export function readShape(raw: unknown): { shape: LayerShape } | { problem: string } {
  if (!isRecord(raw)) return { problem: 'is not a shape' }
  let name: string | undefined
  if (raw.name !== undefined) {
    if (typeof raw.name !== 'string' || raw.name.length > MAX_SHAPE_NAME || !oneLine(raw.name)) return { problem: `has a name that is not one line of ${MAX_SHAPE_NAME} characters or fewer` }
    name = raw.name
  }
  const named = name === undefined || name === '' ? {} : { name }
  if (raw.kind === 'polyline') {
    if (!Array.isArray(raw.points)) return { problem: 'has no list of points' }
    const points: [number, number][] = []
    for (const p of raw.points) {
      const point = pair(p)
      if (!point) return { problem: 'has a point that is not two finite numbers' }
      points.push(point)
    }
    if (points.length < 2) return { problem: 'is a polyline of fewer than two points' }
    if (raw.closed !== undefined && raw.closed !== true && raw.closed !== false) return { problem: 'says closed with something other than true or false' }
    if (raw.closed === true && points.length < 3) return { problem: 'is closed with fewer than three points' }
    return { shape: { ...named, kind: 'polyline', points, ...(raw.closed === true ? { closed: true as const } : {}) } }
  }
  if (raw.kind === 'circle') {
    const centre = pair(raw.centre)
    if (!centre) return { problem: 'has a centre that is not two finite numbers' }
    if (!finite(raw.radius) || raw.radius <= 0) return { problem: 'has a radius that is not a finite number above zero' }
    return { shape: { ...named, kind: 'circle', centre, radius: raw.radius } }
  }
  if (raw.kind === 'label') {
    const at = pair(raw.at)
    if (!at) return { problem: 'has a place that is not two finite numbers' }
    if (typeof raw.text !== 'string' || raw.text.trim() === '' || raw.text.length > MAX_LABEL_TEXT || !oneLine(raw.text)) return { problem: `has a text that is not one line of 1 to ${MAX_LABEL_TEXT} characters` }
    return { shape: { kind: 'label', at, text: raw.text } }
  }
  return { problem: 'is not a polyline, a circle or a label' }
}

function readFrom(raw: unknown): TracingFrom | null {
  if (!isRecord(raw)) return null
  if (raw.kind === 'main') {
    if (raw.axis !== 'XY' && raw.axis !== 'XZ' && raw.axis !== 'YZ') return null
    return finite(raw.offset) ? { kind: 'main', axis: raw.axis, offset: raw.offset } : null
  }
  if (raw.kind === 'face') {
    if (typeof raw.ref !== 'string' || raw.ref === '' || raw.ref.length > MAX_TEXT || !Number.isSafeInteger(raw.revision)) return null
    if (raw.tag !== undefined && (typeof raw.tag !== 'string' || raw.tag === '' || raw.tag.length > MAX_TEXT)) return null
    return { kind: 'face', ref: raw.ref, ...(raw.tag === undefined ? {} : { tag: raw.tag }), revision: raw.revision as number }
  }
  if (raw.kind === 'section') {
    const origin = vec3(raw.origin)
    const normal = vec3(raw.normal)
    return origin && normal && Math.hypot(...normal) > 1e-9 ? { kind: 'section', origin, normal } : null
  }
  return null
}

/** A plane with only its own keys, or null when it is not a frame (finite, orthonormal within 1e-6) or says no origin. */
export function readPlane(raw: unknown): TracingPlane | null {
  if (!isRecord(raw)) return null
  const origin = vec3(raw.origin)
  const x = vec3(raw.x)
  const y = vec3(raw.y)
  const from = readFrom(raw.from)
  if (!origin || !x || !y || !from || !validFrame(x, y)) return null
  if (typeof raw.label !== 'string' || raw.label.length > MAX_TEXT || !oneLine(raw.label)) return null
  return { origin, x, y, label: raw.label, from }
}

/** What a line-up point was snapped to: a corner, a centre or a vertex, by ref; one of them, or nothing. */
function snapOf(value: unknown): LineupPair['snap'] | undefined {
  if (!isRecord(value)) return undefined
  for (const kind of ['corner', 'centre', 'vertex'] as const) {
    const ref = value[kind]
    if (typeof ref === 'string' && ref !== '' && ref.length <= MAX_TEXT) return { [kind]: ref } as LineupPair['snap']
  }
  return undefined
}

function readPhoto(raw: unknown): TracingPhoto | null {
  if (!isRecord(raw)) return null
  const side = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 1 && v <= 100_000
  if (typeof raw.file !== 'string' || !PHOTO_FILE.test(raw.file) || typeof raw.sha256 !== 'string' || !SHA256.test(raw.sha256) || !side(raw.width) || !side(raw.height)) return null
  const pairs: LineupPair[] = []
  for (const p of Array.isArray(raw.pairs) ? raw.pairs : []) {
    if (!isRecord(p) || pairs.length >= MOST_PAIRS) continue
    const photo = pair(p.photo)
    const uv = pair(p.uv)
    if (!photo || !uv) continue
    const snap = snapOf(p.snap)
    pairs.push({ photo, uv, ...(snap ? { snap } : {}) })
  }
  const transform = Array.isArray(raw.transform) && raw.transform.length === 9 && raw.transform.every(finite) ? (raw.transform.slice() as Matrix3) : undefined
  const photo: TracingPhoto = {
    file: raw.file,
    sha256: raw.sha256,
    width: raw.width,
    height: raw.height,
    ...(typeof raw.caption === 'string' && raw.caption !== '' && raw.caption.length <= 2000 ? { caption: raw.caption } : {}),
    ...(typeof raw.from === 'string' && raw.from !== '' && raw.from.length <= 500 ? { from: raw.from } : {}),
    pairs,
    method: raw.method === 'straight' ? 'straight' : 'similar',
    ...(transform ? { transform } : {}),
    ...(finite(raw.scale) ? { scale: raw.scale } : {}),
    ...(finite(raw.angle) ? { angle: raw.angle } : {}),
    ...(finite(raw.fit) ? { fit: raw.fit } : {}),
    ...(typeof raw.straightened === 'string' && STRAIGHT_FILE.test(raw.straightened) ? { straightened: raw.straightened } : {}),
    fade: finite(raw.fade) ? Math.min(1, Math.max(0, raw.fade)) : 0.5,
    ...(raw.hidden === true ? { hidden: true as const } : {})
  }
  return photo
}

/** A tracing and how many of its layers, shapes and photo were left out as not whole; null when it is not a tracing. */
export function readTracing(raw: unknown): { tracing: Tracing; dropped: number } | null {
  if (!isRecord(raw)) return null
  if (typeof raw.id !== 'string' || !TRACING_ID.test(raw.id)) return null
  if (typeof raw.layout !== 'string' || raw.layout === '' || raw.layout.length > MAX_TEXT) return null
  const plane = readPlane(raw.plane)
  if (!plane) return null
  let dropped = 0
  const layers: Layer[] = []
  let nextLayer = idNumber(raw.nextLayer) ?? 1
  let points = 0
  for (const entry of Array.isArray(raw.layers) ? raw.layers : []) {
    const id = isRecord(entry) ? idNumber(entry.id) : undefined
    // An id the file names is never given again, whether its layer is kept or not.
    if (id !== undefined) nextLayer = Math.max(nextLayer, id + 1)
    if (!isRecord(entry) || id === undefined || typeof entry.name !== 'string') {
      dropped += 1
      continue
    }
    const name = entry.name.trim()
    const colour = LAYER_COLOURS.find((c) => c === entry.colour)
    if (name === '' || name.length > MAX_LAYER_NAME || !oneLine(name) || colour === undefined || layers.length >= MOST_LAYERS) {
      dropped += 1
      continue
    }
    if (layers.some((l) => l.id === id || l.name.toLowerCase() === name.toLowerCase())) {
      dropped += 1
      continue
    }
    const shapes: LayerShape[] = []
    for (const s of Array.isArray(entry.shapes) ? entry.shapes : []) {
      const read = readShape(s)
      const used = 'shape' in read && read.shape.kind === 'polyline' ? read.shape.points.length : 0
      if ('problem' in read || shapes.length >= MOST_SHAPES || points + used > MOST_TRACING_POINTS) {
        dropped += 1
        continue
      }
      points += used
      shapes.push(read.shape)
    }
    layers.push({
      id,
      name,
      colour: colour as LayerColour,
      by: entry.by === 'agent' ? 'agent' : 'person',
      ...(entry.hidden === true ? { hidden: true as const } : {}),
      shapes,
      revision: idNumber(entry.revision) ?? 1
    })
  }
  const photo = raw.photo === undefined ? undefined : readPhoto(raw.photo)
  if (raw.photo !== undefined && !photo) dropped += 1
  const parts = Array.isArray(raw.parts) ? raw.parts.filter((p): p is string => typeof p === 'string' && p !== '' && p.length <= MAX_TEXT).slice(0, MOST_PARTS) : undefined
  const build = isRecord(raw.build) && typeof raw.build.id === 'string' && typeof raw.build.sources === 'string' && raw.build.id.length <= MAX_TEXT && raw.build.sources.length <= MAX_TEXT ? { id: raw.build.id, sources: raw.build.sources } : undefined
  const name = typeof raw.name === 'string' ? raw.name.replace(/[\r\n]+/g, ' ').trim().slice(0, MAX_TRACING_NAME) : ''
  const tracing: Tracing = {
    id: raw.id,
    by: raw.by === 'agent' ? 'agent' : 'person',
    name,
    layout: raw.layout,
    createdAt: typeof raw.createdAt === 'string' && !Number.isNaN(Date.parse(raw.createdAt)) ? raw.createdAt : new Date(0).toISOString(),
    ...(build ? { build } : {}),
    plane,
    ...(parts && parts.length > 0 ? { parts } : {}),
    layers,
    nextLayer,
    ...(photo ? { photo } : {}),
    ...(typeof raw.lost === 'string' && raw.lost !== '' && raw.lost.length <= 500 ? { lost: raw.lost } : {})
  }
  return { tracing, dropped }
}

/** A tracing as the file holds it, with only the fields this version knows, each of the right shape; null when it is not one. */
export const sanitiseTracing = (raw: unknown): Tracing | null => readTracing(raw)?.tracing ?? null

/**
 * What a tracings file may hold: the tracings that are whole, each id once, at most 50, and in each the layers and shapes that
 * are whole within the caps. `dropped` counts what was left out. `next` is past every `T<n>` the file names, kept or not: an
 * id that was given out is never given out again. Null when the value is no tracings file at all.
 */
export function readTracingsFile(raw: unknown): { file: TracingsFile; dropped: number } | null {
  if (!isRecord(raw) || !Array.isArray(raw.tracings)) return null
  let next = idNumber(raw.next) ?? 1
  const tracings: Tracing[] = []
  let dropped = 0
  for (const entry of raw.tracings) {
    const given = isRecord(entry) && typeof entry.id === 'string' && TRACING_ID.test(entry.id) ? Number(entry.id.slice(1)) : undefined
    if (given !== undefined && Number.isSafeInteger(given + 1)) next = Math.max(next, given + 1)
    const read = readTracing(entry)
    if (!read || tracings.some((t) => t.id === read.tracing.id) || tracings.length >= MOST_TRACINGS) {
      dropped += 1
      continue
    }
    dropped += read.dropped
    tracings.push(read.tracing)
  }
  return { file: { next, tracings }, dropped }
}

/**
 * The text of the project's `tracings.json`: null when there is none, or when what stands in its place is not a plain file
 * (a link would have torno read, and copy aside, whatever it leads to).
 */
export async function diskText(dir: string): Promise<string | null> {
  const path = join(dir, FOLDER, NAME)
  try {
    if (!(await lstat(path)).isFile()) return null
    return await readFile(path, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT' || (e as NodeJS.ErrnoException).code === 'ENOTDIR') return null
    throw e
  }
}

/**
 * The tracings of the project in `dir`; `text` is what the file holds afterwards (null: no file). A missing file is no
 * tracings, and nothing is written. A link or a folder in the file's place is not read: no tracings and a `problem` (the next
 * change puts a file there). A file that is no tracings file is copied aside as `tracings.json.corrupt-<time>` and a new list
 * started whose ids go on past every `T<n>` the old text names; a file some of whose tracings, layers or shapes were not whole
 * is copied aside as `tracings.json.dropped-<time>` and rewritten with the rest. Either way `problem` says so, once: the next
 * read finds nothing wrong.
 */
export async function loadTracingsFile(dir: string, now: () => Date = () => new Date()): Promise<{ file: TracingsFile; text: string | null; problem?: string }> {
  const path = join(dir, FOLDER, NAME)
  const exists = await lstat(path).then(
    () => true,
    (e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return false
      throw e
    }
  )
  const text = await diskText(dir)
  if (text === null) {
    const file: TracingsFile = { next: 1, tracings: [] }
    if (!exists) return { file, text: null }
    return { file, text: null, problem: `${FOLDER}/${NAME} of this project is not a plain file, so torno did not read it. Its next change puts a tracings file there.` }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    // not JSON
  }
  const read = readTracingsFile(parsed)
  if (read && read.dropped === 0) return { file: read.file, text }

  const stamp = now().toISOString().replace(/[:.]/g, '-')
  await ownTorno(dir)
  if (!read) {
    const aside = `${NAME}.corrupt-${stamp}`
    // Copied, not moved: were the write below to fail, the next read must find the bad file again, and its ids with it.
    await copyFile(path, join(dir, FOLDER, aside))
    const file: TracingsFile = { next: salvagedNext(text, parsed), tracings: [] }
    await saveTracingsFile(dir, file)
    return { file, text: textOf(file), problem: `The tracings file of this project could not be read. It was kept as ${FOLDER}/${aside}, and a new list was started.` }
  }
  const aside = `${NAME}.dropped-${stamp}`
  await copyFile(path, join(dir, FOLDER, aside))
  await saveTracingsFile(dir, read.file)
  const what = read.dropped === 1 ? '1 tracing, layer or shape in the tracings file of this project was' : `${read.dropped} tracings, layers or shapes in the tracings file of this project were`
  return { file: read.file, text: textOf(read.file), problem: `${what} not whole, and left out. The file as it was is kept as ${FOLDER}/${aside}.` }
}

/** Writes `<dir>/.torno/tracings.json` whole or not at all, once the folder is known to be torno's own. */
export function saveTracingsFile(dir: string, file: TracingsFile): Promise<void> {
  return writeOwn(dir, NAME, textOf(file))
}

/** Where the ids of a fresh list start after a file that could not be read: past its `next` and every `T<n>` its text names. */
function salvagedNext(text: string, parsed: unknown): number {
  let next = (isRecord(parsed) ? idNumber(parsed.next) : undefined) ?? 1
  for (const match of text.matchAll(/"next"\s*:\s*(\d+)/g)) next = Math.max(next, idNumber(Number(match[1])) ?? 1)
  for (const match of text.matchAll(/"T(\d+)"/g)) next = Math.max(next, (idNumber(Number(match[1])) ?? 0) + 1)
  return next
}
