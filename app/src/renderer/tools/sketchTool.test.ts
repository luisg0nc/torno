import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SketchDraft } from '../../shared/bridge'
import type { Mark, SketchMark, Vec3 } from '../../shared/marks'
import type { Camera } from '../../shared/view'
import { activePlane, addStroke, leaveSketch, setPen, setSketchEnv, setSnapping, settled, sketchStore, setXray, type SketchEnv } from '../state/sketching'
import { toolStore } from '../state/tools'
import type { Hit } from '../viewport/picking'
import type { ViewportPointer } from '../viewport/Viewport'
import { sketchTool } from './sketchTool'
import type { Snap } from './sketch/snap'
import type { ToolContext } from './Tool'

// From the front: the camera is on -Y and looks along +Y, x to the right and z up. A pixel is a millimetre.
const FRONT: Camera = { position: [0, -100, 0], target: [0, 0, 0], up: [0, 0, 1], ortho: true, fov: 35, zoom: 1 }
const BOUNDS = { min: [-20, -15, -2.5] as Vec3, max: [20, 15, 22.5] as Vec3 }
const screen = (p: Vec3): [number, number] => [p[0], -p[2]]

function pointer(type: ViewportPointer['type'], x: number, z: number, over: Partial<ViewportPointer> = {}): ViewportPointer {
  return { type, hit: null, ray: { origin: [x, -100, z], direction: [0, 1, 0] }, client: [x, -z], buttons: type === 'up' || type === 'click' ? 0 : 1, shift: false, alt: false, ...over }
}
/** A pointer with no button held. */
const hover = (x: number, z: number, over: Partial<ViewportPointer> = {}): ViewportPointer => pointer('move', x, z, { buttons: 0, ...over })
const key = (name: string, over: Partial<KeyboardEvent> = {}): KeyboardEvent => ({ key: name, ...over }) as KeyboardEvent

/** The vertex a fake snap index finds, wherever it is asked. */
const VERTEX: Snap = { kind: 'vertex', ref: 'block/V3', point: [10, 0, 20] }

function rig(opts: { snap?: Snap | null; face?: Hit | null; handle?: boolean; cube?: 'XY' | 'XZ' | 'YZ' | null } = {}) {
  const calls: SketchDraft[] = []
  const pictures: string[] = []
  const said: string[] = []
  let made = 0
  const answer = (d: SketchDraft): SketchMark => ({ ...d, kind: 'sketch', id: d.id ?? `M${++made}`, author: 'user', status: 'draft', anchorState: 'ok', createdAt: '' }) as SketchMark
  const env: SketchEnv = {
    marks: { sketch: async (d) => (calls.push(structuredClone(d)), answer(d)) as Mark, sketchPicture: async (_o, id) => void pictures.push(id), sketching: () => {} },
    here: () => ({ objectId: 'bracket', layout: 'assembly', revision: 3, camera: FRONT, centre: [0, 0, 0] }),
    picture: async () => new Uint8Array([1]),
    say: (_o, m) => void said.push(m)
  }
  setSketchEnv(env)
  const asked: Array<{ ctrl: boolean | undefined }> = []
  const navigation: unknown[][] = []
  const drafts: unknown[] = []
  const sketch: Array<Record<string, unknown>> = []
  const sheets: unknown[] = []
  const index = {
    nearest: (_ray: unknown, _project: unknown, pointer: [number, number], radius = 10, visible?: (p: Vec3) => boolean) => {
      asked.push({ ctrl: undefined })
      const snap = opts.snap === undefined ? VERTEX : opts.snap
      // Where it is, as the pointer finds it: within the radius of the target on screen.
      const [x, y] = snap ? screen(snap.point) : [0, 0]
      return snap && Math.hypot(pointer[0] - x, pointer[1] - y) <= radius && (!visible || visible(snap.point)) ? snap : null
    }
  }
  const seen: Vec3[] = []
  let hidden = false
  const ctx: ToolContext = {
    viewport: {
      setHover: () => {},
      setNavigation: (...args) => void navigation.push(args),
      setDraft: (d) => void drafts.push(d),
      lockedView: () => null,
      pickScan: () => null,
      scanPatch: () => null,
      pick: () => opts.face ?? null,
      bounds: () => BOUNDS,
      project: (p) => screen(p),
      snapIndex: () => index as never,
      visibleAt: (p) => (seen.push(p), !hidden),
      setSketch: (o) => void sketch.push(o as Record<string, unknown>),
      setSketchSheet: (p) => void sheets.push(p),
      sketchCorner: () => [0, 0, 0],
      onSketchHandle: () => opts.handle === true,
      cubeAt: () => opts.cube ?? null,
      pointerAt: () => [0, 0]
    },
    readout: { show: () => {}, describe: () => {}, say: (_a, m) => void said.push(m), hide: () => {} },
    objectId: 'bracket',
    layout: 'assembly',
    revision: 3,
    camera: FRONT,
    stale: null,
    descriptor: () => undefined,
    describe: async () => null,
    measure: () => Promise.reject(new Error('nothing is measured here')),
    commit: () => Promise.reject(new Error('a sketch is not committed so')),
    openNote: () => {}
  }
  const tool = sketchTool()
  tool.activate?.(ctx)
  return { tool, ctx, calls, pictures, said, asked, navigation, drafts, sketch, sheets, hide: (on: boolean) => void (hidden = on), seen }
}

