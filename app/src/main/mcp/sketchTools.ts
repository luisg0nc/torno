import type { SketchDraft } from '../../shared/bridge'
import { type Mark, type SketchMark, type SketchPlane, type SketchStroke, type Vec3, MAX_SKETCH_DIAMETER, MAX_SKETCH_NAME, MAX_NOTE, MAX_STROKE_POINTS } from '../../shared/marks'
import { type MainAxis, type PlaneFrame, axesOfNormal, directionText, mainPlaneFrame } from '../../shared/planes'
import type { Scene } from '../../shared/scene'
import { describeMark, vector } from '../marks/describe'
import { oneLine, readSketch } from '../sketches/read'
import { strokeTouches } from '../sketches/touches'
import { unknownKeys } from './keys'
import { type AddSketchArgs, MOST_AGENT_POINTS, MOST_AGENT_STROKES, NO_SKETCH_STROKE } from './schemas'
import { type ToolDeps, type ToolResult, MARK_ID, behind, built, failure, layoutFor, marksOf, messageOf, noMark } from './tools'
import { checkRef, markCamera } from './markTools'

// `add_sketch`: Claude's own drawing in 3D, made, replaced or removed. Main makes the planes' frames (a main plane's axes as
// `viewPlane` labels them, a face plane from the kernel's `describe` of that face), checks every number, the reach of the
// points from the parts and the caps, and works out what each stroke touches against the last build. The sketch is the
// agent's, of the last build, and has no snaps: its points are its own, and are told as given.

const STROKE_KEYS = ['points', 'plane', 'points2d']
const MAIN_PLANE_KEYS = ['main', 'offset']
const FACE_PLANE_KEYS = ['face', 'offset']
const POINT_PLANE_KEYS = ['origin', 'normal']
const SKETCH_KEYS = ['name', 'note', 'take', 'diameter', 'layout', 'sketch', 'remove', 'strokes']

/** How far from the layout's parts a point may be, in diagonals of their box. */
const REACH = 10
/** The diagonal reach is counted from, at least, so that a layout of tiny parts does not forbid a sketch beside them. */
const LEAST_DIAGONAL_MM = 100

const isPoint3 = (value: unknown): value is Vec3 => Array.isArray(value) && value.length === 3 && value.every((c) => typeof c === 'number' && Number.isFinite(c))
const isPoint2 = (value: unknown): value is [number, number] => Array.isArray(value) && value.length === 2 && value.every((c) => typeof c === 'number' && Number.isFinite(c))
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isMainAxis = (value: unknown): value is MainAxis => value === 'XY' || value === 'XZ' || value === 'YZ'
const mm = (n: number): string => String(Number(n.toFixed(3)))

/** The box of the layout's parts: where its middle is and how long its diagonal is (the least, `LEAST_DIAGONAL_MM`). */
function reachOf(scene: Scene, layout: string): { centre: Vec3; reach: number } {
  const parts = scene.parts.filter((p) => p.layout === layout)
  if (parts.length === 0) return { centre: [0, 0, 0], reach: REACH * LEAST_DIAGONAL_MM }
  const min = [0, 1, 2].map((i) => Math.min(...parts.map((p) => p.bbox.min[i])))
  const max = [0, 1, 2].map((i) => Math.max(...parts.map((p) => p.bbox.max[i])))
  const diagonal = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2])
  return { centre: [0, 1, 2].map((i) => (min[i] + max[i]) / 2) as Vec3, reach: REACH * Math.max(diagonal, LEAST_DIAGONAL_MM) }
}

const plus = (a: Vec3, b: Vec3, k: number): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k]
/** Numbers as a plane keeps them: no negative zeros, no noise past the micron. */
const tidy = (v: Vec3): Vec3 => v.map((c) => Math.round(c * 1e9) / 1e9 + 0) as Vec3

