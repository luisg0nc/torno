import * as THREE from 'three'
import type { Line2 } from 'three/addons/lines/Line2.js'
import type { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { describe, expect, it } from 'vitest'
import type { ArrowMark, Mark, PickMark, PinMark, ShapeMark, StrokeMark, Vec3 } from '../../../shared/marks'
import { labelText, mmPerPx, rowLabel, place, project, type Label } from './labels'
import { MarkLayer } from './MarkLayer'
import { BEHIND, DOT_PX, LEADER_PX, build, dispose, markPoints, rescale, setActive, strokePoints } from './markObjects'

const CAMERA = { position: [100, -100, 80] as Vec3, target: [0, 0, 10] as Vec3, up: [0, 0, 1] as Vec3, ortho: false, fov: 35, zoom: 1 }
const BASE = { author: 'user', note: '', status: 'draft', anchorState: 'ok', layout: 'assembly', revision: 1, camera: CAMERA, createdAt: '2026-10-09T10:00:00.000Z' } as const
const COLOURS = { user: '#cf3f2c', agent: '#288156', reference: '#686d74' }

const pin: PinMark = { ...BASE, id: 'M1', kind: 'pin', anchor: { point: [1, 2, 20], normal: [0, 0, 2], part: 'base', ref: 'base/F4' } }
const pick: PickMark = { ...BASE, id: 'M2', kind: 'pick', target: 'face', anchor: { point: [5, 0, 2.5], part: 'base', ref: 'base/F5' } }
const arrow: ArrowMark = { ...BASE, id: 'M3', author: 'agent', kind: 'arrow', from: { point: [1, 2, 20] }, to: [4, 6, 32] }
const surfaceStroke: StrokeMark = { ...BASE, id: 'M4', kind: 'stroke', space: 'surface', anchor: { point: [0, 0, 5] }, points: [[0, 0, 5], [2, 0, 5], [2, 3, 5]] }
const planeStroke: StrokeMark = {
  ...BASE,
  id: 'M5',
  kind: 'stroke',
  space: 'plane',
  anchor: { point: [0, 40, 0] },
  plane: { origin: [0, 40, 1], x: [1, 0, 0], y: [0, 0, 1], label: 'XZ at y = 40.0' },
  points2d: [[0, 0], [10, 0], [10, 5]]
}
const shape = (over: Partial<ShapeMark> = {}): ShapeMark => ({ ...BASE, id: 'M6', kind: 'shape', shape: 'box', intent: 'remove', position: [5, 5, 10], rotation: [0, 0, 0, 1], size: [6, 8, 20], ...over })

const names = (object: THREE.Object3D): string[] => object.children.flatMap((c) => (c.name ? [c.name] : names(c)))
const child = (object: THREE.Object3D, name: string): THREE.Object3D => object.getObjectByName(name)!
/** The two drawings of one thing: behind a part, and in the open. */
const twins = (object: THREE.Object3D): Array<THREE.Mesh<THREE.BufferGeometry, THREE.Material>> => {
  const found: Array<THREE.Mesh<THREE.BufferGeometry, THREE.Material>> = []
  object.traverse((c) => {
    if ((c as THREE.Mesh).geometry) found.push(c as THREE.Mesh<THREE.BufferGeometry, THREE.Material>)
  })
  return found
}
/** The ends of the segments of a fat line. */
function ends(line: THREE.Object3D): Array<[THREE.Vector3, THREE.Vector3]> {
  const geometry = (twins(line)[0] as unknown as Line2).geometry
  const start = geometry.getAttribute('instanceStart')
  const end = geometry.getAttribute('instanceEnd')
  return Array.from({ length: start.count }, (_, i) => [new THREE.Vector3().fromBufferAttribute(start, i), new THREE.Vector3().fromBufferAttribute(end, i)])
}

describe('build', () => {
  it('makes each kind of mark without a graphics context, of the parts that kind has', () => {
    expect(names(build(pin, COLOURS, 1))).toEqual(['dot', 'leader'])
    expect(names(build(pick, COLOURS, 1))).toEqual(['dot'])
    expect(names(build(arrow, COLOURS, 1))).toEqual(['tail', 'shaft', 'head'])
    expect(names(build(surfaceStroke, COLOURS, 1))).toEqual(['line'])
    expect(names(build(planeStroke, COLOURS, 1))).toEqual(['line', 'plane'])
    for (const kind of ['box', 'cylinder', 'sphere', 'plane'] as const) expect(names(build(shape({ shape: kind }), COLOURS, 1))).toEqual(['fill', 'outline'])
    expect(build(pin, COLOURS, 1).name).toBe('M1')
  })

  it('draws everything twice: in the open as it is, and at 35 % where a part is in front', () => {
    for (const mark of [pin, pick, arrow, surfaceStroke, planeStroke, shape()] as Mark[]) {
      const drawn = twins(build(mark, COLOURS, 1))
      expect(drawn.length % 2).toBe(0)
      for (let i = 0; i < drawn.length; i += 2) {
        const [behind, open] = [drawn[i].material, drawn[i + 1].material]
        expect(drawn[i].geometry).toBe(drawn[i + 1].geometry)
        expect(behind.depthFunc).toBe(THREE.GreaterDepth)
        expect(open.depthFunc).toBe(THREE.LessEqualDepth)
        expect(behind.opacity).toBeCloseTo(open.opacity * BEHIND)
        expect(behind.depthWrite || open.depthWrite).toBe(false)
        expect(drawn[i].renderOrder).toBeLessThan(drawn[i + 1].renderOrder)
      }
    }
  })

  it('colours a mark by its author, and a reference shape grey whoever made it', () => {
    const colour = (mark: Mark): string => `#${(twins(build(mark, COLOURS, 1))[0].material as THREE.MeshBasicMaterial).color.getHexString()}`
    expect(colour(pin)).toBe(COLOURS.user)
    expect(colour(arrow)).toBe(COLOURS.agent)
    expect(colour(shape({ author: 'agent' }))).toBe(COLOURS.agent)
    expect(colour(shape({ intent: 'reference' }))).toBe(COLOURS.reference)
  })

  it('an arrow runs from its anchor to its tip: its length is |to − from|', () => {
    const [[from, to]] = ends(child(build(arrow, COLOURS, 1), 'shaft'))
    expect(from.toArray()).toEqual([1, 2, 20])
    expect(to.toArray()).toEqual([4, 6, 32])
    expect(from.distanceTo(to)).toBeCloseTo(13)
    // The head is at the tip and points along the arrow.
    const head = child(build(arrow, COLOURS, 1), 'head')
    expect(head.position.toArray()).toEqual([4, 6, 32])
    const along = new THREE.Vector3(0, 0, 1).applyQuaternion(head.quaternion)
    expect(along.distanceTo(new THREE.Vector3(3, 4, 12).normalize())).toBeLessThan(1e-6)
  })

  it('a stroke on a plane goes through origin + x·u + y·v', () => {
    expect(strokePoints(planeStroke)).toEqual([[0, 40, 1], [10, 40, 1], [10, 40, 6]])
    expect(strokePoints(surfaceStroke)).toEqual(surfaceStroke.points)
    const segments = ends(child(build(planeStroke, COLOURS, 1), 'line'))
    expect(segments.map(([a]) => a.toArray())).toEqual([[0, 40, 1], [10, 40, 1]])
    expect(segments[1][1].toArray()).toEqual([10, 40, 6])
  })

  it('a stroke of one point is a dot, and one of none is a dot at its anchor', () => {
    const one = build({ ...surfaceStroke, points: [[7, 8, 9]] }, COLOURS, 1)
    expect(names(one)).toEqual(['dot'])
    expect(child(one, 'dot').position.toArray()).toEqual([7, 8, 9])
    expect(child(build({ ...surfaceStroke, points: [] }, COLOURS, 1), 'dot').position.toArray()).toEqual([0, 0, 5])
  })

  it("shows a stroke's plane only while the mark is the active one, around the stroke", () => {
    const object = build(planeStroke, COLOURS, 1)
    const plane = child(object, 'plane')
    expect(plane.visible).toBe(false)
    setActive(object, true)
    expect(plane.visible).toBe(true)
    const box = new THREE.Box3().setFromBufferAttribute(twins(plane)[0].geometry.getAttribute('position') as THREE.BufferAttribute)
    // In the plane y = 40, past the stroke (x 0 to 10, z 1 to 6) on every side.
    expect([box.min.y, box.max.y]).toEqual([40, 40])
    expect(box.min.x).toBeLessThan(0)
    expect(box.max.x).toBeGreaterThan(10)
    expect(box.min.z).toBeLessThan(1)
    expect(box.max.z).toBeGreaterThan(6)
    setActive(object, false)
    expect(plane.visible).toBe(false)
  })

  it('places a shape by its position and rotation, a quarter see-through, and dashes the outline of what is to go or to be kept clear', () => {
    const turned = build(shape({ rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2] }), COLOURS, 1)
    const body = child(turned, 'fill').parent!
    expect(body.position.toArray()).toEqual([5, 5, 10])
    expect(new THREE.Vector3(1, 0, 0).applyQuaternion(body.quaternion).distanceTo(new THREE.Vector3(0, 1, 0))).toBeLessThan(1e-6)
    expect(twins(child(turned, 'fill'))[1].material.opacity).toBe(0.25)
    // A rotation of all zeros is no rotation, not a collapse.
    expect(child(build(shape({ rotation: [0, 0, 0, 0] }), COLOURS, 1), 'fill').parent!.quaternion.toArray()).toEqual([0, 0, 0, 1])

    const dashed = (intent: ShapeMark['intent']): boolean => (twins(child(build(shape({ intent }), COLOURS, 1), 'outline'))[1].material as LineMaterial).dashed
    expect([dashed('add'), dashed('remove'), dashed('keep-out'), dashed('reference')]).toEqual([false, true, true, false])
  })

  it('a cylinder stands along its own Z, as wide as its diameter and as tall as its height', () => {
    const fill = twins(child(build(shape({ shape: 'cylinder', size: [6, 6, 20] }), COLOURS, 1), 'fill'))[0].geometry
    fill.computeBoundingBox()
    expect(fill.boundingBox!.max.toArray().map((v) => Math.round(v * 100) / 100)).toEqual([3, 3, 10])
  })
})

