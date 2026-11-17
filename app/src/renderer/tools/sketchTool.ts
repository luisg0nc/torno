import { pressed, which } from '../../shared/keys'
import type { Viewport } from '../viewport/Viewport'
import { actions, store } from '../state/store'
import { toolStore } from '../state/tools'
import { TYPING } from '../ui/typing'
import { type Anchor, type NewStroke, type Vec3 } from '../../shared/marks'
import type { MainAxis } from '../../shared/planes'
import { type PenSnap, type PenStroke, PenState } from './sketch/pens'
import { type PlaneDraft, facePlane, fromPlane, mainPlane, pointPlane, rayOnPlane, toPlane, withOffset } from './sketch/planes'
import { strokeAt } from './sketch/hit'
import { type Snap, projectOnto } from './sketch/snap'
import { dragOffset } from '../viewport/sketchPlane'
import {
  activatePlane,
  activePlane,
  addPlane,
  addStroke,
  askOffset,
  cycleTake,
  eraseStroke,
  finishSketch,
  pickPlane,
  setOffset,
  setPen,
  setPlane,
  setXray,
  sketchStore,
  startSketch,
  dropSketchOf,
  takeMarks,
  undoStroke,
  type SketchPen
} from '../state/sketching'
import type { ViewportPointer } from '../viewport/Viewport'
import { planeName } from './planes'
import { REPEAT_MS, REPEAT_PX, type Tool, type ToolContext } from './Tool'

/** The pointer is sampled each time it has travelled this far, in pixels, while a freehand stroke is drawn. */
export const SAMPLE_PX = 3
/** A target is snapped to within this many pixels of the pointer. */
export const SNAP_PX = 10
/** What a pointer at a grazing angle to the plane meets too far off to be anywhere: the point is none, in millimetres. */
const MOST_FAR_MM = 1e5

const MAIN_BY_KEY: MainAxis[] = ['XY', 'XZ', 'YZ']
const FIGURES = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '.']

/** Where a pointer aims: the point in the pen's own coordinates, the snap it took, the point in the object frame, and the face it is on. */
interface Aim {
  p: number[]
  snap?: PenSnap
  world: Vec3
  hit?: { point: Vec3; normal: Vec3 | null; part: string; ref: string }
}

