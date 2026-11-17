import { describe, expect, it } from 'vitest'
import type { SketchMark, Vec3 } from '../../shared/marks'
import { Refusal } from '../refusal'
import { checkSketch } from './check'
import { CIRCLE, VERTICES, fixture, world } from './testing'

const CAMERA = { position: [100, -100, 80], target: [0, 0, 10], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 }
const XY = { id: 1, origin: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], label: 'XY at z = 0.0 (u = +X, v = +Y)', from: { kind: 'main', axis: 'XY', offset: 0 } }
const { build } = fixture(7)

const raw = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  objectId: 'bracket',
  layout: 'assembly',
  revision: 7,
  camera: CAMERA,
  name: 'Hose',
  note: 'route it here',
  take: 'flow',
  diameter: 19,
  planes: [XY],
  strokes: [],
  ...over
})
const surface = (points: Vec3[], more: Record<string, unknown> = {}): Record<string, unknown> => ({ pen: 'points', points, revision: 7, ...more })
const stored = (strokes: object[], over: object = {}): SketchMark =>
  ({
    id: 'M7',
    kind: 'sketch',
    author: 'user',
    note: '',
    status: 'sent',
    anchorState: 'ok',
    layout: 'assembly',
    revision: 3,
    camera: CAMERA,
    createdAt: '2026-11-17T10:00:00.000Z',
    name: 'Hose',
    take: 'flow',
    diameter: 19,
    planes: [XY],
    strokes,
    picture: 'k-0123456789ab.png',
    sentBefore: true,
    ...over
  }) as unknown as SketchMark

const refused = (value: unknown, stored?: SketchMark, b = build): string => {
  const result = checkSketch(value, stored, b)
  expect(result).toBeInstanceOf(Refusal)
  return (result as Refusal).message
}
const kept = (value: unknown, was?: SketchMark, b = build) => {
  const result = checkSketch(value, was, b)
  if (result instanceof Refusal) throw result
  return result
}