describe('rescale', () => {
  it('keeps dots, leaders and arrow heads the same size on screen, and line widths in pixels', () => {
    const object = build(pin, COLOURS, 0.5)
    expect(child(object, 'dot').scale.x).toBe(0.5)
    rescale(object, (at) => at.z / 10, 2)
    // 2 mm to the pixel at z = 20, and two pixels to the nominal one.
    expect(child(object, 'dot').scale.toArray()).toEqual([4, 4, 4])
    expect(child(object, 'dot').children[0].scale.x).toBe(DOT_PX)
    expect(child(object, 'leader').scale.x).toBe(4)
    const [[, tip]] = ends(child(object, 'leader'))
    expect(tip.toArray()).toEqual([0, 0, LEADER_PX])

    const line = twins(child(build(surfaceStroke, COLOURS, 1), 'line'))[1].material as LineMaterial
    expect(line.linewidth).toBe(2.5)
    const stroke = build(surfaceStroke, COLOURS, 1)
    setActive(stroke, true)
    rescale(stroke, () => 1, 2)
    expect((twins(child(stroke, 'line'))[1].material as LineMaterial).linewidth).toBe(7.5)
  })

  it('keeps dashes the same length on screen', () => {
    const object = build(shape(), COLOURS, 1)
    rescale(object, () => 0.25, 2)
    const outline = twins(child(object, 'outline'))[1].material as LineMaterial
    // Half a millimetre to the nominal pixel: a 7 px dash is 3.5 mm of line.
    expect(outline.dashSize / outline.dashScale).toBeCloseTo(3.5)
  })

  it('is freed without complaint', () => {
    for (const mark of [pin, pick, arrow, planeStroke, shape({ shape: 'sphere' })] as Mark[]) expect(() => dispose(build(mark, COLOURS, 1))).not.toThrow()
  })
})

