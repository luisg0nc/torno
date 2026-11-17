import { useStore as useZustand } from 'zustand'
import { createStore } from 'zustand/vanilla'
import type { SketchDraft } from '../../shared/bridge'
import { MAX_SKETCH_DIAMETER, MAX_SKETCH_NAME, MOST_SKETCH_PLANES, MOST_SKETCH_POINTS, MOST_SKETCH_STROKES, type Anchor, type Mark, type SketchMark, type NewStroke, type SketchPlane, type SketchTake, type Vec3 } from '../../shared/marks'
import type { Camera } from '../../shared/view'
import { type Tracing } from '../../shared/tracings'
import { inkPlane } from '../ui/tracings/inkTool'
import { type PlaneDraft, mainPlane, withOffset } from '../tools/sketch/planes'
import type { Pen } from '../tools/sketch/pens'
import { reviewActions } from './review'
import { setTool, toolStore } from './tools'

// A 3D sketch being drawn (the Draw tool, `tools/sketchTool.ts`; the panel is `ui/sketch/`). The draft is the whole sketch as
// main keeps it: every stroke added or erased, and every change of a field, sends it (`marks:sketch`), at once for a stroke
// and 300 ms after the last key for a field that is typed in. The mark is made by the first stroke, so a sketch that is
// started and left with none writes nothing; main gives its number then, and the next sends carry it. Nothing of a pointer
// move is here: the pen and the pointer's hint are the tool's, drawn through the overlay.

/** How long a typed field waits for the next key before it is sent, in milliseconds. */
export const TYPED_MS = 300
/** The pens of the tool: the three of `PenState`, and the eraser. */
export type SketchPen = Pen | 'erase'

export interface Sketching {
  /** The sketch being drawn; `id` is main's, once the first stroke has made it. */
  open: { id?: string; draft: SketchDraft } | null
  /** The plane strokes go on, by its number in the sketch, or `surface`. */
  plane: number | 'surface'
  pen: SketchPen
  snapping: boolean
  xray: boolean
  /** Why main refused the last change, in its words; null once a change is kept. */
  problem: string | null
  /** How many strokes added or erased can be taken back. */
  undoable: number
  /** The next click on a part makes a plane: of that face, or through that point. */
  picking: 'face' | 'point' | null
  /** How many times the offset field has been asked for (`Tab`): the panel takes the keys each time. */
  offsetAsked: number
  /** The row of the panel the pointer is on: the strokes of that plane, or of the surface, are lit in the view. */
  lit: number | 'surface' | null
}

const INITIAL: Sketching = { open: null, plane: 'surface', pen: 'free', snapping: true, xray: false, problem: null, undoable: 0, picking: null, offsetAsked: 0, lit: null }

export const sketchStore = createStore<Sketching>(() => INITIAL)

export function useSketching<T>(select: (s: Sketching) => T): T {
  return useZustand(sketchStore, select)
}

/** What the sketch needs of the window: main's calls, where and when the view is, the picture of its card, and where a refusal is said. */
export interface SketchEnv {
  marks: { sketch(draft: SketchDraft): Promise<Mark>; sketchPicture(objectId: string, id: string, png: Uint8Array): Promise<void>; sketching(objectId: string, id: string | null): void }
  /** The project, layout, build and camera on show, and the middle of its parts; null with none. */
  here(): { objectId: string; layout: string; revision: number; camera: Camera; centre: Vec3 } | null
  /** The picture of the card: the view from `camera` at 1280 px, with the marks drawn. Null when none can be drawn. */
  picture(camera: Camera): Promise<Uint8Array | null>
  /** The picture of the card of ink on a tracing: the tracing view at 1280 px with the ink drawn. Without it the card keeps its placeholder. */
  tracingPicture?(objectId: string, id: string): Promise<Uint8Array | null>
  /** Says why a change was not kept. */
  say(objectId: string, message: string): void
}

let env: SketchEnv | null = null
export function setSketchEnv(next: SketchEnv | null): void {
  env = next
}

/** The project, layout, build and camera on show, as a sketch is begun from them; null with none (the view is not up, or nothing is built). */
export function sketchHere(): { objectId: string; layout: string; revision: number; camera: Camera } | null {
  const here = env?.here()
  return here ? { objectId: here.objectId, layout: here.layout, revision: here.revision, camera: here.camera } : null
}

