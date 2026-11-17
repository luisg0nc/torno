import { describe, expect, it } from 'vitest'
import type { Mark } from '../../shared/marks'
import type { ScanAlignment, ScanInfo } from '../../shared/scans'
import type { Scene } from '../../shared/scene'
import { describeMark, directionText, markData, number } from './describe'

const BASE = {
  author: 'user',
  note: '',
  status: 'draft',
  anchorState: 'ok',
  layout: 'assembly',
  revision: 1,
  camera: { position: [100, -100, 80], target: [0, 0, 10], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 },
  createdAt: '2026-10-09T12:00:00.000Z'
} as const

const mark = (m: object): Mark => ({ ...BASE, ...m }) as Mark

describe('number', () => {
  // The cases of the kernel's own `number` (kernel/tests/test_queries.py): the two write numbers alike.
  it.each([
    [20, '20'],
    [1180.0, '1180'],
    [502.6548, '502.7'],
    [25.1327, '25.13'],
    [6000.0000001, '6000'],
    [12345.6, '12350'],
    [0.5, '0.5'],
    [0.012346, '0.01235'],
    [-2.5, '-2.5'],
    [-0, '0'],
    [1e-12, '0'],
    [-1e-12, '0'],
    [-0.0000001, '0'],
    [9e-7, '0'],
    [0.000002, '0.000002'],
    [-0.00025, '-0.00025'],
    [40.5, '40.5'],
    [14.2, '14.2'],
    [0.99996, '1'],
    [9999.6, '10000']
  ])('writes %f as %s', (value, text) => {
    expect(number(value)).toBe(text)
  })
})

describe('describeMark of a view note', () => {
  const note = (over: object = {}): Mark =>
    mark({
      id: 'M4',
      kind: 'note',
      note: 'too thin  here',
      revision: 12,
      picture: 'n-0123456789ab.png',
      ink: 'n-0123456789ab.ink.png',
      size: { w: 800, h: 600 },
      strokes: [],
      inkColour: '#ff00ff',
      labels: [{ x: 1, y: 1, text: 'a' }, { x: 2, y: 2, text: 'b' }, { x: 3, y: 3, text: 'c' }],
      under: [],
      references: [{ file: 'r-0123456789ab.png', comment: 'x' }, { file: 'r-0123456789ac.jpg', comment: '' }],
      ...over
    })

  it('says what it holds and the build it was drawn on', () => {
    expect(describeMark(note())).toBe('M4 · view note · draft: "too thin here" (3 labels, 2 references, drawn on build 12)')
  })

  it('says its status, the tag it was given and what the last build did to its anchor', () => {
    expect(describeMark(note({ status: 'sent', anchorState: 'orphaned' }), { tag: 'changed' })).toBe('(changed) M4 · view note · sent: "too thin here" (3 labels, 2 references, drawn on build 12) [its part is gone]')
  })

  it('says only what it has', () => {
    expect(describeMark(note({ labels: [{ x: 1, y: 1, text: 'a' }], references: [], note: '' }))).toBe('M4 · view note · draft (1 label, drawn on build 12)')
    expect(describeMark(note({ labels: [], references: [], note: '' }))).toBe('M4 · view note · draft (drawn on build 12)')
  })

  it('says when nothing has checked it against the last build', () => {
    expect(describeMark(note({ anchor: { point: [1, 2, 3], ref: 'base/F1' } }), { revision: 13 })).toContain('[not checked against r13]')
  })

  it('is data as it is held', () => {
    expect(markData(note(), 12)).toMatchObject({ id: 'M4', kind: 'note', labels: expect.any(Array) })
  })
})