describe('the snaps of a stroke', () => {
  it('keeps a snap to a vertex, and sets the point where the kernel has the vertex, in the object frame of the part\'s place', () => {
    const v3 = world(VERTICES[3])
    const draft = kept(raw({ strokes: [surface([[v3[0] + 0.004, v3[1], v3[2]], [0, 0, 0]], { snaps: [{ i: 0, vertex: 'block/V3' }] })] }))
    expect(draft.strokes[0].snaps).toEqual([{ i: 0, vertex: 'block/V3' }])
    expect(draft.strokes[0].points?.[0]).toEqual(v3.map((c) => expect.closeTo(c, 4)))
    expect(draft.strokes[0].points?.[1]).toEqual([0, 0, 0])
  })

  it('refuses a vertex the part does not have: V99 on a part of ten', () => {
    expect(refused(raw({ strokes: [surface([[0, 0, 0]], { snaps: [{ i: 0, vertex: 'block/V99' }] })] }))).toMatch(/V99.*10 vertices|no vertex V99/)
  })

  it('refuses a snap to a part the layout has not, or one with no snap data', () => {
    expect(refused(raw({ strokes: [surface([[0, 0, 0]], { snaps: [{ i: 0, vertex: 'gone/V1' }] })] }))).toMatch(/gone/)
    expect(refused(raw({ strokes: [surface([[0, 0, 0]], { snaps: [{ i: 0, vertex: 'old/V0' }] })] }))).toMatch(/old.*snap/)
  })

  it('refuses a point further from its vertex than 0.01 mm, and says how far', () => {
    const v1 = world(VERTICES[1])
    expect(refused(raw({ strokes: [surface([[v1[0] + 0.02, v1[1], v1[2]]], { snaps: [{ i: 0, vertex: 'block/V1' }] })] }))).toMatch(/0\.02/)
    expect(kept(raw({ strokes: [surface([[v1[0] + 0.009, v1[1], v1[2]]], { snaps: [{ i: 0, vertex: 'block/V1' }] })] })).strokes).toHaveLength(1)
  })

  it('refuses a centre snap that is 0.5 mm off', () => {
    const c = world(CIRCLE.centre)
    const message = refused(raw({ strokes: [surface([[c[0] + 0.5, c[1], c[2]]], { snaps: [{ i: 0, centre: 'block/E14', radius: CIRCLE.radius }] })] }))
    expect(message).toMatch(/0\.5/)
  })

  it('keeps a centre snap, and refuses one with another radius or an edge that is no circle', () => {
    const c = world(CIRCLE.centre)
    const ok = kept(raw({ strokes: [surface([c], { snaps: [{ i: 0, centre: 'block/E14', radius: 8 }] })] }))
    expect(ok.strokes[0].snaps).toEqual([{ i: 0, centre: 'block/E14', radius: 8 }])
    expect(refused(raw({ strokes: [surface([c], { snaps: [{ i: 0, centre: 'block/E14', radius: 9 }] })] }))).toMatch(/radius/)
    expect(refused(raw({ strokes: [surface([c], { snaps: [{ i: 0, centre: 'block/E0', radius: 8 }] })] }))).toMatch(/E0.*circle/)
  })

  it('accepts a projected centre on a plane: the point is the centre, put on the plane', () => {
    const c = world(CIRCLE.centre)
    const draft = kept(raw({ strokes: [{ plane: 1, pen: 'points', points2d: [[c[0], c[1]]], snaps: [{ i: 0, centre: 'block/E14', radius: 8, projected: true }], revision: 7 }] }))
    expect(draft.strokes[0].snaps).toEqual([{ i: 0, centre: 'block/E14', radius: 8, projected: true }])
    expect(draft.strokes[0].points2d?.[0][0]).toBeCloseTo(c[0], 4)
    expect(draft.strokes[0].points2d?.[0][1]).toBeCloseTo(c[1], 4)
  })

  it('refuses the centre on a plane when it was not said to be projected and it is not on it, and a projection on a surface', () => {
    const c = world(CIRCLE.centre)
    expect(refused(raw({ strokes: [{ plane: 1, pen: 'points', points2d: [[c[0], c[1]]], snaps: [{ i: 0, centre: 'block/E14', radius: 8 }], revision: 7 }] }))).toMatch(/5/)
    expect(refused(raw({ strokes: [surface([c], { snaps: [{ i: 0, centre: 'block/E14', radius: 8, projected: true }] })] }))).toMatch(/projected/)
  })

  it('sets a point on a straight edge at the nearest point of it, and keeps it exact', () => {
    const near = world([12, 0.004, 0])
    const draft = kept(raw({ strokes: [surface([near], { snaps: [{ i: 0, edge: 'block/E0' }] })] }))
    expect(draft.strokes[0].snaps).toEqual([{ i: 0, edge: 'block/E0' }])
    const at = world([12, 0, 0])
    draft.strokes[0].points?.[0].forEach((c, k) => expect(c).toBeCloseTo(at[k], 4))
  })

  it('refuses a point 0.02 mm off a straight edge, or past its end', () => {
    expect(refused(raw({ strokes: [surface([world([12, 0.02, 0])], { snaps: [{ i: 0, edge: 'block/E0' }] })] }))).toMatch(/0\.02/)
    expect(refused(raw({ strokes: [surface([world([45, 0, 0])], { snaps: [{ i: 0, edge: 'block/E0' }] })] }))).toMatch(/E0/)
  })

  it('keeps a point on a circular edge, and refuses one off the circle', () => {
    const on = world([CIRCLE.centre[0] + 8, CIRCLE.centre[1], CIRCLE.centre[2]])
    expect(kept(raw({ strokes: [surface([on], { snaps: [{ i: 0, edge: 'block/E14' }] })] })).strokes[0].snaps).toEqual([{ i: 0, edge: 'block/E14' }])
    const inside = world([CIRCLE.centre[0] + 7, CIRCLE.centre[1], CIRCLE.centre[2]])
    expect(refused(raw({ strokes: [surface([inside], { snaps: [{ i: 0, edge: 'block/E14' }] })] }))).toMatch(/1/)
  })

  it('records a snap to a B-spline edge as approximate, checked only for its ref', () => {
    const anywhere = world([20, 0.3, 25])
    const draft = kept(raw({ strokes: [surface([anywhere], { snaps: [{ i: 0, edge: 'block/E4' }] })] }))
    expect(draft.strokes[0].snaps).toEqual([{ i: 0, edge: 'block/E4', approx: true }])
    expect(draft.strokes[0].points).toEqual([anywhere])
    expect(refused(raw({ strokes: [surface([anywhere], { snaps: [{ i: 0, edge: 'block/E40', approx: true }] })] }))).toMatch(/E40/)
  })

  it('takes an approximate snap on a straight edge as it says: checked for its ref only', () => {
    const anywhere = world([12, 0.4, 0])
    expect(kept(raw({ strokes: [surface([anywhere], { snaps: [{ i: 0, edge: 'block/E0', approx: true }] })] })).strokes[0].snaps).toEqual([{ i: 0, edge: 'block/E0', approx: true }])
  })

  it('refuses a snap to a point the stroke does not have', () => {
    expect(refused(raw({ strokes: [surface([[0, 0, 0]], { snaps: [{ i: 3, vertex: 'block/V0' }] })] }))).toMatch(/point/)
  })
})

