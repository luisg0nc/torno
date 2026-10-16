import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Described, MeasureProbe } from '../../shared/geometry'
import { measuredStore, type Held } from '../state/measured'
import type { DimensionMark, Mark, NewMark, Vec3 } from '../../shared/marks'
import type { Camera } from '../../shared/view'
import { setBetween, setRound, toolStore } from '../state/tools'
import type { Hit } from '../viewport/picking'
import type { ViewportPointer } from '../viewport/Viewport'
import { REFUSAL_MS, SPREAD_LINE, measureTool, NOT_ROUND } from './measureTool'
import { routePointer, type ToolContext } from './Tool'

const CAMERA: Camera = { position: [0, -100, 0], target: [0, 0, 0], up: [0, 0, 1], ortho: true, fov: 35, zoom: 1 }
const PLANE: Described = { kind: 'face', ref: 'assembly:plate/F5', type: 'plane', area: 1100, center: [0, 0, 3], normal: [0, 0, 1], radius: null, descriptor: 'plane, normal +Z, z = 3, 1100 mm²' }
const CYLINDER: Described = { kind: 'face', ref: 'assembly:plate/F9', type: 'cylinder', area: 150.8, center: [-10, 5, 0], normal: null, radius: 4, descriptor: 'cylinder, radius 4, axis Z, 150.8 mm²' }
const CIRCLE: Described = { kind: 'edge', ref: 'assembly:plate/E20', type: 'circle', length: 25.13, center: [-10, 5, 3], descriptor: 'circle, radius 4, 25.13 mm' }
const LINE: Described = { kind: 'edge', ref: 'assembly:plate/E2', type: 'line', length: 40, center: [0, 15, 3], descriptor: 'line, 40 mm' }
const KNOWN: Record<string, Described> = { 'plate/F5': PLANE, 'plate/F0': { ...PLANE, ref: 'assembly:plate/F0', normal: [0, 0, -1] }, 'plate/F9': CYLINDER, 'plate/E20': CIRCLE, 'plate/E2': LINE }

const top = (point: Vec3 = [5, 3, 3]): Hit => ({ partKey: 'assembly:plate', part: 'plate', kind: 'face', index: 5, ref: 'plate/F5', point, normal: [0, 0, 1], distance: 100 })
const bottom = (point: Vec3 = [5, 3, -3]): Hit => ({ ...top(point), index: 0, ref: 'plate/F0', normal: [0, 0, -1] })
const hole = (point: Vec3 = [-6, 5, 0]): Hit => ({ ...top(point), index: 9, ref: 'plate/F9', normal: [-1, 0, 0] })
const rim = (point: Vec3 = [-6, 5, 3]): Hit => ({ ...top(point), kind: 'edge', index: 20, ref: 'plate/E20', normal: null })

/** A pointer event at a client pixel, on what is given. */
function pointer(type: ViewportPointer['type'], client: [number, number], hit: Hit | null = null, opts: { shift?: boolean; buttons?: number } = {}): ViewportPointer {
  world.under = hit
  world.at = client
  return { type, hit, ray: { origin: [client[0], -100, -client[1]], direction: [0, 1, 0] }, client, buttons: opts.buttons ?? 0, shift: opts.shift ?? false, alt: false }
}

const key = (name: string): KeyboardEvent => ({ key: name }) as KeyboardEvent

