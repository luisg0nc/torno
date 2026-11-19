
import { MOST_CUTS_TOLD, MOST_REFS_TOLD, MOST_SCANS_TOLD, type StrokeUnder, type StrokeVector } from '../../shared/drawing'
import type { Camera } from '../../shared/view'

// What a view note holds of what the ink lies over, checked field by field (`notes/check.ts`) and worded for the agent
// (`notes/text.ts`): the pieces they share. The drawing on the view that once went with a prompt of its own is gone:
// a note is that drawing, kept as a mark.

/** A face of a part, as the window's pick names it (`refOf`): a part of any name on one line (no control character), its faces counted from 0. */
const FACE = /^[^\p{Cc}\u2028\u2029]{1,200}\/F(?:0|[1-9][0-9]{0,6})$/u
/** A part, by its name: one line, no control character. */
const PART = /^[^\p{Cc}\u2028\u2029]{1,200}$/u
const SCAN = /^S[1-9][0-9]{0,6}$/
export const INK = /^#[0-9a-fA-F]{6}$/
/** The longest caption, and object id or layout, taken after folding to one line; a longer descriptor is cut. */
export const MAX_CAPTION = 4000
export const MAX_NAME = 200
const MAX_DESCRIPTOR = 200
/** Beyond this a coordinate of a camera is no place (as of a saved view). */
const MAX_COORDINATE = 1e9

export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
export const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0
/** Every run of white space, line breaks too, as one space. */
export const folded = (v: string): string => v.replace(/\s+/g, ' ').trim()
/** A text of one line, `most` characters at most once folded; null for anything else. */
export function line(v: unknown, most: number): string | null {
  if (typeof v !== 'string') return null
  const one = folded(v)
  return one !== '' && one.length <= most ? one : null
}

export function cameraOf(v: unknown): Camera | null {
  if (!isRecord(v)) return null
  const triple = (t: unknown): [number, number, number] | null => (Array.isArray(t) && t.length === 3 && t.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= MAX_COORDINATE) ? [t[0], t[1], t[2]] : null)
  const position = triple(v.position)
  const target = triple(v.target)
  const up = triple(v.up)
  if (!position || !target || !up || typeof v.ortho !== 'boolean') return null
  if (typeof v.fov !== 'number' || !(v.fov >= 1 && v.fov <= 120)) return null
  if (typeof v.zoom !== 'number' || !Number.isFinite(v.zoom) || v.zoom <= 0) return null
  if (position.every((c, i) => c === target[i]) || up.every((c) => c === 0)) return null
  return { position, target, up, ortho: v.ortho, fov: v.fov, zoom: v.zoom }
}

const MAX_MM = 1e6
const vec3 = (t: unknown): [number, number, number] | null => (Array.isArray(t) && t.length === 3 && t.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= MAX_MM) ? [t[0], t[1], t[2]] : null)

/** What a stroke says as a vector (`StrokeVector`), as the window sends it and a note keeps it; null when it is not one. */
export function vectorOf(v: unknown): StrokeVector | null {
  if (!isRecord(v)) return null
  const from = vec3(v.from)
  const to = vec3(v.to)
  const direction = vec3(v.direction)
  if (!from || !to || !direction || typeof v.length !== 'number' || !Number.isFinite(v.length) || v.length < 0 || v.length > MAX_MM) return null
  if (v.head !== 'to' && v.head !== 'unknown') return null
  return { from, to, length: v.length, direction, head: v.head }
}

