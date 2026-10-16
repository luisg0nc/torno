import { number } from './format'
import type { Vec3 } from './marks'
import type { Camera } from './view'

// Explode: the parts of one layout drawn apart, for display only. Nothing here is geometry: a part is where the
// build placed it, and what is worked out below is only how far from there the viewport draws it. No position,
// ref or number that is kept or told is ever of a part as it is drawn apart.

/** How the parts of one layout are drawn apart. View state: never geometry. */
export interface ExplodeState {
  /** 0 (as assembled) to 1. */
  amount: number
  /** Times the layout's own reach, 0.25 to 4. 1 when left out of a file. */
  scale: number
  /** Away from the centre of the layout's box, or apart along an axis of the object frame. */
  axis: 'centre' | 'x' | 'y' | 'z'
}
export const NO_EXPLODE: ExplodeState = { amount: 0, scale: 1, axis: 'centre' }
export const MIN_EXPLODE_SCALE = 0.25
export const MAX_EXPLODE_SCALE = 4
/** Said with every picture and caption that draws parts apart. */
export const EXPLODED_NOTE = 'the parts are drawn apart for display: every position, ref and number told is of the parts as assembled'
/** Said at the pointer by every tool but Select while the layout shown is exploded. */
// The key is written out, and `keys.test.ts` holds it to the table: the exported page's viewer is bundled with this file, and is not to carry the table of torno's keys.
export const EXPLODED_TOOLS = 'The parts are drawn apart: put them together (E, or the slider at 0) to mark, measure or cut'
/** Said to the person who asks for the parts apart while they are cut: a section is never drawn exploded. */
export const SECTION_FIRST = 'Take the section away to draw the parts apart'
/** Said to the agent that asks for both: a section is never drawn exploded. */
export const NOT_EXPLODED_AND_CUT = 'a section is not drawn exploded: give explode or section, not both (explode: null draws the parts together, section: null draws them whole)'
/** Said after the scans of a caption that draws parts apart: a scan is never moved, so it is no longer where the parts are drawn. */
export const SCANS_STAY = 'scans are where they are'
/** Said in the window of parts that do not move from the centre, because they share it. */
export const SHARED_CENTRE = 'These parts share a centre: choose an axis'
/** A part whose centre is nearer the layout's than this, in millimetres, shares it: it does not move from the centre. */
export const SHARED_CENTRE_MM = 0.01
const AXES = ['x', 'y', 'z'] as const

/** Whether anything is drawn apart. */
export function isExploded(explode: ExplodeState | null | undefined): explode is ExplodeState {
  return explode !== null && explode !== undefined && explode.amount > 0
}

/** An explode out of whatever was given (a file, a request): `amount` clamped to 0..1, `scale` to its range (1 for none), `axis` one of the four (`centre` for none). Null for what is no object or has no finite amount. */
export function explodeOf(value: unknown): ExplodeState | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const said = value as { amount?: unknown; scale?: unknown; axis?: unknown }
  if (typeof said.amount !== 'number' || !Number.isFinite(said.amount)) return null
  const scale = typeof said.scale === 'number' && Number.isFinite(said.scale) ? said.scale : 1
  const axis = said.axis === 'x' || said.axis === 'y' || said.axis === 'z' ? said.axis : 'centre'
  return { amount: Math.min(Math.max(said.amount, 0), 1), scale: Math.min(Math.max(scale, MIN_EXPLODE_SCALE), MAX_EXPLODE_SCALE), axis }
}

/** What the agent may give: a number is the amount. */
export function explodeArg(value: unknown): ExplodeState | null {
  return typeof value === 'number' ? explodeOf({ amount: value }) : explodeOf(value)
}

/** A part as explode takes it: its name, its box, and the group of parts it is in (`Part.group`), if any. */
export interface ExplodePart { name: string; bbox: { min: Vec3; max: Vec3 }; group?: string }

/**
 * The bodies an explode moves: a group of parts is one, its box the box round its parts' boxes; a part in no group
 * is one of its own. By a key no part's name can be, in the order they first come.
 */
function bodiesOf(parts: readonly ExplodePart[]): { bodies: ExplodePart[]; of: string[] } {
  const bodies = new Map<string, ExplodePart>()
  const of = parts.map((part) => {
    const key = part.group === undefined ? `\u0000part ${part.name}` : `\u0000group ${part.group}`
    const had = bodies.get(key)
    if (!had) bodies.set(key, { name: key, bbox: { min: [...part.bbox.min], max: [...part.bbox.max] } })
    else for (let i = 0; i < 3; i++) {
      had.bbox.min[i] = Math.min(had.bbox.min[i], part.bbox.min[i])
      had.bbox.max[i] = Math.max(had.bbox.max[i], part.bbox.max[i])
    }
    return key
  })
  return { bodies: [...bodies.values()], of }
}

