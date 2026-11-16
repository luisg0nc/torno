import type { StrokeUnder } from '../../../shared/drawing'
import type { NoteDraft } from '../../../shared/bridge'
import { picture } from '../../state/agent'
import { describe } from '../../state/descriptors'
import { type Pictured, drawingActions, drawingStore, viewHost } from '../../state/drawing'
import type { Stroke } from '../../state/onboard'
import { store } from '../../state/store'
import { drawingPng } from './compose'
import { underInk } from './under'

/** The long edge of the picture drawn on: the agent's picture at its default. */
const DRAWING_SIZE = 1280
/** How long the kernel's lines for the faces under the ink are waited for. */
const DESCRIBE_MS = 3000
const ELSEWHERE = 'The view shows another project than this chat is of'

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

const within = (n: number, most: number): number => Math.min(Math.max(n, 0), most)

/**
 * "Done" on the board over the view: the picture with the ink is made and, while the screen is what the picture was
 * made of, what the ink lies over; they are kept as a view note, a draft that goes with the session's next prompt
 * (`notes.make`: main checks it, names its pictures and writes them). Rejects with why not, leaving the board open.
 */
export async function finishDrawing(strokes: Stroke[]): Promise<void> {
  const board = drawingStore.getState().board
  if (!board) return
  const p = board.picture
  const size = { width: p.width, height: p.height }
  const { png, inked } = await drawingPng(p.bitmap, size, strokes, { ink: p.ink, casing: p.casing })
  let under: StrokeUnder[] = []
  const host = viewHost()
  const looked = host && p.shows !== null && host.shows() === p.shows
  // Where the view is still what the picture was made of, what the ink lies over; else the ink is kept and that is said (an empty list).
  const found = underInk(strokes, size, inked, looked ? (points) => host.under(points.map(([x, y]) => [x / p.width, y / p.height] as const)) : () => [])
  if (looked) {
    const lines = await described(p, [...new Set(found.under.flatMap((s) => s.refs.map((r) => r.ref)))])
    under = found.under.map((s) => ({ ...s, refs: s.refs.map((r) => (lines.has(r.ref) ? { ref: r.ref, descriptor: lines.get(r.ref)! } : r)) }))
  }
  if (found.kept.length === 0) throw new Error('Draw something first, or cancel')
  const draft: NoteDraft = {
    objectId: p.objectId, revision: p.revision, layout: p.layout, camera: p.camera, caption: p.caption, size: { w: p.width, h: p.height },
    plain: p.plain, inked: png, inkColour: p.ink,
    strokes: found.kept.map((s) => ({ width: s.width, points: s.points.map(([x, y]) => [within(x, p.width), within(y, p.height)] as [number, number]) })),
    labels: [], under, comment: '', references: []
  }
  await window.torno.notes.make(draft)
  drawingActions.cancel()
}