describe('markPoints', () => {
  it('bounds a mark: its anchor, both ends of an arrow, a stroke, the corners of a shape', () => {
    expect(markPoints(arrow)).toEqual([[1, 2, 20], [4, 6, 32]])
    expect(markPoints(planeStroke)).toContainEqual([10, 40, 6])
    const corners = markPoints(shape())
    expect(corners).toHaveLength(8)
    expect(corners).toContainEqual([2, 1, 0])
    expect(corners).toContainEqual([8, 9, 20])
  })
})

function cameraAt(position: Vec3, target: Vec3, ortho = false): THREE.Camera {
  const camera = ortho ? new THREE.OrthographicCamera(-40, 40, 30, -30, 0.1, 1000) : new THREE.PerspectiveCamera(35, 4 / 3, 0.1, 1000)
  camera.up.set(0, 0, 1)
  camera.position.fromArray(position)
  camera.lookAt(new THREE.Vector3().fromArray(target))
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld()
  return camera
}

const SIZE = { width: 800, height: 600 }

describe('labels.project', () => {
  it('names a mark by its id, and says when its anchor drifted or was lost', () => {
    expect(labelText({ id: 'M3', anchorState: 'ok' })).toBe('M3')
    expect(labelText({ id: 'M3', anchorState: 'drifted' })).toBe('M3~')
    expect(labelText({ id: 'M3', anchorState: 'orphaned' })).toBe('M3?')
  })

  it('names a mark in its row by its id alone', () => {
    expect(rowLabel({ id: 'M3', anchorState: 'drifted' })).toBe('M3')
    expect(rowLabel({ id: 'M3', anchorState: 'orphaned' })).toBe('M3')
    expect(labelText({ id: 'M3', anchorState: 'drifted' })).toBe('M3~') // the view's chip keeps it
  })

  it('puts a label where its mark is drawn', () => {
    const camera = cameraAt([0, -200, 0], [0, 0, 0])
    const [centre, right] = project([{ ...pick, anchor: { point: [0, 0, 0] } }, { ...pick, id: 'M9', author: 'agent', anchorState: 'drifted', anchor: { point: [10, 0, 5] } }], camera, SIZE)
    expect(centre).toMatchObject({ id: 'M2', text: 'M2', author: 'user', visible: true })
    expect(centre.x).toBeCloseTo(400)
    expect(centre.y).toBeCloseTo(300)
    expect(right).toMatchObject({ id: 'M9', text: 'M9~', author: 'agent', visible: true })
    expect(right.x).toBeGreaterThan(400)
    expect(right.y).toBeLessThan(300)
    // 10 mm to the right is as many pixels as the scale there says.
    expect(right.x - 400).toBeCloseTo(10 / mmPerPx(camera, new THREE.Vector3(10, 0, 5), SIZE.height), 3)
  })

  it('hides labels behind the camera and outside the frame', () => {
    const camera = cameraAt([0, -200, 0], [0, 0, 0])
    const at = (point: Vec3): Label => project([{ ...pick, anchor: { point } }], camera, SIZE)[0]
    expect(at([0, 0, 0]).visible).toBe(true)
    expect(at([0, -400, 0]).visible).toBe(false) // behind the camera, though it projects to the middle
    expect(at([500, 0, 0]).visible).toBe(false) // off to the right
    expect(at([0, 0, -500]).visible).toBe(false) // below the frame
    expect(at([0, 5000, 0]).visible).toBe(false) // past the far plane, where nothing is drawn
  })

  it('works the same for an orthographic camera', () => {
    const camera = cameraAt([0, -200, 0], [0, 0, 0], true)
    const [inside, outside] = project([{ ...pick, anchor: { point: [20, 0, 15] } }, { ...pick, anchor: { point: [41, 0, 0] } }], camera, SIZE)
    expect(inside).toMatchObject({ visible: true })
    expect(inside.x).toBeCloseTo(600)
    expect(inside.y).toBeCloseTo(150)
    expect(outside.visible).toBe(false)
    expect(mmPerPx(camera, new THREE.Vector3(), SIZE.height)).toBeCloseTo(0.1)
  })

  it("hangs a pin's label at the end of its leader, leaning the way the leader runs", () => {
    const camera = cameraAt([0, -200, 0], [0, 0, 0], true)
    const [up] = project([{ ...pin, anchor: { point: [0, 0, 0], normal: [0, 0, 1] } }], camera, SIZE)
    expect(up.x).toBeCloseTo(400)
    expect(up.y).toBeCloseTo(300 - LEADER_PX)
    expect(up.lean[0]).toBeCloseTo(0)
    expect(up.lean[1]).toBeCloseTo(-1)
    // In a picture twice the nominal size the leader is twice as long in its pixels.
    expect(project([{ ...pin, anchor: { point: [0, 0, 0], normal: [0, 0, 1] } }], camera, SIZE, 2)[0].y).toBeCloseTo(300 - 2 * LEADER_PX)
    // Seen end on, the label goes above the pin and stands clear of its dot.
    const [endOn] = project([{ ...pin, anchor: { point: [0, 0, 0], normal: [0, -1, 0] } }], camera, SIZE)
    expect(endOn.lean).toEqual([0, -1])
    expect(endOn.gap).toBeGreaterThan(DOT_PX)
  })
})