/**
 * By part name, how far each part of a layout is drawn from where it is. Empty when nothing is exploded or the
 * layout has fewer than two parts, or all its parts share a centre they would go from. Never a part of another
 * layout: give it the parts of one.
 *
 * From the centre, a part goes along the line from the centre of the layout's box to the centre of its own, by
 * `(R + d) × amount × scale`: `R` half the diagonal of the layout's box, `d` how far the part's centre is from the
 * layout's. Along an axis the parts are ranked by their centres on it (level ones, within `SHARED_CENTRE_MM`,
 * in the scene's order) and set `2R × amount × scale` apart: to both sides of the middle along x and y, and
 * along z upward from the lowest, which stays.
 */
export function explodeOffsets(parts: readonly ExplodePart[], explode: ExplodeState | null | undefined): Record<string, Vec3> {
  if (!isExploded(explode) || parts.length < 2) return Object.create(null)
  // A group of parts moves as one body (`bodiesOf`): each of its parts by the offset of the box round them.
  if (parts.some((part) => part.group !== undefined)) {
    const { bodies, of } = bodiesOf(parts)
    const moved = explodeOffsets(bodies, explode)
    const offsets: Record<string, Vec3> = Object.create(null)
    if (Object.keys(moved).length === 0) return offsets
    parts.forEach((part, n) => (offsets[part.name] = moved[of[n]]))
    return offsets
  }
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const { bbox } of parts) for (let i = 0; i < 3; i++) {
    min[i] = Math.min(min[i], bbox.min[i])
    max[i] = Math.max(max[i], bbox.max[i])
  }
  const centre = min.map((lo, i) => (lo + max[i]) / 2)
  // Never nothing: a layout with no size is exploded as if it reached half a millimetre.
  const reach = Math.max(Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2, 0.5)
  const by = explode.amount * explode.scale
  const centres = parts.map(({ bbox }) => bbox.min.map((lo, i) => (lo + bbox.max[i]) / 2))
  // By the names of parts, which are anyone's to choose: a record with no key but those.
  const offsets: Record<string, Vec3> = Object.create(null)
  if (explode.axis === 'centre') {
    parts.forEach((part, n) => {
      const d = centres[n].map((c, i) => c - centre[i])
      const far = Math.hypot(d[0], d[1], d[2])
      // A part at the centre has no way to go: it stays, and the others leave it. What modelling leaves of a
      // difference is no direction: a centre within `SHARED_CENTRE_MM` is at the centre.
      const k = far > SHARED_CENTRE_MM ? ((reach + far) * by) / far : 0
      offsets[part.name] = [d[0] * k + 0, d[1] * k + 0, d[2] * k + 0]
    })
    // Every part at the centre: nothing is drawn apart, and nothing is said to be.
    return Object.values(offsets).some((moved) => moved.some((c) => c !== 0)) ? offsets : Object.create(null)
  }
  const i = AXES.indexOf(explode.axis)
  // By where each centre is along the axis. Centres within `SHARED_CENTRE_MM` of one another are level, and
  // level parts go in the scene's order: what modelling leaves of a difference decides nothing.
  const order = parts.map((_, n) => n).sort((a, b) => centres[a][i] - centres[b][i])
  for (let from = 0; from < order.length; ) {
    let to = from + 1
    while (to < order.length && centres[order[to]][i] - centres[order[to - 1]][i] <= SHARED_CENTRE_MM) to += 1
    order.splice(from, to - from, ...order.slice(from, to).sort((a, b) => a - b))
    from = to
  }
  // Along x and y to both sides of the middle. Along z upward from the lowest part, which stays where it is:
  // nothing is drawn under the ground the layout stands on.
  const first = explode.axis === 'z' ? 0 : (parts.length - 1) / 2
  order.forEach((n, rank) => {
    const moved: Vec3 = [0, 0, 0]
    moved[i] = (rank - first) * 2 * reach * by + 0
    offsets[parts[n].name] = moved
  })
  return offsets
}

/** `exploded 40 % from the centre`, `exploded 100 % along z, ×2`. */
export function explodeText(explode: ExplodeState): string {
  const how = explode.axis === 'centre' ? 'from the centre' : `along ${explode.axis}`
  return `exploded ${number(explode.amount * 100)} % ${how}${explode.scale === 1 ? '' : `, ×${number(explode.scale)}`}`
}