describe('describeMark', () => {
  it('says what a pin is on, where, and its note', () => {
    const pin = mark({
      id: 'M3',
      kind: 'pin',
      note: 'this edge is ugly',
      anchor: { point: [12, 40.5, 20.0000001], part: 'lid', ref: 'lid/F12', descriptor: 'plane, normal +Z, z = 20, 1180 mm²' }
    })
    expect(describeMark(pin)).toBe('M3 pin on lid/F12 (plane, normal +Z, z = 20, 1180 mm²) at (12, 40.5, 20): "this edge is ugly"')
  })

  it('says of a pin in empty space only where it is', () => {
    expect(describeMark(mark({ id: 'M1', kind: 'pin', note: 'here', anchor: { point: [1.23456, -0, 3] } }))).toBe('M1 pin at (1.235, 0, 3): "here"')
  })

  it('names what a pick is of', () => {
    const pick = mark({ id: 'M4', kind: 'pick', target: 'edge', note: 'round this', anchor: { point: [0, 0, 0], part: 'base', ref: 'base/E7', descriptor: 'line, 40 mm' } })
    expect(describeMark(pick)).toBe('M4 pick of base/E7 (line, 40 mm): "round this"')
    const bare = mark({ id: 'M4', kind: 'pick', target: 'part', anchor: { point: [0, 0, 0], part: 'base', ref: 'base' } })
    expect(describeMark(bare)).toBe('M4 pick of base')
  })

  it('gives an arrow its start, its vector and its length', () => {
    const arrow = mark({
      id: 'M5',
      kind: 'arrow',
      note: 'move this wall out',
      from: { point: [0, 10, 5], part: 'lid', ref: 'lid/F3', descriptor: 'plane, normal +Y, y = 10, 200 mm²' },
      to: [0, 24.2, 5]
    })
    expect(describeMark(arrow)).toBe('M5 arrow from lid/F3 (plane, normal +Y, y = 10, 200 mm²) at (0, 10, 5) by (0, 14.2, 0), 14.2 mm: "move this wall out"')
    expect(describeMark(mark({ id: 'M5', kind: 'arrow', from: { point: [0, 0, 0] }, to: [3, 4, 0] }))).toBe('M5 arrow from (0, 0, 0) by (3, 4, 0), 5 mm')
  })

  it('names the plane of a stroke drawn on a view, counts its points and measures it', () => {
    const points2d = Array.from({ length: 23 }, (_, i) => [(i * 60) / 22, i % 2 === 0 ? 0 : 35])
    const stroke = mark({
      id: 'M6',
      kind: 'stroke',
      space: 'plane',
      note: 'profile like this',
      anchor: { point: [0, 40, 0] },
      plane: { origin: [0, 40, 0], x: [1, 0, 0], y: [0, 0, 1], label: 'XZ at y = 40.0' },
      points2d
    })
    expect(describeMark(stroke)).toBe('M6 stroke on plane XZ at y = 40.0, 23 points, 60 × 35 mm: "profile like this"')
  })

  it('says what a stroke on a surface starts on', () => {
    const stroke = mark({
      id: 'M8',
      kind: 'stroke',
      space: 'surface',
      note: 'crack',
      anchor: { point: [1, 2, 20], part: 'lid', ref: 'lid/F12', descriptor: 'plane, normal +Z, z = 20, 1180 mm²' },
      points: [
        [1, 2, 20],
        [11, 2, 20],
        [11, 7.5, 20]
      ]
    })
    expect(describeMark(stroke)).toBe('M8 stroke on lid/F12 (plane, normal +Z, z = 20, 1180 mm²) from (1, 2, 20), 3 points, 10 × 5.5 × 0 mm: "crack"')
  })

  it('gives a shape its size, where its centre is and what it is meant for', () => {
    const shape = { id: 'M7', kind: 'shape', note: 'pocket here', intent: 'remove', position: [5, 5, 4.5], rotation: [0, 0, 0, 1] }
    expect(describeMark(mark({ ...shape, shape: 'box', size: [10, 10, 4] }))).toBe('M7 box 10 × 10 × 4 mm centred at (5, 5, 4.5), intent remove: "pocket here"')
    expect(describeMark(mark({ ...shape, shape: 'cylinder', size: [8, 8, 20], note: '' }))).toBe('M7 cylinder diameter 8, height 20 mm centred at (5, 5, 4.5), intent remove')
    expect(describeMark(mark({ ...shape, shape: 'sphere', size: [6, 6, 6], note: '', intent: 'keep-out' }))).toBe('M7 sphere diameter 6 mm centred at (5, 5, 4.5), intent keep-out')
    expect(describeMark(mark({ ...shape, shape: 'plane', size: [30, 20, 0], note: '', intent: 'reference' }))).toBe('M7 plane 30 × 20 mm centred at (5, 5, 4.5), intent reference')
  })

  it('says how a shape is turned when it is, in degrees about X, Y and Z', () => {
    const box = { id: 'M7', kind: 'shape', shape: 'box', intent: 'add', size: [10, 10, 4], position: [0, 0, 0] }
    const half = (degrees: number) => [Math.sin((degrees * Math.PI) / 360), Math.cos((degrees * Math.PI) / 360)]
    const [s15, c15] = half(15)
    expect(describeMark(mark({ ...box, rotation: [0, 0, s15, c15] }))).toBe('M7 box 10 × 10 × 4 mm centred at (0, 0, 0), rotated (0, 0, 15)°, intent add')
    const [s90, c90] = half(90)
    expect(describeMark(mark({ ...box, rotation: [s90, 0, 0, c90] }))).toBe('M7 box 10 × 10 × 4 mm centred at (0, 0, 0), rotated (90, 0, 0)°, intent add')
    expect(describeMark(mark({ ...box, rotation: [0, -s15, 0, c15] }))).toBe('M7 box 10 × 10 × 4 mm centred at (0, 0, 0), rotated (0, -15, 0)°, intent add')
    // About X by 30, then about Z by 45, as three.js composes 'XYZ': q = qx · qz.
    const [sx, cx] = half(30)
    const [sz, cz] = half(45)
    expect(describeMark(mark({ ...box, rotation: [sx * cz, -sx * sz, cx * sz, cx * cz] }))).toBe('M7 box 10 × 10 × 4 mm centred at (0, 0, 0), rotated (30, 0, 45)°, intent add')
    // A quaternion and its negative are one rotation; none at all is not said.
    expect(describeMark(mark({ ...box, rotation: [0, 0, -s15, -c15] }))).toContain('rotated (0, 0, 15)°')
    expect(describeMark(mark({ ...box, rotation: [0, 0, 0, -1] }))).toBe('M7 box 10 × 10 × 4 mm centred at (0, 0, 0), intent add')
  })

  it('says where a mark that moved or lost its part was placed, not what is there: the ref may now name something else', () => {
    const pin = { id: 'M3', kind: 'pin', note: 'here', anchor: { point: [1, 2, 3], part: 'lid', ref: 'lid/F12', descriptor: 'plane, normal +Z, z = 20, 1180 mm²' } }
    expect(describeMark(mark({ ...pin, anchorState: 'drifted' }))).toBe('M3 pin placed on lid/F12 at (1, 2, 3): "here" [moved since it was placed: check it]')
    expect(describeMark(mark({ ...pin, anchorState: 'orphaned', note: '' }))).toBe('M3 pin placed on lid/F12 at (1, 2, 3) [its part is gone]')

    // A pick of an edge that drifted keeps its ref, and carries the descriptor of the face now under it.
    const pick = { id: 'M4', kind: 'pick', target: 'edge', note: 'round this', anchor: { point: [0, 0, 0], part: 'plate', ref: 'plate/E1', descriptor: 'plane, normal +Z, z = 5, 1200 mm²' } }
    expect(describeMark(mark({ ...pick, anchorState: 'drifted' }))).toBe('M4 pick placed on plate/E1: "round this" [moved since it was placed: check it]')
    expect(describeMark(mark({ ...pick, anchorState: 'orphaned' }))).toBe('M4 pick placed on plate/E1: "round this" [its part is gone]')

    const arrow = mark({ id: 'M5', kind: 'arrow', anchorState: 'drifted', from: { point: [0, 10, 5], part: 'lid', ref: 'lid/F3', descriptor: 'plane, normal +Y, y = 10, 200 mm²' }, to: [0, 20, 5] })
    expect(describeMark(arrow)).toBe('M5 arrow placed on lid/F3, from (0, 10, 5) by (0, 10, 0), 10 mm [moved since it was placed: check it]')
    const stroke = mark({ id: 'M8', kind: 'stroke', space: 'surface', anchorState: 'orphaned', anchor: { point: [1, 2, 20], part: 'lid', ref: 'lid/F12', descriptor: 'plane' }, points: [[1, 2, 20], [11, 2, 20]] })
    expect(describeMark(stroke)).toBe('M8 stroke placed on lid/F12 from (1, 2, 20), 2 points, 10 × 0 × 0 mm [its part is gone]')
    // What names nothing says nothing more.
    expect(describeMark(mark({ id: 'M1', kind: 'pin', anchorState: 'drifted', anchor: { point: [1, 2, 3] } }))).toBe('M1 pin at (1, 2, 3) [moved since it was placed: check it]')
  })

  it('says a pin on an edge is on the edge, between which faces, and what the edge is', () => {
    const anchor = { point: [20, 0, 5], part: 'lid', ref: 'lid/E40', edge: 'lid/E40', between: ['lid/F12', 'lid/F40'], descriptor: 'line, 40 mm' }
    expect(describeMark(mark({ id: 'M3', kind: 'pin', note: 'this edge is ugly', anchor }))).toBe(
      'M3 pin on the edge lid/E40 between lid/F12 and lid/F40 (line, 40 mm) at (20, 0, 5): "this edge is ugly"'
    )
    // A seam has one face, and a kernel that could not describe the edge says nothing of it.
    const { between: _one, descriptor: _none, ...seam } = anchor
    expect(describeMark(mark({ id: 'M3', kind: 'pin', anchor: seam }))).toBe('M3 pin on the edge lid/E40 at (20, 0, 5)')
    // Once it has moved off it, only where it was placed.
    expect(describeMark(mark({ id: 'M3', kind: 'pin', anchorState: 'drifted', anchor }))).toBe('M3 pin placed on lid/E40 at (20, 0, 5) [moved since it was placed: check it]')
  })

  it('says so when nothing has checked an open mark against the build there is', () => {
    const pin = { id: 'M6', kind: 'pin', note: 'here', anchor: { point: [1, 2, 3], part: 'lid', ref: 'lid/F2' } }
    expect(describeMark(mark({ ...pin, checkedRevision: 11 }), { revision: 12 })).toBe('M6 pin on lid/F2 at (1, 2, 3): "here" [not checked against r12]')
    expect(describeMark(mark(pin), { revision: 12 })).toBe('M6 pin on lid/F2 at (1, 2, 3): "here" [not checked against r12]')
    expect(describeMark(mark({ ...pin, checkedRevision: 12 }), { revision: 12 })).toBe('M6 pin on lid/F2 at (1, 2, 3): "here"')
    // Any other build than this one: revisions count anew when an object is opened again.
    expect(describeMark(mark({ ...pin, checkedRevision: 13 }), { revision: 12 })).toBe('M6 pin on lid/F2 at (1, 2, 3): "here" [not checked against r12]')
    // After what the last check found, when it found something.
    expect(describeMark(mark({ ...pin, checkedRevision: 11, anchorState: 'drifted' }), { revision: 12 })).toBe(
      'M6 pin placed on lid/F2 at (1, 2, 3): "here" [moved since it was placed: check it] [not checked against r12]'
    )
    // A resolved mark is checked by nothing, and nothing is said of it; nor when no build is named.
    expect(describeMark(mark({ ...pin, status: 'resolved', checkedRevision: 3 }), { revision: 12 })).toBe('M6 pin on lid/F2 at (1, 2, 3): "here"')
    expect(describeMark(mark(pin))).toBe('M6 pin on lid/F2 at (1, 2, 3): "here"')
  })

  it('says what a line is news of, before the mark', () => {
    const pin = { id: 'M2', kind: 'pin', note: 'here', anchor: { point: [1, 2, 3] } }
    expect(describeMark(mark(pin), { tag: 'changed' })).toBe('(changed) M2 pin at (1, 2, 3): "here"')
    expect(describeMark(mark({ ...pin, author: 'agent' }), { tag: 'reopened by the user' })).toBe('(yours, reopened by the user) M2 pin at (1, 2, 3): "here"')
  })

  it("marks the agent's own", () => {
    const pin = mark({ id: 'M9', kind: 'pin', author: 'agent', note: 'this face?', anchor: { point: [1, 2, 3], part: 'lid', ref: 'lid/F2' } })
    expect(describeMark(pin)).toBe('(yours) M9 pin on lid/F2 at (1, 2, 3): "this face?"')
  })

  it('is one line whatever the note holds', () => {
    const pin = mark({ id: 'M1', kind: 'pin', note: '  two\nlines\tand a tab ', anchor: { point: [0, 0, 0] } })
    expect(describeMark(pin)).toBe('M1 pin at (0, 0, 0): "two lines and a tab"')
  })
})

