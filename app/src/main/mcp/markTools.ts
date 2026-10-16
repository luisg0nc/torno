import { apply } from '../../shared/align'
import { groupsIn } from '../../shared/groups'
import type { Described } from '../../shared/geometry'
import { expectedText, offBy, standingOf, valueText } from '../../shared/dimension'
import { type Anchor, type DimensionMark, type Mark, type NewMark, type Quat, isUnchecked, markAnchors } from '../../shared/marks'
import type { Part, Scene } from '../../shared/scene'
import type { Camera, HighlightResult } from '../../shared/view'
import { describeMark, number, scanVector, vector } from '../marks/describe'
import { MAX_NOTE } from '../marks/file'
import type { Unmeasured } from '../marks/measure'
import { spreadApart } from '../marks/spread'
import { EDGE_TOLERANCE_MM, answered, judge, judgePin, tolerance } from '../marks/reanchor'
import { onlyKeysWrong, unknownKeys } from './keys'
import type { ScanInfo } from '../../shared/scans'
import type { AlignmentSaid } from '../scans/said'
import { regionLost, scanFor } from './scanTools'
import { type AddMarkArgs, type HighlightArgs, type ResolveMarkArgs, FOV, INTENTS, MEASURES, SHAPES } from './schemas'
import {
  type ToolDeps,
  type ToolResult,
  MARK_ID,
  behind,
  built,
  failure,
  layoutFor,
  marksOf,
  messageOf,
  noMark,
  notOpen,
  onScreen,
  scansFor,
  tidy
} from './tools'

// The tools that work with marks and with what a ref names: `highlight`,
// `add_mark` and `resolve_mark`, and what they need to tie a mark to the
// geometry. What every tool shares (the object, its build, how an answer is
// written) is in ./tools, which registers these beside its own.

type Vec3 = [number, number, number]

export interface CheckedRef {
  part: Part
  target: 'part' | 'face' | 'edge'
}

/**
 * What a ref names in a layout of a build, or why it names nothing there, in
 * words that say what there is: the parts, or how many faces or edges the part has.
 */
export function checkRef(scene: Scene, layout: string, ref: string): CheckedRef | string {
  const parts = scene.parts.filter((p) => p.layout === layout)
  const whole = parts.find((p) => p.name === ref)
  if (whole) return { part: whole, target: 'part' }
  const sub = /^(.*)\/([FE])(\d+)$/.exec(ref)
  const part = sub && parts.find((p) => p.name === sub[1])
  if (!sub || !part) {
    const name = sub ? sub[1] : ref
    const form = sub || !ref.includes('/') ? '' : '; a ref is a part, part/F<n> or part/E<n>'
    // A group's name is no ref: its faces and edges are its parts'.
    const group = groupsIn(scene, layout).find((g) => g.name === name)
    const isGroup = group ? `; ${name} is a group: its parts are ${group.parts.join(', ')}` : ''
    return `no part '${name}' in layout ${layout} (parts: ${parts.map((p) => p.name).join(', ') || 'none'})${form}${isGroup}`
  }
  const [letter, plural, count] = sub[2] === 'F' ? ['F', 'faces', part.faceCount] : ['E', 'edges', part.edgeCount]
  if (Number(sub[3]) >= count) return `${part.name} has ${count} ${plural}${count > 0 ? `, ${letter}0 to ${letter}${count - 1}` : ''}: there is no ${letter}${sub[3]}`
  return { part, target: sub[2] === 'F' ? 'face' : 'edge' }
}

/** An end of a measurement as the agent names one: a ref, the number of a mark, a point, a ref with a point, or a point of a scan. */
export type EndArg = string | { ref?: string; point?: Vec3 } | { scan: string; point: Vec3 }

/** Said of an end that names a scan and is no point of one. */
export const noScanEnd = (name: string): string => `${name} names nothing: a point of a scan is {"scan": "S1", "point": [x, y, z]}, in mm in the frame of the layout`

const isPoint = (point: unknown): point is Vec3 => Array.isArray(point) && point.length === 3 && point.every((c) => typeof c === 'number' && Number.isFinite(c))

/** Said of an end that is none, with what one looks like: whatever was given reaches the tool, so that this is the answer. */
export const noEnd = (name: string): string => `${name} names nothing: give a ref ("lid/F12"), the number of a mark ("M3"), {"point": [x, y, z]} in mm, or {"ref": "lid/F12", "point": [x, y, z]}`

