import { describe, expect, it } from 'vitest'
import type { Described } from '../../shared/geometry'
import type { Mark, NewMark, Vec3 } from '../../shared/marks'
import type { Camera } from '../../shared/view'
import type { Hit } from '../viewport/picking'
import type { ViewportPointer } from '../viewport/Viewport'
import { MAX_STROKE_POINTS } from '../../shared/marks'
import { drawTool } from './drawTool'
import { fromPlane, planeName, toPlane, viewPlane } from './planes'
import { simplify } from './simplify'
import { routePointer, type ToolContext } from './Tool'

// From the front: the camera is on -Y and looks along +Y. A pixel is a millimetre.
const FRONT: Camera = { position: [0, -100, 0], target: [0, 0, 0], up: [0, 0, 1], ortho: true, fov: 35, zoom: 1 }
const FACE: Described = { kind: 'face', ref: 'assembly:base/F5', type: 'plane', area: 1200, center: [0, 0, 2.5], normal: [0, 0, 1], radius: null, descriptor: 'plane, normal +Z, z = 2.5, 1200 mm²' }
const BOUNDS = { min: [-20, -15, -2.5] as Vec3, max: [20, 15, 22.5] as Vec3 }

function hitAt(point: Vec3): Hit {
  return { partKey: 'assembly:base', part: 'base', kind: 'face', index: 5, ref: 'base/F5', point, normal: [0, 0, 1], distance: 100 }
}

/** A pointer event from the front: the ray looks along +Y through (x, z), and the client pixel is (x, -z). */
function pointer(type: ViewportPointer['type'], x: number, z: number, hit: Hit | null = null): ViewportPointer {
  return { type, hit, ray: { origin: [x, -100, z], direction: [0, 1, 0] }, client: [x, -z], buttons: type === 'up' || type === 'click' ? 0 : 1, shift: false, alt: false }
}

function fake(opts: { locked?: 'front' | null; pick?: (x: number, y: number, opts?: { edges?: boolean }) => Hit | null; stale?: string } = {}) {
  const committed: NewMark[] = []
  const noted: string[] = []
  const drafts: unknown[] = []
  const navigation: unknown[][] = []
  const said: string[] = []
  const ctx: ToolContext = {
    viewport: {
      setHover: () => {},
      setNavigation: (...args) => void navigation.push(args),
      setDraft: (d) => void drafts.push(d),
      lockedView: () => opts.locked ?? null,
      pick: (x, y, o) => opts.pick?.(x, y, o) ?? null,
      bounds: () => BOUNDS,
      pickScan: () => null, scanPatch: () => null
    },
    readout: { show: (_at, ref, detail) => void said.push(`${ref} | ${detail ?? ''}`), describe: () => {}, say: (_at, message) => void said.push(message), hide: () => {} },
    objectId: 'bracket',
    layout: 'assembly',
    revision: 7,
    camera: FRONT,
    stale: opts.stale ?? null,
    descriptor: () => undefined,
    describe: async () => FACE,
    measure: () => Promise.reject(new Error('nothing is measured here')),
    commit: async (mark) => {
      committed.push(mark)
      return { ...mark, id: `M${committed.length}`, status: 'draft', anchorState: 'ok', createdAt: '2026-10-09T00:00:00.000Z' } as Mark
    },
    openNote: (mark) => void noted.push(mark.id)
  }
  return { ctx, committed, noted, drafts, navigation, said }
}

const settled = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

