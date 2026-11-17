import { type FocusBox, DEFAULT_FOCUS_MARGIN, MAX_FOCUS_MARGIN, focusMargin } from '../../shared/focus'
import { markAnchors, markPoints, sketchStrokePoints } from '../../shared/marks'
import { number } from '../../shared/format'
import { groupsIn } from '../../shared/groups'
import { expandSet } from '../../shared/sets'
import type { Scene } from '../../shared/scene'
import { vector } from '../marks/describe'
import { wire } from '../marks/measure'
import { movedForDisplay } from '../marks/spread'
import { unknownKeys } from './keys'
import { checkRef, isSetRef, setsAt } from './markTools'
import { MOST_DESCRIBED, withLayoutHint } from './setRefs'
import { refusal } from './readTools'
import { type ToolDeps, type ToolResult, MARK_ID, failure, marksOf, noMark } from './tools'

// What `look` and `show` frame on when given a `focus`: a ref, a group, a mark or a box, worked out in main to the box
// the window frames (`FocusBox`, shared/focus.ts) before it is asked, so that what names nothing is refused with what
// there is. Coordinates are in the frame of the layout the picture is of: where the parts are shown.

type Vec3 = [number, number, number]

const FORMS = 'a focus is a part, part/F<n>, part/E<n>, a group, a mark (M3) or a box {"min": [x, y, z], "max": [x, y, z]}'
const BOX_FORM = 'a focus box takes min and max, three numbers each, in mm in the frame of the layout: {"min": [x, y, z], "max": [x, y, z]}'
const BOX_ORDER = 'a focus box has its min below its max in x, y and z'
export const NO_MARGIN = `margin is a share of the focus box's longest side added on every side, 0 to ${MAX_FOCUS_MARGIN} (default ${DEFAULT_FOCUS_MARGIN})`
export const MARGIN_NEEDS_FOCUS = 'margin goes with focus: give the ref, mark or box to frame'
export const NO_SAVED_FRAME = 'a saved view frames its own picture: give focus with front, iso, … or a camera, or the view without focus'

/** A focus worked out: the box for the window, what it is of, and what a caption says of it. */
export interface Focused {
  focus: FocusBox
  /** The line a reply gives after the picture's caption (no newline). */
  said: string
  /** The parts the focus is of, by name: they have to be drawn for the picture to show it. */
  parts: string[]
  /** The line about parts torno moved for display, or ''. */
  moved: string
}

/** A point to the millionth of a millimetre: what is left of arithmetic in a mark's point reaches the window as it is not. */
const snapped = (v: Vec3): Vec3 => v.map((c) => Math.round(c * 1e6) / 1e6 + 0) as Vec3

const isVec = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every((c) => typeof c === 'number' && Number.isFinite(c))

/** The share of the box added on every side, or the error to answer with. Absent: the default. */
export function marginShare(given: unknown): number | ToolResult {
  if (given === undefined) return DEFAULT_FOCUS_MARGIN
  return typeof given === 'number' && Number.isFinite(given) && given >= 0 && given <= MAX_FOCUS_MARGIN ? given : failure(NO_MARGIN)
}

const boxText = (min: readonly number[], max: readonly number[]): string => (min.every((c, i) => c === max[i]) ? `at ${vector(min)}` : `box ${vector(min)} to ${vector(max)}`)

/**
 * What the agent named, as a box in the frame of `layout`, or the error to answer with. A ref of a part is the
 * scene's box; a face or an edge is the kernel's, of the last build (`measure` bbox: exact or not as it says); a
 * group is the box round its parts; a mark is the box round the points it is drawn at (a pin is a point); a box is as
 * given. Everything is checked against the last build before anything is asked of the kernel.
 */