/** The keys an end may have: a ref, a point, or a scan with a point. */
const END_KEYS = ['ref', 'point', 'scan']
const isScanPoint = (end: unknown): boolean => typeof (end as { scan?: unknown } | null)?.scan === 'string' && isPoint((end as { point?: unknown }).point)

/** An end as it was given, when it is one: a ref, or an object with a ref, a point of three finite numbers, or both, and no other key. */
function endOf(arg: unknown): { ref?: string; point?: Vec3 } | null {
  if (typeof arg === 'string') return arg === '' ? null : { ref: arg }
  if (typeof arg !== 'object' || arg === null || Array.isArray(arg)) return null
  if (Object.keys(arg).some((key) => key !== 'ref' && key !== 'point')) return null
  const { ref, point } = arg as { ref?: unknown; point?: unknown }
  const isPoint = Array.isArray(point) && point.length === 3 && point.every((c) => typeof c === 'number' && Number.isFinite(c))
  if ((ref !== undefined && (typeof ref !== 'string' || ref === '')) || (point !== undefined && !isPoint)) return null
  if (ref === undefined && point === undefined) return null
  return { ...(ref === undefined ? {} : { ref: ref as string }), ...(point === undefined ? {} : { point: point as Vec3 }) }
}

/** An end of a measurement as it is asked of the kernel, and what a reading calls it: `base/F5`, `base/F5 (M3)`, `(10, 5, -1)`. */
export interface End {
  ref?: string
  point?: Vec3
  /** The part the ref is of; none of a bare point. */
  part?: Part
  text: string
  /** The end is a point of this scan, or the centroid of a region of it: where the scan's alignment in the layout puts it, and so approximate. */
  scan?: { id: string; aligned: AlignmentSaid; alignments: ScanInfo['alignments'] }
}

/**
 * What the ends of a measurement name in a layout of a build, each checked
 * against that build before the kernel is asked, or the error to answer with.
 * A mark stands for what it is on (its first anchor: the ref, at the point),
 * and only when that is known to be of this build: one the build moved, one
 * whose part is gone, one not yet checked against it and one that is
 * resolved, which is no longer checked, are refused, since their refs may
 * name other geometry now. A point of a scan, and a region of one (its
 * centroid), are where the scan's alignment in the layout puts them: refused
 * where it has none (`scanFor`).
 */
export async function endsOf(deps: ToolDeps, objectId: string, scene: Scene, revision: number, layout: string, asked: Array<['a' | 'b', EndArg]>): Promise<End[] | ToolResult> {
  const ends: End[] = []
  let marks: Mark[] | undefined
  for (const [name, arg] of asked) {
    if (typeof arg === 'string' && MARK_ID.test(arg)) {
      if (!marks) {
        const read = await marksOf(deps, objectId)
        if ('content' in read) return read
        marks = read
      }
      const mark = marks.find((m) => m.id === arg)
      if (!mark) return noMark(arg, marks)
      if (mark.kind === 'region') {
        const region = mark
        const of = await scanFor(deps, objectId, layout, revision, region.scan)
        if ('content' in of) return of
        if (region.anchorState === 'orphaned' || !isPoint(region.local?.centroid)) return failure(`${regionLost(arg, region.scan)}, or give a point of the scan, as {"scan": "${region.scan}", "point": [x, y, z]}`)
        const point = tidy(apply(of.alignment.transform, region.local.centroid))
        ends.push({ point, scan: { id: of.scan.id, aligned: of.aligned, alignments: of.scan.alignments }, text: `the centroid of region ${arg} (${of.scan.id}) at ${scanVector(point)}` })
        continue
      }
      // It has two ends, or is of one thing at a point: which is meant is not for torno to guess.
      if (mark.kind === 'dimension') return failure(`${arg} is a dimension: name the ref or point of the end you mean`)
      if (mark.layout !== layout) return failure(`${arg} is in layout ${mark.layout}, not ${layout}`)
      if (mark.anchorState === 'orphaned') return failure(`the part ${arg} was placed on is gone: give a ref`)
      if (mark.anchorState !== 'ok') return failure(`${arg} has moved since it was placed: give a ref`)
      if (mark.status === 'resolved') return failure(`${arg} is resolved, and is no longer checked against the builds: give a ref`)
      if (isUnchecked(mark, revision)) return failure(`${arg} has not been checked against r${revision} yet, so what it is on is not known: give a ref, or ask again in a moment`)
      const on = markAnchors(mark)[0]
      if (!on) return failure(`${arg} is not on a part, a face or an edge: give a ref or a point`)
      if (on.ref === undefined) {
        ends.push({ point: on.point, text: `${vector(on.point)} (${arg})` })
        continue
      }
      const checked = checkRef(scene, layout, on.ref)
      if (typeof checked === 'string') return failure(`${arg} is on ${on.ref}, but ${checked}`)
      ends.push({ ref: on.ref, point: on.point, part: checked.part, text: `${on.ref} (${arg})` })
      continue
    }
    // A key an end does not take is refused by name: dropped, `{point, scann}` would be a bare point, measured as exact.
    if (onlyKeysWrong(arg, END_KEYS, (end) => endOf(end) !== null || isScanPoint(end))) return failure(unknownKeys(arg, END_KEYS, `the end ${name}`)!)
    if (typeof arg === 'object' && arg !== null && 'scan' in arg) {
      // A point of a scan is that and nothing else: with a ref beside it, which of the two is meant is not for torno to guess.
      if ('ref' in arg) return failure(noScanEnd(name))
      const { scan, point } = arg as { scan?: unknown; point?: unknown }
      if (typeof scan !== 'string' || scan === '' || !isPoint(point)) return failure(noScanEnd(name))
      const of = await scanFor(deps, objectId, layout, revision, scan)
      if ('content' in of) return of
      ends.push({ point, scan: { id: of.scan.id, aligned: of.aligned, alignments: of.scan.alignments }, text: `${vector(point)} given as a point of ${of.scan.id}` })
      continue
    }
    const given = endOf(arg)
    if (!given) return failure(noEnd(name))
    const { ref, point } = given
    const checked = ref === undefined ? undefined : checkRef(scene, layout, ref)
    if (typeof checked === 'string') return failure(checked)
    ends.push({ ...(ref === undefined ? {} : { ref }), ...(point ? { point } : {}), ...(checked ? { part: checked.part } : {}), text: ref ?? vector(point!) })
  }
  return ends
}