/** Whether two explodes draw the parts the same. */
export function sameExplode(a: ExplodeState | null | undefined, b: ExplodeState | null | undefined): boolean {
  if (!a || !b) return !a && !b
  return a.amount === b.amount && a.scale === b.scale && a.axis === b.axis
}

/** Why an explode of something would draw nothing apart of these parts: there are fewer than two, or none moves from a centre they share. Null when it would. */
export function nothingApart(explode: ExplodeState, parts: readonly ExplodePart[]): 'one part' | 'shared centre' | null {
  if (parts.length < 2 || bodiesOf(parts).bodies.length < 2) return 'one part'
  return Object.keys(explodeOffsets(parts, { ...explode, amount: 1 })).length === 0 ? 'shared centre' : null
}

/** That, as the agent is told it of a layout it asked to see drawn apart. */
export function nothingApartText(why: 'one part' | 'shared centre', layout: string): string {
  if (why === 'one part') return `nothing can be drawn apart in layout ${layout}: it has fewer than two parts (explode: null draws it as it is)`
  return `nothing is drawn apart from the centre in layout ${layout}: its parts share a centre; give an axis, {"amount": 0.5, "axis": "z"}`
}

/**
 * The one rule for what is drawn apart: the explode kept for a layout, when it is of something, there is no
 * section (one is never drawn exploded) and it moves a part of the layout (two parts at least, not all at the
 * centre they would go from). Null otherwise: then nothing is apart, nothing is locked and nothing says exploded.
 * The window, a picture, main and an exported page all ask this.
 */
export function explodeShown(explode: ExplodeState | null | undefined, section: unknown, parts: readonly ExplodePart[]): ExplodeState | null {
  if (!isExploded(explode) || (section !== null && section !== undefined)) return null
  return nothingApart(explode, parts) === null ? explode : null
}

/**
 * Never both: a section is not drawn exploded. What a change to one makes of the other, for whoever changes
 * them by hand, in the window and in an exported page: setting a section puts the parts together (the amount
 * goes to 0, how they would go apart is kept), and drawing the parts apart takes the section away. `changed`
 * says which of the two was just set. (The window does not let the parts be drawn apart under a section at all:
 * it asks this to know, and says `SECTION_FIRST`.)
 */
export function neverBoth<S>(explode: ExplodeState | null | undefined, section: S | null | undefined, changed: 'explode' | 'section'): { explode: ExplodeState | null; section: S | null } {
  const apart = explode ?? null
  const cut = section ?? null
  if (cut === null || !isExploded(apart)) return { explode: apart, section: cut }
  return changed === 'section' ? { explode: { ...apart, amount: 0 }, section: cut } : { explode: apart, section: null }
}

/**
 * Whether any of some parts, drawn off by `offsets`, is outside the view: a corner of its box is projected off
 * the screen (`project` answers in fractions of the half size of the view, -1 to 1 across it). What decides
 * whether drawing the parts apart is followed by fitting them: only when one of them would no longer be seen whole.
 * The one rule, for a key or a button in the window, a saved view applied there, and an exported page.
 */
export function leavesView(parts: readonly ExplodePart[], offsets: Readonly<Record<string, Vec3>>, project: (point: Vec3) => readonly [number, number]): boolean {
  for (const part of parts) {
    const by = offsets[part.name] ?? [0, 0, 0]
    for (let corner = 0; corner < 8; corner++) {
      const [x, y] = project([0, 1, 2].map((i) => ((corner >> i) & 1 ? part.bbox.max[i] : part.bbox.min[i]) + by[i]) as Vec3)
      if (!(Math.abs(x) <= 1 && Math.abs(y) <= 1)) return true
    }
  }
  return false
}

/**
 * Where the camera goes back to when the parts come together: where it was before drawing them apart framed
 * them anew (`framed.before`, kept by whoever framed them for `leavesView`), if it is still where that framing
 * put it (`framed.after`); null once anybody has moved it since, or when nothing was framed. One rule both ways,
 * in the window and in an exported page: framed on the way out only to keep every part in sight, and put back
 * on the way in.
 */
export function cameraBack(framed: { before: Camera; after: Camera } | null, now: Camera): Camera | null {
  return framed && sameCamera(now, framed.after) ? framed.before : null
}

/** Whether two cameras are one, to a millionth: one read back as it was set. */
function sameCamera(a: Camera, b: Camera): boolean {
  const near = (x: readonly number[], y: readonly number[]): boolean => x.length === y.length && x.every((c, i) => Math.abs(c - y[i]) <= 1e-6 * Math.max(1, Math.abs(c)))
  return a.ortho === b.ortho && near(a.position, b.position) && near(a.target, b.target) && near(a.up, b.up) && near([a.zoom, a.fov], [b.zoom, b.fov])
}