/** A plane as Claude names it, as a frame and how it was made; or why it is none. `id` is the number it is given in the sketch. */
async function planeOf(deps: ToolDeps, objectId: string, scene: Scene, layout: string, revision: number, n: number, id: number, value: unknown): Promise<SketchPlane | string> {
  const at = `the plane of stroke ${n}`
  if (!isRecord(value)) return `${at} is not a plane: ${NO_SKETCH_STROKE}`
  if ('main' in value) {
    const wrong = unknownKeys(value, MAIN_PLANE_KEYS, at)
    if (wrong) return wrong
    if (!isMainAxis(value.main)) return `${at} names the main plane ${JSON.stringify(value.main)}: it is XY, XZ or YZ`
    if (typeof value.offset !== 'number' || !Number.isFinite(value.offset)) return `${at} has an offset that is not a number of mm`
    const frame: PlaneFrame = mainPlaneFrame(value.main, value.offset)
    return { id, ...frame, from: { kind: 'main', axis: value.main, offset: value.offset } }
  }
  if ('face' in value) {
    const wrong = unknownKeys(value, FACE_PLANE_KEYS, at)
    if (wrong) return wrong
    if (typeof value.face !== 'string' || value.face === '') return `${at} names a face that is no ref: a face is lid/F12`
    if (typeof value.offset !== 'number' || !Number.isFinite(value.offset)) return `${at} has an offset that is not a number of mm`
    const checked = checkRef(scene, layout, value.face)
    if (typeof checked === 'string') return checked
    if (checked.target !== 'face') return `${at} is through ${value.face}, which is ${checked.target === 'part' ? 'a part' : 'an edge'}, not a face`
    let described
    try {
      described = await deps.describe(objectId, layout, checked.ref)
    } catch (e) {
      return `${at} is through ${checked.ref}, which the kernel could not describe: ${messageOf(e)}`
    }
    if (described.kind !== 'face') return `${at} is through ${checked.ref}, which the kernel does not say is a face`
    if (described.type !== 'plane' || !described.normal) return `${checked.ref} is not flat (the kernel says ${described.descriptor}): a plane goes through a planar face, or give {"origin": [x, y, z], "normal": [x, y, z]}`
    const axes = axesOfNormal(described.normal)
    if (!axes || !isPoint3(described.center)) return `the kernel gave no usable normal or centre for ${checked.ref}`
    const x = tidy(axes.x)
    const y = tidy(axes.y)
    const origin = tidy(plus(described.center, axes.normal, value.offset))
    const label = `plane through ${checked.ref} offset ${mm(value.offset)} mm (u = ${directionText(x)}, v = ${directionText(y)})`
    return { id, origin, x, y, label, from: { kind: 'face', ref: checked.ref, offset: value.offset, revision } }
  }
  if ('origin' in value || 'normal' in value) {
    const wrong = unknownKeys(value, POINT_PLANE_KEYS, at)
    if (wrong) return wrong
    if (!isPoint3(value.origin) || !isPoint3(value.normal)) return `${at} needs an origin and a normal, each [x, y, z] of finite numbers in mm`
    const axes = axesOfNormal(value.normal)
    if (!axes) return `the normal of ${at} has no length`
    const x = tidy(axes.x)
    const y = tidy(axes.y)
    const label = `plane through ${vector(value.origin)} normal ${directionText(tidy(axes.normal))} (u = ${directionText(x)}, v = ${directionText(y)})`
    return { id, origin: [...value.origin], x, y, label, from: { kind: 'point', point: [...value.origin], normal: tidy(axes.normal), offset: 0 } }
  }
  return `${at} is not a plane: ${NO_SKETCH_STROKE}`
}