export async function highlightTool(deps: ToolDeps, objectId: string, args: HighlightArgs): Promise<ToolResult> {
  const found = onScreen(deps, objectId)
  if ('content' in found) return found
  const layout = layoutFor(deps, objectId, found.scene, args.layout)
  if (typeof layout !== 'string') return layout

  const refs: string[] = []
  const wrong: string[] = []
  let marks: Mark[] | undefined
  for (const ref of args.refs) {
    let named = ref
    if (MARK_ID.test(ref)) {
      if (!marks) {
        const read = await marksOf(deps, objectId)
        if ('content' in read) return read
        marks = read
      }
      const mark = marks.find((m) => m.id === ref)
      const on = mark && markAnchors(mark)[0]?.ref
      if (!mark) wrong.push(`no mark ${ref} (marks: ${marks.map((m) => m.id).join(', ') || 'none'})`)
      else if (mark.layout !== layout) wrong.push(`${ref} is in layout ${mark.layout}, not ${layout}`)
      else if (!on) wrong.push(`${ref} is not on a part, a face or an edge`)
      // Its ref is where it was placed, which may name other geometry now: that is not pointed at as the mark.
      else if (mark.anchorState === 'drifted') wrong.push(`${ref} was placed on ${on}, which has moved since: the ref may name something else now`)
      else if (mark.anchorState === 'orphaned') wrong.push(`the part ${ref} was placed on is gone`)
      // As `endsOf` rules for a measurement: a mark stands for what it is on only when the last build's check confirmed it.
      else if (isUnchecked(mark, found.revision)) wrong.push(`${ref} has not been checked against r${found.revision} yet, so what it is on is not known: give a ref, or ask again in a moment`)
      if (!mark || mark.layout !== layout || !on || mark.anchorState !== 'ok' || isUnchecked(mark, found.revision)) continue
      named = on
    }
    // A bare group name stands for all of its parts in the layout.
    const group = named === ref ? groupsIn(found.scene, layout).find((g) => g.name === ref) : undefined
    if (group) {
      for (const name of group.parts) if (!refs.includes(name)) refs.push(name)
      continue
    }
    const checked = checkRef(found.scene, layout, named)
    if (typeof checked === 'string') wrong.push(named === ref ? checked : `${ref} is on ${named}, but ${checked}`)
    else if (!refs.includes(named)) refs.push(named)
  }
  // All or nothing: a question about three faces is not asked of two.
  if (wrong.length > 0) return failure(`nothing was highlighted: ${wrong.join('; ')}`)

  const note = args.note?.trim().slice(0, MAX_NOTE)
  let done: HighlightResult
  try {
    done = await deps.highlight(objectId, layout, refs, note || undefined)
  } catch (e) {
    return failure(messageOf(e))
  }
  if (done.objectId !== objectId) return failure(`${notOpen(found.obj, done.objectId)}. Ask the user to open it.`)
  const newer = done.revision !== found.revision ? ` The window shows r${done.revision}, not r${found.revision}: check the refs with describe.` : ''
  return {
    content: [
      {
        type: 'text',
        text: `highlighted ${done.refs.join(', ')} in layout ${done.layout} for the user${note ? `, with the note "${note}"` : ''}, until they click in the viewport or 60 s pass.${newer}`
      }
    ]
  }
}