// ---------------------------------------------------------------------------------------------------------------------
// What is kept to undo, and to send.

type Step = { kind: 'add'; stroke: NewStroke } | { kind: 'erase'; stroke: NewStroke; index: number }
let history: Step[] = []
let timer: ReturnType<typeof setTimeout> | undefined
/** A send is waiting on main: the next waits for it, so that the sketch has its number by then. */
let inflight: Promise<void> | null = null
let queued = false
/** The sketch to send once the send in the air is answered, when it was let go meanwhile (`leaveSketch`); else the open one. */
let queuedOpen: NonNullable<Sketching['open']> | null = null
/** `queuedOpen` was let go: it is sent as it was, with its own revision and camera (`flush`'s `own`). */
let queuedOwn = false
/** The marks main sent while a send was waiting or in the air: taken again once it is answered (`takeMarks`). */
let late: readonly Mark[] | null = null

const state = (): Sketching => sketchStore.getState()
const set = (patch: Partial<Sketching>): void => sketchStore.setState(patch)

function counted(): void {
  set({ undoable: history.length })
}

/** The sketch with the change made to its draft; nothing when none is open. */
function change(make: (draft: SketchDraft) => SketchDraft): boolean {
  const open = state().open
  if (!open) return false
  set({ open: { ...open, draft: make(open.draft) } })
  return true
}

const strokesOn = (draft: SketchDraft, plane: number): number => draft.strokes.filter((s) => s.plane === plane).length
const pointsIn = (draft: SketchDraft): number => draft.strokes.reduce((sum, s) => sum + (s.points ?? s.points2d ?? []).length, 0)

/** The plane strokes go on now; null on the surface. */
export function activePlane(s: Sketching = state()): SketchPlane | null {
  if (!s.open || s.plane === 'surface') return null
  return s.open.draft.planes.find((p) => p.id === s.plane) ?? null
}

/** The camera looks along the axis this plane is across: the plane it faces. */
function facing(camera: Camera): 'XY' | 'XZ' | 'YZ' {
  const look = [0, 1, 2].map((i) => Math.abs(camera.target[i] - camera.position[i]))
  return look[2] >= look[0] && look[2] >= look[1] ? 'XY' : look[1] >= look[0] ? 'XZ' : 'YZ'
}

// ---------------------------------------------------------------------------------------------------------------------
// Opening and closing.

/** Opens a new sketch of the project on show, on the plane its view faces through the middle of the parts; false when there is no project on show to sketch. Nothing is written until the first stroke. */
export function startSketch(objectId: string): boolean {
  // Ink on a tracing is the tracing view's own: the Draw tool does not take it over, and it is let go (what it holds is kept).
  if (inkIsOpen()) leaveSketch()
  if (state().open) return state().open!.draft.objectId === objectId
  const here = env?.here()
  if (!env || !here || here.objectId !== objectId) return false
  const axis = facing(here.camera)
  const around = here.centre
  const first = mainPlane(axis, around[axis === 'XY' ? 2 : axis === 'XZ' ? 1 : 0], around)
  history = []
  set({ open: { draft: { objectId, layout: here.layout, revision: here.revision, camera: here.camera, name: '', note: '', take: 'rough', planes: [{ id: 1, ...first }], strokes: [] } }, plane: 1, problem: null, picking: null, undoable: 0 })
  return true
}

/**
 * Opens ink on a tracing: a sketch of the person's whose one plane is the tracing's own (`inkPlane`), rough by nature. The ink of that tracing
 * that is open already goes on; any other sketch that is open is let go (what it held is kept). Nothing is written until the first stroke.
 * False when there is no build on show to draw on.
 */
export function startInk(objectId: string, tracing: Pick<Tracing, 'id' | 'layout' | 'plane'>): boolean {
  const open = state().open
  if (open && open.draft.objectId === objectId && open.draft.tracing === tracing.id) return true
  if (open) leaveSketch()
  const here = env?.here()
  if (!env || !here || here.objectId !== objectId) return false
  history = []
  set({
    open: { draft: { objectId, layout: tracing.layout, revision: here.revision, camera: here.camera, name: '', note: '', take: 'rough', tracing: tracing.id, planes: [inkPlane(tracing)], strokes: [] } },
    plane: 1,
    problem: null,
    picking: null,
    undoable: 0
  })
  return true
}