/** One stroke of what the window says is under the ink, within a picture of that size; null when it is not one. */
export function strokeOf(v: unknown, width: number, height: number): StrokeUnder | null {
  if (!isRecord(v) || !Array.isArray(v.box) || v.box.length !== 4 || !v.box.every((n) => typeof n === 'number' && Number.isFinite(n))) return null
  const [left, top, right, bottom] = v.box as number[]
  if (left < 0 || top < 0 || right > width || bottom > height || left > right || top > bottom) return null
  if (!Array.isArray(v.refs) || v.refs.length > MOST_REFS_TOLD || !Array.isArray(v.cuts) || v.cuts.length > MOST_CUTS_TOLD || !Array.isArray(v.scans) || v.scans.length > MOST_SCANS_TOLD || typeof v.bare !== 'boolean') return null
  if (v.moreRefs !== undefined && !isCount(v.moreRefs)) return null
  const refs: StrokeUnder['refs'] = []
  for (const one of v.refs) {
    if (!isRecord(one) || typeof one.ref !== 'string' || !FACE.test(one.ref)) return null
    const descriptor = typeof one.descriptor === 'string' ? folded(one.descriptor).slice(0, MAX_DESCRIPTOR) : ''
    refs.push(descriptor !== '' ? { ref: one.ref, descriptor } : { ref: one.ref })
  }
  const cuts = v.cuts
  if (!cuts.every((c): c is string => typeof c === 'string' && PART.test(c))) return null
  const scans = v.scans
  if (!scans.every((s): s is string => typeof s === 'string' && SCAN.test(s))) return null
  // Over something, and nothing of it named: no stroke the window would say.
  if (refs.length === 0 && cuts.length === 0 && scans.length === 0 && !v.bare) return null
  const vector = v.vector === undefined ? undefined : vectorOf(v.vector)
  if (vector === null) return null
  return { box: [left, top, right, bottom], refs, ...(v.moreRefs ? { moreRefs: v.moreRefs } : {}), cuts: [...cuts], scans: [...scans], bare: v.bare, ...(vector ? { vector } : {}) }
}

/** Where in the picture, as the agent reads it: `412–630`. */
const span = (from: number, to: number): string => `${Math.round(from)}–${Math.round(to)}`
export const counted = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/** What a stroke of ink, or the head of an arrow, lies over, in words: the faces with the kernel's line, the cut faces, the scans. */
export function overText(stroke: StrokeUnder): string {
  const faces = stroke.refs.map((r) => (r.descriptor ? `${r.ref} (${r.descriptor})` : r.ref))
  if (stroke.moreRefs) faces.push(`and ${counted(stroke.moreRefs, 'more face', 'more faces')}`)
  // A section's cut face is of its part, and no face of the model: it has no ref.
  faces.push(...stroke.cuts.map((part) => `the cut face of ${part}`))
  const scans = stroke.scans.length > 0 ? `scan ${stroke.scans.join(', ')}` : ''
  let over: string
  if (faces.length > 0) over = `${faces.join(', ')}${scans ? `; ${scans} where no part is` : ''}${stroke.bare ? '; partly over no part' : ''}`
  else if (scans) over = `over no part: ${scans}${stroke.bare ? ', and partly over nothing' : ''}`
  else over = 'over no part'
  return over
}

/** What one stroke lies over, as a line of the caption. */
export function strokeLine(stroke: StrokeUnder, n: number): string {
  const [left, top, right, bottom] = stroke.box
  return `- stroke ${n}, x ${span(left, right)}, y ${span(top, bottom)}: ${overText(stroke)}${stroke.vector ? `; ${vectorText(stroke.vector)}` : ''}`
}

const mm = (n: number): string => String(Math.round(n * 10) / 10 + 0)
const point = (p: readonly number[]): string => `(${p.map(mm).join(', ')})`

/** A stroke as a vector, in words: the ends in mm of the object frame on the surface, how long, which way, which end has the head. Read off the view's mesh: not exact. */
export function vectorText(v: StrokeVector): string {
  const way = v.head === 'to' ? 'an arrow, its head at the second end' : 'which end has a head is not clear'
  return `from ${point(v.from)} to ${point(v.to)} mm on the surface, ${mm(v.length)} mm long, direction ${point(v.direction.map((n) => Math.round(n * 100) / 100))} (${way}; read off the view's mesh, not exact)`
}