/**
 * Where a mark of the agent's is tied to the geometry, as a re-anchored one
 * would be: the ref, the point, the normal there and what the kernel says of
 * it. Given a ref alone, the middle of that edge, or the point of the surface
 * nearest the centre of that face or part; given a point alone, the part
 * whose surface the point is on, or nothing but the point when it is on none
 * (a failure when the kernel could not say of some part, and it is on no other).
 * A `pick` keeps the ref it was given and is refused when its point is not on
 * what that names; anything else is tied to the face under its point. `said`
 * is what the agent should know of how that went, in the words of the `kind`
 * of mark it is for.
 */
export async function anchorFor(
  deps: ToolDeps,
  objectId: string,
  scene: Scene,
  layout: string,
  ref: string | undefined,
  point: Vec3 | undefined,
  kind: 'pin' | 'pick' | 'arrow' | 'shape'
): Promise<{ anchor: Anchor; target?: CheckedRef['target']; said?: string } | ToolResult> {
  const parts = scene.parts.filter((p) => p.layout === layout)
  const pick = kind === 'pick'
  // A pin is on an edge when its point is on one (`judgePin`); anything else is on the face there.
  const pin = kind === 'pin'
  try {
    if (ref === undefined) {
      if (!point) return failure('give a ref or a point')
      const found = parts.length > 0 ? await deps.nearest(objectId, layout, parts.map((p) => ({ part: p.name, point }))) : []
      let best: Anchor | undefined
      let least = Infinity
      found.forEach((one, i) => {
        if (!answered(one) || one.distance >= least) return
        const judged = (pin ? judgePin : judge)({ point, part: one.part }, one, tolerance(parts[i].bbox))
        if (judged.state !== 'ok') return
        least = one.distance
        best = judged.anchor
      })
      if (best) return { anchor: best }
      // A part the kernel could say nothing of may be the one the point is on: it is not said to be on none.
      const failed = found.find((one) => one.found && one.error !== undefined)
      if (failed?.found && failed.error !== undefined) {
        return failure(`the kernel could not say whether ${vector(point)} is on ${failed.part}: ${failed.error}. No mark was placed: give a ref.`)
      }
      return { anchor: { point }, said: 'The point is on no part of this layout, so the mark is tied to none.' }
    }

    const checked = checkRef(scene, layout, ref)
    if (typeof checked === 'string') return failure(checked)
    const { part, target } = checked
    const described = await deps.describe(objectId, layout, ref)
    // A centre the kernel measured carries the noise of measuring: -3.5e-15 is 0.
    const base: Anchor = { point: point ?? tidy(centreOf(described, part)), part: part.name, ref, descriptor: described.descriptor }
    if (described.kind === 'face' && described.normal) base.normal = described.normal
    // The mark is checked against the build the moment it is kept (`followMarks`): what is kept here is
    // what that check would make of it, so that the answer given now still holds afterwards.
    const onEdge = (pick || pin) && target === 'edge'
    // The middle of an edge is on the edge: for a pick there is nothing to ask. A pin also says which faces meet there.
    if (onEdge && !point && pick) return { anchor: base, target }
    const [nearBase] = await deps.nearest(objectId, layout, [{ part: part.name, point: base.point, ...(onEdge ? { edge: ref } : {}) }])
    if (nearBase?.found && nearBase.error !== undefined) return failure(`the kernel could not say where ${vector(base.point)} is on ${part.name}: ${nearBase.error}`)
    if (!answered(nearBase)) return { anchor: base, target }
    let near = nearBase
    if (onEdge) {
      // Off its edge, the mark would be said to have drifted at once. An edge has no one normal.
      if (near.edgeFound !== true) return failure(`the kernel did not say how far the point ${vector(base.point)} is from ${ref}: leave the point out to use the middle of the edge`)
      if (near.edgeDistance > EDGE_TOLERANCE_MM) return failure(`the point ${vector(base.point)} is ${number(near.edgeDistance)} mm from ${ref}: give a point on the edge, or leave the point out to use its middle`)
      if (!pin) return { anchor: base, target }
      // Two edges may both be within reach of the point (those of a narrow chamfer): the pin is on the one the kernel found it on.
      const onIt = judgePin({ ...base, edge: ref }, near, Infinity).anchor
      const other = onIt.edge !== undefined && onIt.edge !== ref
      return { anchor: onIt, target, ...(other ? { said: `The pin is placed on ${onIt.edge}, the edge under that point, not ${ref}.` } : {}) }
    }
    if (point && near.distance > tolerance(part.bbox)) {
      return failure(`the point ${vector(point)} is ${number(near.distance)} mm from the surface of ${part.name}: give a point on it, or leave the point out to use the centre of ${ref}`)
    }
    // The centre of a face may not be on it (a cylinder's is on its axis, a ring's in its hole), and that
    // of a part is inside it: without a point, the mark goes to the point of the surface nearest to it.
    const at = point ?? tidy(near.point)
    if (!point && at.some((c, i) => c !== near.point[i])) {
      // The point kept is the rounded one, and that is where the check will ask: beside a curved edge it may
      // be under another face than the one it was rounded from. What is kept and said is what the kernel says of it.
      const [there] = await deps.nearest(objectId, layout, [{ part: part.name, point: at }])
      if (answered(there)) near = there
    }
    if (pin && near.support === 'edge') {
      // The point is on an edge, whatever was named to find it: the check would find the pin on that edge.
      const onIt = judgePin({ point: at, part: part.name }, near, tolerance(part.bbox)).anchor
      if (onIt.edge !== undefined) return { anchor: onIt, target, said: `That point is on the edge ${onIt.edge}: the pin is placed on the edge.` }
    }
    const elsewhere = target === 'face' && near.ref !== ref
    if (pick) {
      // A pick is of the thing named. Of a face it follows the face under its point, so it must be on that face.
      if (elsewhere) {
        return failure(
          point
            ? `the point ${vector(point)} is on ${near.ref}, not ${ref}: give a point on ${ref}`
            : `the centre of ${ref} is not on it (a face with a hole, a ring or a short cylinder): give a point on ${ref}`
        )
      }
      const anchor: Anchor = { ...base, point: at }
      if (near.normal) anchor.normal = near.normal
      return { anchor, target }
    }
    // A pin, an arrow or a shape is on the face that is under its point, whatever was named to find the point.
    if (near.ref === ref) {
      const anchor: Anchor = { ...base, point: at }
      if (near.normal) anchor.normal = near.normal
      return { anchor, target }
    }
    const { anchor } = judge({ point: at, part: part.name }, near, Infinity)
    const placed = `the mark is placed on ${near.ref}, the face under that point`
    const [is, does] = kind === 'arrow' ? ['An arrow starts on a face', 'it starts on'] : kind === 'shape' ? ['A shape is tied to a face', 'it is tied to'] : ['A pin is on a face', 'it is placed on']
    const said =
      target === 'part'
        ? undefined
        : target === 'edge'
          ? `${is}: ${does} ${near.ref}, the face under ${point ? 'that point' : `the middle of ${ref}`}. Use a pick to mark the edge itself.`
          : point
            ? `The point is on ${near.ref}, not ${ref}: ${placed}.`
            : `The centre of ${ref} is not on it: ${placed}. Give a point on ${ref} to put it there.`
    return { anchor, target, ...(said ? { said } : {}) }
  } catch (e) {
    return failure(messageOf(e))
  }
}