describe('a dimension in one line', () => {
  const TOP = { point: [5, 3, 3], normal: [0, 0, 1], part: 'base', ref: 'base/F5', descriptor: 'plane, normal +Z, z = 3, 1100 mm²' }
  const BOTTOM = { point: [5, 3, -3], normal: [0, 0, -1], part: 'base', ref: 'base/F0' }
  const distance = (m: object = {}): Mark => mark({ id: 'M7', kind: 'dimension', measure: 'distance', a: TOP, b: BOTTOM, value: 6, how: 'between planes', points: [[5, 3, 3], [5, 3, -3]], measuredRevision: 4, ...m })
  const hole = (m: object = {}): Mark => mark({ id: 'M8', kind: 'dimension', measure: 'diameter', a: { point: [-6, 5, 0], part: 'base', ref: 'base/F9' }, value: 8, how: 'cylinder', measuredRevision: 4, ...m })

  // As of r4, the build they were measured on.
  const said = (m: Mark, tag?: string): string => describeMark(m, { revision: 4, ...(tag ? { tag } : {}) })
  const checked = { checkedRevision: 4 }

  it('says the value, how it was taken and between what', () => {
    expect(said(distance(checked))).toBe('M7 distance 6 mm between planes, base/F5 to base/F0')
    expect(said(distance({ ...checked, value: 6.00000001, note: 'the plate' }))).toBe('M7 distance 6 mm between planes, base/F5 to base/F0: "the plate"')
    expect(said(distance({ ...checked, how: 'point to plane', a: { point: [1, 2, 9.5] }, value: 6.5 }))).toBe('M7 distance 6.5 mm point to plane, (1, 2, 9.5) to base/F0')
    expect(said(distance({ ...checked, measure: 'angle', value: 45, how: 'between normals' }))).toBe('M7 angle 45° between normals, base/F5 to base/F0')
    expect(said(distance({ ...checked, measure: 'thickness', b: undefined, value: 2, how: 'wall, along the normal' }))).toBe('M7 thickness 2 mm wall, along the normal, base/F5 at (5, 3, 3)')
  })

  it('of a diameter or a radius says what it is of, and no more of how unless that says which', () => {
    expect(said(hole(checked))).toBe('M8 diameter 8 mm, base/F9')
    expect(said(hole({ ...checked, measure: 'radius', value: 4, how: 'circle', a: { point: [0, 0, 0], part: 'base', ref: 'base/E3' } }))).toBe('M8 radius 4 mm, base/E3')
    expect(said(hole({ ...checked, measure: 'radius', value: 2, how: 'torus, of the tube' }))).toBe('M8 radius 2 mm (torus, of the tube), base/F9')
  })

  it('with an expectation says what was expected and the tolerance, the verdict, and how far off which way', () => {
    expect(said(hole({ ...checked, expected: 8.5, verdict: 'fail' }))).toBe('M8 diameter 8 mm, base/F9 (expected 8.5 ± 0.05: FAIL, 0.5 under)')
    expect(said(hole({ ...checked, value: 8.7, expected: 8.5, tolerance: 0.1, verdict: 'fail' }))).toBe('M8 diameter 8.7 mm, base/F9 (expected 8.5 ± 0.1: FAIL, 0.2 over)')
    expect(said(hole({ ...checked, value: 8.02, expected: 8, verdict: 'pass' }))).toBe('M8 diameter 8.02 mm, base/F9 (expected 8 ± 0.05: pass)')
    expect(said(distance({ ...checked, measure: 'angle', value: 44, how: 'between normals', expected: 45, verdict: 'fail' }))).toBe('M7 angle 44° between normals, base/F5 to base/F0 (expected 45 ± 0.1: FAIL, 1 under)')
  })

  it('one whose end the build moved is measured from what is under its ends now, and says that it moved', () => {
    const moved = hole({ ...checked, anchorState: 'drifted', value: 9, expected: 8, verdict: 'fail', note: 'the bolt' })
    expect(said(moved)).toBe('M8 diameter 9 mm, base/F9 (expected 8 ± 0.05: FAIL, 1 over): "the bolt" [moved since it was placed: check it]')
  })

  it('has no value once the part of an end is gone, whatever it held', () => {
    expect(said(distance({ ...checked, id: 'M9', value: undefined, how: undefined, points: undefined, anchorState: 'orphaned' }))).toBe('M9 distance: not measurable, [its part is gone]')
    expect(said(distance({ ...checked, id: 'M9', anchorState: 'orphaned', expected: 6, verdict: 'pass' }))).toBe('M9 distance: not measurable, [its part is gone]')
    // Nor when the build it was measured on is another: there is nothing it was.
    expect(describeMark(distance({ id: 'M9', anchorState: 'orphaned', checkedRevision: 5 }), { revision: 5 })).toBe('M9 distance: not measurable, [its part is gone]')
  })

  it('that the kernel could not measure on this build says so, with the kernel’s reason', () => {
    expect(said(hole({ ...checked, value: undefined, how: undefined }))).toBe('M8 diameter: not measurable, base/F9')
    expect(said(hole({ ...checked, value: undefined, how: undefined, expected: 8.5 }))).toBe('M8 diameter: not measurable, base/F9 (expected 8.5 ± 0.05)')
    expect(said(hole({ ...checked, value: undefined, how: undefined, refused: 'base/F9 is a plane face: it has no diameter', expected: 8.5 }))).toBe(
      'M8 diameter: not measurable (base/F9 is a plane face: it has no diameter), base/F9 (expected 8.5 ± 0.05)'
    )
  })

  it('never gives a value of another build as that of the last: it is not measured on that one, and has no verdict', () => {
    expect(describeMark(hole(), { revision: 4 })).toBe('M8 diameter 8 mm, base/F9 [not checked against r4]')
    expect(describeMark(hole({ checkedRevision: 5 }), { revision: 5 })).toBe('M8 diameter: not measured on r5 (was 8 mm on r4), base/F9')
    expect(describeMark(hole({ checkedRevision: 5, expected: 8, verdict: 'pass' }), { revision: 5 })).toBe('M8 diameter: not measured on r5 (was 8 mm on r4), base/F9 (expected 8 ± 0.05)')
    expect(describeMark(hole({ checkedRevision: 5, measuredRevision: undefined }), { revision: 5 })).toBe('M8 diameter: not measured yet, base/F9')
    expect(describeMark(hole({ checkedRevision: 5, measuredRevision: undefined, value: undefined, how: undefined }), { revision: 5 })).toBe('M8 diameter: not measured yet, base/F9')
    expect(describeMark(hole({ anchorState: 'drifted', checkedRevision: 5 }), { revision: 5 })).toBe('M8 diameter: not measured on r5 (was 8 mm on r4), base/F9 [moved since it was placed: check it]')
    // With no build to hold it against, it is not measured at all.
    expect(describeMark(hole())).toBe('M8 diameter: not measured (was 8 mm on r4), base/F9')
  })

  it('once resolved is no longer measured: its value is what it was, and says of which build when that is not the last', () => {
    expect(describeMark(hole({ status: 'resolved' }), { revision: 4 })).toBe('M8 diameter 8 mm, base/F9')
    expect(describeMark(hole({ status: 'resolved', measuredRevision: 2 }), { revision: 5 })).toBe('M8 diameter 8 mm, base/F9 [as measured on r2]')
    expect(describeMark(hole({ status: 'resolved', measuredRevision: undefined }), { revision: 5 })).toBe('M8 diameter 8 mm, base/F9 [as measured on an earlier build]')
    expect(describeMark(hole({ status: 'resolved' }))).toBe('M8 diameter 8 mm, base/F9 [as measured on r4]')
  })

  it('says whose it is, and that it changed, like any mark', () => {
    expect(said(hole({ ...checked, author: 'agent' }), 'changed')).toBe('(yours, changed) M8 diameter 8 mm, base/F9')
  })

  it('as data holds a value only where its line gives one: what it held on another build is told as that', () => {
    const current = hole({ ...checked, expected: 8.5, verdict: 'fail', points: [[-14, 5, 0], [-6, 5, 0]] })
    expect(markData(current, 4)).toBe(current)
    const stale = markData(current, 5) as Record<string, unknown>
    for (const key of ['value', 'how', 'points', 'verdict']) expect(stale).not.toHaveProperty(key)
    expect(stale).toMatchObject({ id: 'M8', expected: 8.5, wasValue: 8, wasRevision: 4, measuredRevision: 4 })
    // Of a run before this one: which build it was is not known.
    expect(markData(hole({ measuredRevision: undefined }), 5)).not.toHaveProperty('wasRevision')
    // Its part gone: no value, and none that it was.
    const gone = markData(hole({ ...checked, anchorState: 'orphaned', expected: 8, verdict: 'pass' }), 4) as Record<string, unknown>
    for (const key of ['value', 'how', 'verdict', 'wasValue', 'wasRevision']) expect(gone).not.toHaveProperty(key)
    // Moved, and measured on this build from what is under it: its value stands.
    expect(markData(hole({ ...checked, anchorState: 'drifted' }), 4)).toMatchObject({ value: 8 })
    // Resolved, it is no longer measured: what it held is told as that, whichever build is the last, and never as `value`.
    for (const last of [4, 5, undefined]) {
      const resolved = markData(hole({ status: 'resolved', expected: 8, verdict: 'pass', points: [[-14, 5, 0], [-6, 5, 0]] }), last) as Record<string, unknown>
      for (const key of ['value', 'how', 'points', 'verdict', 'wasValue', 'measuredRevision']) expect(resolved).not.toHaveProperty(key)
      expect(resolved).toMatchObject({ status: 'resolved', resolvedValue: 8, resolvedVerdict: 'pass', resolvedOnRevision: 4 })
    }
    expect(markData(hole({ status: 'resolved', measuredRevision: undefined }), 5)).not.toHaveProperty('resolvedOnRevision')
    expect(markData(hole({ status: 'resolved', anchorState: 'orphaned' }), 5)).not.toHaveProperty('resolvedValue')
    // Any other mark is as it is.
    const pin = mark({ kind: 'pin', anchor: TOP })
    expect(markData(pin, 4)).toBe(pin)
  })
})

