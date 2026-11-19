import { type NoteMark, type Vec3, penStrokes } from './marks'

// What the ink of a drawing on the view lies over (the chat's "Draw on view" makes a view note of it): per stroke, as the
// window works it out and main checks it (`main/sessions/drawing.ts`, `main/notes/check.ts`), and as the person is
// shown it (`DrawnOver`).

/** The most strokes the agent is told of, the most faces of one and the most scans of one; the rest are counted. */
export const MOST_STROKES_TOLD = 16
export const MOST_REFS_TOLD = 6
export const MOST_SCANS_TOLD = 4
/** The most parts whose cut face (a section's) one stroke is told to lie over. */
export const MOST_CUTS_TOLD = 4

/**
 * A stroke as a vector, where both its ends lie over a face: the two points of the surface under them (the object
 * frame, mm), read off the mesh the view draws, so they are close and not exact; the straight distance between them
 * and the way it points (a unit vector). `head` is `to` when the stroke turns back on itself at its last end (an arrow's
 * head), and `unknown` when it does not, the ends then being as drawn.
 */
export interface StrokeVector {
  from: Vec3
  to: Vec3
  length: number
  direction: Vec3
  head: 'to' | 'unknown'
}

/** What one stroke of ink lies over in the picture, where ink is still left of it. */
export interface StrokeUnder {
  /** Its box in pixels of the picture: left, top, right, bottom. */
  box: [number, number, number, number]
  /** The faces under it (`lid/F12`), in the order the stroke first crosses them, each with the kernel's line when it came. */
  refs: Array<{ ref: string; descriptor?: string }>
  /** How many more faces it crosses than `refs` holds. */
  moreRefs?: number
  /** The parts whose cut face, where a section cuts them, is under it (`lid`), in the order first crossed. */
  cuts: string[]
  /** The scans under it where no part is (`S1`). */
  scans: string[]
  /** Some of it lies over no part (nor a scan). */
  bare: boolean
  /** The stroke as a vector, when both its ends lie over a face. */
  vector?: StrokeVector
}

/** The most faces the line a drawing is shown by lists; the rest are counted. */
export const MOST_FACES_LISTED = 8

/**
 * What a drawing's ink lies over, as the person is shown it before the note goes and under it once it has: refs and
 * counts, no kernel line and no pixel. The chat keeps it on the prompt's item (text, so the log may hold it); the
 * pictures are never kept there.
 */
export interface DrawnOver {
  /** The view note the drawing is of (`M5`), when it is one. */
  note?: string
  /** The build the drawing was made on: the faces are of it. */
  revision: number
  /** The object's latest build when the prompt went, when it was another than `revision`. */
  latest?: number
  /** Null when the view moved while it was drawn and it could not be said. */
  over: {
    /** The faces, once each, in the order the strokes first cross them (`lid/F12`). */
    faces: string[]
    moreFaces?: number
    /** The parts whose cut face, where a section cuts them, is under the ink. */
    cuts: string[]
    scans: string[]
    /** The strokes, by number from 1, that lie over no part and no scan. */
    bare: number[]
    /** The strokes, by number from 1, that lie over a part (or a cut face, or a scan) and partly over none: the ring that half misses a wall. */
    partly: number[]
    /** How many strokes have ink left. */
    strokes: number
    moreStrokes?: number
  } | null
}

const once = (all: string[]): string[] => [...new Set(all)]
/** Whether a stroke lies over something the line names: a face, a cut face or a scan. */
const named = (s: StrokeUnder): boolean => s.refs.length > 0 || s.cuts.length > 0 || s.scans.length > 0

/** What the ink of a drawing lies over, as `DrawnOver`; `latest` is the object's last build now. */
export function drawnOver(d: { revision: number; under: StrokeUnder[] | null; moreStrokes?: number }, latest?: number): DrawnOver {
  const stamp = latest !== undefined && latest !== d.revision ? { latest } : {}
  if (d.under === null) return { revision: d.revision, ...stamp, over: null }
  const all = once(d.under.flatMap((s) => s.refs.map((r) => r.ref)))
  const unlisted = all.length - MOST_FACES_LISTED
  const moreFaces = Math.max(0, unlisted) + d.under.reduce((n, s) => n + (s.moreRefs ?? 0), 0)
  return {
    revision: d.revision,
    ...stamp,
    over: {
      faces: all.slice(0, MOST_FACES_LISTED),
      ...(moreFaces > 0 ? { moreFaces } : {}),
      cuts: once(d.under.flatMap((s) => s.cuts)),
      scans: once(d.under.flatMap((s) => s.scans)),
      bare: d.under.flatMap((s, i) => (named(s) ? [] : [i + 1])),
      partly: d.under.flatMap((s, i) => (named(s) && s.bare ? [i + 1] : [])),
      strokes: d.under.length,
      ...(d.moreStrokes ? { moreStrokes: d.moreStrokes } : {})
    }
  }
}

/**
 * What the ink of a note lies over, as the prompt's item shows it: refs and counts only, no kernel line, no box, no
 * camera. What a label's arrow points at is not a stroke and is left out here (the words say it).
 */
export function noteDrawnOver(note: Pick<NoteMark, 'id' | 'revision' | 'strokes' | 'under'>, latest?: number): DrawnOver {
  // Only the pen strokes are told of: an eraser stroke lies over nothing.
  const pens = penStrokes(note.strokes).length
  const told = Math.min(pens, MOST_STROKES_TOLD)
  // Ink that was not looked under (the view moved while it was drawn) is no `over`; no ink is no strokes.
  const under = pens > 0 && note.under.length === 0 ? null : note.under.slice(0, told)
  const more = pens - told
  return { note: note.id, ...drawnOver({ revision: note.revision, under, ...(more > 0 ? { moreStrokes: more } : {}) }, latest) }
}
