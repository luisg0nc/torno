import { describe, expect, it } from 'vitest'
import type { SketchSnap, Vec3 } from '../../../shared/marks'
import { nearestOnCircle, nearestOnSegment } from '../../../shared/snapdata'
import { mainPlane } from './planes'
import { SnapIndex, projectOnto, toSketchSnap, type Snap } from './snap'

// A plate seen from the front: its front face is 80 x 50 mm in the XZ plane at y = 0 (part-local), with a hole of radius 12 at
// (40, 25) and a bulging top edge. Every point of the part is moved by (100, 50, 0) into the object frame. One pixel is one
// millimetre; the view looks along +Y, x to the right and z up.
const AT: Vec3 = [100, 50, 0]
const toObject = (v: Vec3): Vec3 => [v[0] + AT[0], v[1] + AT[1], v[2] + AT[2]]
const V: Vec3[] = [[0, 0, 0], [80, 0, 0], [80, 0, 50], [0, 0, 50]]

function plate() {
  const edges: number[] = []
  const per: number[] = []
  const types: number[] = []
  const segment = (a: Vec3, b: Vec3): void => void edges.push(...a, ...b)
  // E0 to E3 go round the face: bottom, right (straight), the top (a B-spline through (40, 0, 58)) and left (straight).
  per.push(1, 1, 2, 1)
  types.push(0, 0, 6, 0)
  segment(V[0], V[1])
  segment(V[1], V[2])
  segment(V[2], [40, 0, 58])
  segment([40, 0, 58], V[3])
  segment(V[3], V[0])
  // E4 is the hole: a circle of 24 chords.
  const hole: Vec3[] = Array.from({ length: 25 }, (_, k): Vec3 => [40 + 12 * Math.cos((k / 24) * 2 * Math.PI), 0, 25 + 12 * Math.sin((k / 24) * 2 * Math.PI)])
  per.push(24)
  types.push(1)
  for (let k = 0; k < 24; k++) segment(hole[k], hole[k + 1])
  return {
    name: 'plate',
    toObject,
    data: { points: new Float32Array(V.flat()), circles: new Float32Array([4, 40, 0, 25, 0, 1, 0, 12]) },
    edges: new Float32Array(edges),
    segmentsPerEdge: new Uint32Array(per),
    edgeTypes: new Uint32Array(types)
  }
}

const screen = (p: Vec3): [number, number] => [p[0] - AT[0], -p[2]]
/** The ray through a pixel, from the front. */
const ray = (px: number, py: number) => ({ origin: [px + AT[0], -500, -py] as Vec3, dir: [0, 1, 0] as Vec3 })
const index = new SnapIndex([plate()])
const at = (px: number, py: number, radius?: number): Snap | null => index.nearest(ray(px, py), screen, [px, py], radius)