describe('labels.place', () => {
  const chip = (text: string) => ({ w: 8 + text.length * 7, h: 18 })
  const label = (id: string, x: number, y: number, over: Partial<Label> = {}): Label => ({ id, text: id, author: 'user', x, y, visible: true, lean: [Math.SQRT1_2, -Math.SQRT1_2], gap: 9, ...over })
  const apart = (a: { box: { x: number; y: number; w: number; h: number } }, b: typeof a): boolean =>
    a.box.x + a.box.w <= b.box.x || b.box.x + b.box.w <= a.box.x || a.box.y + a.box.h <= b.box.y || b.box.y + b.box.h <= a.box.y

  it('sets a chip off its point, the way it leans', () => {
    const [only] = place([label('M1', 100, 100)], chip, SIZE)
    expect(only.box.x).toBeGreaterThan(100)
    expect(only.box.y + only.box.h).toBeLessThan(100)
  })

  it('keeps the chips of marks that are close together apart, and off each other\'s points', () => {
    const crowd = [label('M1', 300, 300), label('M2', 300, 300), label('M3', 304, 298), label('M4', 310, 302), label('M5', 296, 305), label('M6', 300, 296)]
    const placed = place(crowd, chip, SIZE)
    for (const a of placed) {
      for (const b of placed) {
        if (a === b) continue
        expect(apart(a, b), `${a.id} over ${b.id}`).toBe(true)
        const onPoint = b.x > a.box.x && b.x < a.box.x + a.box.w && b.y > a.box.y && b.y < a.box.y + a.box.h
        expect(onPoint, `${a.id} on the point of ${b.id}`).toBe(false)
      }
    }
    // The first asked keeps the place it wanted.
    expect(placed[0].box).toEqual(place([crowd[0]], chip, SIZE)[0].box)
  })

  it('keeps a chip inside the picture when its point is in a corner', () => {
    const [corner] = place([label('M1', 795, 4)], chip, SIZE)
    expect(corner.box.x + corner.box.w).toBeLessThanOrEqual(800)
    expect(corner.box.y).toBeGreaterThanOrEqual(0)
  })

  it('leaves a label that is not visible out of the way of the others', () => {
    const [hidden, shown] = place([label('M1', 300, 300, { visible: false }), label('M2', 300, 300)], chip, SIZE)
    expect(hidden.visible).toBe(false)
    expect(shown.box).toEqual(place([label('M2', 300, 300)], chip, SIZE)[0].box)
  })
})