function centreOf(described: Described, part: Part): Vec3 {
  if (described.kind !== 'part') return described.center
  const { min, max } = described.bbox ?? part.bbox
  return [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
}

/**
 * A view of a mark the agent placed, for "go to its view" in the window: at
 * the mark from the side its surface faces, far enough back to see the parts.
 */
function markCamera(scene: Scene, layout: string, at: Vec3, normal: Vec3 | undefined): Camera {
  const parts = scene.parts.filter((p) => p.layout === layout)
  let diagonal = 0
  if (parts.length > 0) {
    const min = [0, 1, 2].map((i) => Math.min(...parts.map((p) => p.bbox.min[i])))
    const max = [0, 1, 2].map((i) => Math.max(...parts.map((p) => p.bbox.max[i])))
    diagonal = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2])
  }
  const distance = Math.max(50, 1.7 * diagonal)
  // The usual three-quarter view, from the side of each axis that the surface faces.
  const from = [1, -1, 0.8].map((c, i) => (normal && Math.abs(normal[i]) > 0.3 ? Math.abs(c) * Math.sign(normal[i]) : c))
  const length = Math.hypot(from[0], from[1], from[2])
  const position = at.map((c, i) => c + (from[i] / length) * distance) as Vec3
  return { position, target: at, up: [0, 0, 1], ortho: false, fov: FOV, zoom: 1 }
}

