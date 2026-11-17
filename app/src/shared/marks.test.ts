import { describe, expect, it } from 'vitest'
import { type Anchor, type Mark, type NoteMark, type SketchMark, MAIN_ONLY_KEYS, isUnchecked, markAnchors, markIntent, markPoints, sketchStrokePoints, splitStrokeRef, STROKE_ID, strokeRef, strokeSamples, translated } from './marks'

const ANCHOR: Anchor = { point: [1, 2, 20], part: 'base', ref: 'base/F4' }
const note = (over: object = {}): NoteMark =>
  ({
    id: 'M4',
    kind: 'note',
    author: 'user',
    note: 'too thin here',
    status: 'draft',
    anchorState: 'ok',
    layout: 'assembly',
    revision: 12,
    camera: { position: [100, -100, 80], target: [0, 0, 10], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 },
    createdAt: '2026-11-16T10:00:00.000Z',
    picture: 'n-0123456789ab.png',
    ink: 'n-0123456789ab.ink.png',
    size: { w: 800, h: 600 },
    strokes: [],
    inkColour: '#ff00ff',
    labels: [],
    under: [],
    references: [],
    ...over
  }) as NoteMark

describe('a note mark', () => {
  it('has its anchor as its only anchor, and none when the ink lay over no face', () => {
    expect(markAnchors(note({ anchor: ANCHOR }))).toEqual([ANCHOR])
    expect(markAnchors(note())).toEqual([])
  })

  it('is unchecked like a pick: open, and not checked against the last build', () => {
    expect(isUnchecked(note({ anchor: ANCHOR }), 3)).toBe(true)
    expect(isUnchecked(note({ anchor: ANCHOR, checkedRevision: 3 }), 3)).toBe(false)
    expect(isUnchecked(note({ anchor: ANCHOR, status: 'resolved' }), 3)).toBe(false)
  })

  it('moves only its anchor when its part is spread otherwise', () => {
    expect(translated(note({ anchor: ANCHOR }), [0, 0, 5]).anchor?.point).toEqual([1, 2, 25])
    expect(translated(note(), [0, 0, 5])).toEqual(note())
  })

  it('is drawn in no view: no point to keep in', () => {
    expect(markPoints(note({ anchor: ANCHOR }))).toEqual([])
  })
})

const sketch = (over: object = {}): SketchMark =>
  ({
    id: 'M7',
    kind: 'sketch',
    author: 'user',
    note: '',
    status: 'draft',
    anchorState: 'ok',
    layout: 'assembly',
    revision: 12,
    camera: { position: [100, -100, 80], target: [0, 0, 10], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 },
    createdAt: '2026-11-17T10:00:00.000Z',
    name: 'Hose',
    take: 'rough',
    planes: [{ id: 1, origin: [0, 40, 0], x: [1, 0, 0], y: [0, 0, 1], label: 'XZ at y = 40.0', from: { kind: 'main', axis: 'XZ', offset: 40 } }],
    strokes: [],
    nextStroke: 1,
    ...over
  }) as SketchMark

const line = (n: number): Array<[number, number, number]> => Array.from({ length: n }, (_, i) => [i, 0, 20])