/** Whether ink on a tracing is the sketch that is open. */
export const inkIsOpen = (s: Sketching = state()): boolean => s.open?.draft.tracing !== undefined

/** Opens a sketch of the person's again, in the same tool. The agent's is not the person's to change. */
export async function editSketch(mark: SketchMark): Promise<void> {
  const here = env?.here()
  if (!env || !here) return
  if (mark.author !== 'user') {
    env.say(here.objectId, `${mark.id} is Claude's sketch: only Claude changes it.`)
    return
  }
  if (state().open?.id === mark.id) return
  if (mark.layout !== here.layout) {
    env.say(here.objectId, `${mark.id} is a sketch of the layout ${mark.layout}: show that layout to change it.`)
    return
  }
  await finishSketch()
  history = []
  const used = mark.strokes.at(-1)?.plane
  set({
    open: {
      id: mark.id,
      draft: {
        objectId: here.objectId,
        id: mark.id,
        layout: mark.layout,
        revision: here.revision,
        camera: mark.camera,
        name: mark.name,
        note: mark.note,
        take: mark.take,
        ...(mark.diameter === undefined ? {} : { diameter: mark.diameter }),
        planes: mark.planes.map((p) => structuredClone(p)),
        strokes: mark.strokes.map((s) => structuredClone(s)),
        ...(mark.tracing === undefined ? {} : { tracing: mark.tracing }),
        ...(mark.anchor ? { anchor: structuredClone(mark.anchor) } : {})
      }
    },
    plane: used ?? mark.planes.at(-1)?.id ?? 'surface',
    problem: null,
    picking: null,
    undoable: 0
  })
  env.marks.sketching(here.objectId, mark.id)
  if (toolStore.getState().tool !== 'draw') setTool('draw')
}

/**
 * Closes the sketch, as it is: what was drawn is kept (main has it). What was waiting to be sent (a typed field, or what
 * queued behind a send) is sent first, unless `send` is false (main no longer has the sketch).
 */
export function leaveSketch(send = true): void {
  const open = state().open
  const waiting = timer !== undefined || queued
  clearTimeout(timer)
  timer = undefined
  if (!send) {
    queued = false
    queuedOpen = null
    queuedOwn = false
  }
  late = null
  if (send && open && waiting) flush(open, true)
  history = []
  if (open?.id && env) env.marks.sketching(open.draft.objectId, null)
  set({ ...INITIAL, pen: state().pen, snapping: state().snapping })
}

/**
 * Done: what is waiting is sent, the picture of the sketch's card is drawn from its camera at 1280 px and kept by main, and the
 * sketch is closed. A sketch with no stroke has no card and writes nothing.
 */
export async function finishSketch(): Promise<void> {
  const open = state().open
  if (!open) return
  if (timer !== undefined) {
    clearTimeout(timer)
    timer = undefined
    flush()
  }
  while (inflight) await inflight
  const now = state().open
  // Left meanwhile: nothing is left to do.
  if (!now) return
  const id = now.id
  if (id && env) {
    try {
      // Ink on a tracing is drawn from the tracing's own view, and the sketch of the 3D view from where it was drawn.
      const png = now.draft.tracing === undefined ? await env.picture(now.draft.camera) : ((await env.tracingPicture?.(now.draft.objectId, id)) ?? null)
      if (png) await env.marks.sketchPicture(now.draft.objectId, id, png)
    } catch {
      // The card is left with its placeholder: the sketch is none the less kept.
    }
  }
  leaveSketch()
  // Done is the end of drawing: the tool in hand goes back to Select (a tool put down for another is not asked).
  if (toolStore.getState().tool === 'draw' && now.draft.tracing === undefined) setTool('select')
}

// ---------------------------------------------------------------------------------------------------------------------
// Sending.

/** A change is made: sent at once, or once typing has stopped. Before the first stroke nothing is sent, there being no sketch to make. */
function changed(typed = false): void {
  clearTimeout(timer)
  timer = undefined
  if (typed) timer = setTimeout(() => ((timer = undefined), flush()), TYPED_MS)
  else flush()
}

/**
 * Sends the open sketch, or `given`. The revision and camera it is sent with are the view's as it is now, unless `own`: a
 * sketch let go is sent as it was, with its own, the view being of another project or layout by then.
 */