/** Lets the promises a tool left behind run out. */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

const draw = (r: ReturnType<typeof rig>, from: [number, number], to: [number, number]): void => {
  r.tool.onPointer(pointer('down', ...from), r.ctx)
  r.tool.onPointer(pointer('move', (from[0] + to[0]) / 2, (from[1] + to[1]) / 2), r.ctx)
  r.tool.onPointer(pointer('move', ...to), r.ctx)
  r.tool.onPointer(pointer('up', ...to), r.ctx)
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  leaveSketch()
  setSketchEnv(null)
  setPen('free')
  setSnapping(true)
  setXray(false)
  vi.useRealTimers()
  toolStore.setState({ tool: 'select' })
})

describe('taking the tool up and putting it down', () => {
  it('opens a sketch on the plane the view faces, and leaving with no stroke writes nothing and draws no picture', async () => {
    const r = rig()
    expect(activePlane()).toMatchObject({ id: 1, label: 'XZ at y = 0.0 (u = +X, v = +Z)' })
    r.tool.cancel(r.ctx)
    await settled()
    await vi.advanceTimersByTimeAsync(1000)
    expect(r.calls).toEqual([])
    expect(r.pictures).toEqual([])
    expect(sketchStore.getState().open).toBeNull()
  })

  it('keeps what was drawn when it is put down for another tool, and draws the card', async () => {
    const r = rig({ snap: null })
    draw(r, [0, 5], [30, 5])
    await settled()
    r.tool.cancel(r.ctx)
    await vi.advanceTimersByTimeAsync(0)
    await settled()
    await vi.advanceTimersByTimeAsync(10)
    expect(r.calls).toHaveLength(1)
    expect(r.pictures).toEqual(['M1'])
  })
})

describe('snapping', () => {
  it('snaps to what is near the pointer, and tells the hint what: the point is the vertex, put on the plane', () => {
    const r = rig()
    r.tool.onPointer(hover(12, 18), r.ctx)
    const last = r.sketch.at(-1) as { hint: { snap: { kind: string; ref: string; projected: boolean } }; marker: Vec3 }
    expect(last.hint.snap).toMatchObject({ kind: 'vertex', ref: 'block/V3', projected: false })
    expect(last.marker).toEqual([10, 0, 20])
  })

  it('turns snapping off while Ctrl is held on a pointer move, and again when it is let go', () => {
    const r = rig()
    r.tool.onPointer(hover(12, 18, { ctrl: true }), r.ctx)
    expect(r.asked).toHaveLength(0)
    expect((r.sketch.at(-1) as { hint: object }).hint).not.toHaveProperty('snap')
    expect((r.sketch.at(-1) as { marker: unknown }).marker).toBeNull()
    r.tool.onPointer(hover(12, 18), r.ctx)
    expect(r.asked).toHaveLength(1)
    expect((r.sketch.at(-1) as { hint: object }).hint).toHaveProperty('snap')
  })

  it('does not snap when snapping is turned off in the sketch, and a stroke that did snap says so', async () => {
    const r = rig()
    draw(r, [0, 5], [11, 19])
    await settled()
    // The last point snapped to the vertex: its place is the vertex's, and the snap is told.
    expect(r.calls[0].strokes[0].points2d!.at(-1)).toEqual([10, 20])
    expect(r.calls[0].strokes[0].snaps).toEqual([{ i: r.calls[0].strokes[0].points2d!.length - 1, vertex: 'block/V3' }])
    const q = rig()
    setSnapping(false)
    q.tool.onPointer(hover(12, 18), q.ctx)
    expect(q.asked).toHaveLength(0)
  })

  it('leaves out the targets that are hidden behind a part, unless x-ray is on', () => {
    const r = rig()
    r.hide(true)
    r.tool.onPointer(hover(12, 18), r.ctx)
    expect((r.sketch.at(-1) as { marker: unknown }).marker).toBeNull()
    expect(r.seen).toEqual([[10, 0, 20]])
    setXray(true)
    r.tool.onPointer(hover(12, 18), r.ctx)
    expect((r.sketch.at(-1) as { marker: unknown }).marker).toEqual([10, 0, 20])
  })
})