export async function focusOf(deps: ToolDeps, objectId: string, found: { scene: Scene; revision: number }, layout: string, given: unknown, share: number, drawn: (parts: string[]) => ToolResult | null = () => null): Promise<Focused | ToolResult> {
  const framed = (box: { min: Vec3; max: Vec3 }, of: string, how: string, parts: string[], moved = ''): Focused | ToolResult => {
    const margin = focusMargin(box, share)
    return drawn(parts) ?? { focus: { min: snapped(box.min), max: snapped(box.max), margin }, said: `focus ${of}: ${how}, framed with ${number(margin)} mm round it`, parts, moved }
  }
  const { scene } = found

  if (typeof given === 'object' && given !== null && !Array.isArray(given)) {
    const wrong = unknownKeys(given, ['min', 'max'], 'the focus')
    if (wrong !== null) return failure(wrong)
    const { min, max } = given as { min?: unknown; max?: unknown }
    if (!isVec(min) || !isVec(max)) return failure(BOX_FORM)
    if (min.some((c, i) => c > max[i])) return failure(BOX_ORDER)
    return framed({ min, max }, 'box', `${min.every((c, i) => c === max[i]) ? 'at ' : ''}${vector(min)}${min.every((c, i) => c === max[i]) ? '' : ` to ${vector(max)}`} mm, as you gave it`, [])
  }
  if (typeof given !== 'string' || given === '') return failure(FORMS)

  if (MARK_ID.test(given)) {
    const marks = await marksOf(deps, objectId)
    if ('content' in marks) return marks
    const mark = marks.find((m) => m.id === given)
    if (!mark) return noMark(given, marks)
    if (mark.kind === 'region') return failure(`${given} is a region of a scan, which has no place in the model's frame: give a box {"min": [x, y, z], "max": [x, y, z]} or a ref`)
    if (mark.layout !== layout) return failure(`${given} is in layout ${mark.layout}, not ${layout}: give layout "${mark.layout}", or a ref`)
    const points = markPoints(mark)
    if (points.length === 0) return failure(`${given} has no place to frame: give a ref or a box`)
    const box = { min: [0, 1, 2].map((i) => Math.min(...points.map((p) => p[i]))) as Vec3, max: [0, 1, 2].map((i) => Math.max(...points.map((p) => p[i]))) as Vec3 }
    const parts = [...new Set(markAnchors(mark).flatMap((anchor) => (anchor.part === undefined ? [] : [anchor.part])))]
    const drifted = mark.anchorState === 'ok' ? '' : `, where it was placed (its part has ${mark.anchorState === 'orphaned' ? 'gone' : 'moved'} since)`
    return framed(box, `${given} (${mark.kind})`, `${boxText(box.min, box.max)} mm${drifted}`, parts)
  }

  const group = groupsIn(scene, layout).find((g) => g.name === given)
  if (group) {
    const members = scene.parts.filter((p) => p.layout === layout && group.parts.includes(p.name))
    const box = { min: [0, 1, 2].map((i) => Math.min(...members.map((p) => p.bbox.min[i]))) as Vec3, max: [0, 1, 2].map((i) => Math.max(...members.map((p) => p.bbox.max[i]))) as Vec3 }
    const exact = members.every((p) => p.bboxExact === true)
    const moved = members.filter((p) => Object.keys(movedForDisplay(p, layout)).length > 0).map((p) => p.name)
    return framed(box, `${given} (a group of ${members.length} part${members.length === 1 ? '' : 's'})`, exactText(box, exact), group.parts, movedText(moved, layout))
  }

  // A named set (`#deck`, `block/#deck`): the box round its members' boxes.
  if (isSetRef(given)) return setFocus(deps, objectId, found, layout, given, framed, drawn)

  const checked = checkRef(scene, layout, given)
  if (typeof checked === 'string') return failure(`${checked}; ${FORMS}`)
  const moved = Object.keys(movedForDisplay(checked.part, layout)).length > 0 ? movedText([checked.part.name], layout) : ''
  if (checked.target === 'part') return framed(checked.part.bbox, given, exactText(checked.part.bbox, checked.part.bboxExact === true), [checked.part.name], moved)

  // Before the kernel is asked: a face of a part the picture leaves out is not worth a query.
  const out = drawn([checked.part.name])
  if (out) return out
  let measured: { min?: unknown; max?: unknown; exact?: unknown }
  try {
    measured = await deps.query(objectId, 'measure', wire({ kind: 'bbox', layout, a: { ref: given } }))
  } catch (e) {
    return refusal(e, layout, 'box')
  }
  if (!isVec(measured?.min) || !isVec(measured?.max)) return failure('the kernel did not answer with a box')
  // As of the answer: a build may have ended while the kernel was asked, and the box is of the one it was asked about.
  if (deps.scene(objectId)?.revision !== found.revision) return failure(`${deps.object(objectId)?.name ?? objectId} was built again while the kernel was asked: call again`)
  return framed({ min: measured.min, max: measured.max }, given, exactText({ min: measured.min, max: measured.max }, measured.exact === true), [checked.part.name], moved)
}

type Framer = (box: { min: Vec3; max: Vec3 }, of: string, how: string, parts: string[], moved?: string) => Focused | ToolResult

/**
 * The box round the members a named set has in the last build: a part's from the scene, a face's or an edge's from the
 * kernel as one face's is (20 of them at most; a member past those is covered by its part's box, which makes the box
 * approximate). Lost members are left out and said. A stroke is framed by its points.
 */