function flush(given?: NonNullable<Sketching['open']>, own = false): void {
  const open = given ?? state().open
  if (!open || !env) return
  // A sketch is made by its first stroke: with none, there is nothing to keep, and a field changed meanwhile goes with it.
  if (!open.id && open.draft.strokes.length === 0) return
  if (inflight) {
    queued = true
    queuedOpen = open
    queuedOwn = own
    return
  }
  const sent = open
  const here = env.here()
  // The layout is the one the sketch was started in: a sketch does not move to another.
  // What the bar of an open review says is said of a new sketch only; main keeps it of the sketch it makes, and never changes it of one it has.
  const intent = sent.id || sent.draft.id ? undefined : reviewActions.intentForNew(sent.draft.layout)
  const draft: SketchDraft = { ...sent.draft, ...(sent.id ? { id: sent.id } : {}), ...(here && !own ? { revision: here.revision, camera: here.camera } : {}), ...(intent ? { intent } : {}) }
  const call = env.marks.sketch(draft).then(
    (mark) => {
      // Let go while this made it: what waits to be sent for it goes to the sketch main made, not to a second one.
      if (queuedOpen && !queuedOpen.id && !queuedOpen.draft.id && queuedOpen.draft.objectId === draft.objectId && (!state().open || queuedOwn)) queuedOpen = { id: mark.id, draft: { ...queuedOpen.draft, id: mark.id } }
      // Gone, or another sketch is open now.
      const now = state().open
      if (!now || (now.id ?? mark.id) !== mark.id || now.draft.objectId !== draft.objectId) return
      if (!now.id) {
        set({ open: { ...now, id: mark.id, draft: { ...now.draft, id: mark.id } } })
        env?.marks.sketching(draft.objectId, mark.id)
      }
      set({ problem: null })
    },
    (e: unknown) => {
      const text = e instanceof Error ? e.message : String(e)
      set({ problem: text })
      env?.say(draft.objectId, `The sketch was not kept: ${text}`)
    }
  )
  inflight = call.finally(() => {
    inflight = null
    if (queued) {
      const next = queuedOpen
      const own = queuedOwn
      queued = false
      queuedOpen = null
      queuedOwn = false
      // The sketch as it is now (it has its number by now); the one that was let go meanwhile is sent as it was.
      flush(own || !state().open ? (next ?? undefined) : undefined, own)
      return
    }
    // What main moved meanwhile is taken now that the window has nothing in the air.
    if (late && timer === undefined) {
      const marks = late
      late = null
      takeMarks(marks)
    }
  })
}

/** Waits until what has been sent is answered (and what was queued behind it): for the tests. */
export async function settled(): Promise<void> {
  while (inflight) await inflight
}

// ---------------------------------------------------------------------------------------------------------------------
// The planes.

/**
 * Makes a plane the one strokes go on. The plane in hand, when nothing has been drawn on it, is replaced (a cube clicked
 * twice makes one plane); otherwise this is a plane of its own. Past the planes a sketch keeps it is refused, with why.
 */
export function activatePlane(plane: PlaneDraft): void {
  const open = state().open
  if (!open) return
  const current = activePlane()
  if (current && strokesOn(open.draft, current.id) === 0) {
    change((d) => ({ ...d, planes: d.planes.map((p) => (p.id === current.id ? { ...plane, id: current.id } : p)) }))
    return
  }
  addPlane(plane)
}

/** Adds a plane to the sketch and makes it the one strokes go on, whether or not the one in hand has strokes. */
export function addPlane(plane: PlaneDraft): void {
  const open = state().open
  if (!open) return
  if (open.draft.planes.length >= MOST_SKETCH_PLANES) {
    refuse(`A sketch has at most ${MOST_SKETCH_PLANES} planes.`)
    return
  }
  const id = Math.max(0, ...open.draft.planes.map((p) => p.id)) + 1
  change((d) => ({ ...d, planes: [...d.planes, { ...plane, id }] }))
  set({ plane: id, picking: null })
}

/** Strokes go on this plane of the sketch, or on the surface. */
export function setPlane(plane: number | 'surface'): void {
  const open = state().open
  if (!open || (plane !== 'surface' && !open.draft.planes.some((p) => p.id === plane))) return
  set({ plane, picking: null })
}