/** The tool of Draw: a 3D sketch, strokes on planes and on the surface of the parts. What it keeps and sends is `state/sketching.ts`; what it draws over the view goes through the viewport's overlay, never through React. */
export function sketchTool(): Tool {
  const planePen = new PenState<[number, number]>('free', (stroke) => place(stroke))
  const surfacePen = new PenState<Vec3>('free', (stroke) => place(stroke))
  /** What the tool was last handed: the strokes of a pen are placed from its callback, in the turn of the event that ended them. */
  let now: ToolContext | null = null
  /** The face the stroke under way started on: where the sketch is tied if nothing before it was. */
  let started: Aim['hit'] | null = null
  let last: [number, number] = [0, 0]
  let pressing = false
  let overCube = false
  let handle: { plane: PlaneDraft; from: ViewportPointer['ray']; now: PlaneDraft } | null = null
  let typed = ''
  let click: { client: [number, number]; at: number } | null = null
  /** Where the pointer was last, and what it aimed at: what the hint is told again of when a figure is typed. */
  let lastMove: { e: ViewportPointer; aim: Aim | null } | null = null

  const pen = (): PenState<number[]> => (activePlane() ? planePen : surfacePen) as unknown as PenState<number[]>
  const live = (): PenState<number[]> | null => {
    const found = [planePen, surfacePen].find((p) => p.active)
    return (found ?? null) as unknown as PenState<number[]> | null
  }

  const forget = (ctx: ToolContext): void => {
    planePen.cancel()
    surfacePen.cancel()
    started = null
    typed = ''
    pressing = false
    overCube = false
    handle = null
    ctx.viewport.setNavigation(true)
    ctx.viewport.setDraft(null)
    ctx.viewport.setSketch?.({ hint: null, marker: null })
  }

  /** The pen of the store, on the pen of the plane. */
  const setting = (): void => {
    const asked = sketchStore.getState().pen
    if (asked === 'erase') return
    for (const p of [planePen, surfacePen]) if (p.pen !== asked) p.setPen(asked)
  }

  function place(stroke: PenStroke<number[]>): void {
    if (!now) return
    const state = sketchStore.getState()
    const plane = activePlane(state)
    const base = { pen: stroke.pen, revision: now.revision, ...(stroke.snaps.length > 0 ? { snaps: stroke.snaps } : {}), ...(state.xray ? { xray: true as const } : {}) }
    const made: NewStroke = plane ? { plane: plane.id, points2d: stroke.points as [number, number][], ...base } : { points: stroke.points as Vec3[], ...base }
    const anchor: Anchor | undefined = started ? { point: started.point, ...(started.normal ? { normal: started.normal } : {}), part: started.part, ref: started.ref } : undefined
    started = null
    if (!addStroke(made, anchor)) return
  }

  /** The points of what is being drawn, in the object frame. */
  const worldOf = (points: number[][]): Vec3[] => {
    const plane = activePlane()
    return plane ? points.map((p) => fromPlane(plane, p as [number, number])) : (points as Vec3[])
  }

  const paint = (ctx: ToolContext): void => {
    const p = live()
    ctx.viewport.setDraft(p ? { kind: 'stroke', points: worldOf(p.points) } : null)
  }

  /** Where the pointer aims, and what it snaps to: null where there is nothing to draw on (the surface with no part under it, a plane the ray runs along). */
  const aimAt = (e: ViewportPointer, ctx: ToolContext): Aim | null => {
    const state = sketchStore.getState()
    const plane = activePlane(state)
    const snapping = state.snapping && e.ctrl !== true
    let snap: Snap | null = null
    const index = snapping ? ctx.viewport.snapIndex?.() : null
    if (index && ctx.viewport.project) {
      const see = state.xray || !ctx.viewport.visibleAt ? undefined : ctx.viewport.visibleAt.bind(ctx.viewport)
      snap = index.nearest({ origin: e.ray.origin, dir: e.ray.direction }, ctx.viewport.project.bind(ctx.viewport), e.client, SNAP_PX, see)
    }
    if (plane) {
      if (snap) {
        const { uv, projected } = projectOnto(plane, snap)
        return { p: uv, snap: { snap, projected }, world: fromPlane(plane, uv) }
      }
      const point = rayOnPlane(e.ray, plane)
      if (!point || Math.hypot(point[0] - plane.origin[0], point[1] - plane.origin[1], point[2] - plane.origin[2]) > MOST_FAR_MM) return null
      return { p: toPlane(plane, point), world: point }
    }
    // The surface: the face under the pointer, faces only (near an edge the viewport would say the edge, off to one side of the pointer), the exact point of a snap in its place.
    const face = e.hit?.kind === 'face' ? e.hit : ctx.viewport.pick(e.client[0], e.client[1], { edges: false })
    const hit = face ? { point: face.point, normal: face.normal, part: face.part, ref: face.ref } : undefined
    if (snap) return { p: snap.point, snap: { snap, projected: false }, world: snap.point, ...(hit ? { hit } : {}) }
    return face ? { p: face.point, world: face.point, hit } : null
  }

  /** The hint beside the pointer: what it snaps to and the segment under way. */
  const tell = (ctx: ToolContext, e: ViewportPointer | null, aim: Aim | null): void => {
    const p = live() ?? pen()
    const segment = p.segment
    ctx.viewport.setSketch?.({
      hint: e ? { at: e.client, ...(aim?.snap ? { snap: { kind: aim.snap.snap.kind, ref: aim.snap.snap.ref, radius: aim.snap.snap.radius, approx: aim.snap.snap.approx, projected: aim.snap.projected } } : {}), ...(segment ? { segment: { length: segment.length, ...(segment.angle === undefined ? {} : { angle: segment.angle }) } } : {}), ...(typed !== '' ? { typed } : {}) } : null,
      marker: aim?.snap ? aim.snap.snap.point : null
    })
  }

  /** The plane of a main axis through the point the current plane passes, or through the middle of the parts. */
  const mainThrough = (axis: MainAxis, ctx: ToolContext): void => {
    const here = activePlane()
    const bounds = ctx.viewport.bounds()
    const around: Vec3 = here ? here.origin : [0, 1, 2].map((i) => (bounds.min[i] + bounds.max[i]) / 2) as Vec3
    const across = axis === 'XY' ? 2 : axis === 'XZ' ? 1 : 0
    activatePlane(mainPlane(axis, around[across], around))
  }

  /** The plane of a flat face, as the kernel says it is; or why not. */
  const faceOf = async (ref: string, ctx: ToolContext, at: [number, number]): Promise<void> => {
    const described = await ctx.describe(ref).catch(() => null)
    if (described?.kind !== 'face' || described.type !== 'plane' || !described.normal) {
      ctx.readout.say(at, `${ref} is not flat: pick a flat face`)
      return
    }
    const plane = facePlane(ref, described.center, described.normal, 0, ctx.revision)
    if (plane) addPlane(plane)
  }

  const cancelStroke = (ctx: ToolContext): void => {
    planePen.cancel()
    surfacePen.cancel()
    started = null
    typed = ''
    pressing = false
    ctx.viewport.setNavigation(true)
    ctx.viewport.setDraft(null)
  }

  const onMove = (e: ViewportPointer, ctx: ToolContext): void => {
    // Dragging the handle of the sheet: shown as it goes, kept once, when it is let go.
    if (handle) {
      const offset = Math.round(dragOffset(handle.plane, handle.from, e.ray) * 10) / 10
      handle.now = withOffset(handle.plane, offset)
      ctx.viewport.setSketchSheet?.(handle.now)
      ctx.viewport.setSketch?.({ plane: { label: planeName(handle.now.label), at: ctx.viewport.sketchCorner?.() ?? handle.now.origin } })
      return
    }
    if (overCube) return
    const state = sketchStore.getState()
    if (state.pen === 'erase') {
      ctx.viewport.setSketch?.({ hint: null, marker: null })
      return
    }
    setting()
    const aim = aimAt(e, ctx)
    const p = live() ?? pen()
    if (aim) {
      // Freehand takes a sample each time the pointer has travelled far enough; the others follow the pointer.
      const sampled = p.pen !== 'free' || !pressing || Math.hypot(e.client[0] - last[0], e.client[1] - last[1]) >= SAMPLE_PX
      if (sampled) {
        p.move(aim.p, aim.snap)
        last = e.client
      }
    }
    lastMove = { e, aim }
    paint(ctx)
    tell(ctx, e, aim)
  }

  const onDown = (e: ViewportPointer, ctx: ToolContext): void => {
    // With Alt the press is the camera's: the way to turn the view with the tool in hand.
    if (!(e.buttons & 1) || e.alt) return
    const state = sketchStore.getState()
    const cube = ctx.viewport.cubeAt?.(e.client[0], e.client[1])
    if (cube) {
      mainThrough(cube, ctx)
      overCube = true
      ctx.viewport.setNavigation(false)
      return
    }
    const plane = activePlane(state)
    if (plane && ctx.viewport.onSketchHandle?.(e.client[0], e.client[1])) {
      handle = { plane, from: e.ray, now: plane }
      ctx.viewport.setNavigation(false)
      return
    }
    // A pick of a face or a point is made on the click that follows.
    if (state.picking) return
    if (state.pen === 'erase') {
      const draft = state.open?.draft
      const project = ctx.viewport.project?.bind(ctx.viewport)
      const index = draft && project ? strokeAt(draft, project, e.client) : null
      const hit = draft && index !== null ? draft.strokes[index] : undefined
      if (hit) eraseStroke(hit)
      ctx.viewport.setNavigation(false)
      pressing = true
      return
    }
    setting()
    // A point to point stroke is made of clicks: a press that moves is the camera's.
    if (state.pen === 'points') return
    const aim = aimAt(e, ctx)
    if (!aim) return
    pressing = true
    last = e.client
    started = state.open && !state.open.draft.anchor && aim.hit ? aim.hit : null
    ctx.viewport.setNavigation(false, { wheel: true })
    ctx.viewport.setHover(null)
    ctx.readout.hide()
    pen().down(aim.p, aim.snap)
    paint(ctx)
    tell(ctx, e, aim)
  }

  const onUp = (e: ViewportPointer, ctx: ToolContext): void => {
    if (handle) {
      const made = handle.now
      const was = handle.plane.from.kind === 'view' || handle.plane.from.kind === 'tracing' ? null : handle.plane.from.offset
      handle = null
      ctx.viewport.setNavigation(true)
      if (made.from.kind !== 'view' && made.from.kind !== 'tracing' && made.from.offset !== was) setOffset(made.from.offset)
      return
    }
    // The press is over, whatever it did: the camera is the pointer's again.
    const pressed = pressing || overCube
    pressing = false
    overCube = false
    if (pressed) ctx.viewport.setNavigation(true)
    const state = sketchStore.getState()
    const p = live()
    if (!p || state.pen === 'erase' || state.pen === 'points') return
    const aim = aimAt(e, ctx)
    // Let go: the stroke ends where the pointer is, however near the last sample that is.
    if (aim && (p.pen === 'line' || (p.pen === 'free' && Math.hypot(e.client[0] - last[0], e.client[1] - last[1]) > 0))) p.move(aim.p, aim.snap)
    // A line let go where it began was a click: it waits for the second one.
    p.up()
    paint(ctx)
    tell(ctx, e, aim)
  }

  const onClick = (e: ViewportPointer, ctx: ToolContext): void => {
    const state = sketchStore.getState()
    if (state.picking && e.hit) {
      const kind = state.picking
      pickPlane(null)
      if (kind === 'face') void faceOf(e.hit.ref, ctx, e.client)
      else {
        const plane = pointPlane(e.hit.point, e.hit.normal ?? ctx.camera.position.map((c, i) => c - ctx.camera.target[i]) as Vec3, 0)
        if (plane) addPlane(plane)
      }
      return
    }
    if (state.pen !== 'points') return
    setting()
    const again = click && Math.hypot(e.client[0] - click.client[0], e.client[1] - click.client[1]) <= REPEAT_PX && performance.now() - click.at <= REPEAT_MS
    click = { client: e.client, at: performance.now() }
    const p = pen()
    // The second click of a double click ends the stroke, as Enter does.
    if (again && p.active) {
      p.enter()
      paint(ctx)
      return
    }
    const aim = aimAt(e, ctx)
    if (!aim) return
    if (state.open && !state.open.draft.anchor && !p.active && aim.hit) started = aim.hit
    p.click(aim.p, aim.snap)
    paint(ctx)
    tell(ctx, e, aim)
  }

  return {
    id: 'draw',
    cursor: 'crosshair',
    activate(ctx) {
      now = ctx
      dropSketchOf(ctx.objectId, ctx.layout)
      startSketch(ctx.objectId)
    },
    onPointer(e, ctx) {
      now = ctx
      if (!sketchStore.getState().open) startSketch(ctx.objectId)
      if (!sketchStore.getState().open) return
      // The pointer was taken away: a stroke under way is nobody's.
      if (e.type === 'cancel') return forget(ctx)
      if (e.type === 'down') return onDown(e, ctx)
      if (e.type === 'move') {
        // A release that never came: the button is up and the press is still on.
        if ((pressing || handle || overCube) && !(e.buttons & 1)) return forget(ctx)
        return onMove(e, ctx)
      }
      if (e.type === 'up') return onUp(e, ctx)
      if (e.type === 'click') onClick(e, ctx)
    },
    onKey(e, ctx) {
      now = ctx
      const state = sketchStore.getState()
      if (!state.open) return false
      if (pressed(e, 'sketch.leave')) {
        // What is under way first; the pick of a plane next; the sketch itself after: the viewport's step back leaves the tool.
        if (live() || typed !== '') {
          cancelStroke(ctx)
          ctx.viewport.setSketch?.({ hint: null, marker: null })
          return true
        }
        if (state.picking) {
          pickPlane(null)
          return true
        }
        return false
      }
      const main = which(e, 'sketch.plane')
      if (main >= 0) {
        mainThrough(MAIN_BY_KEY[main], ctx)
        return true
      }
      const pens: Array<[Parameters<typeof pressed>[1], SketchPen]> = [['sketch.free', 'free'], ['sketch.line', 'line'], ['sketch.points', 'points'], ['sketch.erase', 'erase']]
      for (const [id, chosen] of pens) {
        if (!pressed(e, id)) continue
        cancelStroke(ctx)
        setPen(chosen)
        setting()
        return true
      }
      if (pressed(e, 'sketch.surface')) {
        cancelStroke(ctx)
        setPlane('surface')
        return true
      }
      if (pressed(e, 'sketch.face')) {
        const at = ctx.viewport.pointerAt?.()
        const hit = at ? ctx.viewport.pick(at[0], at[1], { edges: false }) : null
        if (at && hit) void faceOf(hit.ref, ctx, at)
        else pickPlane('face')
        return true
      }
      if (pressed(e, 'sketch.offset')) {
        if (!activePlane()) return false
        askOffset()
        return true
      }
      // X shows or hides the cut the view already has, and the sketch goes on; a new cut is made by picking Section, which ends it.
      if (pressed(e, 'tool.section')) {
        const cut = store.getState().section
        if (cut) ctx.viewport.setSection?.(ctx.viewport.getSection?.() ? null : cut)
        return true
      }
      if (pressed(e, 'sketch.xray')) {
        setXray(!state.xray)
        return true
      }
      if (pressed(e, 'sketch.take')) {
        cycleTake()
        return true
      }
      // Figures are the length of a segment while one is drawn, and the views' otherwise (`1` to `4`).
      const p = live() ?? pen()
      if (p.segment && pressed(e, 'sketch.length')) {
        const figure = FIGURES[which(e, 'sketch.length')]
        if (figure !== '.' || !typed.includes('.')) {
          typed += figure
          const mm = Number(typed)
          p.typedLength(mm > 0 ? mm : null)
          paint(ctx)
          tell(ctx, lastMove?.e ?? null, lastMove?.aim ?? null)
          return true
        }
      }
      if (pressed(e, 'sketch.back') && (typed !== '' || p.active)) {
        if (typed !== '') {
          typed = typed.slice(0, -1)
          const mm = Number(typed)
          p.typedLength(mm > 0 ? mm : null)
        } else p.backspace()
        paint(ctx)
        return true
      }
      if (pressed(e, 'sketch.fix') && p.active) {
        typed = ''
        p.enter()
        paint(ctx)
        tell(ctx, lastMove?.e ?? null, lastMove?.aim ?? null)
        return true
      }
      return false
    },
    cancel(ctx) {
      now = ctx
      forget(ctx)
      ctx.viewport.setSketch?.({ plane: null, cube: null })
      // A cut the sketch hid is shown again.
      const cut = store.getState().section
      if (cut && !ctx.viewport.getSection?.()) ctx.viewport.setSection?.(cut)
      // The tool is put down for another: what was drawn is kept, and the card has its picture.
      void finishSketch()
    }
  }
}