describe('simplify', () => {
  it('keeps the ends and removes the points on the line between them', () => {
    expect(simplify<[number, number]>([[0, 0], [1, 0], [2, 0.05], [3, 0], [10, 0]], 0.2, 400)).toEqual([[0, 0], [10, 0]])
  })

  it('keeps a point that is further off the line than the tolerance', () => {
    expect(simplify<[number, number]>([[0, 0], [5, 0.1], [5, 3], [7, 3.1], [10, 3]], 0.2, 400)).toEqual([[0, 0], [5, 0.1], [5, 3], [10, 3]])
  })

  it('works on points in space', () => {
    const points: Vec3[] = [[0, 0, 0], [1, 1, 1], [2, 2, 2], [2, 2, 8], [2, 2, 9]]
    expect(simplify(points, 0.2, 400)).toEqual([[0, 0, 0], [2, 2, 2], [2, 2, 9]])
  })

  it('never gives more than the most asked for, and still keeps the ends', () => {
    // A zigzag: no point of it is within the tolerance of its neighbours' line.
    const points = Array.from({ length: 3000 }, (_, i): [number, number] => [i, i % 2 === 0 ? 0 : 5])
    const kept = simplify(points, 0.2, 400)
    expect(kept.length).toBeLessThanOrEqual(400)
    expect(kept.length).toBeGreaterThan(300)
    expect(kept[0]).toEqual([0, 0])
    expect(kept.at(-1)).toEqual([2999, 5])
    // Thinned evenly: in the order drawn, with no long gap.
    const xs = kept.map((p) => p[0])
    expect(xs).toEqual([...xs].sort((a, b) => a - b))
    expect(Math.max(...xs.slice(1).map((x, i) => x - xs[i]))).toBeLessThanOrEqual(9)
  })

  it('leaves one point, or two, or a closed loop, as they are', () => {
    expect(simplify<[number, number]>([[1, 2]], 0.2, 400)).toEqual([[1, 2]])
    expect(simplify<[number, number]>([[1, 2], [1, 2]], 0.2, 400)).toEqual([[1, 2], [1, 2]])
    expect(simplify<[number, number]>([[0, 0], [10, 0], [10, 10], [0, 0]], 0.2, 400)).toEqual([[0, 0], [10, 0], [10, 10], [0, 0]])
  })
})