/** What `add_sketch` makes of its `strokes`: the planes and the strokes as a sketch keeps them, or why it is none. Nothing is kept. */
async function strokesOf(
  deps: ToolDeps,
  objectId: string,
  scene: Scene,
  layout: string,
  revision: number,
  given: unknown
): Promise<{ planes: SketchPlane[]; strokes: SketchStroke[] } | string> {
  if (!Array.isArray(given) || given.length === 0) return `give strokes, 1 to ${MOST_AGENT_STROKES}: ${NO_SKETCH_STROKE}`
  if (given.length > MOST_AGENT_STROKES) return `a sketch of yours has at most ${MOST_AGENT_STROKES} strokes, and this one has ${given.length}: draw the rest in a sketch of its own`
  const planes: SketchPlane[] = []
  /** The planes made, by what was said of them: two strokes on the same plane share one. */
  const made = new Map<string, number>()
  const strokes: SketchStroke[] = []
  const { centre, reach } = reachOf(scene, layout)
  let points = 0
  for (const [i, raw] of given.entries()) {
    const n = i + 1
    if (!isRecord(raw)) return `stroke ${n} is not a stroke: ${NO_SKETCH_STROKE}`
    const wrong = unknownKeys(raw, STROKE_KEYS, `stroke ${n}`)
    if (wrong) return wrong
    const onPlane = raw.plane !== undefined
    if (onPlane === (raw.points !== undefined) || onPlane === (raw.points2d === undefined)) return `stroke ${n} is not a stroke: ${NO_SKETCH_STROKE}`
    const list = onPlane ? raw.points2d : raw.points
    if (!Array.isArray(list) || list.length === 0) return `stroke ${n} has no points`
    if (list.length > MAX_STROKE_POINTS) return `stroke ${n} has ${list.length} points, and a stroke has at most ${MAX_STROKE_POINTS}: break it in two, or leave out points a line does not need`
    points += list.length
    if (points > MOST_AGENT_POINTS) return `a sketch of yours has at most ${MOST_AGENT_POINTS} points in all: stroke ${n} goes past that`
    for (const [k, point] of list.entries()) {
      if (!(onPlane ? isPoint2(point) : isPoint3(point))) return `stroke ${n}, point ${k + 1} is not ${onPlane ? 'two' : 'three'} finite numbers in mm`
    }
    const pen = list.length === 1 ? 'points' : 'line'
    if (!onPlane) {
      const far = (list as Vec3[]).findIndex((p) => Math.hypot(p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]) > reach)
      if (far >= 0) return `stroke ${n}, point ${far + 1} ${vector((list as Vec3[])[far])} is more than ${REACH} diagonals of the layout's parts away from them: points are in mm in the frame of the layout`
      strokes.push({ points: (list as Vec3[]).map((p) => [...p] as Vec3), pen, revision })
      continue
    }
    const key = JSON.stringify(raw.plane)
    let id = made.get(key)
    if (id === undefined) {
      const plane = await planeOf(deps, objectId, scene, layout, revision, n, planes.length + 1, raw.plane)
      if (typeof plane === 'string') return plane
      id = plane.id
      planes.push(plane)
      made.set(key, id)
    }
    const plane = planes.find((p) => p.id === id) as SketchPlane
    const far = (list as [number, number][]).findIndex(([u, v]) => {
      const p = plus(plus(plane.origin, plane.x, u), plane.y, v)
      return Math.hypot(p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]) > reach
    })
    if (far >= 0) return `stroke ${n}, point ${far + 1} ([${(list as [number, number][])[far].join(', ')}] on ${plane.label}) is more than ${REACH} diagonals of the layout's parts away from them`
    strokes.push({ plane: id, points2d: (list as [number, number][]).map((p) => [...p] as [number, number]), pen, revision })
  }
  return { planes, strokes }
}

/** Where the sketch is, for its camera: the middle of its points. */
function middleOf(planes: SketchPlane[], strokes: SketchStroke[]): Vec3 {
  const all: Vec3[] = strokes.flatMap((s) => (s.points ?? (s.points2d ?? []).map(([u, v]) => plus(plus((planes.find((p) => p.id === s.plane) as SketchPlane).origin, (planes.find((p) => p.id === s.plane) as SketchPlane).x, u), (planes.find((p) => p.id === s.plane) as SketchPlane).y, v))))
  const sum = all.reduce<Vec3>((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0])
  return tidy([sum[0] / all.length, sum[1] / all.length, sum[2] / all.length])
}

/** The sketch of the agent's that `id` names, or why it is not one to change. */
async function ownSketch(deps: ToolDeps, objectId: string, id: unknown, what: 'change' | 'remove'): Promise<SketchMark | ToolResult> {
  if (typeof id !== 'string' || !MARK_ID.test(id)) return failure('sketch is the number of a sketch of yours, such as M9')
  const marks = await marksOf(deps, objectId)
  if ('content' in marks) return marks
  const mark = marks.find((m: Mark) => m.id === id)
  if (!mark) return noMark(id, marks)
  if (mark.kind !== 'sketch') return failure(`${id} is a ${mark.kind}, not a sketch`)
  if (mark.author !== 'agent') return failure(`${id} is the user's sketch: you cannot ${what} it. Make a sketch of your own with add_sketch, and say in its note what it changes.`)
  return mark
}