export async function addMarkTool(deps: ToolDeps, objectId: string, args: AddMarkArgs): Promise<ToolResult> {
  const found = built(deps, objectId)
  if ('content' in found) return found
  const { scene, revision } = found
  const layout = layoutFor(deps, objectId, scene, args.layout)
  if (typeof layout !== 'string') return layout
  const base = { author: 'agent', note: args.note.slice(0, MAX_NOTE), layout, revision } as const

  let mark: NewMark
  let said: string | undefined
  if (args.kind === 'dimension') {
    const made = await dimensionFor(deps, objectId, scene, revision, layout, args)
    if ('content' in made) return made
    mark = { ...base, ...made }
  } else if (args.kind === 'shape') {
    const missing = (['shape', 'size', 'position', 'intent'] as const).filter((key) => args[key] === undefined)
    if (missing.length > 0) return failure(`a shape needs ${missing.join(', ')}: shape is one of ${SHAPES.join(', ')}; intent one of ${INTENTS.join(', ')}; size and position are [x, y, z] in mm`)
    const [x, y, z] = args.size!
    const flat = args.shape === 'plane'
    if (x <= 0 || (args.shape !== 'cylinder' && args.shape !== 'sphere' && y <= 0) || (!flat && args.shape !== 'sphere' && z <= 0)) return failure(`the size of a ${args.shape} must be positive: ${vector(args.size!)}`)
    const size: Vec3 = args.shape === 'cylinder' ? [x, x, z] : args.shape === 'sphere' ? [x, x, x] : flat ? [x, y, 0] : [x, y, z]
    const rotation = args.rotation ?? [0, 0, 0, 1]
    const length = Math.hypot(...rotation)
    if (length < 1e-9) return failure('rotation is a quaternion [x, y, z, w]: it cannot be all zeros')
    let anchor: Anchor | undefined
    if (args.ref !== undefined) {
      const tied = await anchorFor(deps, objectId, scene, layout, args.ref, args.point, 'shape')
      if ('content' in tied) return tied
      anchor = tied.anchor
      said = tied.said
    }
    mark = {
      ...base,
      kind: 'shape',
      shape: args.shape!,
      intent: args.intent!,
      position: args.position!,
      rotation: rotation.map((c) => c / length) as Quat,
      size,
      camera: markCamera(scene, layout, args.position!, undefined),
      ...(anchor ? { anchor } : {})
    }
  } else {
    if (args.kind === 'pick' && args.ref === undefined) return failure('a pick needs a ref: the part, face or edge it is of. For a point, place a pin')
    if (args.ref === undefined && args.point === undefined) return failure(`${args.kind === 'arrow' ? 'an arrow' : 'a pin'} needs a ref or a point${args.kind === 'arrow' ? ' to start from' : ''}`)
    if (args.kind === 'arrow' && args.to === undefined && args.by === undefined) return failure('an arrow needs to (where it ends) or by (the vector from its start), in mm')
    if (args.kind === 'arrow' && args.to !== undefined && args.by !== undefined) return failure('an arrow takes to (where it ends) or by (the vector from its start), not both')
    const tied = await anchorFor(deps, objectId, scene, layout, args.ref, args.point, args.kind)
    if ('content' in tied) return tied
    const { anchor } = tied
    said = tied.said
    const camera = markCamera(scene, layout, anchor.point, anchor.normal)
    if (args.kind === 'pin') mark = { ...base, kind: 'pin', anchor, camera }
    else if (args.kind === 'pick') mark = { ...base, kind: 'pick', target: tied.target ?? 'part', anchor, camera }
    else {
      const to = args.to ?? (anchor.point.map((c, i) => c + args.by![i]) as Vec3)
      if (to.every((c, i) => Math.abs(c - anchor.point[i]) < 1e-6)) return failure(`the arrow would end where it starts, at ${vector(anchor.point)}`)
      mark = { ...base, kind: 'arrow', from: anchor, to, camera }
    }
  }

  let added: Mark
  let unmeasured: Unmeasured | undefined
  let reason: string | undefined
  try {
    if (mark.kind === 'dimension') ({ mark: added, unmeasured, reason } = await deps.addDimension(objectId, mark))
    else added = await deps.addMark(objectId, mark)
  } catch (e) {
    return failure(messageOf(e))
  }
  if (added.kind === 'dimension' && unmeasured) return keptUnmeasured(deps, objectId, layout, added, unmeasured, reason)
  // Placed on the last build that worked, which the agent may take for the model as it has just edited it.
  const why = behind(deps, objectId)
  const stale = why ? `, stale: ${why}, so the mark was placed on the parts of r${revision}; it is checked against the next build that works` : ''
  // A dimension says its value as that of a build: the one it was placed and measured on, whose ends were found a moment ago.
  const line = added.kind === 'dimension' ? describeMark({ ...added, checkedRevision: revision }, { revision, scene }) : describeMark(added, { scene })
  return { content: [{ type: 'text', text: `placed in layout ${layout}: ${line}${said ? `\n${said}` : ''}\nrevision r${revision}${stale}` }] }
}