describe('viewPlane', () => {
  it('names the plane of the front view through a point: XZ at its y', () => {
    const plane = viewPlane({ ...FRONT, position: [0, -100, 0], target: [0, 0, 0] }, [0, 40, 0])
    expect(plane).toEqual({ origin: [0, 40, 0], x: [1, 0, 0], y: [0, 0, 1], label: 'XZ at y = 40.0 (u = +X, v = +Z)' })
  })

  it('has the view’s right and up as its axes, whichever way the view looks', () => {
    // From the right: looking along -X, +Y is to the right.
    expect(viewPlane({ ...FRONT, position: [100, 0, 0] }, [12.34, 0, 5])).toEqual({ origin: [12.34, 0, 5], x: [0, 1, 0], y: [0, 0, 1], label: 'YZ at x = 12.3 (u = +Y, v = +Z)' })
    // From above, +Y up on screen. The viewport leans this camera by a hair: the axes come out exact all the same.
    expect(viewPlane({ ...FRONT, position: [0, -0.001, 100], up: [0, 1, 0.00001] }, [1, 2, -0.04])).toEqual({ origin: [1, 2, -0.04], x: [1, 0, 0], y: [0, 1, 0], label: 'XY at z = 0.0 (u = +X, v = +Y)' })
    // From the back: +X runs to the left, and the plane says so in its x.
    expect(viewPlane({ ...FRONT, position: [0, 100, 0] }, [0, 0, 0])).toMatchObject({ x: [-1, 0, 0], y: [0, 0, 1], label: 'XZ at y = 0.0 (u = -X, v = +Z)' })
  })

  it('says which way its two axes run, so that the same plane seen from the other side is not the same label: a profile is never read mirrored', () => {
    const from = (position: [number, number, number], up: [number, number, number] = [0, 0, 1]) => viewPlane({ ...FRONT, position, up }, [1, 2, 3])
    // Front and back.
    expect(from([0, -100, 0])).toMatchObject({ x: [1, 0, 0], y: [0, 0, 1], label: 'XZ at y = 2.0 (u = +X, v = +Z)' })
    expect(from([0, 100, 0])).toMatchObject({ x: [-1, 0, 0], y: [0, 0, 1], label: 'XZ at y = 2.0 (u = -X, v = +Z)' })
    // Right and left.
    expect(from([100, 0, 0])).toMatchObject({ x: [0, 1, 0], y: [0, 0, 1], label: 'YZ at x = 1.0 (u = +Y, v = +Z)' })
    expect(from([-100, 0, 0])).toMatchObject({ x: [0, -1, 0], y: [0, 0, 1], label: 'YZ at x = 1.0 (u = -Y, v = +Z)' })
    // Top and bottom.
    expect(from([0, 0, 100], [0, 1, 0])).toMatchObject({ x: [1, 0, 0], y: [0, 1, 0], label: 'XY at z = 3.0 (u = +X, v = +Y)' })
    expect(from([0, 0, -100], [0, -1, 0])).toMatchObject({ x: [1, 0, 0], y: [0, -1, 0], label: 'XY at z = 3.0 (u = +X, v = -Y)' })
    // A point drawn to the right of the origin on screen is at +u, whichever side it is seen from.
    expect(fromPlane(from([0, 100, 0]), [5, 0])).toEqual([-4, 2, 3])
    expect(fromPlane(from([-100, 0, 0]), [5, 0])).toEqual([1, -3, 3])
    expect(fromPlane(from([0, 0, -100], [0, -1, 0]), [0, 5])).toEqual([1, -3, 3])
  })

  it('names a plane seen square on but turned about the view by its axes as vectors', () => {
    const turned = viewPlane({ ...FRONT, position: [0, 0, 100], up: [Math.SQRT1_2, Math.SQRT1_2, 0] }, [0, 0, 5])
    expect(turned.label).toBe('XY at z = 5.0 (u = [0.71, -0.71, 0], v = [0.71, 0.71, 0])')
    expect(planeName(turned.label)).toBe('XY at z = 5.0')
    expect(planeName('view plane (u = [1, 0.01, 0], v = +Z)')).toBe('view plane')
  })

  it('is only "view plane" when the view is more than half a degree off every axis', () => {
    const off = Math.tan((0.6 * Math.PI) / 180) * 100
    const plane = viewPlane({ ...FRONT, position: [off, -100, 0] }, [0, 40, 0])
    // An axis that is exactly a principal one is named; the other is given as its numbers.
    expect(plane.label).toBe('view plane (u = [1, 0.01, 0], v = +Z)')
    expect(Math.hypot(...plane.x)).toBeCloseTo(1, 9)
    expect(plane.y).toEqual([0, 0, 1])
    const near = Math.tan((0.4 * Math.PI) / 180) * 100
    expect(viewPlane({ ...FRONT, position: [near, -100, 0] }, [0, 40, 0]).label).toBe('XZ at y = 40.0 (u = +X, v = +Z)')
  })

  it('takes points to its own two axes and back', () => {
    const plane = viewPlane({ ...FRONT, position: [60, -80, 50] }, [3, 4, 5])
    for (const uv of [[0, 0], [12.5, -7], [-30, 41.25]] as [number, number][]) {
      const back = toPlane(plane, fromPlane(plane, uv))
      expect(back[0]).toBeCloseTo(uv[0], 9)
      expect(back[1]).toBeCloseTo(uv[1], 9)
    }
    expect(fromPlane(viewPlane(FRONT, [0, 40, 0]), [10, 20])).toEqual([10, 40, 20])
    expect(toPlane(viewPlane(FRONT, [0, 40, 0]), [10, 40, 20])).toEqual([10, 20])
  })
})

