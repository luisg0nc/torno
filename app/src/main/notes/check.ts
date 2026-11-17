import { MOST_STROKES_TOLD, type StrokeUnder } from '../../shared/drawing'
import type { NoteDraft, NoteEdit, NoteReferenceDraft } from '../../shared/bridge'
import { type Anchor, type NoteLabel, type NoteStroke, MAX_LABEL, MAX_REFERENCE_COMMENT, MAX_STROKE_POINTS, MOST_LABELS, MOST_NOTE_ERASES, MOST_NOTE_REFERENCES, MOST_NOTE_STROKES, penStrokes } from '../../shared/marks'
import { checkedImage } from '../images'
import { anchorOf, MAX_NOTE } from '../marks/file'
import { Refusal } from '../refusal'
import { INK, MAX_CAPTION, MAX_NAME, cameraOf, folded, isCount, isRecord, line, strokeOf } from '../sessions/drawing'

// What the window sends to make or edit a view note (`notes:make`, `notes:edit`), checked field by field: the same
// checks a drawing on the view gets (`sessions/drawing.ts`), and the caps of a note. What comes out holds only the
// fields a note's draft has: an id, an author, a status, anything only main says of a mark, and any file name, is not
// among them. Main names every file (`files.ts`).

const NOT = 'The note could not be kept'
/** The widest a stroke of ink is, in pixels of the picture. */
const MAX_WIDTH = 1000

type Stroke = NoteStroke
type Size = { w: number; h: number }

/** A Refusal that begins as every one of these does. */
const no = (why: string): Refusal => new Refusal(`${NOT}: ${why}`)

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
/** A point within a picture of that size. */
const within = (x: unknown, y: unknown, size: Size): x is number => finite(x) && finite(y) && x >= 0 && x <= size.w && y >= 0 && y <= size.h

/** The stroke of ink as the window drew it, within a picture of that size, cut to the points a stroke keeps. */
function strokeAt(v: unknown, size: Size): Stroke | null {
  if (!isRecord(v) || !finite(v.width) || !(v.width > 0) || v.width > MAX_WIDTH || !Array.isArray(v.points) || v.points.length === 0) return null
  const points: Array<[number, number]> = []
  for (const p of v.points.slice(0, MAX_STROKE_POINTS)) {
    if (!Array.isArray(p) || p.length !== 2 || !within(p[0], p[1], size)) return null
    points.push([p[0], p[1]])
  }
  // Only `true` is an eraser stroke; any other `erase` is a pen's.
  return v.erase === true ? { width: v.width, points, erase: true } : { width: v.width, points }
}

function checkedStrokes(v: unknown, size: Size): Stroke[] | Refusal {
  if (!Array.isArray(v)) return no('its strokes are not a list')
  if (v.length > MOST_NOTE_STROKES + MOST_NOTE_ERASES) return no(`it has more than ${MOST_NOTE_STROKES} strokes`)
  const strokes: Stroke[] = []
  for (const one of v) {
    const stroke = strokeAt(one, size)
    if (!stroke) return no('a stroke is not one within the picture')
    strokes.push(stroke)
  }
  // The pen strokes and the eraser strokes are held to their caps apart: rubbing out is not a reason to lose a note.
  if (penStrokes(strokes).length > MOST_NOTE_STROKES) return no(`it has more than ${MOST_NOTE_STROKES} strokes`)
  if (strokes.length - penStrokes(strokes).length > MOST_NOTE_ERASES) return no(`it has more than ${MOST_NOTE_ERASES} eraser strokes`)
  return strokes
}

function labelAt(v: unknown, size: Size): NoteLabel | null {
  if (!isRecord(v) || !within(v.x, v.y, size)) return null
  const text = line(v.text, MAX_LABEL)
  if (text === null) return null
  if (v.to === undefined) return { x: v.x as number, y: v.y as number, text }
  if (!isRecord(v.to) || !within(v.to.x, v.to.y, size)) return null
  return { x: v.x as number, y: v.y as number, text, to: { x: v.to.x as number, y: v.to.y as number } }
}