/**
 * What is said of a dimension that was kept without a value: first that it
 * was not measured and why, so that the line after it is not taken for a
 * measurement, then that the mark is there and when it will have a value
 * (it is not to be placed again: that would leave two).
 * The revision is the last build's as of now: of a dimension the model was
 * rebuilt under, it is the newer one, on which its ends are yet to be found.
 */
function keptUnmeasured(deps: ToolDeps, objectId: string, layout: string, added: Mark, why: Unmeasured, reason: string | undefined): ToolResult {
  const revision = deps.scene(objectId)?.revision
  const on = revision === undefined ? 'the next build' : `r${revision}`
  const said =
    why === 'rebuilt'
      ? `the model was rebuilt while this was measured. ${added.id} was kept without a value, and is measured when its ends have been found on ${on}: read it then with describe.`
      : `the kernel gave no answer${reason ? ` (${reason})` : ''}. ${added.id} was kept without a value, and is measured when the marks are next checked against ${on}: read it then with describe.`
  return { content: [{ type: 'text', text: `NOT MEASURED: ${said}\nplaced in layout ${layout}: ${describeMark(added, { revision, ...(deps.scene(objectId) ? { scene: deps.scene(objectId)!.scene } : {}) })}\nrevision ${on}` }] }
}

/**
 * What a dimension of the agent's is made of: its kind of measurement and its
 * ends, each tied to the geometry as a pin is, since that is how every build
 * finds them again. An end is of what was named: a face or an edge, at the
 * point given or at its middle, or a bare point. One whose point is on
 * another face is refused, where a pin would be put on that face: the kernel
 * would measure from something the agent did not name. A whole part is no
 * end of a dimension: the next build would take it for the face under its
 * point.
 */
