import type { StrokeUnder } from '../../../shared/drawing'
import type { NoteDraft, NoteEdit } from '../../../shared/bridge'
import type { Anchor, NoteLabel, NoteMark, NoteStroke } from '../../../shared/marks'
import { picture } from '../../state/agent'
import { describe } from '../../state/descriptors'
import { type Pictured, drawingActions, drawingStore, viewHost } from '../../state/drawing'
import type { Stroke } from '../../state/onboard'
import { store } from '../../state/store'
import { drawingPng } from './compose'
import { changeOf, itsUnder } from './change'
import { cleanLabels } from './labelbox'
import { type RefItem, MAX_NOTE_COMMENT, oneLine, referenceDrafts } from './referenceImages'
import { type Under, underHeads, underInk } from './under'

/** The long edge of the picture drawn on: the agent's picture at its default. */
const DRAWING_SIZE = 1280
/** How long the kernel's lines for the faces under the ink are waited for. */
const DESCRIBE_MS = 3000
const ELSEWHERE = 'The view shows another project than this chat is of'
const NOT_THERE = 'The project this note is of is not the one open'

const token = (name: string, fallback: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback

/**
 * Opens the board over the picture the agent's `look` makes of the view as it is now, for a chat of the object
 * open. Rejects with why there is none (no build, no 3D view, another object), opening nothing.
 */
export async function openDrawing(sessionId: string): Promise<void> {
  const s = drawingStore.getState()
  if (s.board || s.opening) return
  const { objectId, sessions } = store.getState()
  if (objectId === null || sessions[objectId]?.sessionId !== sessionId) throw new Error(ELSEWHERE)
  drawingActions.opening(sessionId)
  try {
    const host = viewHost()
    if (!host) throw new Error('the torno window has no 3D view to draw it with')
    const before = host.shows()
    const look = await picture({ view: 'current', size: DRAWING_SIZE })
    const after = host.shows()
    if (look.objectId !== objectId || store.getState().objectId !== objectId) throw new Error(ELSEWHERE)
    const blob = new Blob([look.png as BlobPart], { type: 'image/png' })
    const bitmap = await createImageBitmap(blob)
    const pictured: Pictured = {
      url: URL.createObjectURL(blob), plain: look.png, bitmap, width: look.width, height: look.height,
      objectId, revision: look.revision, layout: look.layout ?? store.getState().layout, caption: look.caption, camera: host.camera(),
      ink: token('--drawing-ink', '#B5127A'), casing: token('--panel', '#FAF9F6'),
      // The camera may have been on its way somewhere: then no point of the picture is known to be over what it shows.
      shows: before === after ? after : null
    }
    drawingActions.openOn(sessionId, pictured)
  } finally {
    drawingActions.opening(null)
  }
}

/** The kernel's line for each face, those that come within `DESCRIBE_MS`. */
async function described(p: Pictured, refs: string[]): Promise<Map<string, string>> {
  const lines = new Map<string, string>()
  const asked = Promise.all(refs.map(async (ref) => {
    const line = await describe(p.objectId, p.revision, p.layout, ref)
    if (line) lines.set(ref, line)
  }))
  await Promise.race([asked, new Promise((resolve) => setTimeout(resolve, DESCRIBE_MS))])
  return new Map(lines)
}

/** Decodes a picture and lets the board hold it: an object URL for the ground and the decoded bitmap, with what it is of. */
async function pictured(bytes: Uint8Array, of: Omit<Pictured, 'url' | 'plain' | 'bitmap' | 'width' | 'height'>): Promise<Pictured> {
  const blob = new Blob([bytes as BlobPart], { type: 'image/png' })
  const bitmap = await createImageBitmap(blob)
  return { ...of, url: URL.createObjectURL(blob), plain: bytes, bitmap, width: bitmap.width, height: bitmap.height }
}

/**
 * Opens the sheet over a note of the project to change it, on the plain picture it was made on (`notes.picture`).
 * A note whose plain picture is not on this computer opens with no picture: only its comment and references can be
 * changed. Rejects with why not (no such note, another project open), opening nothing.
 */
export async function openNote(objectId: string, markId: string): Promise<void> {
  const s = drawingStore.getState()
  if (s.board || s.opening) return
  const now = store.getState()
  if (now.objectId !== objectId) throw new Error(NOT_THERE)
  const note = now.marks.find((m): m is NoteMark => m.kind === 'note' && m.id === markId)
  if (!note) throw new Error(`There is no view note ${markId} in this project`)
  const sessionId = now.sessions[objectId]?.sessionId ?? ''
  drawingActions.opening(sessionId)
  try {
    const bytes = await window.torno.notes.picture(objectId, markId, 'plain').catch(() => null)
    if (store.getState().objectId !== objectId) throw new Error(NOT_THERE)
    const picture = bytes
      ? await pictured(bytes, {
          objectId, revision: note.revision, layout: note.layout, caption: '', camera: note.camera, ink: note.inkColour, casing: token('--panel', '#FAF9F6'),
          // What the screen shows is not what the picture was made of: what a new stroke lies over is not worked out again.
          shows: null
        }).catch(() => null)
      : null
    drawingActions.openNoteOn(sessionId, objectId, note, picture)
  } finally {
    drawingActions.opening(null)
  }
}

const within = (n: number, most: number): number => Math.min(Math.max(n, 0), most)

/** What the sheet of a note holds besides the ink: its labels, its comment and its references. */
export interface NoteForm {
  labels: NoteLabel[]
  comment: string
  references: RefItem[]
  /** The face of the window's text, which the labels are set in. */
  family: string
}

/** Whether the screen is still what the picture was made of, so that what the ink lies over can be worked out. */
export function worksOut(p: Pictured): boolean {
  const host = viewHost()
  return host !== null && p.shows !== null && host.shows() === p.shows
}

/** The anchor of a note: the first face under its ink, where it was hit, with the kernel's line when it came. */
function anchorOf(hit: Extract<Under, { ref: string }> | null, lines: Map<string, string>): Anchor | undefined {
  if (!hit?.point || !hit.part) return undefined
  const descriptor = lines.get(hit.ref)
  return { point: hit.point, ...(hit.normal ? { normal: hit.normal } : {}), part: hit.part, ref: hit.ref, ...(descriptor ? { descriptor } : {}) }
}

/**
 * "Done" on the sheet over a picture of the view: the picture with the ink, the labels and their arrows is made and,
 * while the screen is what the picture was made of, what the ink and the head of each arrow lie over; they are kept
 * as a view note, a draft that goes with the session's next prompt (`notes.make`: main checks it, names its pictures
 * and writes them). Over a note being edited, what changed is sent (`notes.edit`), the picture with the ink only when
 * the strokes or the labels changed. Rejects with why not, leaving the sheet open.
 */
export async function finishDrawing(strokes: Stroke[], form: NoteForm): Promise<void> {
  const board = drawingStore.getState().board
  const p = board?.picture
  if (!board || !p) return
  const size = { width: p.width, height: p.height }
  const labels = cleanLabels(form.labels, size)
  const comment = oneLine(form.comment)
  if (comment.length > MAX_NOTE_COMMENT) throw new Error(`The comment is at most ${MAX_NOTE_COMMENT} characters`)
  const look = { ink: p.ink, casing: p.casing }
  const { png, inked } = await drawingPng(p.bitmap, size, strokes, look, labels, form.family)
  const host = viewHost()
  // Where the view is still what the picture was made of, what the ink lies over; else the ink is kept and that is said (an empty list).
  const looked = board.note === null && host !== null && worksOut(p)
  let first: Extract<Under, { ref: string }> | null = null
  const lookUnder = looked
    ? (points: Array<[number, number]>): Under[] => {
        const found = host.under(points.map(([x, y]) => [x / p.width, y / p.height] as const))
        first ??= found.find((u): u is Extract<Under, { ref: string }> => u !== null && 'ref' in u && u.point !== undefined) ?? null
        return found
      }
    : () => []
  const found = underInk(strokes, size, inked, lookUnder)
  const heads = underHeads(labels, size, lookUnder)
  const kept: NoteStroke[] = found.kept.map((s) => ({ width: s.width, points: s.points.map(([x, y]) => [within(x, p.width), within(y, p.height)] as [number, number]), ...(s.tool === 'eraser' ? { erase: true as const } : {}) }))

  if (board.note) return editNote(board.note, board.objectId, { strokes: kept, labels, comment, references: form.references }, png)

  let under: StrokeUnder[] = []
  let lines = new Map<string, string>()
  if (looked) {
    lines = await described(p, [...new Set([...found.under, ...heads].flatMap((s) => s.refs.map((r) => r.ref)))])
    under = [...found.under, ...heads].map((s) => ({ ...s, refs: s.refs.map((r) => (lines.has(r.ref) ? { ref: r.ref, descriptor: lines.get(r.ref)! } : r)) }))
  }
  const references = referenceDrafts(form.references)
  if (kept.length === 0 && labels.length === 0 && comment === '' && references.length === 0) throw new Error('Draw or write something first, or cancel')
  const anchor = anchorOf(first, lines)
  const draft: NoteDraft = {
    objectId: p.objectId, revision: p.revision, layout: p.layout, camera: p.camera, caption: p.caption, size: { w: p.width, h: p.height },
    plain: p.plain, inked: png, inkColour: p.ink, strokes: kept, labels, under, comment, references, ...(anchor ? { anchor } : {})
  }
  await window.torno.notes.make(draft)
  drawingActions.cancel()
}

/** What a note being edited is sent as: only what changed, the picture with the ink only when the ink did. Nothing changed: nothing is sent. */
async function editNote(note: NoteMark, objectId: string, now: Parameters<typeof changeOf>[1], png: Uint8Array): Promise<void> {
  const change = changeOf(note, now)
  if (store.getState().objectId !== objectId) throw new Error(NOT_THERE)
  if (change.any) {
    const edit: NoteEdit = { ...(change.comment !== undefined ? { comment: change.comment } : {}), ...change.refs }
    if (change.ink) Object.assign(edit, { strokes: now.strokes, labels: now.labels, under: itsUnder(note, now), inked: png })
    await window.torno.notes.edit(objectId, note.id, edit)
  }
  drawingActions.cancel()
}

/**
 * "Done" on the sheet of a note with no picture (its plain picture is not on this computer): only the comment and the
 * references can be changed, and they are sent as such. Rejects with why not, leaving the sheet open.
 */
export async function finishNoteText(form: Pick<NoteForm, 'comment' | 'references'>): Promise<void> {
  const board = drawingStore.getState().board
  if (!board?.note) return
  const note = board.note
  const comment = oneLine(form.comment)
  if (comment.length > MAX_NOTE_COMMENT) throw new Error(`The comment is at most ${MAX_NOTE_COMMENT} characters`)
  await editNote(note, board.objectId, { strokes: note.strokes, labels: note.labels, comment, references: form.references }, new Uint8Array())
}