describe('the pens', () => {
  it('freehand: press, drag, let go makes one stroke on the plane, of the build it was drawn on, and sends the sketch', async () => {
    const r = rig({ snap: null })
    r.tool.onPointer(pointer('down', 0, 5), r.ctx)
    // The camera is not turned by this drag, and the wheel still zooms.
    expect(r.navigation.at(-1)).toEqual([false, { wheel: true }])
    for (const x of [5, 10, 15, 20]) r.tool.onPointer(pointer('move', x, 5 + x), r.ctx)
    expect(r.drafts.at(-1)).toMatchObject({ kind: 'stroke' })
    r.tool.onPointer(pointer('up', 20, 25), r.ctx)
    expect(r.navigation.at(-1)).toEqual([true])
    await settled()
    expect(r.calls).toHaveLength(1)
    const stroke = r.calls[0].strokes[0]
    expect(stroke).toMatchObject({ plane: 1, pen: 'free', revision: 3 })
    expect(stroke.points2d![0]).toEqual([0, 5])
    expect(stroke.points2d!.at(-1)).toEqual([20, 25])
    expect(stroke).not.toHaveProperty('xray')
    expect(r.calls[0]).not.toHaveProperty('id')
    expect(r.drafts.at(-1)).toBeNull()
  })

  it('a second stroke carries the id main gave, and one drawn in x-ray says so', async () => {
    const r = rig({ snap: null })
    draw(r, [0, 5], [30, 5])
    await settled()
    setXray(true)
    draw(r, [0, 9], [30, 9])
    await settled()
    expect(r.calls.map((d) => [d.id, d.strokes.length])).toEqual([[undefined, 1], ['M1', 2]])
    expect(r.calls[1].strokes[1]).toMatchObject({ xray: true })
    expect(r.calls[1].strokes[0]).not.toHaveProperty('xray')
  })

  it('no stroke is made of a touch: a press let go where it began is nothing', async () => {
    const r = rig({ snap: null })
    r.tool.onPointer(pointer('down', 5, 5), r.ctx)
    r.tool.onPointer(pointer('up', 5, 5), r.ctx)
    await settled()
    expect(r.calls).toEqual([])
  })

  it('a press with Alt is the camera’s, and one that is not the left button', async () => {
    const r = rig({ snap: null })
    r.tool.onPointer(pointer('down', 5, 5, { alt: true }), r.ctx)
    r.tool.onPointer(pointer('down', 5, 5, { buttons: 2 }), r.ctx)
    expect(r.navigation).toEqual([])
    r.tool.onPointer(pointer('move', 25, 5), r.ctx)
    r.tool.onPointer(pointer('up', 25, 5), r.ctx)
    await settled()
    expect(r.calls).toEqual([])
  })

  it('line: press, drag and let go makes two points', async () => {
    const r = rig({ snap: null })
    setPen('line')
    draw(r, [0, 5], [30, 5])
    await settled()
    expect(r.calls[0].strokes[0]).toMatchObject({ pen: 'line', points2d: [[0, 5], [30, 5]] })
  })

  it('line: a click and another click make it, with the camera the pointer’s between them', async () => {
    const r = rig({ snap: null })
    setPen('line')
    r.tool.onPointer(pointer('down', 0, 5), r.ctx)
    r.tool.onPointer(pointer('up', 0, 5), r.ctx)
    expect(r.navigation.at(-1)).toEqual([true])
    r.tool.onPointer(hover(15, 8), r.ctx)
    // The segment under way, as the hint says it.
    expect((r.sketch.at(-1) as { hint: { segment: { length: number; angle: number } } }).hint.segment.length).toBeCloseTo(Math.hypot(15, 3))
    r.tool.onPointer(pointer('down', 30, 5), r.ctx)
    r.tool.onPointer(pointer('up', 30, 5), r.ctx)
    await settled()
    expect(r.calls[0].strokes[0]).toMatchObject({ pen: 'line', points2d: [[0, 5], [30, 5]] })
    expect(r.navigation.at(-1)).toEqual([true])
  })

  it('point to point: each click adds a point, Enter ends it, and the camera turns on a drag', async () => {
    const r = rig({ snap: null })
    setPen('points')
    r.tool.onPointer(pointer('down', 0, 5), r.ctx)
    expect(r.navigation).toEqual([])
    r.tool.onPointer(pointer('up', 0, 5), r.ctx)
    r.tool.onPointer(pointer('click', 0, 5), r.ctx)
    r.tool.onPointer(hover(10, 9), r.ctx)
    r.tool.onPointer(pointer('click', 20, 5), r.ctx)
    r.tool.onPointer(hover(25, 12), r.ctx)
    // A point is not one until it is clicked.
    expect(r.tool.onKey!(key('Enter'), r.ctx)).toBe(true)
    await settled()
    expect(r.calls[0].strokes[0]).toMatchObject({ pen: 'points', points2d: [[0, 5], [20, 5]] })
  })

  it('point to point: a double click ends it, Backspace takes the last point back', async () => {
    const r = rig({ snap: null })
    setPen('points')
    const at = (x: number) => r.tool.onPointer(pointer('click', x, 5), r.ctx)
    at(0)
    at(10)
    at(20)
    r.tool.onKey!(key('Backspace'), r.ctx)
    at(30)
    at(30)
    await settled()
    expect(r.calls[0].strokes[0]).toMatchObject({ pen: 'points', points2d: [[0, 5], [10, 5], [30, 5]] })
  })

  it('a figure typed while a line is drawn is its length, along where the pointer points; Enter fixes it', async () => {
    const r = rig({ snap: null })
    setPen('line')
    r.tool.onPointer(pointer('down', 0, 5), r.ctx)
    r.tool.onPointer(pointer('up', 0, 5), r.ctx)
    r.tool.onPointer(hover(10, 5), r.ctx)
    expect(r.tool.onKey!(key('2'), r.ctx)).toBe(true)
    expect(r.tool.onKey!(key('5'), r.ctx)).toBe(true)
    expect((r.sketch.at(-1) as { hint: { typed: string } }).hint.typed).toBe('25')
    expect(r.tool.onKey!(key('Enter'), r.ctx)).toBe(true)
    await settled()
    expect(r.calls[0].strokes[0].points2d).toEqual([[0, 5], [25, 5]])
  })

  it('a figure with no segment under way is not the length’s: it goes on to the views', () => {
    const r = rig({ snap: null })
    expect(r.tool.onKey!(key('2'), r.ctx)).toBe(false)
    expect(r.tool.onKey!(key('4'), r.ctx)).toBe(false)
  })

  it('Esc gives up a stroke under way and then leaves it to the viewport, which leaves the tool', () => {
    const r = rig({ snap: null })
    setPen('line')
    r.tool.onPointer(pointer('down', 0, 5), r.ctx)
    r.tool.onPointer(pointer('up', 0, 5), r.ctx)
    expect(r.tool.onKey!(key('Escape'), r.ctx)).toBe(true)
    expect(r.tool.onKey!(key('Escape'), r.ctx)).toBe(false)
  })
})