describe('what is kept of the strokes the sketch had', () => {
  const v1 = world(VERTICES[1])
  const old = surface([[v1[0], v1[1], v1[2]], [5, 5, 5]], { snaps: [{ i: 0, vertex: 'block/V1' }], revision: 3, touches: ['block/F2', 'block/F3'] })

  it('takes an unchanged stroke of revision 3 from what main stored when the build is 7, touches and all, whatever the window sent', () => {
    const sent = { ...old, touches: ['window/F99'], points: [[v1[0] + 0.002, v1[1], v1[2]], [5, 5, 5]] }
    const draft = kept(raw({ id: 'M7', strokes: [sent, surface([[1, 1, 1]])] }), stored([old]))
    expect(draft.strokes[0]).toEqual(old)
    expect(draft.strokes[0].revision).toBe(3)
    expect(draft.strokes[1]).toEqual(surface([[1, 1, 1]]))
    expect(draft.strokes[1].touches).toBeUndefined()
  })

  it('refuses a new stroke whose revision is not the last build\'s', () => {
    expect(refused(raw({ strokes: [surface([[1, 1, 1]], { revision: 6 })] }))).toMatch(/build 6.*build 7|last build/)
    expect(refused(raw({ strokes: [surface([[1, 1, 1]], { revision: 8 })] }))).toMatch(/build/)
    expect(refused(raw({ strokes: [old] }), stored([]))).toMatch(/build/)
  })

  it('refuses a stroke of the old build that was changed: it is a new one, and must be of this build', () => {
    const moved = { ...old, points: [[v1[0], v1[1], v1[2]], [5, 5, 6]] }
    expect(refused(raw({ id: 'M7', strokes: [moved] }), stored([old]))).toMatch(/build/)
  })

  it('takes a stroke by its value, wherever the window put it in the list', () => {
    const other = surface([[9, 9, 9]], { revision: 3 })
    const draft = kept(raw({ id: 'M7', strokes: [other, old] }), stored([old, other]))
    expect(draft.strokes).toEqual([other, old])
  })

  it('keeps the id of the stroke it takes from what main stored, and prefers the one the window names among identical strokes', () => {
    const twin = (id: string, touches: string[]) => surface([[9, 9, 9]], { id, revision: 3, touches })
    const draft = kept(raw({ id: 'M7', strokes: [{ ...twin('k2', []), touches: undefined }, { ...twin('k1', []), touches: undefined }] }), stored([twin('k1', ['a/F1']), twin('k2', ['b/F2'])]))
    expect(draft.strokes.map((one) => [one.id, one.touches])).toEqual([['k2', ['b/F2']], ['k1', ['a/F1']]])
  })

  it('reads an id of a stroke only when it is one, and never refuses a sketch for one', () => {
    const draft = kept(raw({ strokes: [surface([[1, 1, 1]], { id: 'k3' }), surface([[2, 2, 2]], { id: 'x9' }), surface([[3, 3, 3]], { id: 7 })] }))
    expect(draft.strokes.map((one) => one.id)).toEqual(['k3', undefined, undefined])
  })

  it('does not take on a stroke the way its plane was made, when that is another', () => {
    const planeStroke = { plane: 1, pen: 'free', points2d: [[0, 0], [1, 1]], revision: 3 }
    const other = { ...XY, from: { kind: 'view', label: 'Top' } }
    expect(refused(raw({ id: 'M7', planes: [other], strokes: [planeStroke] }), stored([planeStroke]))).toMatch(/build/)
  })

  it('refuses a layout other than the one the sketch has', () => {
    expect(refused(raw({ id: 'M7', layout: 'print' }), stored([]))).toMatch(/layout/)
  })

  it('does not take a stroke from the sketch it has not got: nothing stored, so every stroke is new', () => {
    expect(refused(raw({ strokes: [old] }), undefined)).toMatch(/build/)
  })

  it('does not take on a stroke the plane it was drawn on, when the plane is another', () => {
    const planeStroke = { plane: 1, pen: 'free', points2d: [[0, 0], [1, 1]], revision: 3 }
    const was = stored([planeStroke])
    const shifted = { ...XY, origin: [0, 0, 5] }
    expect(refused(raw({ id: 'M7', planes: [shifted], strokes: [planeStroke] }), was)).toMatch(/build/)
    expect(kept(raw({ id: 'M7', strokes: [planeStroke] }), was).strokes[0]).toEqual(planeStroke)
  })
})