describe('the draw tool', () => {
  it('on a locked view, draws on the view plane through the middle of the scene when it starts beside the parts', async () => {
    const { ctx, committed, noted, navigation, drafts, said } = fake({ locked: 'front' })
    const tool = drawTool()
    routePointer(tool, pointer('down', 30, 5), ctx)
    // The camera is not turned by this drag, and the wheel still zooms.
    expect(navigation).toEqual([[false, { wheel: true }]])
    routePointer(tool, pointer('move', 40, 15), ctx)
    expect(drafts.at(-1)).toEqual({ kind: 'stroke', points: [[30, 0, 5], [40, 0, 15]] })
    // The plane, and how large the drawing is on it.
    expect(said.at(-1)).toBe('XZ at y = 0.0 (u = +X, v = +Z) | 10.0 × 10.0 mm')
    routePointer(tool, pointer('move', 30, 20), ctx)
    routePointer(tool, pointer('up', 40, 25), ctx)
    expect(navigation.at(-1)).toEqual([true])
    await settled()
    expect(committed).toEqual([
      {
        kind: 'stroke',
        space: 'plane',
        author: 'user',
        note: '',
        layout: 'assembly',
        revision: 7,
        camera: FRONT,
        anchor: { point: [30, 0, 5] },
        plane: { origin: [0, 0, 10], x: [1, 0, 0], y: [0, 0, 1], label: 'XZ at y = 0.0 (u = +X, v = +Z)' },
        points2d: [[30, -5], [40, 5], [30, 10], [40, 15]]
      }
    ])
    expect(noted).toEqual(['M1'])
    expect(drafts.at(-1)).toBeNull()
  })

  it('on a locked view, the plane goes through the point of the part the stroke starts on', async () => {
    const { ctx, committed } = fake({ locked: 'front' })
    const tool = drawTool()
    routePointer(tool, pointer('down', 10, 2.5, hitAt([10, -15, 2.5])), ctx)
    routePointer(tool, pointer('move', 10, 12.5), ctx)
    routePointer(tool, pointer('up', 25, 12.5), ctx)
    await settled()
    expect(committed[0]).toMatchObject({
      kind: 'stroke',
      space: 'plane',
      anchor: { point: [10, -15, 2.5], part: 'base', ref: 'base/F5', descriptor: FACE.descriptor },
      plane: { origin: [10, -15, 2.5], x: [1, 0, 0], y: [0, 0, 1], label: 'XZ at y = -15.0 (u = +X, v = +Z)' },
      points2d: [[0, 0], [0, 10], [15, 10]]
    })
  })

  it('on a free view, draws on the surface: each sample is where the pointer is on a part, and those beside the parts are left out', async () => {
    // The part is under the pointer for x up to 20.
    const pick = (x: number, y: number): Hit | null => (x <= 20 ? hitAt([x, -15, -y]) : null)
    const { ctx, committed, noted, navigation, drafts } = fake({ pick })
    const tool = drawTool()
    routePointer(tool, pointer('down', 0, 0, hitAt([0, -15, 0])), ctx)
    expect(navigation).toEqual([[false, { wheel: true }]])
    routePointer(tool, pointer('move', 10, 10), ctx)
    expect(drafts.at(-1)).toEqual({ kind: 'stroke', points: [[0, -15, 0], [10, -15, 10]] })
    routePointer(tool, pointer('move', 30, 10), ctx)
    routePointer(tool, pointer('move', 20, 0), ctx)
    routePointer(tool, pointer('up', 20, -8), ctx)
    await settled()
    expect(committed).toEqual([
      {
        kind: 'stroke',
        space: 'surface',
        author: 'user',
        note: '',
        layout: 'assembly',
        revision: 7,
        camera: FRONT,
        anchor: { point: [0, -15, 0], normal: [0, 0, 1], part: 'base', ref: 'base/F5', descriptor: FACE.descriptor },
        points: [[0, -15, 0], [10, -15, 10], [20, -15, 0], [20, -15, -8]]
      }
    ])
    expect(noted).toEqual(['M1'])
  })

  it('on a free view, begins on the face under the pointer, not on the edge the pointer is within reach of', async () => {
    // The viewport reports the edge it snapped to; under the pointer itself is the face, 0.4 mm from it.
    const edge: Hit = { partKey: 'assembly:base', part: 'base', kind: 'edge', index: 3, ref: 'base/E3', point: [0, -15, 0], normal: null, distance: 100 }
    const picks: Array<{ edges?: boolean } | undefined> = []
    const { ctx, committed } = fake({
      pick: (x, y, opts) => {
        picks.push(opts)
        return hitAt([x + 0.4, -15, -y])
      }
    })
    const tool = drawTool()
    routePointer(tool, pointer('down', 0, 0, edge), ctx)
    expect(picks).toEqual([{ edges: false }])
    routePointer(tool, pointer('move', 10, 0), ctx)
    routePointer(tool, pointer('up', 20, 0), ctx)
    await settled()
    expect(committed[0]).toMatchObject({ space: 'surface', anchor: { point: [0.4, -15, 0], ref: 'base/F5', normal: [0, 0, 1] }, points: [[0.4, -15, 0], [20.4, -15, 0]] })

    // Within reach of an edge and beside the part: there is no face to begin on, and the drag turns the camera.
    const beside = fake({ pick: () => null })
    routePointer(drawTool(), pointer('down', 0, 0, edge), beside.ctx)
    expect(beside.navigation).toEqual([])
  })

  it('on a free view, a press beside the parts is not a stroke: that drag turns the camera', async () => {
    const { ctx, committed, navigation, drafts } = fake()
    const tool = drawTool()
    routePointer(tool, pointer('down', 90, 90), ctx)
    routePointer(tool, pointer('move', 60, 60), ctx)
    routePointer(tool, pointer('up', 60, 60), ctx)
    await settled()
    expect(navigation).toEqual([])
    expect(drafts.filter(Boolean)).toEqual([])
    expect(committed).toEqual([])
  })

  it('with Alt held, a press is not a stroke: it is left to turn the camera, on a locked view too', async () => {
    for (const locked of ['front', null] as const) {
      const { ctx, committed, navigation, drafts } = fake({ locked })
      const tool = drawTool()
      routePointer(tool, { ...pointer('down', 0, 0, hitAt([0, -15, 0])), alt: true }, ctx)
      routePointer(tool, { ...pointer('move', 30, 10), alt: true }, ctx)
      routePointer(tool, { ...pointer('up', 30, 10), alt: true }, ctx)
      await settled()
      expect(navigation).toEqual([])
      expect(drafts.filter(Boolean)).toEqual([])
      expect(committed).toEqual([])
    }
  })

  it('on a locked view, says beside the parts which plane a stroke would be on, and how to turn the view', () => {
    const { ctx, said } = fake({ locked: 'front' })
    const tool = drawTool()
    routePointer(tool, { ...pointer('move', 30, 5), buttons: 0 }, ctx)
    expect(said.at(-1)).toBe('Draws on XZ at y = 0.0. Alt-drag or Iso (1) to turn the view')
    // On a free view there is nothing to say there.
    const free = fake()
    routePointer(drawTool(), { ...pointer('move', 30, 5), buttons: 0 }, free.ctx)
    expect(free.said).toEqual([])
  })

  it('is no stroke when all of it is shorter than 0.1 mm, however far the pointer went', async () => {
    const { ctx, committed, drafts, navigation } = fake({ locked: 'front' })
    const tool = drawTool()
    // Zoomed far in: 30 px of pointer are 0.06 mm of plane.
    const at = (type: ViewportPointer['type'], px: number): ViewportPointer => ({ ...pointer(type, px / 500, 0), client: [px, 0] })
    routePointer(tool, at('down', 0), ctx)
    routePointer(tool, at('move', 10), ctx)
    routePointer(tool, at('move', 20), ctx)
    routePointer(tool, at('up', 30), ctx)
    await settled()
    expect(committed).toEqual([])
    expect(drafts.at(-1)).toBeNull()
    expect(navigation.at(-1)).toEqual([true])
  })

  it('is no stroke when it goes out and back within 0.1 mm of where it began: simplified, it would be two points in one place', async () => {
    const { ctx, committed, drafts } = fake({ locked: 'front' })
    const tool = drawTool()
    const at = (type: ViewportPointer['type'], px: number): ViewportPointer => ({ ...pointer(type, px / 500, 0), client: [px, 0] })
    // 0.16 mm out and back: 0.32 mm of path, and nothing left of it between its ends.
    routePointer(tool, at('down', 0), ctx)
    routePointer(tool, at('move', 40), ctx)
    routePointer(tool, at('move', 80), ctx)
    routePointer(tool, at('move', 40), ctx)
    routePointer(tool, at('up', 0), ctx)
    await settled()
    expect(committed).toEqual([])
    expect(drafts.at(-1)).toBeNull()
  })

  it('samples every 3 px the pointer travels', () => {
    const { ctx, drafts } = fake({ locked: 'front' })
    const tool = drawTool()
    routePointer(tool, pointer('down', 0, 0), ctx)
    for (let x = 1; x <= 7; x++) routePointer(tool, pointer('move', x, 0), ctx)
    expect(drafts.at(-1)).toEqual({ kind: 'stroke', points: [[0, 0, 0], [3, 0, 0], [6, 0, 0]] })
  })

  it('simplifies a stroke of thousands of points to 400 at most, keeping its ends', async () => {
    const { ctx, committed } = fake({ locked: 'front' })
    const tool = drawTool()
    routePointer(tool, pointer('down', 0, 0), ctx)
    // A zigzag 4 mm high, a sample every 4 px.
    for (let i = 1; i < 3000; i++) routePointer(tool, pointer('move', i * 3, i % 2 === 0 ? 0 : 4), ctx)
    routePointer(tool, pointer('up', 9000, 0), ctx)
    await settled()
    const mark = committed[0]
    if (mark?.kind !== 'stroke') throw new Error('no stroke')
    expect(MAX_STROKE_POINTS).toBe(400)
    expect(mark.points2d!.length).toBeLessThanOrEqual(400)
    expect(mark.points2d!.length).toBeGreaterThan(300)
    expect(mark.points2d![0]).toEqual([0, -10])
    expect(mark.points2d!.at(-1)).toEqual([9000, -10])
  })

  it('drops the points that say nothing: a straight drag of many samples is two points', async () => {
    const { ctx, committed } = fake({ locked: 'front' })
    const tool = drawTool()
    routePointer(tool, pointer('down', 0, 0), ctx)
    for (let x = 3; x <= 60; x += 3) routePointer(tool, pointer('move', x, 0.1), ctx)
    routePointer(tool, pointer('up', 60, 0), ctx)
    await settled()
    expect(committed[0]).toMatchObject({ points2d: [[0, -10], [60, -10]] })
  })

  it('cancels a stroke of fewer than two points', async () => {
    const { ctx, committed, noted, navigation, drafts } = fake({ locked: 'front' })
    const tool = drawTool()
    routePointer(tool, pointer('down', 5, 5), ctx)
    routePointer(tool, pointer('move', 6, 5), ctx)
    routePointer(tool, pointer('up', 6, 6), ctx)
    routePointer(tool, pointer('click', 6, 6), ctx)
    await settled()
    expect(committed).toEqual([])
    expect(noted).toEqual([])
    expect(navigation.at(-1)).toEqual([true])
    expect(drafts.at(-1)).toBeNull()
  })

  it('Escape drops the stroke, and is not used otherwise', async () => {
    const { ctx, committed, navigation, drafts } = fake({ locked: 'front' })
    const tool = drawTool()
    const escape = { key: 'Escape' } as KeyboardEvent
    expect(tool.onKey!(escape, ctx)).toBe(false)
    routePointer(tool, pointer('down', 0, 0), ctx)
    routePointer(tool, pointer('move', 12, 5), ctx)
    expect(tool.onKey!(escape, ctx)).toBe(true)
    expect(navigation.at(-1)).toEqual([true])
    expect(drafts.at(-1)).toBeNull()
    routePointer(tool, pointer('up', 30, 40), ctx)
    await settled()
    expect(committed).toEqual([])
  })

  it('drops the stroke when the pointer is taken away, and when the tool is put down', async () => {
    for (const end of ['cancel', 'put down'] as const) {
      const { ctx, committed, navigation, drafts } = fake({ locked: 'front' })
      const tool = drawTool()
      routePointer(tool, pointer('down', 0, 0), ctx)
      routePointer(tool, pointer('move', 12, 5), ctx)
      if (end === 'cancel') routePointer(tool, pointer('cancel', 12, 5), ctx)
      else tool.cancel(ctx)
      expect(navigation.at(-1)).toEqual([true])
      expect(drafts.at(-1)).toBeNull()
      routePointer(tool, pointer('up', 30, 40), ctx)
      await settled()
      expect(committed).toEqual([])
    }
  })

  it('drops the stroke when a move comes with no button held: a release was missed', async () => {
    const { ctx, committed, navigation, drafts } = fake({ locked: 'front' })
    const tool = drawTool()
    routePointer(tool, pointer('down', 0, 0), ctx)
    routePointer(tool, pointer('move', 12, 5), ctx)
    routePointer(tool, { ...pointer('move', 20, 5), buttons: 0 }, ctx)
    expect(navigation.at(-1)).toEqual([true])
    expect(drafts.at(-1)).toBeNull()
    routePointer(tool, pointer('up', 30, 40), ctx)
    await settled()
    expect(committed).toEqual([])
  })

  it('draws nothing on a stale build', async () => {
    const { ctx, committed, navigation } = fake({ locked: 'front', stale: 'Rebuilding: picks wait for the new build' })
    const tool = drawTool()
    routePointer(tool, pointer('down', 0, 0), ctx)
    routePointer(tool, pointer('move', 12, 5), ctx)
    routePointer(tool, pointer('up', 30, 40), ctx)
    await settled()
    expect(committed).toEqual([])
    expect(navigation).toEqual([])
  })
})