/**
 * Joins a viewport to the sketch being drawn, as `connectShapeEdit` does the gizmo: the sheet of the active plane with its
 * label, the view cube and x-ray follow the sketch's store and the tool in hand; the marks main sends are taken into the
 * open sketch; a sketch is let go with its project and layout; and `Ctrl+Z`, which the tool is not handed (it is a chord),
 * takes the last stroke back. Returns what undoes it.
 */
export function connectSketching(viewport: Pick<Viewport, 'setXray' | 'setSketchSheet' | 'setSketch' | 'sketchCorner' | 'setLitStrokes'>): () => void {
  let laid: unknown = null
  let lit = ''
  const sync = (force = false): void => {
    const s = sketchStore.getState()
    const on = toolStore.getState().tool === 'draw' && s.open !== null
    viewport.setXray(on && s.xray)
    const plane = on ? activePlane(s) : null
    if (force || plane !== laid) {
      laid = plane
      viewport.setSketchSheet(plane)
    }
    // The strokes of the plane a row of the panel is pointed at.
    const light = on && s.open?.id !== undefined && s.lit !== null ? { id: s.open.id, plane: s.lit } : null
    if ((light ? `${light.id}:${light.plane}` : '') !== lit) {
      lit = light ? `${light.id}:${light.plane}` : ''
      viewport.setLitStrokes(light)
    }
    viewport.setSketch({
      plane: plane ? { label: planeName(plane.label), at: viewport.sketchCorner() ?? plane.origin } : null,
      cube: on ? { active: plane?.from.kind === 'main' ? plane.from.axis : null } : null,
      ...(on ? {} : { hint: null, marker: null })
    })
  }
  const onKey = (e: KeyboardEvent): void => {
    if (e.defaultPrevented || e.repeat || toolStore.getState().tool !== 'draw' || !sketchStore.getState().open) return
    if (e.target instanceof Element && e.target.closest(TYPING)) return
    if (pressed(e, 'sketch.undo') && undoStroke()) e.preventDefault()
  }
  sync(true)
  const offSketch = sketchStore.subscribe(() => sync())
  const offTool = toolStore.subscribe(() => sync())
  const offStore = store.subscribe((s, before) => {
    if (s.marks !== before.marks) takeMarks(s.marks)
    if (s.objectId !== before.objectId || s.layout !== before.layout) dropSketchOf(s.objectId, s.layout)
    // The sheet lies across the parts shown: it follows a new build and a part switched off.
    if (s.scene !== before.scene || s.layers !== before.layers) sync(true)
  })
  window.addEventListener('keydown', onKey)
  return () => {
    offSketch()
    offTool()
    offStore()
    window.removeEventListener('keydown', onKey)
    viewport.setSketchSheet(null)
    viewport.setSketch({ plane: null, cube: null, hint: null, marker: null })
    viewport.setXray(false)
    viewport.setLitStrokes(null)
  }
}

/** What a refusal of main's is said as, in the marks panel as the other marks' are. */
export function sayRefusal(objectId: string, message: string): void {
  actions.setMarksProblem({ objectId, message })
}
