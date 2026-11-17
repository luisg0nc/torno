import { count, number } from '../../shared/format'
import { type SketchMark, type SketchPlane, type SketchSnap, type SketchStroke, type SketchTake, sketchStrokePoints } from '../../shared/marks'
import { directionText, vector } from '../marks/describe'

// What Claude reads of a 3D sketch, in words: the one wording the prompt and the `marks` tool share. Text only: a sketch
// goes with no picture, and the 6-picture cap of a prompt is untouched by it. No line of it begins with a word the
// stand-in agent takes for a command (`test/fake-agent.mjs`), and every line is one line.

/** How many points a prompt tells of in all, before the rest is summarised. */
export const MOST_POINTS_TOLD = 2000

/** How to take a sketch, said once as an instruction. */
export const TAKE_SENTENCES: Record<SketchTake, string> = {
  exact: 'Take it exactly: follow these points to the millimetre.',
  rough: 'Take it roughly: the shape and the place matter, not the exact points.',
  flow: 'Take it as a route: follow its path loosely, and keep its diameter clear.'
}

export interface SketchTextOptions {
  /** The object's latest build, for the line that says the model was built again since. */
  revision?: number
  /** At most this many points are listed, whole strokes only; the rest is counted. Default `MOST_POINTS_TOLD`. */
  mostPoints?: number
  /** A tool of torno's as the client names it to its model; the tool's own name when none is given. */
  toolName?: (tool: string) => string
}

const PENS = { free: 'freehand', line: 'straight line', points: 'point to point' } as const

/** A coordinate to a tenth of a millimetre, and never `-0.0`: a free point is no finer than that. */
const tenth = (v: number): string => (Math.round(v * 10) / 10 + 0).toFixed(1)
/** A coordinate of a snapped point, in full to the thousandth. */
const full = (v: number): string => (Math.round(v * 1000) / 1000 + 0).toFixed(3)

/** How a plane was made, in words. */
function madeOf(plane: SketchPlane): string {
  const from = plane.from
  switch (from.kind) {
    case 'main':
      return `the main plane ${from.axis}, offset ${number(from.offset)} mm`
    case 'face':
      return `plane through ${from.ref} (face of build ${from.revision}), offset ${number(from.offset)} mm`
    case 'point':
      return `plane through the point ${vector(from.point)}, normal ${directionText(from.normal)}, offset ${number(from.offset)} mm`
    case 'view':
      return `the standard view ${from.label}`
  }
}

function planeLine(plane: SketchPlane): string {
  return `plane ${plane.id}: ${plane.label}; ${madeOf(plane)}; origin ${vector(plane.origin)}, u along ${directionText(plane.x)}, v along ${directionText(plane.y)}`
}

/** What a snapped point is, as main vouches for it. */
function snapText(snap: SketchSnap): string {
  const projected = snap.projected ? ', projected onto the plane' : ''
  if ('vertex' in snap) return `exact: vertex ${snap.vertex}${projected}`
  if ('centre' in snap) return `exact: centre of ${snap.centre} (r ${number(snap.radius)})${projected}`
  if (snap.approx) return `approximate: on edge ${snap.edge} (not a straight or circular edge, so only the edge is known)${projected}`
  return `exact: on edge ${snap.edge}${projected}`
}

const length = (points: ReadonlyArray<readonly number[]>): number => points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - points[i][0], p[1] - points[i][1], p[2] - points[i][2]), 0)

function strokeLines(mark: SketchMark, stroke: SketchStroke): string[] {
  const points = sketchStrokePoints(mark, stroke)
  const where = stroke.plane === undefined ? 'on the surface' : `on plane ${stroke.plane}${mark.planes.some((p) => p.id === stroke.plane) ? '' : ' (the sketch has none)'}`
  const touches = stroke.touches === undefined || stroke.touches.length === 0 ? 'touches nothing that was found' : `touches ${stroke.touches.join(', ')}`
  const lines = [`stroke ${stroke.id}: ${PENS[stroke.pen]} ${where}, ${number(length(points))} mm long, ${points.length} ${points.length === 1 ? 'point' : 'points'}, drawn on build ${stroke.revision}; ${touches} (of build ${stroke.revision})`]
  const snapped = new Map((stroke.snaps ?? []).map((snap) => [snap.i, snap]))
  points.forEach((point, i) => {
    const snap = snapped.get(i)
    lines.push(snap ? `  p${i} = (${point.map(full).join(', ')}) ${snapText(snap)}` : `  p${i} = (${point.map(tenth).join(', ')}) approximate`)
  })
  return lines
}