describe('a sketch mark', () => {
  it('has its anchor as its only anchor, and none when it was drawn in empty space', () => {
    expect(markAnchors(sketch({ anchor: ANCHOR }))).toEqual([ANCHOR])
    expect(markAnchors(sketch())).toEqual([])
  })

  it('has no samples of a plane stroke, and at most 8 of each surface stroke, the last kept', () => {
    const onPlane = { plane: 1, pen: 'free', points2d: [[0, 0], [1, 1]], revision: 12 }
    const surface = { pen: 'free', points: line(100), revision: 12 }
    const mark = sketch({ anchor: { ...ANCHOR, point: [0, 0, 20] }, strokes: [onPlane, surface] })
    const samples = strokeSamples(mark)
    expect(samples).toHaveLength(8)
    expect(samples[7]).toEqual([99, 0, 20])
    expect(samples).not.toContainEqual([0, 0, 20])
    expect(strokeSamples(sketch({ strokes: [onPlane] }))).toEqual([])
  })

  it('samples a stroke other than the first from its first point, since only the first stroke carries the anchor', () => {
    const first = { pen: 'free', points: line(3), revision: 12 }
    const second = { pen: 'points', points: [[50, 0, 20], [60, 0, 20]], revision: 12 }
    const samples = strokeSamples(sketch({ anchor: { ...ANCHOR, point: [0, 0, 20] }, strokes: [first, second] }))
    expect(samples).toEqual([[1, 0, 20], [2, 0, 20], [50, 0, 20], [60, 0, 20]])
  })

  it('looks at no more than 8 strokes, the first and the last among them', () => {
    const strokes = Array.from({ length: 30 }, (_, i) => ({ pen: 'points', points: [[i * 10, 0, 20]], revision: 12 }))
    const samples = strokeSamples(sketch({ anchor: { ...ANCHOR, point: [0, 0, 20] }, strokes }), 1)
    expect(samples.length).toBeLessThanOrEqual(8)
    expect(samples[samples.length - 1]).toEqual([290, 0, 20])
  })

  it('gives the points of a stroke in the object frame, of its plane or its own', () => {
    const mark = sketch({ strokes: [{ plane: 1, pen: 'free', points2d: [[2, 3]], revision: 12 }, { pen: 'free', points: [[1, 2, 3]], revision: 12 }] })
    expect(sketchStrokePoints(mark, mark.strokes[0])).toEqual([[2, 40, 3]])
    expect(sketchStrokePoints(mark, mark.strokes[1])).toEqual([[1, 2, 3]])
    expect(sketchStrokePoints(mark, { id: 'k1', plane: 9, pen: 'free', points2d: [[1, 1]], revision: 1 })).toEqual([])
  })

  it('moves the origins of its planes, its surface points and its anchor, and leaves plane points alone', () => {
    const mark = sketch({ anchor: ANCHOR, strokes: [{ plane: 1, pen: 'free', points2d: [[2, 3]], revision: 12 }, { pen: 'free', points: [[1, 2, 3]], revision: 12 }] })
    const moved = translated(mark, [0, 0, 5])
    expect(moved.planes[0].origin).toEqual([0, 40, 5])
    expect(moved.planes[0].from).toEqual(mark.planes[0].from)
    expect(moved.strokes[0].points2d).toEqual([[2, 3]])
    expect(moved.strokes[1].points).toEqual([[1, 2, 8]])
    expect(moved.anchor?.point).toEqual([1, 2, 25])
  })

  it('is kept in view by every point of it', () => {
    const mark = sketch({ strokes: [{ plane: 1, pen: 'free', points2d: [[2, 3]], revision: 12 }, { pen: 'free', points: [[1, 2, 3]], revision: 12 }] })
    expect(markPoints(mark)).toEqual([[2, 40, 3], [1, 2, 3]])
  })

  it('is unchecked like a pick: open, and not checked against the last build', () => {
    expect(isUnchecked(sketch(), 3)).toBe(true)
    expect(isUnchecked(sketch({ checkedRevision: 3 }), 3)).toBe(false)
  })
})

describe('markIntent', () => {
  const pick = (over: object = {}): Mark => ({ ...note(), kind: 'pick', target: 'face', anchor: ANCHOR, ...over }) as unknown as Mark
  const shape = (over: object = {}): Mark => ({ ...note(), kind: 'shape', shape: 'box', intent: 'add', position: [0, 0, 0], rotation: [0, 0, 0, 1], size: [1, 1, 1], ...over }) as unknown as Mark

  it('is what a pick says of itself', () => {
    expect(markIntent(pick({ intent: 'want' }))).toBe('want')
    expect(markIntent(pick({ intent: 'dont' }))).toBe('dont')
    expect(markIntent(pick())).toBeNull()
  })

  it("reads a person's shape: add is want, remove is don't want, the rest plain", () => {
    expect(markIntent(shape({ intent: 'add' }))).toBe('want')
    expect(markIntent(shape({ intent: 'remove' }))).toBe('dont')
    expect(markIntent(shape({ intent: 'keep-out' }))).toBeNull()
    expect(markIntent(shape({ intent: 'reference' }))).toBeNull()
  })

  it("is null for every mark of the agent's, a shape's add and remove included", () => {
    expect(markIntent(shape({ author: 'agent', intent: 'add' }))).toBeNull()
    expect(markIntent(shape({ author: 'agent', intent: 'remove' }))).toBeNull()
    expect(markIntent(pick({ author: 'agent', intent: 'want' }))).toBeNull()
  })

  it('is main only that says which round a mark is in and what was judged of it', () => {
    expect(MAIN_ONLY_KEYS).toContain('round')
    expect(MAIN_ONLY_KEYS).toContain('judged')
  })
})

describe('a stroke of a sketch, as a set names it', () => {
  it('is the sketch, a slash and the stroke id, and reads back', () => {
    expect(strokeRef('M7', 'k3')).toBe('M7/k3')
    expect(splitStrokeRef('M7/k3')).toEqual({ mark: 'M7', stroke: 'k3' })
    for (const bad of ['M7', 'M7/3', 'M7/k0', 'M7/k1000000', 'M7/k3/x', 'N7/k3', 'M0/k3', '/k3', 'M7/K3']) expect(splitStrokeRef(bad), bad).toBeNull()
  })

  it('has an id of k and a number of one to six digits, with no leading zero', () => {
    for (const ok of ['k1', 'k42', 'k999999']) expect(STROKE_ID.test(ok), ok).toBe(true)
    for (const bad of ['k', 'k0', 'k01', 'k1000000', 'k-1', 'k1 ', 'x1']) expect(STROKE_ID.test(bad), bad).toBe(false)
  })
})