/** Moves the active plane to `offset` mm: where strokes are on it, it stays and a plane of its own is made at the offset. A plane of a locked view has none. */
export function setOffset(offset: number, opts: { typed?: boolean } = {}): void {
  const plane = activePlane()
  if (!plane || !Number.isFinite(offset) || plane.from.kind === 'view' || plane.from.kind === 'tracing') return
  const moved = withOffset(plane, offset)
  if (moved === plane) return
  const { id: _id, ...draft } = moved
  activatePlane(draft)
  if (opts.typed) changed(true)
}

/** The offset of the active plane in mm, or null for none (the surface, a plane of a locked view). */
export function offsetOf(plane: SketchPlane | null): number | null {
  return plane && plane.from.kind !== 'view' && plane.from.kind !== 'tracing' ? plane.from.offset : null
}

/** The next click on a part makes a plane of that face or through that point; null for no longer waiting. */
export function pickPlane(kind: 'face' | 'point' | null): void {
  set({ picking: kind })
}

/** The offset field is asked for: `Tab`. */
export function askOffset(): void {
  set({ offsetAsked: state().offsetAsked + 1 })
}

// ---------------------------------------------------------------------------------------------------------------------
// The strokes.

function refuse(message: string): void {
  set({ problem: message })
  const objectId = state().open?.draft.objectId
  if (objectId && env) env.say(objectId, message)
}

/** Adds a stroke, and sends the sketch. The first stroke makes the mark. A stroke past what a sketch keeps is refused. */
export function addStroke(stroke: NewStroke, anchor?: Anchor): boolean {
  const open = state().open
  if (!open) return false
  if (open.draft.strokes.length >= MOST_SKETCH_STROKES) {
    refuse(`A sketch has at most ${MOST_SKETCH_STROKES} strokes.`)
    return false
  }
  if (pointsIn(open.draft) + (stroke.points ?? stroke.points2d ?? []).length > MOST_SKETCH_POINTS) {
    refuse(`A sketch has at most ${MOST_SKETCH_POINTS} points.`)
    return false
  }
  history.push({ kind: 'add', stroke })
  // Where it is tied to a part, if nothing before it was: the first point of the first stroke that lies on a face.
  change((d) => ({ ...d, strokes: [...d.strokes, stroke], ...(anchor && !d.anchor ? { anchor } : {}) }))
  counted()
  changed()
  return true
}

/**
 * Takes the stroke out of the sketch, one step of Undo. A stroke is told by its id (`k3`), the one main gave it; one main has
 * not numbered yet (just drawn, not yet answered) is the stroke itself, as the sketch holds it. Where it was is kept, for Undo.
 */
export function eraseStroke(target: string | NewStroke): void {
  const strokes = state().open?.draft.strokes
  const index = strokes?.findIndex((s) => (typeof target === 'string' ? s.id === target : target.id !== undefined ? s.id === target.id : s === target)) ?? -1
  const stroke = strokes?.[index]
  if (!stroke) return
  history.push({ kind: 'erase', stroke, index })
  change((d) => ({ ...d, strokes: d.strokes.filter((s) => s !== stroke) }))
  counted()
  changed()
}

/** Takes back the last stroke added or erased in this editing of the sketch; false when there is none. */
export function undoStroke(): boolean {
  const step = history.pop()
  if (!step || !state().open) return false
  if (step.kind === 'add') change((d) => ({ ...d, strokes: d.strokes.filter((s) => s !== step.stroke) }))
  else change((d) => ({ ...d, strokes: [...d.strokes.slice(0, step.index), step.stroke, ...d.strokes.slice(step.index)] }))
  counted()
  changed()
  return true
}

// ---------------------------------------------------------------------------------------------------------------------
// The fields.

/** The name of the sketch, on one line and at most `MAX_SKETCH_NAME` characters. Typed, so it is sent once typing stops. */
export function setName(name: string): void {
  if (change((d) => ({ ...d, name: name.replace(/[\r\n]+/g, ' ').slice(0, MAX_SKETCH_NAME) }))) changed(true)
}

/** The comment on the sketch. Typed. */
export function setNote(note: string): void {
  if (change((d) => ({ ...d, note }))) changed(true)
}