describe('a region of a scan', () => {
  const scan = (id: string, alignments: Record<string, ScanAlignment> = {}, checks: ScanInfo['checks'] = {}): ScanInfo =>
    ({ id, name: `${id}.glb`, source: { path: `/dl/${id}.glb`, bytes: 1, mtimeMs: 1, sha256: '' }, imported: { unit: 'm', up: 'y', assumed: { unit: true, up: true }, vertices: 9000, triangles: 16000, colours: 'none', bbox: { min: [-50, -50, 0], max: [50, 50, 10] }, area: 1, at: '' }, alignments, sourceState: 'present', meshState: 'ok', checks }) as ScanInfo
  // A patch 10 × 10 mm and 1 mm thick, painted while `print` was shown.
  const local = { centroid: [-15, -15, 0], bbox: { min: [-20, -20, -0.5], max: [-10, -10, 0.5] }, plane: { origin: [-15, -15, 0], normal: [0, 0, 1], rms: 0.3 }, box: { centre: [-15, -15, 0], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], half: [5, 5, 0.5] } }
  const REGION = mark({ id: 'M7', kind: 'region', scan: 'S1', note: 'wiring loom', layout: 'print', triangles: 4812, area: 31000, local, mesh: 'abc|1|2|m|y', mask: 2 })
  // A strip 200 × 10 × 2 mm lying along the diagonal of the scan's frame.
  const D = Math.SQRT1_2
  const STRIP = mark({ id: 'M8', kind: 'region', scan: 'S1', note: 'cable', layout: 'print', triangles: 80, area: 2000, local: { centroid: [0, 0, 0], bbox: { min: [-74.2, -74.2, -1], max: [74.2, 74.2, 1] }, plane: { origin: [0, 0, 0], normal: [0, 0, 1], rms: 0.5 }, box: { centre: [0, 0, 0], axes: [[D, D, 0], [-D, D, 0], [0, 0, 1]], half: [100, 5, 1] } } })
  const at = (t: [number, number, number], q: [number, number, number, number] = [0, 0, 0, 1], s = 1) => ({ transform: { t, q, s }, steps: ['typed'], frame: {}, at: '' }) as never
  const held = (layout: string) => ({ [layout]: { revision: 12, of: 0, off: 0, worst: 0, moved: [] } })

  it('tells a region where its scan is aligned, each number as about that, and says when that is nowhere', () => {
    expect(describeMark(REGION, { scans: [scan('S1', { print: at([100, 0, 5]) })] })).toBe('M7 region on scan S1: 4,812 triangles, ≈ 31000 mm², centre ≈ (85, -15, 5), ≈ 10 × 10 × 1 mm, within a box of ≈ 10 × 10 × 1 mm, flat about a plane with normal ≈ (0, 0, 1): "wiring loom"')
    expect(describeMark(REGION, { scans: [scan('S1')] })).toBe('M7 region on scan S1 (not aligned in print, so it has no place in the model’s frame): 4,812 triangles, ≈ 31000 mm², ≈ 10 × 10 × 1 mm, flat: "wiring loom"')
    expect(describeMark(REGION)).toBe('M7 region on scan S1 (its scan could not be read just now, so where it stands is not told): 4,812 triangles, ≈ 31000 mm², ≈ 10 × 10 × 1 mm, flat: "wiring loom"')
    // Nothing has checked a region against a build, and nothing needs to. (Its scan's alignment is another matter: here it was checked against r12 and holds.)
    expect(describeMark(REGION, { revision: 12, scans: [scan('S1', { print: at([100, 0, 5]) }, held('print'))] })).not.toContain('not checked')
  })

  it('tells it in the layout asked, whichever it was painted in: the triangles are the scan’s in every layout (I3)', () => {
    const scans = [scan('S1', { assembly: at([100, 0, 5]) })]
    expect(describeMark(REGION, { layout: 'assembly', scans })).toMatch(/^M7 region on scan S1: 4,812 triangles, ≈ 31000 mm², centre ≈ \(85, -15, 5\)/)
    expect(describeMark(REGION, { layout: 'print', scans })).toMatch(/^M7 region on scan S1 \(not aligned in print, so it has no place/)
    expect(markData(REGION, 12, scans, 'assembly')).toMatchObject({ toldIn: 'assembly', aligned: true, centroid: [85, -15, 5] })
    expect(markData(REGION, 12, scans, 'print')).toMatchObject({ toldIn: 'print', aligned: false, size: [10, 10, 1], flat: true })
    expect(markData(REGION, 12, scans, 'print')).not.toHaveProperty('centroid')
  })

  it('tells the size it has along its own axes and which way its long side runs, and the box of the layout as what it lies within (I4)', () => {
    // As it lies in the scan: along the diagonal.
    expect(describeMark(STRIP, { scans: [scan('S1', { print: at([0, 0, 0]) })] })).toBe('M8 region on scan S1: 80 triangles, ≈ 2000 mm², centre ≈ (0, 0, 0), ≈ 200 × 10 × 2 mm, its long side along (0.71, 0.71, 0), within a box of ≈ 148.4 × 148.4 × 2 mm, flat about a plane with normal ≈ (0, 0, 1): "cable"')
    // Turned an eighth so that it lies along X: the same size, and now a box of that size.
    const eighth: [number, number, number, number] = [0, 0, Math.sin(-Math.PI / 8), Math.cos(-Math.PI / 8)]
    expect(describeMark(STRIP, { scans: [scan('S1', { print: at([0, 0, 0], eighth) })] })).toBe('M8 region on scan S1: 80 triangles, ≈ 2000 mm², centre ≈ (0, 0, 0), ≈ 200 × 10 × 2 mm, its long side along (1, 0, 0), within a box of ≈ 200 × 10 × 2 mm, flat about a plane with normal ≈ (0, 0, 1): "cable"')
    // At twice the size a fit gave the scan.
    expect(describeMark(STRIP, { scans: [scan('S1', { print: at([0, 0, 0], eighth, 2) })] })).toContain('≈ 8000 mm², centre ≈ (0, 0, 0), ≈ 400 × 20 × 4 mm, its long side along (1, 0, 0)')
    // What is thick against its lesser side is not flat, however it is turned.
    const lump = { ...STRIP, local: { ...(STRIP as { local: { box: object } }).local, box: { centre: [0, 0, 0], axes: [[D, D, 0], [-D, D, 0], [0, 0, 1]], half: [90, 42, 37] } } } as Mark
    for (const q of [[0, 0, 0, 1], eighth] as Array<[number, number, number, number]>) expect(describeMark(lump, { scans: [scan('S1', { print: at([0, 0, 0], q) })] })).toMatch(/≈ 180 × 84 × 74 mm, its long side along .*, not flat: "cable"$/)
    expect(markData(STRIP, 12, [scan('S1', { print: at([0, 0, 0], eighth) })])).toMatchObject({ size: [200, 10, 2], flat: true, bboxOf: expect.stringContaining('lies within'), approximate: expect.stringContaining('scan') })
  })

  it('gives a region as data in the frame of the layout, never what only main reads of it', () => {
    const told = markData(REGION, 12, [scan('S1', { print: at([100, 0, 5]) })]) as Record<string, unknown>
    expect(told).toMatchObject({ id: 'M7', kind: 'region', scan: 'S1', triangles: 4812, area: 31000, centroid: [85, -15, 5], bbox: { min: [80, -20, 4.5], max: [90, -10, 5.5] } })
    for (const key of ['local', 'mesh', 'mask']) expect(told).not.toHaveProperty(key)
    expect((markData(REGION, 12, [scan('S1')]) as Record<string, unknown>).centroid).toBeUndefined()
  })

  it('says after it what puts its place in doubt: an alignment that is rough, may no longer hold, or was not checked against the build', () => {
    const placed = { print: at([100, 0, 5]) }
    expect(describeMark(REGION, { revision: 12, scans: [scan('S1', placed)] })).toMatch(/: "wiring loom" \[S1's alignment was not checked against r12: whether it still holds on it is not known\]$/)
    const off = { print: { revision: 12, of: 4, off: 2, worst: 6.2, moved: [] } }
    expect(describeMark(REGION, { revision: 12, scans: [scan('S1', placed, off)] })).toMatch(/\[S1's alignment may no longer hold: the model is no longer under 2 of its 4 points \(worst 6.2 mm off\) on r12: check the alignment\]$/)
    const rough = { print: { ...(placed.print as object), rough: 'it has 2 pairs of points' } }
    expect(describeMark(REGION, { scans: [scan('S1', rough as never)] })).toMatch(/\[S1 is only roughly aligned: it has 2 pairs of points\]$/)
  })

  // Milestone 5 (T3): the doubt was in the line only; whoever reads the data reads a place with no word on how far to rely on it.
  it('gives in a region’s data how the alignment it is placed by stands, in a word', () => {
    const placed = { print: at([100, 0, 5]) }
    const rough = { print: { ...(placed.print as object), rough: 'it has 2 pairs of points' } }
    expect(markData(REGION, 12, [scan('S1', rough as never, held('print'))])).toMatchObject({ aligned: true, alignment: 'rough' })
    expect(markData(REGION, 12, [scan('S1', placed, held('print'))])).toMatchObject({ aligned: true, alignment: 'aligned' })
    expect(markData(REGION, 12, [scan('S1', placed)])).toMatchObject({ aligned: true, alignment: 'not checked' })
    expect(markData(REGION, 12, [scan('S1', placed, { print: { revision: 12, of: 4, off: 2, worst: 6.2, moved: [] } })])).toMatchObject({ aligned: true, alignment: 'in doubt' })
    // Where it has no place there is no alignment to speak of: `aligned` says so.
    expect(markData(REGION, 12, [scan('S1')])).toMatchObject({ aligned: false })
    expect(markData(REGION, 12, [scan('S1')])).not.toHaveProperty('alignment')
  })

  it('says of an orphaned region why, as far as that is known, and gives nothing of the mesh it was of (M6, M7)', () => {
    const orphaned = { ...REGION, anchorState: 'orphaned' } as Mark
    expect(describeMark(orphaned, { scans: [] })).toBe('M7 region on scan S1 [its scan is gone]: "wiring loom"')
    expect(describeMark(orphaned, { scans: [scan('S1')] })).toBe('M7 region on scan S1 [the mesh of its scan is no longer the one it was painted on: the user paints it again]: "wiring loom"')
    // The scans could not be read: which of the two is not known, and neither is said.
    expect(describeMark(orphaned)).toBe('M7 region on scan S1 [its scan is gone, or is no longer the mesh it was painted on]: "wiring loom"')
    const data = markData(orphaned, 12, [scan('S1', { print: at([100, 0, 5]) })]) as Record<string, unknown>
    for (const key of ['triangles', 'area', 'centroid', 'bbox', 'size', 'local', 'mesh', 'mask']) expect(data).not.toHaveProperty(key)
    expect(data).toMatchObject({ id: 'M7', anchorState: 'orphaned', lost: 'the mesh of its scan is no longer the one it was painted on: the user paints it again' })
    expect(describeMark({ ...REGION, author: 'agent', status: 'resolved' }, { tag: 'changed' })).toMatch(/^\(yours, changed\) M7 region on scan S1 \(its scan could not be read just now/)
  })
})

// The sweep's finding 5: what modelling leaves where it means nothing was told with four digits of itself.
describe('numbers that are zero within the part', () => {
  const part = { key: 'assembly:stand', name: 'stand', layout: 'assembly', bbox: { min: [-65, 0, -60], max: [65, 208, 60] } }
  const scene = { model: 'm.py', layouts: ['assembly'], parts: [part], seconds: 0, output: '' } as unknown as Scene
  const base = { author: 'user', status: 'draft', anchorState: 'ok', layout: 'assembly', revision: 1, camera: { position: [1, 1, 1], target: [0, 0, 0], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 }, createdAt: 't' }

  it('are told as 0: a coordinate or a size under a millionth of the extent of the part it is on', () => {
    const pin = { ...base, id: 'M1', kind: 'pin', note: 'flat', anchor: { point: [-0.000004772, 0, 20], part: 'stand', ref: 'stand/F2' } } as unknown as Mark
    expect(describeMark(pin, { scene })).toBe('M1 pin on stand/F2 at (0, 0, 20): "flat"')
    const stroke = { ...base, id: 'M3', kind: 'stroke', note: '', space: 'surface', anchor: { point: [-30, 0, -50], part: 'stand', ref: 'stand/F2' }, points: [[-30, 0, -50], [30, 0, -49.999996662]] } as unknown as Mark
    expect(describeMark(stroke, { scene })).toBe('M3 stroke on stand/F2 from (-30, 0, -50), 2 points, 60 × 0 × 0 mm')
    // What is small and meant is told: a hundredth of a millimetre is far over a millionth of 270 mm.
    expect(describeMark({ ...pin, anchor: { point: [0.012, 0, 20], part: 'stand', ref: 'stand/F2' } } as unknown as Mark, { scene })).toContain('at (0.012, 0, 20)')
    // Without the scene nothing is known of the extent, and the number is told as it is, to four digits.
    expect(describeMark(pin)).toContain('at (-0.000004772, 0, 20)')
    // On a part of a few millimetres the same number is a real coordinate.
    const small = { ...scene, parts: [{ ...part, bbox: { min: [0, 0, 0], max: [1, 1, 1] } }] } as unknown as Scene
    expect(describeMark(pin, { scene: small })).toContain('at (-0.000004772, 0, 20)')
  })

  it('tells a direction to two decimals, without what is left in it of nothing', () => {
    expect(directionText([-0.003691, 0, 0.9999932])).toBe('(0, 0, 1)')
    expect(directionText([0.0004, 0.70710678, 0.70710678])).toBe('(0, 0.71, 0.71)')
    expect(directionText([0.6, 0.8, 0])).toBe('(0.6, 0.8, 0)')
    // The side it is told from stays the one of its largest component.
    expect(directionText([0.0009, 0, -1])).toBe('(0, 0, 1)')
  })
})