describe('the nearest snap', () => {
  it('is a vertex when one is within 10 px, though an edge is nearer', () => {
    // 6 px along the bottom edge from V1, and 1 px above it: the edge is 1 px away, the vertex 6.
    const snap = at(74, -1)!
    expect(snap.kind).toBe('vertex')
    expect(snap.ref).toBe('plate/V1')
    expect(snap.point).toEqual([180, 50, 0])
    expect(snap.approx).toBeUndefined()
  })

  it('is the nearer of two vertices', () => {
    expect(at(2, -48)!.ref).toBe('plate/V3')
    expect(at(78, -47)!.ref).toBe('plate/V2')
  })

  it('is the centre of a hole when the pointer is within 10 px of it, with the radius, found from the circles', () => {
    const snap = at(43, -27)!
    expect(snap.kind).toBe('centre')
    expect(snap.ref).toBe('plate/E4')
    expect(snap.radius).toBe(12)
    expect(snap.point).toEqual([140, 50, 25])
  })

  it('is the point of a straight edge nearest to the pointer, told exactly', () => {
    const snap = at(30, -3)!
    expect(snap).toMatchObject({ kind: 'edge', ref: 'plate/E0' })
    expect(snap.approx).toBeUndefined()
    // Exactly on the segment between the edge's two vertices, as main works it out.
    const expected = nearestOnSegment([100, 50, 0], [180, 50, 0], snap.point)
    expect(Math.hypot(...snap.point.map((c, i) => c - expected[i]))).toBeLessThan(0.01)
    expect(snap.point[0]).toBeCloseTo(130, 1)
  })

  it('is the nearest point on a circular edge, told exactly and on the circle', () => {
    // 3 px outside the hole at three o'clock, 12 px from its centre: only the edge is near.
    const snap = at(55, -25)!
    expect(snap).toMatchObject({ kind: 'edge', ref: 'plate/E4' })
    expect(snap.approx).toBeUndefined()
    const expected = nearestOnCircle([140, 50, 25], [0, 1, 0], 12, snap.point)
    expect(Math.hypot(...snap.point.map((c, i) => c - expected[i]))).toBeLessThan(1e-6)
    expect(snap.point[0]).toBeCloseTo(152, 1)
    expect(snap.point[2]).toBeCloseTo(25, 1)
  })

  it('is approximate on an edge that is a spline', () => {
    const snap = at(40, -57)!
    expect(snap).toMatchObject({ kind: 'edge', ref: 'plate/E2', approx: true })
    expect(snap.point[2]).toBeCloseTo(58, 1)
  })

  it('is nothing when nothing is within the radius', () => {
    expect(at(40, 40)).toBeNull()
    expect(at(14, -25)).toBeNull()
    // The edge is 5 px away: out of reach of a radius of 4 px, within the 10 px of the default.
    expect(at(30, -5, 4)).toBeNull()
    expect(at(30, -5)).not.toBeNull()
  })

  it('takes the one nearer along the ray of two that are the same place on the screen', () => {
    const behind = { ...plate(), name: 'behind', toObject: (v: Vec3): Vec3 => [v[0] + AT[0], v[1] + AT[1] + 30, v[2] + AT[2]] }
    const both = new SnapIndex([behind, plate()])
    expect(both.nearest(ray(80, 0), screen, [80, 0])!.ref).toBe('plate/V1')
  })

  it('works with a perspective view', () => {
    // The camera is at y = -300 looking along +Y, 500 px focal length: what is nearer is bigger.
    const flat = (p: Vec3): [number, number] => {
      const depth = p[1] + 300
      return [(500 * (p[0] - AT[0])) / depth, (-500 * p[2]) / depth]
    }
    const through = (px: number, py: number) => {
      const d: Vec3 = [px, 500, -py]
      const l = Math.hypot(...d)
      return { origin: [AT[0], -300, 0] as Vec3, dir: d.map((c) => c / l) as Vec3 }
    }
    // V1 is at depth 350: x = 80 is 80 * 500 / 350 px from the middle.
    const [px, py] = flat([180, 50, 0])
    const snap = index.nearest(through(px + 4, py - 3), flat, [px + 4, py - 3])!
    expect(snap.ref).toBe('plate/V1')
  })

  it('is found among thousands of segments', () => {
    const many = plate()
    const edges: number[] = []
    for (let k = 0; k < 20000; k++) edges.push(1000 + k * 0.01, 0, 1000, 1000 + k * 0.01 + 0.005, 0, 1000)
    const big = new SnapIndex([{ ...many, name: 'rail', edges: new Float32Array(edges), segmentsPerEdge: new Uint32Array([20000]), edgeTypes: new Uint32Array([0]), data: { points: new Float32Array(0), circles: new Float32Array(0) } }, plate()])
    const started = performance.now()
    for (let k = 0; k < 50; k++) big.nearest(ray(30, -3), screen, [30, -3])
    expect(performance.now() - started).toBeLessThan(500)
    expect(big.nearest(ray(30, -3), screen, [30, -3])!.ref).toBe('plate/E0')
  })
})

describe('projectOnto', () => {
  const plane = { ...mainPlane('XZ', 70, [0, 0, 0]), id: 1 }

  it('puts a snap on the plane along its normal, and says so when it was off it', () => {
    const centre: Snap = { kind: 'centre', ref: 'plate/E4', point: [140, 50, 25], radius: 12 }
    expect(projectOnto(plane, centre)).toEqual({ uv: [140, 25], projected: true })
  })

  it('does not say so of a snap that is on the plane', () => {
    const vertex: Snap = { kind: 'vertex', ref: 'plate/V1', point: [180, 70, 0] }
    expect(projectOnto(plane, vertex)).toEqual({ uv: [180, 0], projected: false })
  })

  it('is not moved by the noise of a float', () => {
    expect(projectOnto(plane, { kind: 'vertex', ref: 'plate/V1', point: [180, 70.00001, 0] }).projected).toBe(false)
  })
})

describe('toSketchSnap', () => {
  it('makes the snap a sketch keeps: one of the three, and whether it was projected', () => {
    const vertex: Snap = { kind: 'vertex', ref: 'plate/V1', point: [0, 0, 0] }
    const centre: Snap = { kind: 'centre', ref: 'plate/E4', point: [0, 0, 0], radius: 12 }
    const edge: Snap = { kind: 'edge', ref: 'plate/E0', point: [0, 0, 0] }
    const spline: Snap = { kind: 'edge', ref: 'plate/E2', point: [0, 0, 0], approx: true }
    const told: SketchSnap[] = [toSketchSnap(0, vertex, false), toSketchSnap(1, centre, true), toSketchSnap(2, edge, false), toSketchSnap(3, spline, true)]
    expect(told).toEqual([
      { i: 0, vertex: 'plate/V1' },
      { i: 1, centre: 'plate/E4', radius: 12, projected: true },
      { i: 2, edge: 'plate/E0' },
      { i: 3, edge: 'plate/E2', approx: true, projected: true }
    ])
  })
})