function checkedLabels(v: unknown, size: Size): NoteLabel[] | Refusal {
  if (!Array.isArray(v)) return no('its labels are not a list')
  if (v.length > MOST_LABELS) return no(`it has more than ${MOST_LABELS} labels`)
  const labels: NoteLabel[] = []
  for (const one of v) {
    const label = labelAt(one, size)
    if (!label) return no(`a label is not one: a point in the picture and a line of at most ${MAX_LABEL} characters`)
    labels.push(label)
  }
  return labels
}

/**
 * What the ink lies over: a line for each stroke told of (at most `MOST_STROKES_TOLD`, the rest are counted, as for a
 * drawing), then one for each label with an arrow. Each line is held to what a drawing's is.
 */
function checkedUnder(v: unknown, size: Size, strokes: number, arrows: number): StrokeUnder[] | Refusal {
  const wrong = no('what its ink lies over is not said as it should be')
  if (!Array.isArray(v) || v.length > Math.min(strokes, MOST_STROKES_TOLD) + arrows) return wrong
  const under: StrokeUnder[] = []
  for (const one of v) {
    const stroke = strokeOf(one, size.w, size.h)
    if (!stroke) return wrong
    under.push(stroke)
  }
  return under
}

/** A reference picture the person gave: a PNG or JPEG of at most 2000 px and 3.75 MB, as its header says, and a line of at most 300 characters. */
function checkedReference(v: unknown): NoteReferenceDraft | Refusal {
  if (!isRecord(v)) return no('a reference is not one')
  const image = checkedImage(v.bytes)
  if (!image || image.mediaType !== v.mediaType) return no('a reference picture is not a PNG or JPEG of at most 2000 px and 3.75 MB')
  if (typeof v.comment !== 'string') return no(`the comment on a reference is not text`)
  const comment = folded(v.comment)
  if (comment.length > MAX_REFERENCE_COMMENT) return no(`the comment on a reference is longer than ${MAX_REFERENCE_COMMENT} characters`)
  return { bytes: image.bytes, mediaType: image.mediaType, comment }
}

function checkedReferences(v: unknown, most = MOST_NOTE_REFERENCES): NoteReferenceDraft[] | Refusal {
  if (!Array.isArray(v)) return no('its references are not a list')
  if (v.length > most) return no(`it has more than ${most} references`)
  const references: NoteReferenceDraft[] = []
  for (const one of v) {
    const reference = checkedReference(one)
    if (reference instanceof Refusal) return reference
    references.push(reference)
  }
  return references
}

/** The comment of a note: text of at most as many characters as a mark keeps. */
function checkedComment(v: unknown): string | Refusal {
  return typeof v === 'string' && v.length <= MAX_NOTE ? v : no(`its comment is not text of at most ${MAX_NOTE} characters`)
}

/** A PNG of the size, as its header says; the reason when it is not. */
function checkedPng(v: unknown, which: string, size: Size): Uint8Array | Refusal {
  const image = checkedImage(v)
  if (!image || image.mediaType !== 'image/png') return no(`its ${which} picture is not a PNG of at most 2000 px and 3.75 MB`)
  if (image.width !== size.w || image.height !== size.h) return no(`its ${which} picture is not of the size it says`)
  return image.bytes
}

const sizeOf = (v: unknown): Size | null => (isRecord(v) && isCount(v.w) && isCount(v.h) && v.w > 0 && v.h > 0 && v.w <= 2000 && v.h <= 2000 ? { w: v.w, h: v.h } : null)

/**
 * The note the window sent, checked: every field what it says it is, the pictures PNGs of the size it says (and
 * references of at most 2000 px), the strokes, labels and what the ink lies over within that picture and the caps of a
 * note. A `Refusal` says why not, and then nothing is written. Fields it does not have, and any it does that only
 * main says, are dropped.
 */