function fake(over: Partial<ToolContext> = {}) {
  const committed: NewMark[] = []
  const taken: MeasureProbe[] = []
  const noted: string[] = []
  const drafts: unknown[] = []
  const said: string[] = []
  const hovered: Array<string | null> = []
  /** What the kernel measures of each mark committed, as main would have it. */
  const measures: Record<string, Partial<DimensionMark>> = {
    distance: { value: 6, how: 'between planes' },
    angle: { value: 180, how: 'between normals' },
    diameter: { value: 8, how: 'cylinder' },
    radius: { value: 4, how: 'cylinder' },
    thickness: { value: 6, how: 'wall, along the normal' }
  }
  const ctx: ToolContext = {
    // What the viewport finds under a point as of now is what the last pointer event was on, unless a test says the view moved since (`under`).
    viewport: { setHover: (hit) => void hovered.push(hit?.ref ?? null), setNavigation: () => {}, setDraft: (d) => void drafts.push(d), lockedView: () => null, pickScan: () => null, scanPatch: () => null, pick: (_x, _y, opts) => (opts?.edges === false ? (world.under?.kind === 'edge' ? world.beneath : world.under) : world.under), pointerAt: () => world.at, bounds: () => ({ min: [-20, -15, -3], max: [20, 15, 3] }) },
    readout: { show: (_at, ref, detail) => void said.push(`${ref} | ${detail ?? ''}`), describe: () => {}, say: (_at, message) => void said.push(message), hide: () => void said.push('(hidden)') },
    objectId: 'measures',
    layout: 'assembly',
    revision: 7,
    camera: CAMERA,
    stale: null,
    descriptor: () => undefined,
    describe: async (ref) => KNOWN[ref] ?? null,
    // As main measures one not kept (`measureOnce`): on the build it was taken on.
    measure: async (probe) => {
      taken.push(probe)
      const { value, how } = measures[probe.measure]
      return { value: value!, how: how!, revision: probe.revision }
    },
    commit: async (mark) => {
      committed.push(mark)
      // As main measures it: on the build it was placed on.
      const measured = mark.kind === 'dimension' ? { ...measures[mark.measure], measuredRevision: mark.revision } : {}
      return { ...mark, ...measured, id: `M${committed.length}`, status: 'draft', anchorState: 'ok', createdAt: '2026-10-09T00:00:00.000Z' } as Mark
    },
    openNote: (mark) => void noted.push(mark.id),
    ...over
  }
  return { ctx, committed, taken, noted, drafts, said, hovered }
}

/** A measurement held, as the tool holds one: a distance of 6 mm on r7. */
const heldOne = (more: Partial<Held> = {}): Held => ({
  objectId: 'measures',
  layout: 'assembly',
  revision: 7,
  camera: CAMERA,
  measure: 'distance',
  a: { point: [5, 3, 3], part: 'plate', ref: 'plate/F5' },
  b: { point: [5, 3, -3], part: 'plate', ref: 'plate/F0' },
  value: 6,
  how: 'between planes',
  ...more
})

/** What is under the pointer as the viewport knows it, and where the pointer is: kept as the events say. */
/** `beneath`: the face under an edge that is under the pointer, which is what is found when the faces alone are asked for. */
const world: { under: Hit | null; at: [number, number] | null; beneath: Hit | null } = { under: null, at: null, beneath: null }

/** Lets the promises a tool left behind run out. */
const settled = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