describe('what main keeps to itself', () => {
  it('drops id, author, status, sentBefore and picture from the draft, and the touches of a new stroke', () => {
    const draft = kept(raw({ id: 'M7', author: 'agent', status: 'resolved', sentBefore: true, picture: 'k-0123456789ab.png', checkedRevision: 7, strokes: [surface([[1, 1, 1]], { touches: ['x/F1'] })] }))
    for (const key of ['id', 'author', 'status', 'sentBefore', 'picture', 'checkedRevision']) expect(draft).not.toHaveProperty(key)
    expect(draft.strokes[0]).not.toHaveProperty('touches')
  })

  it('takes the id from the sketch it is a change to, not from the window', () => {
    expect(kept(raw({ id: 'M99' }), stored([])).id).toBe('M7')
    expect(kept(raw({ id: 'M7' }), undefined)).not.toHaveProperty('id')
  })

  it('keeps the anchor the sketch has when the window sends the same point', () => {
    const anchor = { point: [1, 2, 3], part: 'block', ref: 'block/F2', arranged: [0, 0, 0] as Vec3 }
    expect(kept(raw({ id: 'M7', anchor: { point: [1, 2, 3], part: 'block', ref: 'block/F7', tag: 'top' } }), stored([], { anchor })).anchor).toEqual(anchor)
    expect(kept(raw({ id: 'M7', anchor: { point: [1, 2, 4], part: 'block' } }), stored([], { anchor })).anchor).toEqual({ point: [1, 2, 4], part: 'block' })
  })
})