describe('erase', () => {
  it('takes the stroke under the pointer and sends the sketch without it', async () => {
    const r = rig({ snap: null })
    draw(r, [0, 5], [30, 5])
    draw(r, [0, 15], [30, 15])
    await settled()
    expect(r.tool.onKey!(key('c'), r.ctx)).toBe(true)
    expect(sketchStore.getState().pen).toBe('erase')
    r.tool.onPointer(pointer('down', 15, 15), r.ctx)
    r.tool.onPointer(pointer('up', 15, 15), r.ctx)
    await settled()
    expect(r.calls.at(-1)!.strokes).toHaveLength(1)
    expect(r.calls.at(-1)!.strokes[0].points2d![0]).toEqual([0, 5])
    // Nothing under the pointer: nothing taken.
    r.tool.onPointer(pointer('down', 15, 40), r.ctx)
    r.tool.onPointer(pointer('up', 15, 40), r.ctx)
    await settled()
    expect(r.calls).toHaveLength(3)
  })
})

describe('the plane', () => {
  it('a click on a face of the view cube makes that plane the one drawn on, through the origin of the current one, and draws nothing', async () => {
    const r = rig({ snap: null, cube: 'YZ' })
    r.tool.onPointer(pointer('down', 400, -40), r.ctx)
    r.tool.onPointer(pointer('up', 400, -40), r.ctx)
    expect(activePlane()).toMatchObject({ from: { kind: 'main', axis: 'YZ', offset: 0 } })
    await settled()
    expect(r.calls).toEqual([])
  })

  it('Shift and 1, 2, 3 are XY, XZ and YZ', () => {
    const r = rig({ snap: null })
    for (const [code, axis] of [['Digit1', 'XY'], ['Digit2', 'XZ'], ['Digit3', 'YZ']] as const) {
      expect(r.tool.onKey!(key('!', { code, shiftKey: true }), r.ctx)).toBe(true)
      expect(activePlane()).toMatchObject({ from: { kind: 'main', axis } })
    }
  })

  it('the handle of the sheet moves the plane by as far as it is dragged along its normal, shown as it goes and kept once', async () => {
    const r = rig({ snap: null, handle: true })
    // XY, across Z, through z = 0 (the middle of the parts).
    r.tool.onKey!(key('!', { code: 'Digit1', shiftKey: true }), r.ctx)
    const before = sketchStore.getState().open!.draft
    expect(activePlane()).toMatchObject({ from: { axis: 'XY', offset: 0 } })
    r.tool.onPointer(pointer('down', 0, 66), r.ctx)
    expect(r.navigation.at(-1)).toEqual([false])
    r.tool.onPointer(pointer('move', 0, 70), r.ctx)
    r.tool.onPointer(pointer('move', 0, 73), r.ctx)
    // Shown as it goes: the sheet of the plane at the offset it is dragged to, with nothing of the store changed.
    expect(r.sheets.at(-1)).toMatchObject({ from: { kind: 'main', axis: 'XY', offset: 7 }, label: 'XY at z = 7.0 (u = +X, v = +Y)' })
    expect(sketchStore.getState().open!.draft).toBe(before)
    r.tool.onPointer(pointer('up', 0, 73), r.ctx)
    expect(r.navigation.at(-1)).toEqual([true])
    expect(activePlane()).toMatchObject({ id: 1, from: { axis: 'XY', offset: 7 }, origin: [0, 0, 7] })
    await settled()
    expect(r.calls).toEqual([])
  })

  it('a handle drag on a plane with strokes leaves them where they are and makes a plane of its own', async () => {
    const r = rig({ snap: null, handle: true })
    r.tool.onKey!(key('!', { code: 'Digit1', shiftKey: true }), r.ctx)
    addStroke({ plane: 1, pen: 'line', points2d: [[0, 0], [5, 0]], revision: 3 })
    r.tool.onPointer(pointer('down', 0, 66), r.ctx)
    r.tool.onPointer(pointer('move', 0, 76), r.ctx)
    r.tool.onPointer(pointer('up', 0, 76), r.ctx)
    expect(sketchStore.getState().open!.draft.planes.map((p) => [p.id, p.from.kind === 'main' ? p.from.offset : null])).toEqual([[1, 0], [2, 10]])
    expect(sketchStore.getState().plane).toBe(2)
  })

  it('a click on the handle with no drag changes nothing', () => {
    const r = rig({ snap: null, handle: true })
    const before = sketchStore.getState().open!.draft
    r.tool.onPointer(pointer('down', 0, 66), r.ctx)
    r.tool.onPointer(pointer('up', 0, 66), r.ctx)
    expect(sketchStore.getState().open!.draft).toBe(before)
  })

  it('U draws on the surface of the parts: the face under the pointer, a stroke of points in the object frame, tied to the part', async () => {
    const face: Hit = { partKey: 'assembly:block', part: 'block', kind: 'face', index: 3, ref: 'block/F3', point: [0, -15, 5], normal: [0, -1, 0], distance: 85 }
    let at: Vec3 = [0, -15, 5]
    const r = rig({ snap: null, face })
    r.ctx.viewport.pick = () => ({ ...face, point: at })
    expect(r.tool.onKey!(key('u'), r.ctx)).toBe(true)
    expect(sketchStore.getState().plane).toBe('surface')
    r.tool.onPointer(pointer('down', 0, 5, { hit: face }), r.ctx)
    for (const x of [10, 20]) {
      at = [x, -15, 5 + x / 2]
      r.tool.onPointer(pointer('move', x, 5 + x / 2), r.ctx)
    }
    r.tool.onPointer(pointer('up', 20, 15), r.ctx)
    await settled()
    const stroke = r.calls[0].strokes[0]
    expect(stroke).not.toHaveProperty('plane')
    expect(stroke.points![0]).toEqual([0, -15, 5])
    expect(stroke.points!.at(-1)).toEqual([20, -15, 15])
    expect(r.calls[0].anchor).toEqual({ point: [0, -15, 5], normal: [0, -1, 0], part: 'block', ref: 'block/F3' })
  })

  it('a press on the surface with no part under it is the camera’s', () => {
    const r = rig({ snap: null, face: null })
    r.tool.onKey!(key('u'), r.ctx)
    r.tool.onPointer(pointer('down', 0, 5), r.ctx)
    // Never taken from the camera: it is switched on, and that is all.
    expect(r.navigation.every(([on]) => on === true)).toBe(true)
  })
})