/** The strokes that are told whole within `most` points, and the rest. */
function split(mark: SketchMark, most: number): { told: SketchStroke[]; points: number; left: SketchStroke[] } {
  const told: SketchStroke[] = []
  let points = 0
  for (const stroke of mark.strokes) {
    const size = sketchStrokePoints(mark, stroke).length
    if (points + size > most) break
    told.push(stroke)
    points += size
  }
  return { told, points, left: mark.strokes.slice(told.length) }
}

/** How many points `sketchText` lists with these options: for a prompt that spends a budget of points over its sketches. */
export function pointsTold(mark: SketchMark, opts: SketchTextOptions): number {
  return split(mark, opts.mostPoints ?? MOST_POINTS_TOLD).points
}

/**
 * A sketch as the agent reads it, after the mark's line (`describeMark`): its planes with how each was made, its
 * strokes (the pen, the plane or the surface, the length, the faces it touches of the build it was drawn on, and its
 * points in the object frame: a snapped one in full with what it is, any other to a tenth of a millimetre and said to be
 * approximate), how to take it, and the camera it was drawn from with how to `look` from it. Strokes past
 * `mostPoints` points are counted, not listed.
 */
export function sketchText(mark: SketchMark, opts: SketchTextOptions): string {
  const toolName = opts.toolName ?? ((tool: string): string => tool)
  const { told, left } = split(mark, opts.mostPoints ?? MOST_POINTS_TOLD)
  const lines = [`Sketch ${mark.id} "${mark.name}": ${mark.author === 'agent' ? 'your own' : "the person's"} 3D drawing in layout ${mark.layout}, in mm in its object frame. This is text only: no picture goes with it.`]
  if (opts.revision !== undefined && opts.revision > mark.revision) lines.push(`The model has been built again since: r${opts.revision} is the latest, and the refs and faces here are of the builds named, which may name other geometry now.`)
  lines.push(`${TAKE_SENTENCES[mark.take]}${mark.diameter === undefined ? '' : ` Its diameter is ⌀${number(mark.diameter)} mm.`}`)
  if (mark.planes.length > 0) lines.push(`Planes (a point on one is its origin + u·(its u) + v·(its v)):`, ...mark.planes.map(planeLine))
  if (mark.strokes.length > 0) lines.push('Strokes (each by its id; every point is in the object frame; a point without a snap is approximate):')
  told.forEach((stroke) => lines.push(...strokeLines(mark, stroke)))
  if (left.length > 0) {
    const points = left.reduce((sum, stroke) => sum + sketchStrokePoints(mark, stroke).length, 0)
    lines.push(`… ${count(left.length)} more ${left.length === 1 ? 'stroke' : 'strokes'}, ${count(points)} ${points === 1 ? 'point' : 'points'}: read them with ${toolName('marks')} with ids ["${mark.id}"]`)
  }
  lines.push(`It was drawn from ${JSON.stringify(mark.camera)}: ${toolName('look')} with that as its view draws it again.`)
  return lines.join('\n')
}

/**
 * A sketch as data for the agent, beside its line: what the mark holds without its strokes (400 points each, and up to
 * 200 of them) and the name of its picture, with `strokeCount` and `text`, which says every stroke and point in words
 * (`sketchText`, with no cut: this is where the strokes a prompt left out are read).
 */
export function sketchData(mark: SketchMark, latestRevision: number | undefined): object {
  const { picture: _picture, strokes, ...rest } = mark
  return { ...rest, strokeCount: strokes.length, text: sketchText(mark, { mostPoints: Infinity, ...(latestRevision === undefined ? {} : { revision: latestRevision }) }) }
}