async function dimensionFor(
  deps: ToolDeps,
  objectId: string,
  scene: Scene,
  revision: number,
  layout: string,
  args: AddMarkArgs
): Promise<Pick<Extract<NewMark, { kind: 'dimension' }>, 'kind' | 'measure' | 'a' | 'b' | 'expected' | 'tolerance' | 'camera'> | ToolResult> {
  const { measure, expected, tolerance } = args
  if (measure === undefined) return failure(`a dimension needs measure, one of ${MEASURES.join(', ')}, and a, what it is of`)
  if (args.a === undefined) return failure(noEnd('a'))
  const between = measure === 'distance' || measure === 'angle'
  if (between && args.b === undefined) return failure(`a dimension of ${measure === 'angle' ? 'an angle' : 'a distance'} needs b, its other end`)
  if (!between && args.b !== undefined) return failure(`a dimension of a ${measure} is of a alone: leave b out`)
  // As the store asks of a change to them.
  if (expected !== undefined && !Number.isFinite(expected)) return failure('expected is a number')
  if (tolerance !== undefined && !(Number.isFinite(tolerance) && tolerance >= 0)) return failure('tolerance is a number, zero or more')

  const ends = await endsOf(deps, objectId, scene, revision, layout, [['a', args.a], ...(args.b === undefined ? [] : ([['b', args.b]] as Array<['b', EndArg]>))])
  if ('content' in ends) return ends
  // A dimension is kept as exact and measured again on every build. A point of a scan is neither: it is
  // where an alignment had it that day, and kept as a bare point it would be told without a word of the scan.
  const onScan = ends.findIndex((end) => end.scan !== undefined)
  if (onScan >= 0) {
    const end = ends[onScan]
    const what = end.text.startsWith('the centroid') ? end.text.replace(/ at \(.*$/, '') : `a point of ${end.scan!.id}`
    return failure(`a dimension is checked on every build against the model: an end on a scan cannot be one (${onScan === 0 ? 'a' : 'b'} is ${what}) — use measure, which answers once and says it is approximate`)
  }
  // Said before anything is asked; `addDimension` refuses it too, for whoever places one.
  const apart = measure === 'distance' ? spreadApart(scene, layout, ends[0].part?.name, ends[1]?.part?.name, 'the distance between') : null
  if (apart !== null) return failure(apart)
  const anchors: Anchor[] = []
  for (const end of ends) {
    if (end.ref === undefined) {
      anchors.push({ point: end.point! })
      continue
    }
    const tied = await anchorFor(deps, objectId, scene, layout, end.ref, end.point, 'pin')
    if ('content' in tied) return tied
    if (tied.target === 'part') return failure(`a dimension is between faces, edges and points, and ${end.ref} is a whole part: name a face or an edge of it, or use measure`)
    if (tied.anchor.ref !== end.ref) {
      const at = end.point ? `the point ${vector(end.point)}` : `the ${tied.target === 'edge' ? 'middle' : 'centre'} of ${end.ref}`
      return failure(`${at} is on ${tied.anchor.ref ?? 'no part'}, not on ${end.ref}: give a point on it, as {ref: "${end.ref}", point: [x, y, z]}`)
    }
    anchors.push(tied.anchor)
  }
  const [a, b] = anchors
  return {
    kind: 'dimension',
    measure,
    a,
    ...(b ? { b } : {}),
    ...(expected === undefined ? {} : { expected }),
    ...(tolerance === undefined ? {} : { tolerance }),
    camera: markCamera(scene, layout, a.point, a.normal)
  }
}

/**
 * Resolves a mark for the agent. A dimension of the person's that has an
 * expected value is not the agent's to resolve: it is their check of the
 * part, a resolved dimension is no longer measured, and an agent that
 * resolved what it had just made pass would switch the check off. It is told
 * how the check stands instead. Of any other dimension it resolves, it is
 * told that the dimension is no longer measured.
 */
export async function resolveMarkTool(deps: ToolDeps, objectId: string, args: ResolveMarkArgs): Promise<ToolResult> {
  const marks = await marksOf(deps, objectId)
  if ('content' in marks) return marks
  const before = MARK_ID.test(args.id) ? marks.find((m) => m.id === args.id) : undefined
  if (!before) return noMark(args.id, marks)
  const revision = deps.scene(objectId)?.revision
  if (before.kind === 'dimension' && before.author === 'user' && before.expected !== undefined && before.status !== 'resolved') {
    return failure(`${before.id} is the person's check of the part: it stays measured on every build and only they resolve it. ${standing(before, revision)}`)
  }
  const note = args.note?.trim().slice(0, MAX_NOTE)
  try {
    const mark = await deps.updateMark(objectId, args.id, { status: 'resolved', ...(note ? { resolvedNote: note } : {}) })
    const unmeasured = mark.kind === 'dimension' ? `\n${mark.id} is no longer measured.` : ''
    const scans = await scansFor(deps, objectId, [mark])
    const told = mark.kind === 'region' ? deps.view(objectId)?.layout : undefined
    return { content: [{ type: 'text', text: `resolved: ${describeMark(mark, { revision, ...(told ? { layout: told } : {}), ...(scans ? { scans } : {}), ...(deps.scene(objectId) ? { scene: deps.scene(objectId)!.scene } : {}) })}${mark.resolvedNote ? `\nnote: ${mark.resolvedNote}` : ''}${unmeasured}` }] }
  } catch (e) {
    return failure(messageOf(e))
  }
}

/** How a check of the person's stands on the last build, in a sentence: `It passes on r5.` */
function standing(mark: DimensionMark, revision: number | undefined): string {
  if (revision === undefined) return 'It is not measured: nothing is built yet.'
  const stands = standingOf(mark, revision)
  if (stands === 'pass') return `It passes on r${revision}.`
  if (stands === 'fail' && mark.value !== undefined && mark.expected !== undefined) {
    return `It fails on r${revision}: ${valueText(mark.measure, mark.value).replace(/^(⌀|R) /, '')}, expected ${expectedText(mark)} (${offBy(mark.value, mark.expected)}).`
  }
  return `It is not ${stands === 'unmeasurable' ? 'measurable' : 'measured'} on r${revision}.`
}
