import { describe, expect, it } from 'vitest'
import type { SketchSnap, NewStroke, Vec3 } from '../../../shared/marks'
import { bufView } from '../../../shared/scene'
import { Refusal } from '../../../main/refusal'
import { checkSketch } from '../../../main/sketches/check'
import { fixture, world } from '../../../main/sketches/testing'
import { mainPlane, toPlane } from './planes'
import { SnapIndex, projectOnto, toSketchSnap, type Snap } from './snap'

// The window's snaps against main's checks: what the index tells, put in a sketch as the window would, is a sketch main
// accepts and keeps as it is. The part stands in the object frame turned and moved (`testing.ts`), seen from below at two
// pixels to the millimetre.

const { scene, blob, build } = fixture(7)
const block = scene.parts.find((p) => p.name === 'block')!
const index = new SnapIndex([
  {
    name: 'block',
    toObject: world,
    data: build.snap('block')!,
    edges: bufView(blob, block.mesh.edges, Float32Array),
    segmentsPerEdge: bufView(blob, block.mesh.segmentsPerEdge, Uint32Array),
    edgeTypes: bufView(blob, block.mesh.edgeTypes, Uint32Array)
  }
])
const project = (p: Vec3): [number, number] => [2 * p[0], 2 * p[1]]
const snapAt = (x: number, y: number): Snap => index.nearest({ origin: [x, y, -500], dir: [0, 0, 1] }, project, project([x, y, 0]))!

const CAMERA = { position: [100, -100, 80], target: [0, 0, 10], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 }
const draft = (planes: unknown[], strokes: unknown[]) => ({ objectId: 'bracket', layout: 'assembly', revision: 7, camera: CAMERA, name: 'Hose', note: '', take: 'rough', planes, strokes })
function kept(raw: unknown): NewStroke[] {
  const result = checkSketch(raw, undefined, build)
  if (result instanceof Refusal) throw new Error(result.message)
  return result.strokes
}

// Seen from below: E0 runs along x = 100 from y = 50 to y = 90; the hole's centre is at (80, 60) and its radius 8.
const along = snapAt(100.3, 70)
const hole = snapAt(80 + 8.4, 60)
const centre = snapAt(80.2, 60.2)
const corner = snapAt(100.2, 90.3)

describe('what the window snaps to, as main checks it', () => {
  it('is what the pointer is nearest', () => {
    expect(along).toMatchObject({ kind: 'edge', ref: 'block/E0' })
    expect(hole).toMatchObject({ kind: 'edge', ref: 'block/E14' })
    expect(centre).toMatchObject({ kind: 'centre', ref: 'block/E14', radius: 8 })
    expect(corner).toMatchObject({ kind: 'vertex', ref: 'block/V1' })
  })

  it('is kept as it is on the surface, vertices, centres and the exact points of straight and circular edges', () => {
    const snaps = [along, hole, centre, corner]
    const stroke = { pen: 'points', revision: 7, points: snaps.map((s) => s.point), snaps: snaps.map((s, i): SketchSnap => toSketchSnap(i, s, false)) }
    const [result] = kept(draft([], [stroke]))
    expect(result.snaps).toEqual(stroke.snaps)
    result.points!.forEach((p, i) => p.forEach((c, k) => expect(c).toBeCloseTo(snaps[i].point[k], 4)))
  })

  it('is kept on a plane, projected onto it along its normal', () => {
    const plane = { ...mainPlane('XY', 12, [0, 0, 0]), id: 1 }
    const snaps = [along, hole, centre, corner]
    const told = snaps.map((s) => projectOnto(plane, s))
    expect(told.every((t) => t.projected)).toBe(true)
    const stroke = { pen: 'points', revision: 7, plane: 1, points2d: told.map((t) => t.uv), snaps: snaps.map((s, i) => toSketchSnap(i, s, told[i].projected)) }
    const [result] = kept(draft([plane], [stroke]))
    expect(result.snaps).toEqual(stroke.snaps)
    result.points2d!.forEach((uv, i) => expect(Math.hypot(uv[0] - told[i].uv[0], uv[1] - told[i].uv[1])).toBeLessThan(0.01))
    expect(toPlane(plane, centre.point)[0]).toBeCloseTo(80, 1)
  })
})