export async function addSketchTool(deps: ToolDeps, objectId: string, args: AddSketchArgs): Promise<ToolResult> {
  if (!deps.saveSketch || !deps.removeMark) return failure('add_sketch is not available here')
  // The schema lets every value through: what each is, is said here.
  if (args.sketch !== undefined && args.remove !== undefined && typeof args.remove !== 'boolean') return failure('remove is true or false')
  if (args.remove === true) {
    if (args.sketch === undefined) return failure('remove takes away the sketch that sketch names: give sketch, the number of a sketch of yours (M9)')
    const own = await ownSketch(deps, objectId, args.sketch, 'remove')
    if ('content' in own) return own
    try {
      await deps.removeMark(objectId, own.id)
    } catch (e) {
      return failure(messageOf(e))
    }
    return { content: [{ type: 'text', text: `removed ${own.id}, your sketch "${own.name}": it is gone from the viewport and the board, and the user can undo it` }] }
  }

  const replacing = args.sketch === undefined ? undefined : await ownSketch(deps, objectId, args.sketch, 'change')
  if (replacing && 'content' in replacing) return replacing
  const wrong = unknownKeys(args, SKETCH_KEYS, 'add_sketch')
  if (wrong) return failure(wrong)

  const found = built(deps, objectId)
  if ('content' in found) return found
  const { scene, revision } = found
  const layout = layoutFor(deps, objectId, scene, args.layout ?? replacing?.layout)
  if (typeof layout !== 'string') return layout

  const named = args.name === undefined ? replacing?.name : args.name
  if (typeof named !== 'string') return failure(args.name === undefined ? 'a sketch needs a name, a line saying what it is' : 'name is text')
  const name = oneLine(named)
  if (name === '') return failure('a sketch needs a name, a line saying what it is')
  if (name.length > MAX_SKETCH_NAME) return failure(`the name of a sketch is at most ${MAX_SKETCH_NAME} characters, and this one has ${name.length}`)
  if (args.note !== undefined && typeof args.note !== 'string') return failure('note is text')
  const take = args.take ?? replacing?.take ?? 'rough'
  if (take !== 'exact' && take !== 'rough' && take !== 'flow') return failure('take is exact, rough or flow')
  const diameter = args.diameter ?? (take === 'flow' && args.take === undefined ? replacing?.diameter : undefined)
  if (diameter !== undefined) {
    if (take !== 'flow') return failure('only a flow sketch has a diameter: set take to flow, or leave diameter out')
    if (typeof diameter !== 'number' || !Number.isFinite(diameter) || !(diameter > 0) || diameter > MAX_SKETCH_DIAMETER) return failure(`diameter is the width of the route in mm, more than 0 and at most ${MAX_SKETCH_DIAMETER}`)
  }

  const made = await strokesOf(deps, objectId, scene, layout, revision, args.strokes)
  if (typeof made === 'string') return failure(made)

  // Main's own reading of a sketch: the caps, and planes that are frames.
  const body = readSketch({ name, take, ...(diameter === undefined ? {} : { diameter }), planes: made.planes, strokes: made.strokes }, 'window')
  if (typeof body === 'string') return failure(`that is not a sketch: ${body}`)

  const draft: SketchDraft = {
    objectId,
    ...(replacing ? { id: replacing.id } : {}),
    layout,
    revision,
    camera: markCamera(scene, layout, middleOf(body.planes, body.strokes), undefined),
    name: body.name,
    note: (args.note ?? replacing?.note ?? '').slice(0, MAX_NOTE),
    take: body.take,
    ...(body.diameter === undefined ? {} : { diameter: body.diameter }),
    planes: body.planes,
    strokes: body.strokes
  }

  // What each stroke touches is the build's to say; a kernel that cannot say leaves it with none, and the sketch is kept.
  let touches: string[][] = body.strokes.map(() => [])
  try {
    touches = await strokeTouches(
      { objectId, scene, query: async (_id, _name, asked) => ({ anchors: await deps.nearest(objectId, (asked as { layout: string }).layout, (asked as { anchors: never[] }).anchors) }) as never },
      layout,
      draft,
      body.strokes
    )
  } catch {
    // None known.
  }

  let saved: Mark
  try {
    saved = await deps.saveSketch(objectId, draft, touches)
  } catch (e) {
    return failure(messageOf(e))
  }
  if (saved.kind !== 'sketch') return failure(`${saved.id} was not kept as a sketch`)
  const why = behind(deps, objectId)
  const stale = why ? `, stale: ${why}, so the sketch was made on the parts of r${revision}` : ''
  const lines = [`${replacing ? 'replaced' : 'made'} in layout ${layout}: ${describeMark(saved, { scene })}`]
  for (const plane of saved.planes) lines.push(`plane ${plane.id}: ${plane.label}`)
  saved.strokes.forEach((stroke, i) => {
    const count = (stroke.points ?? stroke.points2d ?? []).length
    lines.push(`stroke ${i + 1}: ${count} point${count === 1 ? '' : 's'}${stroke.plane === undefined ? ' in space' : ` on plane ${stroke.plane}`}${stroke.touches && stroke.touches.length > 0 ? `, touches ${stroke.touches.join(', ')}` : ''}`)
  })
  lines.push(`Its card is on the board, and its picture shows when the project is on show in the torno window.`)
  lines.push(`revision r${revision}${stale}`)
  return { content: [{ type: 'text', text: lines.join('\n') }] }
}