describe('the keys', () => {
  it('chooses the pens, x-ray and the take, and leaves every other key to the viewport (fit, ortho, explode, section, the views)', () => {
    const r = rig({ snap: null })
    for (const [k, pen] of [['l', 'line'], ['p', 'points'], ['b', 'free']] as const) {
      expect(r.tool.onKey!(key(k), r.ctx)).toBe(true)
      expect(sketchStore.getState().pen).toBe(pen)
    }
    expect(r.tool.onKey!(key('i'), r.ctx)).toBe(true)
    expect(sketchStore.getState().xray).toBe(true)
    expect(r.tool.onKey!(key('k'), r.ctx)).toBe(true)
    expect(sketchStore.getState().open!.draft.take).toBe('flow')
    for (const k of ['f', 'o', 'e', 'x', '1', '2', '3', '4', 'w']) expect([k, r.tool.onKey!(key(k), r.ctx)]).toEqual([k, false])
  })

  it('Tab asks for the offset field, and the field is none on the surface', () => {
    const r = rig({ snap: null })
    expect(r.tool.onKey!(key('Tab'), r.ctx)).toBe(true)
    expect(sketchStore.getState().offsetAsked).toBe(1)
    r.tool.onKey!(key('u'), r.ctx)
    expect(r.tool.onKey!(key('Tab'), r.ctx)).toBe(false)
  })

  it('N makes the plane of the flat face under the pointer, as the kernel describes it, and says when the face is not flat', async () => {
    const face: Hit = { partKey: 'assembly:block', part: 'block', kind: 'face', index: 31, ref: 'block/F31', point: [0, -15, 5], normal: [0, -1, 0], distance: 85 }
    const r = rig({ snap: null, face })
    r.ctx.describe = async () => ({ kind: 'face', ref: 'assembly:block/F31', type: 'plane', area: 1, center: [0, -15, 5], normal: [0, -1, 0], radius: null, descriptor: 'plane' }) as never
    expect(r.tool.onKey!(key('n'), r.ctx)).toBe(true)
    await flush()
    expect(sketchStore.getState().open!.draft.planes.at(-1)).toMatchObject({ from: { kind: 'face', ref: 'block/F31', offset: 0, revision: 3 } })
    r.ctx.describe = async () => ({ kind: 'face', ref: 'assembly:block/F9', type: 'cylinder', area: 1, center: [0, 0, 0], normal: null, radius: 4, descriptor: 'cylinder' }) as never
    r.tool.onKey!(key('n'), r.ctx)
    await flush()
    expect(r.said).toEqual(['block/F31 is not flat: pick a flat face'])
  })
})