export function checkNoteDraft(raw: unknown): NoteDraft | Refusal {
  if (!isRecord(raw)) return no('it is not one')
  const objectId = line(raw.objectId, MAX_NAME)
  const layout = line(raw.layout, MAX_NAME)
  const caption = line(raw.caption, MAX_CAPTION)
  if (objectId === null || layout === null || caption === null) return no('it does not say what it is of')
  if (typeof raw.revision !== 'number' || !Number.isInteger(raw.revision) || raw.revision < 1) return no('it names no build')
  const camera = cameraOf(raw.camera)
  if (!camera) return no('its camera is not one')
  const size = sizeOf(raw.size)
  if (!size) return no('its size is not one of a picture of at most 2000 px')
  const plain = checkedPng(raw.plain, 'plain', size)
  if (plain instanceof Refusal) return plain
  const inked = checkedPng(raw.inked, 'inked', size)
  if (inked instanceof Refusal) return inked
  if (typeof raw.inkColour !== 'string' || !INK.test(raw.inkColour)) return no('its ink is not a colour')
  const strokes = checkedStrokes(raw.strokes, size)
  if (strokes instanceof Refusal) return strokes
  const labels = checkedLabels(raw.labels, size)
  if (labels instanceof Refusal) return labels
  const under = checkedUnder(raw.under, size, penStrokes(strokes).length, labels.filter((l) => l.to !== undefined).length)
  if (under instanceof Refusal) return under
  const comment = checkedComment(raw.comment)
  if (comment instanceof Refusal) return comment
  const references = checkedReferences(raw.references)
  if (references instanceof Refusal) return references
  let anchor: Anchor | undefined
  if (raw.anchor !== undefined) {
    const given = anchorOf(raw.anchor)
    if (!given) return no('its anchor is not one')
    // What main alone says of an anchor (its tag) is said again after, from the build.
    const { tag: _tag, ...rest } = given
    anchor = rest
  }
  return { objectId, revision: raw.revision, layout, camera, caption, size, plain, inked, inkColour: raw.inkColour, strokes, labels, under, comment, references, ...(anchor ? { anchor } : {}) }
}

/**
 * What the window changed of a note whose picture is of `size`, checked as a draft is. Only what it says is kept: a
 * change of strokes or labels brings the picture with the new ink on it, and `keepReferences` is the indexes of the
 * references that stay, each once, in order.
 */
export function checkNoteEdit(raw: unknown, size: Size): NoteEdit | Refusal {
  if (!isRecord(raw)) return no('it is not one')
  const edit: NoteEdit = {}
  if (raw.comment !== undefined) {
    const comment = checkedComment(raw.comment)
    if (comment instanceof Refusal) return comment
    edit.comment = comment
  }
  let strokes: Stroke[] | undefined
  if (raw.strokes !== undefined) {
    const checked = checkedStrokes(raw.strokes, size)
    if (checked instanceof Refusal) return checked
    strokes = edit.strokes = checked
  }
  let labels: NoteLabel[] | undefined
  if (raw.labels !== undefined) {
    const checked = checkedLabels(raw.labels, size)
    if (checked instanceof Refusal) return checked
    labels = edit.labels = checked
  }
  if (strokes !== undefined || labels !== undefined) {
    const inked = checkedPng(raw.inked, 'inked', size)
    if (inked instanceof Refusal) return inked
    edit.inked = inked
  } else if (raw.inked !== undefined) {
    return no('a picture with new ink came with no new strokes or labels')
  }
  if (raw.under !== undefined) {
    // The lines of the ink told of: up to what the strokes and the labels with an arrow of the note may have (the ones the edit leaves are not known here).
    const wrong = no('what its ink lies over is not said as it should be')
    if (!Array.isArray(raw.under) || raw.under.length > MOST_STROKES_TOLD + MOST_LABELS) return wrong
    const checked = checkedUnder(raw.under, size, strokes ? penStrokes(strokes).length : MOST_NOTE_STROKES, labels === undefined ? MOST_LABELS : labels.filter((l) => l.to !== undefined).length)
    if (checked instanceof Refusal) return checked
    edit.under = checked
  }
  if (raw.keepReferences !== undefined) {
    const keep = raw.keepReferences
    if (!Array.isArray(keep) || keep.length > MOST_NOTE_REFERENCES || !keep.every(isCount) || new Set(keep).size !== keep.length) return no('the references to keep are not indexes of the references of the note, each once')
    edit.keepReferences = [...(keep as number[])].sort((a, b) => a - b)
  }
  if (raw.addReferences !== undefined) {
    const added = checkedReferences(raw.addReferences)
    if (added instanceof Refusal) return added
    edit.addReferences = added
  }
  return edit
}