describe('what a sketch may be', () => {
  it('keeps what a valid one says, as the draft of the window', () => {
    const draft = kept(raw())
    expect(draft).toEqual({ objectId: 'bracket', layout: 'assembly', revision: 7, camera: CAMERA, name: 'Hose', note: 'route it here', take: 'flow', diameter: 19, planes: [XY], strokes: [] })
  })

  it('is rough when it does not say', () => {
    expect(kept(raw({ take: undefined, diameter: undefined })).take).toBe('rough')
  })

  it('refuses what is not a draft, or has no project, layout, camera or number', () => {
    expect(refused(null)).toMatch(/sketch/)
    expect(refused(raw({ objectId: 4 }))).toMatch(/project/)
    expect(refused(raw({ layout: '' }))).toMatch(/layout/)
    expect(refused(raw({ camera: { position: 1 } }))).toMatch(/camera/)
    expect(refused(raw({ revision: 'x' }))).toMatch(/build/)
    expect(refused(raw({ revision: 8 }))).toMatch(/build/)
  })

  it('refuses a diameter on anything but a flow sketch, one of 0, and one over 500', () => {
    expect(refused(raw({ take: 'rough' }))).toMatch(/diameter/)
    expect(refused(raw({ diameter: 0 }))).toMatch(/diameter/)
    expect(refused(raw({ diameter: 501 }))).toMatch(/diameter/)
    expect(kept(raw({ diameter: 500 })).diameter).toBe(500)
  })

  it('refuses a name of more than 80 characters, and makes one of two lines one', () => {
    expect(refused(raw({ name: 'n'.repeat(81) }))).toMatch(/80/)
    expect(kept(raw({ name: 'a\nb' })).name).toBe('a b')
  })

  it('refuses more than 200 strokes, 400 points in a stroke, and 20 000 points in all', () => {
    expect(refused(raw({ strokes: Array.from({ length: 201 }, () => surface([[0, 0, 0]])) }))).toMatch(/200/)
    expect(refused(raw({ strokes: [surface(Array.from({ length: 401 }, () => [0, 0, 0] as Vec3))] }))).toMatch(/400/)
    expect(refused(raw({ strokes: Array.from({ length: 51 }, () => surface(Array.from({ length: 400 }, () => [0, 0, 0] as Vec3))) }))).toMatch(/20000|20 000/)
  })

  it('refuses a point that is not a finite number, and a stroke on a plane the sketch has not', () => {
    expect(refused(raw({ strokes: [surface([[0, Infinity, 0]])] }))).toMatch(/point/)
    expect(refused(raw({ strokes: [{ plane: 5, pen: 'free', points2d: [[0, 0]], revision: 7 }] }))).toMatch(/plane 5/)
  })

  it('refuses a plane that is not a frame, and sets right one that is off by less than a millionth', () => {
    expect(refused(raw({ planes: [{ ...XY, y: [0.3, 1, 0] }] }))).toMatch(/plane/)
    const set = kept(raw({ planes: [{ ...XY, x: [1 + 3e-7, 0, 0] }] })).planes[0]
    expect(Math.hypot(...set.x)).toBeCloseTo(1, 12)
  })
})

describe('the plane through a face', () => {
  const faces = { ...build, scene: { ...build.scene, parts: build.scene.parts.map((p) => ({ ...p, faceCount: 12 })) } }
  const stroke = [{ plane: 1, pen: 'free', points2d: [[0, 0]], revision: 7 }]
  const through = (ref: string, revision = 7) => ({ id: 1, origin: [0, 0, 20], x: [1, 0, 0], y: [0, 1, 0], label: `plane through ${ref}`, from: { kind: 'face', ref, offset: 0, revision } })

  it('is kept when the face is one of the build', () => {
    expect(kept(raw({ planes: [through('block/F11')], strokes: [{ plane: 1, pen: 'free', points2d: [[0, 0]], revision: 7 }] }), undefined, faces).planes).toHaveLength(1)
  })

  it('is refused when the face is past the faces of the part, or the part is none of the layout', () => {
    expect(refused(raw({ planes: [through('block/F12')], strokes: stroke }), undefined, faces)).toMatch(/block has 12 faces/)
    expect(refused(raw({ planes: [through('lid/F1')], strokes: stroke }), undefined, faces)).toMatch(/no such part/)
  })

  it('is not judged against a build it is not of', () => {
    expect(kept(raw({ planes: [through('block/F99', 5)], strokes: stroke }), undefined, faces).planes).toHaveLength(1)
  })
})

describe('the intent a sketch is made with', () => {
  it('is want or don\'t want, kept as the window says it, and plain when it says nothing', () => {
    expect(kept(raw({ intent: 'dont' }))).toMatchObject({ intent: 'dont' })
    expect(kept(raw({ intent: 'want' }))).toMatchObject({ intent: 'want' })
    expect(kept(raw())).not.toHaveProperty('intent')
  })

  it('is refused when it is anything else, so that main keeps nothing the window made up', () => {
    expect(refused(raw({ intent: 'add' }))).toMatch(/intent/)
    expect(refused(raw({ intent: 7 }))).toMatch(/intent/)
  })

  it('is not changed by the draft of a sketch main has: it is the stored sketch\'s own', () => {
    expect(kept(raw({ intent: 'want' }), stored([]))).not.toHaveProperty('intent')
  })
})