describe('what a layout’s picks tint', () => {
  const edge = (id: string, ref: string, over: Partial<PickMark> = {}): PickMark => ({ ...BASE, id, kind: 'pick', target: 'edge', anchor: { point: [5, 0, 2.5], part: 'plate', ref }, ...over })

  it('is the face, edge or part each pick is on, by who made the mark', () => {
    const layer = new MarkLayer(COLOURS)
    layer.setMarks([pick, edge('M7', 'plate/E1'), edge('M8', 'plate', { author: 'agent', target: 'part' }), pin])
    expect(layer.pickRefs('assembly')).toEqual({ user: ['base/F5', 'plate/E1'], agent: ['plate'] })
    layer.dispose()
  })

  it('is nothing for a pick that drifted or lost its part: its ref is the one it was placed on, which may name other geometry now', () => {
    const layer = new MarkLayer(COLOURS)
    layer.setMarks([edge('M7', 'plate/E1', { anchorState: 'drifted' }), edge('M8', 'post/E2', { anchorState: 'orphaned', author: 'agent' }), edge('M9', 'plate/E4')])
    expect(layer.pickRefs('assembly')).toEqual({ user: ['plate/E4'], agent: [] })
    // They are still drawn, at their points, with their labels.
    layer.show('assembly')
    expect(layer.markOf('assembly', 'M7')).toBeDefined()
    expect(layer.markOf('assembly', 'M8')).toBeDefined()
    layer.dispose()
  })
})

