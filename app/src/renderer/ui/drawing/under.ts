import { MOST_CUTS_TOLD, MOST_REFS_TOLD, MOST_SCANS_TOLD, MOST_STROKES_TOLD, type StrokeUnder } from '../../../shared/drawing'
import type { NoteLabel, Vec3 } from '../../../shared/marks'
import type { Stroke } from '../../state/onboard'

// What the person's ink lies over in a drawing on the view: points along each pen stroke where ink is still left,
// looked under in the view (the caller picks there), and said per stroke as faces, scans and what is over nothing.

/** Board pixels between two points looked under along a stroke, and the most points of one stroke looked under. */
export const SAMPLE_STEP = 6
export const MOST_SAMPLES = 48

/** What is under a point of the view: a face of a part, the cut face of a part (a section's), a scan where no part is, or nothing. */
/** A face carries where it was hit (the object frame), for the anchor of a note: only the first is ever kept. */
export type Under = { ref: string; point?: Vec3; normal?: Vec3 | null; part?: string } | { cut: string } | { scan: string } | null

/** Points `step` apart along a stroke, its first and last among them; at most `most`, spread evenly. */
export function samplesOf(points: ReadonlyArray<readonly [number, number]>, step = SAMPLE_STEP, most = MOST_SAMPLES): Array<[number, number]> {
  if (points.length === 0) return []
  const out: Array<[number, number]> = [[points[0][0], points[0][1]]]
  let carried = 0
  for (let i = 1; i < points.length; i += 1) {
    const [ax, ay] = points[i - 1]
    const [bx, by] = points[i]
    const length = Math.hypot(bx - ax, by - ay)
    let at = step - carried
    while (at <= length) {
      const t = at / length
      out.push([Math.round((ax + (bx - ax) * t) * 10) / 10, Math.round((ay + (by - ay) * t) * 10) / 10])
      at += step
    }
    carried = length - (at - step)
  }
  const last = points[points.length - 1]
  const end = out[out.length - 1]
  if (points.length > 1 && (end[0] !== last[0] || end[1] !== last[1])) out.push([last[0], last[1]])
  if (out.length <= most) return out
  return Array.from({ length: most }, (_, i) => out[Math.round((i * (out.length - 1)) / (most - 1))])
}

/** The box of a stroke, half its width round its points, within the picture, in whole pixels: left, top, right, bottom. */
export function boxOf(stroke: Stroke, size: { width: number; height: number }): [number, number, number, number] {
  const half = stroke.width / 2
  const xs = stroke.points.map((p) => p[0])
  const ys = stroke.points.map((p) => p[1])
  return [Math.max(0, Math.floor(Math.min(...xs) - half)), Math.max(0, Math.floor(Math.min(...ys) - half)), Math.min(size.width, Math.ceil(Math.max(...xs) + half)), Math.min(size.height, Math.ceil(Math.max(...ys) + half))]
}

/** What one stroke lies over, from what is under each of its points: faces and cut faces in the order first crossed, the scans, and whether any is over nothing. */
export function strokeUnder(box: [number, number, number, number], found: readonly Under[]): StrokeUnder {
  const faces: string[] = []
  const cuts: string[] = []
  const scans: string[] = []
  let bare = false
  const add = (list: string[], one: string): void => void (list.includes(one) || list.push(one))
  for (const one of found) {
    if (one === null) bare = true
    else if ('ref' in one) add(faces, one.ref)
    else if ('cut' in one) add(cuts, one.cut)
    else add(scans, one.scan)
  }
  const more = faces.length - MOST_REFS_TOLD
  return { box, refs: faces.slice(0, MOST_REFS_TOLD).map((ref) => ({ ref })), ...(more > 0 ? { moreRefs: more } : {}), cuts: cuts.slice(0, MOST_CUTS_TOLD), scans: scans.slice(0, MOST_SCANS_TOLD), bare }
}

/**
 * Stroke by stroke, what the ink lies over: pen strokes only, at their points where ink is still left (`inked`: what
 * the eraser took is not looked under); a stroke of which no ink is left is no stroke. At most `MOST_STROKES_TOLD`,
 * the rest counted; `kept` is every pen stroke with ink left, told or not. `look` is given points of the picture, in its pixels.
 */
export function underInk(
  strokes: readonly Stroke[],
  size: { width: number; height: number },
  inked: (x: number, y: number) => boolean,
  look: (points: Array<[number, number]>) => Under[]
): { under: StrokeUnder[]; more: number; kept: Stroke[] } {
  const under: StrokeUnder[] = []
  const kept: Stroke[] = []
  let more = 0
  for (const stroke of strokes) {
    if (stroke.tool !== 'pen') continue
    const points = samplesOf(stroke.points).filter(([x, y]) => inked(x, y))
    if (points.length === 0) continue
    kept.push(stroke)
    if (under.length >= MOST_STROKES_TOLD) {
      more += 1
      continue
    }
    under.push(strokeUnder(boxOf(stroke, size), look(points)))
  }
  return { under, more, kept }
}

/** How far round the head of an arrow its box reaches, in board pixels. */
export const HEAD_REACH = 6

/**
 * What the head of each arrow of a note's labels points at, one line for each label that has an arrow, in the order of
 * the labels (the order `under` of a note keeps them in, after its strokes): the point of the head is looked under,
 * and its box is a small one round it within the picture.
 */
export function underHeads(labels: readonly NoteLabel[], size: { width: number; height: number }, look: (points: Array<[number, number]>) => Under[]): StrokeUnder[] {
  const heads: StrokeUnder[] = []
  for (const { to } of labels) {
    if (!to) continue
    const box: [number, number, number, number] = [Math.max(0, Math.floor(to.x - HEAD_REACH)), Math.max(0, Math.floor(to.y - HEAD_REACH)), Math.min(size.width, Math.ceil(to.x + HEAD_REACH)), Math.min(size.height, Math.ceil(to.y + HEAD_REACH))]
    heads.push(strokeUnder(box, look([[to.x, to.y]])))
  }
  return heads
}