beforeEach(() => {
  world.under = null
  world.at = null
  measuredStore.getState().clearHeld()
  setBetween('distance')
  setRound('diameter')
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the measure tool', () => {
  it('two clicks on two things leave a distance between them: each end with its ref, its point and the kernel’s line', async () => {
    const tool = measureTool()
    const { ctx, taken, committed, noted, said } = fake()
    tool.onPointer(pointer('click', [50, 50], top()), ctx)
    await settled()
    expect(taken).toEqual([])
    tool.onPointer(pointer('click', [50, 120], bottom()), ctx)
    await settled()
    expect(taken).toEqual([
      {
        measure: 'distance',
        layout: 'assembly',
        revision: 7,
        a: { point: [5, 3, 3], normal: [0, 0, 1], part: 'plate', ref: 'plate/F5', descriptor: PLANE.descriptor },
        b: { point: [5, 3, -3], normal: [0, 0, -1], part: 'plate', ref: 'plate/F0', descriptor: PLANE.descriptor }
      }
    ])
    // Nothing is kept of it, and no note is opened: it is the kernel's value, read out and held for the strip.
    expect(committed).toEqual([])
    expect(noted).toEqual([])
    expect(said.at(-1)).toBe('6 mm | between planes')
    expect(measuredStore.getState().held).toMatchObject({ objectId: 'measures', layout: 'assembly', revision: 7, camera: CAMERA, measure: 'distance', value: 6, how: 'between planes', a: { ref: 'plate/F5' }, b: { ref: 'plate/F0' } })
    expect(measuredStore.getState().held).not.toHaveProperty('kept')
  })

  it('a double click and T hold what they measure too, and commit nothing', async () => {
    const tool = measureTool()
    const { ctx, committed } = fake()
    tool.onPointer(pointer('click', [50, 50], hole()), ctx)
    tool.onPointer(pointer('click', [51, 50], hole()), ctx)
    await settled()
    expect(measuredStore.getState().held).toMatchObject({ measure: 'diameter', value: 8, how: 'cylinder' })
    tool.onPointer(pointer('move', [80, 40], top([8, 4, 3])), ctx)
    tool.onKey!(key('t'), ctx)
    await settled()
    expect(measuredStore.getState().held).toMatchObject({ measure: 'thickness', value: 6, a: { ref: 'plate/F5' } })
    expect(committed).toEqual([])
  })

  it('lets go of what it holds at the next first end, at Escape with nothing under way, and when it is put down', async () => {
    const tool = measureTool()
    const { ctx } = fake()
    const twice = async (): Promise<void> => {
      tool.onPointer(pointer('click', [50, 50], top()), ctx)
      tool.onPointer(pointer('click', [50, 120], bottom()), ctx)
      await settled()
    }
    await twice()
    tool.onPointer(pointer('click', [50, 50], top()), ctx)
    expect(measuredStore.getState().held).toBeNull()
    // Escape with a first end drops only the end; what is held stays.
    tool.onPointer(pointer('click', [50, 120], bottom()), ctx)
    await settled()
    tool.onPointer(pointer('click', [50, 50], top()), ctx)
    measuredStore.getState().setHeld({ ...heldOne() })
    expect(tool.onKey!(key('Escape'), ctx)).toBe(true)
    expect(measuredStore.getState().held).not.toBeNull()
    expect(tool.onKey!(key('Escape'), ctx)).toBe(true)
    expect(measuredStore.getState().held).toBeNull()
    expect(tool.onKey!(key('Escape'), ctx)).toBe(false)
    await twice()
    tool.cancel(ctx)
    expect(measuredStore.getState().held).toBeNull()
  })

  it('stays in hand: the next two clicks are the next dimension', async () => {
    const tool = measureTool()
    const { ctx, taken } = fake()
    for (const [y, hit] of [[50, top()], [120, bottom()], [200, top([9, 9, 3])], [300, hole()]] as const) {
      tool.onPointer(pointer('click', [50, y], hit), ctx)
      await settled()
    }
    expect(taken.map((m) => [m.a.ref, m.b?.ref])).toEqual([['plate/F5', 'plate/F0'], ['plate/F5', 'plate/F9']])
  })

  it('measures an angle between the two when that is what is asked for', async () => {
    const tool = measureTool()
    const { ctx, taken } = fake()
    tool.onPointer(pointer('click', [50, 50], top()), ctx)
    setBetween('angle')
    tool.onPointer(pointer('click', [50, 120], bottom()), ctx)
    await settled()
    expect(taken).toMatchObject([{ measure: 'angle', a: { ref: 'plate/F5' }, b: { ref: 'plate/F0' } }])
  })

  it('a double click on a cylindrical face or a circular edge commits its diameter at once', async () => {
    const tool = measureTool()
    const { ctx, taken } = fake()
    tool.onPointer(pointer('click', [50, 50], hole()), ctx)
    tool.onPointer(pointer('click', [51, 50], hole()), ctx)
    await settled()
    expect(taken).toEqual([{ measure: 'diameter', layout: 'assembly', revision: 7, a: { point: [-6, 5, 0], normal: [-1, 0, 0], part: 'plate', ref: 'plate/F9', descriptor: CYLINDER.descriptor } }])
    tool.onPointer(pointer('click', [200, 50], rim()), ctx)
    tool.onPointer(pointer('click', [200, 50], rim()), ctx)
    await settled()
    expect(taken[1]).toMatchObject({ measure: 'diameter', a: { point: [-6, 5, 3], ref: 'plate/E20' } })
    expect(taken[1]).not.toHaveProperty('b')
    // And the tool starts afresh: the next click is a first end again.
    tool.onPointer(pointer('click', [300, 300], top()), ctx)
    await settled()
    expect(taken).toHaveLength(2)
  })

  it('its radius, when that is what is asked for', async () => {
    const tool = measureTool()
    const { ctx, taken } = fake()
    setRound('radius')
    tool.onPointer(pointer('click', [50, 50], hole()), ctx)
    tool.onPointer(pointer('click', [50, 50], hole()), ctx)
    await settled()
    expect(taken).toMatchObject([{ measure: 'radius' }])
  })

  it('a double click on what has no radius is one click: the first end, still waiting for the second', async () => {
    const tool = measureTool()
    const { ctx, taken, said } = fake()
    tool.onPointer(pointer('click', [50, 50], top()), ctx)
    tool.onPointer(pointer('click', [50, 50], top()), ctx)
    await settled()
    expect(taken).toEqual([])
    // And why nothing was kept is said, where the pointer is: an ellipse, a flat face or a straight edge has no diameter.
    expect(said.at(-1)).toBe(NOT_ROUND)
    expect(NOT_ROUND).toBe('Not round: a double click measures a hole, a cylinder or a circle')
    tool.onPointer(pointer('click', [50, 120], bottom()), ctx)
    await settled()
    expect(taken).toMatchObject([{ measure: 'distance', a: { ref: 'plate/F5' }, b: { ref: 'plate/F0' } }])
  })

  it('a slow second click on a round thing is its second end, not a double click', async () => {
    vi.useFakeTimers()
    const tool = measureTool()
    const { ctx, taken } = fake()
    tool.onPointer(pointer('click', [50, 50], hole()), ctx)
    await vi.advanceTimersByTimeAsync(600)
    tool.onPointer(pointer('click', [50, 50], hole([-6, 5, 1])), ctx)
    await vi.advanceTimersByTimeAsync(10)
    expect(taken).toMatchObject([{ measure: 'distance', a: { ref: 'plate/F9' }, b: { ref: 'plate/F9', point: [-6, 5, 1] } }])
  })

  it('T over a face commits the thickness of the wall at that point', async () => {
    const tool = measureTool()
    const { ctx, taken } = fake()
    expect(tool.onKey!(key('t'), ctx)).toBe(false)
    tool.onPointer(pointer('move', [80, 40], top([8, 4, 3])), ctx)
    expect(tool.onKey!(key('t'), ctx)).toBe(true)
    await settled()
    expect(taken).toEqual([{ measure: 'thickness', layout: 'assembly', revision: 7, a: { point: [8, 4, 3], normal: [0, 0, 1], part: 'plate', ref: 'plate/F5', descriptor: PLANE.descriptor } }])
    // Held down, the key repeats: it is taken, and leaves no second dimension.
    expect(tool.onKey!({ key: 't', repeat: true } as KeyboardEvent, ctx)).toBe(true)
    await settled()
    expect(taken).toHaveLength(1)
    // With the pointer on an edge it is the wall of the face under it: the faces alone are asked for, as a wall is of a face.
    tool.onPointer(pointer('move', [200, 50], rim()), ctx)
    world.beneath = top([-6, 5, 3])
    expect(tool.onKey!(key('T'), ctx)).toBe(true)
    await settled()
    expect(taken).toHaveLength(2)
    expect(taken[1]).toMatchObject({ measure: 'thickness', a: { point: [-6, 5, 3], ref: 'plate/F5' } })
    taken.pop()
    // An edge with no face under it at that pixel (a silhouette) has no wall, and neither has nothing.
    world.beneath = null
    expect(tool.onKey!(key('T'), ctx)).toBe(false)
    tool.onPointer(pointer('move', [400, 400], null), ctx)
    expect(tool.onKey!(key('T'), ctx)).toBe(false)
    expect(taken).toHaveLength(1)
  })

  it('with Shift an end is a bare point: where it was clicked, tied to nothing', async () => {
    const tool = measureTool()
    const { ctx, taken } = fake()
    tool.onPointer(pointer('click', [50, 50], top([1, 2, 3]), { shift: true }), ctx)
    tool.onPointer(pointer('click', [50, 120], bottom()), ctx)
    await settled()
    expect(taken).toMatchObject([{ measure: 'distance', a: { point: [1, 2, 3] }, b: { ref: 'plate/F0' } }])
    expect((taken[0] as DimensionMark).a).toEqual({ point: [1, 2, 3] })
    // A bare point has no diameter: a double click with Shift is one click.
    tool.onPointer(pointer('click', [300, 50], hole(), { shift: true }), ctx)
    tool.onPointer(pointer('click', [300, 50], hole(), { shift: true }), ctx)
    await settled()
    expect(taken).toHaveLength(1)
  })

  it('Escape drops the first end and keeps the tool; with nothing under way it is not the tool’s', async () => {
    const tool = measureTool()
    const { ctx, taken, drafts } = fake()
    expect(tool.onKey!(key('Escape'), ctx)).toBe(false)
    tool.onPointer(pointer('click', [50, 50], top()), ctx)
    expect(drafts.at(-1)).toEqual({ kind: 'dimension', from: [5, 3, 3], to: null })
    expect(tool.onKey!(key('Escape'), ctx)).toBe(true)
    expect(drafts.at(-1)).toBeNull()
    // The next click is a first end again.
    tool.onPointer(pointer('click', [50, 120], bottom()), ctx)
    await settled()
    expect(taken).toEqual([])
    expect(tool.onKey!(key('Escape'), ctx)).toBe(true)
    expect(tool.onKey!(key('Escape'), ctx)).toBe(false)
  })

  it('put down, it drops what it had under way', async () => {
    const tool = measureTool()
    const { ctx, taken, drafts, hovered } = fake()
    tool.onPointer(pointer('click', [50, 50], top()), ctx)
    tool.cancel(ctx)
    expect(drafts.at(-1)).toBeNull()
    expect(hovered.at(-1)).toBeNull()
    tool.onPointer(pointer('click', [50, 120], bottom()), ctx)
    await settled()
    expect(taken).toEqual([])
  })

  it('while the second end is pending, draws the line to the pointer and reads out an estimate from the mesh, marked as one', () => {
    const tool = measureTool()
    const { ctx, drafts, said } = fake()
    tool.onPointer(pointer('move', [50, 50], top()), ctx)
    expect(said.at(-1)).toBe('plate/F5 | ')
    tool.onPointer(pointer('click', [50, 50], top()), ctx)
    tool.onPointer(pointer('move', [50, 120], bottom([5, 7, -3])), ctx)
    expect(drafts.at(-1)).toEqual({ kind: 'dimension', from: [5, 3, 3], to: [5, 7, -3] })
    // √(4² + 6²)
    expect(said.at(-1)).toBe('≈ 7.211 mm | plate/F0')
    setBetween('angle')
    tool.onPointer(pointer('move', [50, 121], bottom([5, 7, -3])), ctx)
    expect(said.at(-1)).toBe('≈ 180° | plate/F0')
    // An edge has no normal to estimate an angle from.
    tool.onPointer(pointer('move', [50, 122], rim()), ctx)
    expect(said.at(-1)).toBe('angle | plate/E20')
    // Off the parts, only the first end is drawn.
    tool.onPointer(pointer('move', [400, 400], null), ctx)
    expect(drafts.at(-1)).toEqual({ kind: 'dimension', from: [5, 3, 3], to: null })
  })

  it('in angle mode, says before the click what the kernel takes an angle of only if flat, or never, and gives no estimate of it; a plane has its estimate', async () => {
    const SPHERE: Described = { kind: 'face', ref: 'assembly:plate/F11', type: 'sphere', area: 50, center: [0, 0, 0], normal: [0, 0, 1], radius: 2, descriptor: 'sphere, 50 mm²' }
    const SPLINE: Described = { kind: 'face', ref: 'assembly:plate/F12', type: 'bspline', area: 50, center: [0, 0, 0], normal: [0, 0, 1], radius: null, descriptor: 'bspline, 50 mm²' }
    const ball = (): Hit => ({ ...top(), index: 11, ref: 'plate/F11', normal: [0, 0, -1] })
    const sheet = (): Hit => ({ ...top(), index: 12, ref: 'plate/F12', normal: [0, 0, -1] })
    const tool = measureTool()
    const { ctx, said, taken } = fake({ describe: async (ref) => ({ ...KNOWN, 'plate/F11': SPHERE, 'plate/F12': SPLINE })[ref] ?? null })
    setBetween('angle')
    tool.onPointer(pointer('click', [50, 50], top()), ctx)
    await settled()
    // A plane: the estimate from the normals.
    tool.onPointer(pointer('move', [50, 120], bottom()), ctx)
    await settled()
    expect(said.at(-1)).toBe('≈ 180° | plate/F0')
    // A sphere: never, and why, with no estimate.
    tool.onPointer(pointer('move', [50, 121], ball()), ctx)
    await settled()
    expect(said.at(-1)).toBe('Not flat: plate/F11 is a sphere face. An angle needs a flat face, a straight edge or an axis')
    // A spline face: taken only if it is flat.
    tool.onPointer(pointer('move', [50, 122], sheet()), ctx)
    await settled()
    expect(said.at(-1)).toBe('Taken only if flat: plate/F12 is a bspline face')
    // A hole: by its axis, which the mesh does not give.
    tool.onPointer(pointer('move', [50, 123], hole()), ctx)
    await settled()
    expect(said.at(-1)).toBe('By its axis: plate/F9 is a cylinder face')
    // A descriptor already given says it at once, with no estimate meanwhile.
    const known = fake({ descriptor: (ref) => (ref === 'plate/F12' ? SPLINE.descriptor : undefined), describe: () => new Promise(() => {}) })
    const other = measureTool()
    other.onPointer(pointer('click', [50, 50], top()), known.ctx)
    other.onPointer(pointer('move', [50, 122], sheet()), known.ctx)
    expect(known.said.at(-1)).toBe('Taken only if flat: plate/F12 is a bspline face')
    // A hint, not a gate: the click goes to main all the same.
    tool.onPointer(pointer('click', [50, 121], ball()), ctx)
    await settled()
    expect(taken).toMatchObject([{ measure: 'angle', a: { ref: 'plate/F5' }, b: { ref: 'plate/F11' } }])
  })

  it('in angle mode, says of the first end what the kernel will not take an angle of', async () => {
    const SPHERE: Described = { kind: 'face', ref: 'assembly:plate/F11', type: 'sphere', area: 50, center: [0, 0, 0], normal: [0, 0, 1], radius: 2, descriptor: 'sphere, 50 mm²' }
    const ball = (): Hit => ({ ...top(), index: 11, ref: 'plate/F11', normal: [0, 0, -1] })
    const tool = measureTool()
    const { ctx, said } = fake({ describe: async (ref) => ({ ...KNOWN, 'plate/F11': SPHERE })[ref] ?? null })
    setBetween('angle')
    tool.onPointer(pointer('click', [50, 50], ball()), ctx)
    await settled()
    tool.onPointer(pointer('move', [50, 120], bottom()), ctx)
    await settled()
    expect(said.at(-1)).toBe('Not flat: plate/F11 is a sphere face. An angle needs a flat face, a straight edge or an axis')
  })

  it('once main has measured it, reads out the kernel’s value in place of the estimate, and takes its draft away', async () => {
    const tool = measureTool()
    const { ctx, drafts, said } = fake()
    tool.onPointer(pointer('click', [50, 50], top()), ctx)
    tool.onPointer(pointer('click', [50, 120], bottom()), ctx)
    expect(drafts.at(-1)).toEqual({ kind: 'dimension', from: [5, 3, 3], to: [5, 3, -3] })
    await settled()
    expect(said.at(-1)).toBe('6 mm | between planes')
    expect(drafts.at(-1)).toBeNull()
    // It stays while the pointer rests there, and makes way when it moves on.
    tool.onPointer(pointer('move', [50, 121], bottom()), ctx)
    expect(said.at(-1)).toBe('6 mm | between planes')
    tool.onPointer(pointer('move', [90, 160], bottom()), ctx)
    expect(said.at(-1)).toBe('plate/F0 | ')
  })

  it('holds nothing when main could not measure it, and says why', async () => {
    const tool = measureTool()
    const { ctx, said } = fake({ measure: () => Promise.reject(new Error('the kernel did not answer within 10 s')) })
    tool.onPointer(pointer('click', [50, 50], top()), ctx)
    tool.onPointer(pointer('click', [50, 120], bottom()), ctx)
    await settled()
    expect(said.at(-1)).toBe('the kernel did not answer within 10 s')
    expect(measuredStore.getState().held).toBeNull()
  })

  it('when the kernel refuses the measurement there is no dimension, and its reason is read out for four seconds', async () => {
    vi.useFakeTimers()
    const tool = measureTool()
    const reason = 'angle is measured between two planar faces, two straight edges, or a planar face and a straight edge; plate/F9 is a cylinder face'
    const { ctx, said, drafts } = fake({ measure: () => Promise.reject(new Error(reason)) })
    setBetween('angle')
    tool.onPointer(pointer('click', [50, 50], top()), ctx)
    tool.onPointer(pointer('click', [50, 120], hole()), ctx)
    await vi.advanceTimersByTimeAsync(10)
    expect(said.at(-1)).toBe(reason)
    expect(drafts.at(-1)).toBeNull()
    // Moving the pointer does not wipe it.
    tool.onPointer(pointer('move', [300, 300], top()), ctx)
    expect(said.at(-1)).toBe(reason)
    await vi.advanceTimersByTimeAsync(REFUSAL_MS)
    expect(said.at(-1)).toBe('(hidden)')
    tool.onPointer(pointer('move', [301, 300], top()), ctx)
    expect(said.at(-1)).toBe('plate/F5 | ')
  })

  it('T measures the wall under the pointer as of now: straight after the tool is taken, with no pointer move, and after a zoom moved the part under it', async () => {
    const tool = measureTool()
    const { ctx, taken } = fake()
    // The tool was taken with M while the pointer rested over the top: it has been told of no move.
    world.under = top([8, 4, 3])
    world.at = [80, 40]
    expect(tool.onKey!(key('t'), ctx)).toBe(true)
    await settled()
    expect(taken).toMatchObject([{ measure: 'thickness', a: { point: [8, 4, 3], ref: 'plate/F5' } }])
    // A move over the top, then the wheel brings the side of the hole under the pointer: no move tells the tool.
    tool.onPointer(pointer('move', [80, 40], top([8, 4, 3])), ctx)
    world.under = hole([-6, 5, 1])
    expect(tool.onKey!(key('t'), ctx)).toBe(true)
    await settled()
    expect(taken[1]).toMatchObject({ measure: 'thickness', a: { point: [-6, 5, 1], ref: 'plate/F9' } })
    // Zoomed until nothing is under it, or with the pointer off the canvas, there is no wall.
    world.under = null
    expect(tool.onKey!(key('t'), ctx)).toBe(false)
    world.under = top()
    world.at = null
    expect(tool.onKey!(key('t'), ctx)).toBe(false)
    expect(taken).toHaveLength(2)
  })

  it('between two parts torno spread for printing, says so in a line in place of the estimate, and after the click until the next click or Escape', async () => {
    vi.useFakeTimers()
    const tool = measureTool()
    const long = "In layout print torno spread these parts apart for display (they overlapped as the model placed them), so the distance between plate and lid there is torno's, not the model's. Ask in a layout that places the parts as assembled (layouts: assembly), or check each part by itself."
    const { ctx, said, taken } = fake({ moved: (part) => part === 'lid', measure: () => Promise.reject(new Error(long)) })
    const onLid = (): Hit => ({ ...top([60, 3, 3]), partKey: 'print:lid', part: 'lid', ref: 'lid/F5' })
    tool.onPointer(pointer('click', [50, 50], top()), ctx)
    // No estimate of a distance that is torno's.
    tool.onPointer(pointer('move', [300, 50], onLid()), ctx)
    expect(said.at(-1)).toBe(SPREAD_LINE)
    expect(SPREAD_LINE).toBe('Parts are spread for printing here: no distance between them. Add assembly(p) to check fit.')
    // On the same part, and of an angle, the estimate is read out as ever.
    tool.onPointer(pointer('move', [60, 120], bottom()), ctx)
    expect(said.at(-1)).toBe('≈ 6 mm | plate/F0')
    setBetween('angle')
    tool.onPointer(pointer('move', [300, 50], onLid()), ctx)
    expect(said.at(-1)).toBe('≈ 0° | lid/F5')
    setBetween('distance')
    // Clicked all the same, main refuses in full: the line is said, and stays past the four seconds of any other refusal.
    tool.onPointer(pointer('click', [300, 50], onLid()), ctx)
    await vi.advanceTimersByTimeAsync(10)
    expect(said.at(-1)).toBe(SPREAD_LINE)
    await vi.advanceTimersByTimeAsync(REFUSAL_MS * 5)
    tool.onPointer(pointer('move', [310, 60], onLid()), ctx)
    expect(said.at(-1)).toBe(SPREAD_LINE)
    // Escape puts it away, and so does the next click.
    expect(tool.onKey!(key('Escape'), ctx)).toBe(true)
    expect(said.at(-1)).toBe('(hidden)')
    tool.onPointer(pointer('click', [50, 50], top()), ctx)
    tool.onPointer(pointer('click', [300, 50], onLid()), ctx)
    await vi.advanceTimersByTimeAsync(10)
    expect(said.at(-1)).toBe(SPREAD_LINE)
    tool.onPointer(pointer('click', [50, 50], top()), ctx)
    tool.onPointer(pointer('move', [60, 120], bottom()), ctx)
    expect(said.at(-1)).toBe('≈ 6 mm | plate/F0')
    expect(taken).toEqual([])
  })

  it('is given nothing while the parts on screen are stale, and T does nothing then', async () => {
    const tool = measureTool()
    const { ctx, taken, said } = fake({ stale: 'Rebuilding: picks wait for the new build' })
    routePointer(tool, pointer('click', [50, 50], top()), ctx)
    routePointer(tool, pointer('click', [50, 120], bottom()), ctx)
    await settled()
    expect(taken).toEqual([])
    expect(said.at(-1)).toBe('Rebuilding: picks wait for the new build')
    expect(tool.onKey!(key('t'), ctx)).toBe(false)
  })

  it('Enter keeps the last measurement as a dimension, once: the same ends, build and camera, measured again by main', async () => {
    const tool = measureTool()
    const { ctx, committed } = fake()
    expect(tool.onKey!(key('Enter'), ctx)).toBe(false)
    tool.onPointer(pointer('click', [50, 50], top()), ctx)
    tool.onPointer(pointer('click', [50, 120], bottom()), ctx)
    await settled()
    expect(tool.onKey!(key('Enter'), ctx)).toBe(true)
    await settled()
    expect(committed).toEqual([
      {
        kind: 'dimension',
        measure: 'distance',
        author: 'user',
        note: '',
        layout: 'assembly',
        revision: 7,
        camera: CAMERA,
        a: { point: [5, 3, 3], normal: [0, 0, 1], part: 'plate', ref: 'plate/F5', descriptor: PLANE.descriptor },
        b: { point: [5, 3, -3], normal: [0, 0, -1], part: 'plate', ref: 'plate/F0', descriptor: PLANE.descriptor }
      }
    ])
    expect(measuredStore.getState().held?.kept).toBe('M1')
    // Kept already: a second Enter keeps nothing more.
    tool.onKey!(key('Enter'), ctx)
    await settled()
    expect(committed).toHaveLength(1)
  })

  it('when main will not keep it, says why and holds the measurement still', async () => {
    const tool = measureTool()
    const { ctx, said } = fake({ commit: () => Promise.reject(new Error('it was placed on r7, and the part has been built again since (r8): measure it again')) })
    tool.onPointer(pointer('click', [50, 50], hole()), ctx)
    tool.onPointer(pointer('click', [50, 50], hole()), ctx)
    await settled()
    expect(tool.onKey!(key('Enter'), ctx)).toBe(true)
    await settled()
    expect(said.at(-1)).toBe('it was placed on r7, and the part has been built again since (r8): measure it again')
    expect(measuredStore.getState()).toMatchObject({ held: { measure: 'diameter', value: 8 }, refused: 'it was placed on r7, and the part has been built again since (r8): measure it again' })
    expect(measuredStore.getState().held).not.toHaveProperty('kept')
  })

  it('is one of the tools, on M', () => {
    expect(toolStore.getState()).toMatchObject({ between: 'distance', round: 'diameter' })
  })
})