// The polish review's I3 (ruled): a mark's lines are held to 3:1 against the ground and are drawn on the parts,
// where they are between 1.0 and 2.1. Every line has a casing under it in the colour of the panel, 2 px wider.
describe('the casing of a mark\'s lines', () => {
  const CASED = { ...COLOURS, casing: '#faf9f6' }
  const lines = (object: THREE.Object3D): Array<{ casing: boolean; material: LineMaterial; order: number; geometry: THREE.BufferGeometry; parent: THREE.Object3D }> => {
    const found: ReturnType<typeof lines> = []
    object.traverse((c) => {
      const line = c as Line2
      if (line.isLine2 || (line as unknown as { isLineSegments2?: boolean }).isLineSegments2) found.push({ casing: line.userData.casing === true, material: line.material, order: line.renderOrder, geometry: line.geometry, parent: line.parent! })
    })
    return found
  }
  const dimension = { ...BASE, id: 'M7', kind: 'dimension', measure: 'distance', a: { point: [0, 0, 0] }, b: { point: [10, 0, 0] }, points: [[0, 0, 0], [10, 0, 0]], value: 10, measuredRevision: 1 } as unknown as Mark

  it.each([['a pin\'s leader', pin], ['an arrow\'s shaft', arrow], ['a stroke', surfaceStroke], ['a shape\'s outline', shape()], ['a dashed outline', shape({ intent: 'keep-out' })], ['a dimension\'s lines', dimension]] as Array<[string, Mark]>)('is under %s: the same line in the panel\'s colour, 2 px wider, drawn before it', (_what, mark) => {
    const object = build(mark, CASED, 1)
    rescale(object, () => 0.5, 1)
    const all = lines(object)
    const own = all.filter((line) => !line.casing)
    const casings = all.filter((line) => line.casing)
    expect(own.length).toBeGreaterThan(0)
    expect(casings).toHaveLength(own.length)
    for (const line of own) {
      // Its casing: of the same geometry, in the same group (so that whatever turns or places the line takes the casing along).
      const under = casings.find((casing) => casing.geometry === line.geometry && casing.parent === line.parent && casing.material.depthFunc === line.material.depthFunc)!
      expect(under).toBeDefined()
      expect(`#${under.material.color.getHexString()}`).toBe('#faf9f6')
      expect(`#${line.material.color.getHexString()}`).not.toBe('#faf9f6')
      expect(under.material.linewidth).toBeCloseTo(line.material.linewidth + 2, 9)
      expect(under.order).toBeLessThan(line.order)
      expect(under.material.dashed).toBe(line.material.dashed)
      // As faint behind a part as the line is there, and never written to the depth.
      expect(under.material.opacity).toBeCloseTo(line.material.opacity, 9)
      expect(under.material.depthWrite).toBe(false)
    }
    // In a large picture a mark keeps its share of it, casing and all.
    rescale(object, () => 0.5, 2)
    for (const line of lines(object).filter((one) => !one.casing)) {
      const under = lines(object).find((casing) => casing.casing && casing.geometry === line.geometry && casing.material.depthFunc === line.material.depthFunc)!
      expect(under.material.linewidth).toBeCloseTo(line.material.linewidth + 4, 9)
    }
    dispose(object)
  })

  it('is wider with the line of the mark that is worked on, and goes with it when the mark is drawn dimmed or dashed', () => {
    const object = build(arrow, CASED, 1)
    setActive(object, true)
    rescale(object, () => 0.5, 1)
    const [shaft] = lines(object).filter((line) => !line.casing)
    const under = lines(object).find((line) => line.casing && line.material.depthFunc === shaft.material.depthFunc)!
    expect(under.material.linewidth).toBeCloseTo(shaft.material.linewidth + 2, 9)
    dispose(object)
  })

  it('is not drawn without a colour for it: a mark built with none is as it was', () => {
    const object = build(arrow, COLOURS, 1)
    expect(lines(object).filter((line) => line.casing)).toEqual([])
    dispose(object)
  })
})