async function setFocus(deps: ToolDeps, objectId: string, found: { scene: Scene; revision: number }, layout: string, given: string, framed: Framer, drawn: (parts: string[]) => ToolResult | null): Promise<Focused | ToolResult> {
  const { scene } = found
  const named = await setsAt(deps, objectId)
  if ('content' in named) return named
  const inLayout = scene.parts.filter((p) => p.layout === layout)
  const expanded = expandSet(named.sets, inLayout, layout, given, named.marks, named.fresh)
  if (expanded === null) return failure(`${given} is no set; ${FORMS}`)
  if ('error' in expanded) return failure(`${withLayoutHint(expanded.error)}; ${FORMS}`)
  if (expanded.refs.length + expanded.strokes.length === 0) return failure(`${expanded.said}: it names nothing the last build has, so there is nothing to frame`)

  const boxes: Array<{ min: Vec3; max: Vec3 }> = []
  let exact = true
  const names: string[] = []
  const queried: string[] = []
  for (const ref of expanded.refs) {
    const part = inLayout.find((p) => p.name === ref || ref.startsWith(`${p.name}/`))
    if (!part) continue
    if (!names.includes(part.name)) names.push(part.name)
    if (ref === part.name) {
      boxes.push(part.bbox)
      exact = exact && part.bboxExact === true
    } else if (queried.length < MOST_DESCRIBED) queried.push(ref)
    else {
      // Past the most that are asked of the kernel: its part's box covers it.
      boxes.push(part.bbox)
      exact = false
    }
  }
  // Before the kernel is asked: a part the picture leaves out is not worth a query.
  const out = drawn(names)
  if (out) return out
  for (const ref of queried) {
    let measured: { min?: unknown; max?: unknown; exact?: unknown }
    try {
      measured = await deps.query(objectId, 'measure', wire({ kind: 'bbox', layout, a: { ref } }))
    } catch (e) {
      return refusal(e, layout, 'box')
    }
    if (!isVec(measured?.min) || !isVec(measured?.max)) return failure('the kernel did not answer with a box')
    boxes.push({ min: measured.min, max: measured.max })
    exact = exact && measured.exact === true
  }
  // As of the answer: a build may have ended while the kernel was asked, and the box is of the one it was asked about.
  if (queried.length > 0 && deps.scene(objectId)?.revision !== found.revision) return failure(`${deps.object(objectId)?.name ?? objectId} was built again while the kernel was asked: call again`)
  for (const ref of expanded.strokes) {
    const [sketch, id] = ref.split('/')
    const mark = named.marks.find((m) => m.id === sketch)
    const stroke = mark?.kind === 'sketch' ? mark.strokes.find((s) => s.id === id) : undefined
    if (!mark || mark.kind !== 'sketch' || !stroke) continue
    const points = sketchStrokePoints(mark, stroke)
    if (points.length === 0) continue
    boxes.push({ min: [0, 1, 2].map((i) => Math.min(...points.map((p) => p[i]))) as Vec3, max: [0, 1, 2].map((i) => Math.max(...points.map((p) => p[i]))) as Vec3 })
    exact = false
  }
  if (boxes.length === 0) return failure(`${expanded.said}: it has no box to frame`)
  const box = { min: [0, 1, 2].map((i) => Math.min(...boxes.map((b) => b.min[i]))) as Vec3, max: [0, 1, 2].map((i) => Math.max(...boxes.map((b) => b.max[i]))) as Vec3 }
  const moved = inLayout.filter((p) => names.includes(p.name) && Object.keys(movedForDisplay(p, layout)).length > 0).map((p) => p.name)
  return framed(box, given, `${expanded.said.slice(expanded.said.indexOf(': ') + 2)}; ${exactText(box, exact)}`, names, movedText(moved, layout))
}

const exactText = (box: { min: Vec3; max: Vec3 }, exact: boolean): string => `box ${exact ? '' : '≈ '}${vector(box.min)} to ${vector(box.max)} mm, ${exact ? 'exact' : 'approximate'}`

const movedText = (names: string[], layout: string): string => (names.length === 0 ? '' : `${names.join(' and ')} ${names.length === 1 ? 'was' : 'were'} moved by torno for display in layout ${layout}: ${names.length === 1 ? 'it is' : 'they are'} framed where ${names.length === 1 ? 'it is' : 'they are'} shown, not where the model places ${names.length === 1 ? 'it' : 'them'}.`)

/**
 * Why a picture that leaves out a part the focus is of would show nothing of it, as the answer to give; null when
 * the parts are drawn. `asked` is the parts the call names (a group already expanded), or undefined for those the user
 * has switched on, which `visible` (part keys of the layout on screen) says when the picture is of that layout.
 */
export function notDrawn(parts: readonly string[], layout: string, asked: readonly string[] | undefined, screen: { layout: string; visible: readonly string[] } | undefined): ToolResult | null {
  let gone: string[]
  let why: (it: string) => string
  if (asked !== undefined) {
    gone = parts.filter((name) => !asked.includes(name))
    why = (it) => `parts leaves ${it} out. Add ${it} to parts`
  } else if (screen && screen.layout === layout) {
    gone = parts.filter((name) => !screen.visible.includes(`${layout}:${name}`))
    why = (it) => `the user has ${it} switched off. Name ${it} in parts to draw ${it}, e.g. "parts": ${JSON.stringify(gone)}`
  } else return null
  if (gone.length === 0) return null
  return failure(`${gone.join(' and ')} ${gone.length === 1 ? 'is' : 'are'} not drawn: ${why(gone.length === 1 ? 'it' : 'them')}`)
}

/** The line a reply gives when the window found parts between the camera and the middle of the focus. '' when none. */
export function hiddenText(hiddenBy: readonly string[] | undefined): string {
  if (!hiddenBy || hiddenBy.length === 0) return ''
  return `\nThe middle of the focus is hidden from this side: ${hiddenBy.join(' and ')} ${hiddenBy.length === 1 ? 'stands' : 'stand'} between it and the camera. Look with parts that leave ${hiddenBy.length === 1 ? 'it' : 'them'} out, with a section, or from another side.`
}