/** How literally the sketch is taken. The diameter belongs to flow alone and goes with the others. */
export function setTake(take: SketchTake): void {
  const done = change((d) => {
    const { diameter: _diameter, ...rest } = d
    return take === 'flow' && d.diameter !== undefined ? { ...rest, take, diameter: d.diameter } : { ...rest, take }
  })
  if (done) changed()
}

/** exact, rough, flow, and round again. */
export function cycleTake(): void {
  const open = state().open
  if (!open) return
  const order: SketchTake[] = ['exact', 'rough', 'flow']
  setTake(order[(order.indexOf(open.draft.take) + 1) % order.length])
}

/** The diameter of a flow sketch in mm, or none for null; more than 0 and at most `MAX_SKETCH_DIAMETER`. Typed. */
export function setDiameter(diameter: number | null): void {
  const open = state().open
  if (!open || open.draft.take !== 'flow') return
  if (diameter !== null && !(diameter > 0 && diameter <= MAX_SKETCH_DIAMETER)) return
  change((d) => {
    const { diameter: _was, ...rest } = d
    return diameter === null ? rest : { ...rest, diameter }
  })
  changed(true)
}

/** The pointer is on the row of a plane (or the surface) of the panel, or leaves it (null). */
export function setLit(lit: number | 'surface' | null): void {
  if (state().lit !== lit) set({ lit })
}

export function setPen(pen: SketchPen): void {
  set({ pen })
}

export function setSnapping(snapping: boolean): void {
  set({ snapping })
}

export function setXray(xray: boolean): void {
  set({ xray })
}

// ---------------------------------------------------------------------------------------------------------------------
// What main says.

/**
 * The marks of the project changed. A sketch that is open and that main no longer has is closed. One main moved or replaced
 * meanwhile (a build moved what it is drawn on) is taken into the draft, so that the next send is not refused for strokes the
 * window has as they were: only while nothing of the draft is waiting to be sent.
 */
export function takeMarks(marks: readonly Mark[]): void {
  const open = state().open
  if (!open?.id) return
  const mine = marks.find((m) => m.id === open.id)
  if (!mine || mine.kind !== 'sketch') {
    // Taken away (deleted, or undone): nothing is open any more, and nothing is sent.
    leaveSketch(false)
    return
  }
  if (inflight || queued || timer !== undefined) {
    late = marks
    return
  }
  late = null
  // A name or a comment changed elsewhere (the row of the sketch in the marks list) is the draft's, or the next send writes it over.
  if (mine.name !== open.draft.name || mine.note !== open.draft.note) change((d) => ({ ...d, name: mine.name, note: mine.note }))
  const kept = mine
  const bare = (stroke: NewStroke): NewStroke => {
    const { touches: _touches, ...rest } = stroke
    return rest
  }
  if (equal(kept.planes, open.draft.planes) && equal(kept.strokes.map(bare), open.draft.strokes.map(bare))) return
  // Strokes as main has them: what it moved and what it vouched for, without what only it says.
  const strokes = kept.strokes.map((s) => bare(structuredClone(s)))
  const remap = new Map<NewStroke, NewStroke>()
  open.draft.strokes.forEach((old, i) => {
    if (strokes[i]) remap.set(old, strokes[i])
  })
  history = history.flatMap((step) => {
    const stroke = remap.get(step.stroke)
    return stroke ? [{ ...step, stroke }] : []
  })
  change((d) => ({ ...d, planes: kept.planes.map((p) => structuredClone(p)), strokes, ...(kept.anchor ? { anchor: structuredClone(kept.anchor) } : {}) }))
  counted()
  if (state().plane !== 'surface' && !kept.planes.some((p) => p.id === state().plane)) set({ plane: kept.planes.at(-1)?.id ?? 'surface' })
}

/** Whether two values are the same, whatever order the keys of an object were made in. */
function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const [x, y] = [a as Record<string, unknown>, b as Record<string, unknown>]
  const keys = Object.keys(x).filter((k) => x[k] !== undefined)
  if (keys.length !== Object.keys(y).filter((k) => y[k] !== undefined).length) return false
  return keys.every((k) => equal(x[k], y[k]))
}

/** The window lets go of the sketch with the project and the layout it is of: another is on show, or none. */
export function dropSketchOf(objectId: string | null, layout?: string): void {
  const open = state().open
  if (open && (open.draft.objectId !== objectId || (layout !== undefined && open.draft.layout !== layout))) leaveSketch()
}
