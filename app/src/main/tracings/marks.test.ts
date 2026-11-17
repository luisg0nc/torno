import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Anchor, Mark, NewMark, PinMark, SketchMark } from '../../shared/marks'
import type { TracingPlane, TracingsFile } from '../../shared/tracings'
import { describeMark } from '../marks/describe'
import { MarkStore } from '../marks/store'
import { Refusal } from '../refusal'
import { checkOnTracing, onTracingWords, placeOnTracing, tiePin, withUv } from './marks'
import { TracingStore } from './store'

const CAMERA = { position: [100, -100, 80], target: [0, 0, 10], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 }
const BASE = { author: 'user', note: '', layout: 'assembly', revision: 1, camera: CAMERA } as const

/** T1: the XY plane at z = 10, u along X and v along Y. */
const FRAME: TracingPlane = { origin: [0, 0, 10], x: [1, 0, 0], y: [0, 1, 0], label: 'plane through block/F31', from: { kind: 'face', ref: 'block/F31', revision: 1 } }
const file = (over: Partial<TracingsFile['tracings'][number]> = {}): TracingsFile => ({
  next: 2,
  tracings: [{ id: 'T1', by: 'person', name: '', layout: 'assembly', createdAt: '2026-11-17T10:00:00.000Z', plane: FRAME, layers: [], nextLayer: 1, ...over }]
})
const pin = (point: [number, number, number], over: Record<string, unknown> = {}): NewMark => ({ ...BASE, kind: 'pin', anchor: { point } as Anchor, tracing: 'T1', ...over }) as NewMark
const ink = (over: Partial<SketchMark> = {}): SketchMark =>
  ({
    ...BASE,
    id: 'M4',
    status: 'draft',
    anchorState: 'ok',
    createdAt: '2026-11-17T10:00:00.000Z',
    kind: 'sketch',
    name: '',
    take: 'rough',
    nextStroke: 2,
    tracing: 'T1',
    planes: [{ id: 1, origin: [0, 0, 10], x: [1, 0, 0], y: [0, 1, 0], label: 'T1', from: { kind: 'tracing', tracing: 'T1' } }],
    strokes: [{ id: 'k1', plane: 1, pen: 'free', revision: 1, points2d: [[1, 1], [5, 6]] }],
    ...over
  }) as SketchMark

describe('checkOnTracing', () => {
  it('says nothing of a mark that names no tracing', () => {
    expect(checkOnTracing({ ...pin([1, 2, 99]), tracing: undefined } as NewMark, file())).toBeNull()
  })

  it('keeps a pin that lies in the plane', () => {
    expect(checkOnTracing(pin([3, 4, 10]), file())).toBeNull()
  })

  it('keeps a pin 5e-7 mm off the plane and refuses one 2e-6 mm off', () => {
    expect(checkOnTracing(pin([3, 4, 10 + 5e-7]), file())).toBeNull()
    const refusal = checkOnTracing(pin([3, 4, 10 + 2e-6]), file())
    expect(refusal).toBeInstanceOf(Refusal)
    expect(refusal?.message).toMatch(/not in the plane of T1/)
  })

  it('refuses a tracing that is not there, saying which are', () => {
    expect(checkOnTracing(pin([0, 0, 10], { tracing: 'T7' }), file())?.message).toBe('no tracing T7; tracings: T1')
    expect(checkOnTracing(pin([0, 0, 10]), { next: 1, tracings: [] })?.message).toBe('no tracing T1; tracings: none')
  })

  it('refuses a tracing of another layout', () => {
    expect(checkOnTracing(pin([0, 0, 10], { layout: 'print' }), file())?.message).toBe('T1 is a tracing of the layout assembly, not print')
  })

  it('judges every point an arrow holds', () => {
    const arrow = { ...BASE, kind: 'arrow', tracing: 'T1', from: { point: [0, 0, 10] }, to: [5, 5, 10.1] } as NewMark
    expect(checkOnTracing(arrow, file())).toBeInstanceOf(Refusal)
  })

  it('keeps an ink sketch whose strokes are on the plane of the tracing', () => {
    expect(checkOnTracing(ink(), file())).toBeNull()
  })

  it('refuses an ink sketch with a plane that is not the tracing, or a stroke on the surface', () => {
    const other = ink({ planes: [{ id: 1, origin: [0, 0, 11], x: [1, 0, 0], y: [0, 1, 0], label: 'T1', from: { kind: 'tracing', tracing: 'T1' } }] })
    expect(checkOnTracing(other, file())?.message).toMatch(/plane 1 .* is not the plane of T1/)
    const named = ink({ planes: [{ id: 1, origin: [0, 0, 10], x: [1, 0, 0], y: [0, 1, 0], label: 'XY', from: { kind: 'main', axis: 'XY', offset: 10 } }] })
    expect(checkOnTracing(named, file())?.message).toMatch(/plane 1 .* is not the plane of T1/)
    const surface = ink({ strokes: [{ id: 'k1', pen: 'free', revision: 1, points: [[0, 0, 12]] }] })
    expect(checkOnTracing(surface, file())).toBeInstanceOf(Refusal)
  })

  it('judges a mark of a removed tracing against nothing but the tracing being there', () => {
    expect(checkOnTracing(pin([0, 0, 10]), { next: 3, tracings: [] })).toBeInstanceOf(Refusal)
  })
})

describe('withUv', () => {
  it('works out the uv of every point a mark holds, in the order of markPoints, and ignores what the caller sent', () => {
    const made = withUv({ ...pin([3, 4, 10]), uv: [[99, 99]] } as NewMark, file()) as PinMark
    expect(made.uv).toEqual([[3, 4]])
  })

  it('leaves a mark on no tracing, and a sketch, as they are', () => {
    const plain = { ...pin([3, 4, 10]), tracing: undefined } as NewMark
    expect(withUv(plain, file())).toBe(plain)
    const sketch = ink() as unknown as NewMark
    expect(withUv(sketch, file())).toBe(sketch)
  })
})

describe('onTracingWords', () => {
  it('says which tracing a mark is on, and that it was removed', () => {
    const mark = { tracing: 'T1' } as Mark
    expect(onTracingWords(mark, ['T1', 'T2'])).toBe(' · on T1')
    expect(onTracingWords(mark, ['T2'])).toBe(' · on T1 (removed)')
    expect(onTracingWords(mark, undefined)).toBe(' · on T1')
    expect(onTracingWords({} as Mark, ['T1'])).toBe('')
  })

  it('is in the line a mark is described by', () => {
    const mark = { ...BASE, id: 'M1', kind: 'pin', status: 'draft', anchorState: 'ok', createdAt: 'x', note: 'here', tracing: 'T1', anchor: { point: [3, 4, 10] } } as unknown as Mark
    expect(describeMark(mark, { tracings: ['T1'] })).toContain('on T1: "here"')
    expect(describeMark(mark, { tracings: [] })).toContain('on T1 (removed): "here"')
    expect(describeMark({ ...mark, tracing: undefined } as Mark, { tracings: [] })).not.toContain('T1')
  })
})

describe('tiePin', () => {
  const scene = { layouts: ['assembly'], parts: [{ name: 'block', layout: 'assembly', loc: { t: [0, 0, 0], q: [0, 0, 0, 1] }, bbox: { min: [0, 0, 0], max: [10, 10, 10] }, mesh: {} }] } as never
  const found = (distance: number) => ({ part: 'block', found: true, point: [3, 4, 10], normal: [0, 0, 1], ref: 'block/F31', distance, descriptor: 'plane, normal +Z, z = 10, 100 mm²' })

  it('ties a pin on the outline to the face under it, keeping the point where it was put', async () => {
    const asked: unknown[] = []
    const anchor = await tiePin(async (_layout, anchors) => (asked.push(anchors), [found(0.001)] as never), scene, 'assembly', [3, 4, 10])
    expect(anchor).toMatchObject({ point: [3, 4, 10], part: 'block', ref: 'block/F31', normal: [0, 0, 1], descriptor: 'plane, normal +Z, z = 10, 100 mm²' })
    expect(asked).toEqual([[{ part: 'block', point: [3, 4, 10] }]])
  })

  it('leaves a pin that is far from every face tied to no part', async () => {
    expect(await tiePin(async () => [found(4)] as never, scene, 'assembly', [3, 4, 10])).toEqual({ point: [3, 4, 10] })
  })

  it('leaves it tied to no part when the kernel cannot say', async () => {
    expect(await tiePin(async () => { throw new Error('busy') }, scene, 'assembly', [3, 4, 10])).toEqual({ point: [3, 4, 10] })
    expect(await tiePin(async () => [], { layouts: ['assembly'], parts: [] } as never, 'assembly', [3, 4, 10])).toEqual({ point: [3, 4, 10] })
  })
})

describe('placeOnTracing', () => {
  const scene = { layouts: ['assembly'], parts: [{ name: 'block', layout: 'assembly', loc: { t: [0, 0, 0], q: [0, 0, 0, 1] }, bbox: { min: [0, 0, 0], max: [10, 10, 10] }, mesh: {} }] } as never
  const near = { part: 'block', found: true, point: [3, 4, 10], normal: [0, 0, 1], ref: 'block/F31', distance: 0, descriptor: 'plane, normal +Z' }
  const deps = (over: Partial<Parameters<typeof placeOnTracing>[0]> = {}) => ({ tracings: { list: async () => file() }, nearest: async () => [near] as never, scene: () => ({ scene }), ...over })

  it('ties a pin on the outline to its face, checks it and gives it its uv', async () => {
    const made = (await placeOnTracing(deps(), 'bracket', pin([3, 4, 10]))) as PinMark
    expect(made.anchor).toMatchObject({ point: [3, 4, 10], part: 'block', ref: 'block/F31' })
    expect(made.uv).toEqual([[3, 4]])
  })

  it('keeps a pin inside the cut as a point in empty space', async () => {
    const made = (await placeOnTracing(deps({ nearest: async () => [{ ...near, distance: 3 }] as never }), 'bracket', pin([3, 4, 10]))) as PinMark
    expect(made.anchor).toEqual({ point: [3, 4, 10] })
    expect(made.uv).toEqual([[3, 4]])
  })

  it('refuses a pin off the plane, and a tracing that is not there', async () => {
    await expect(placeOnTracing(deps(), 'bracket', pin([3, 4, 10.5]))).rejects.toThrow(/not in the plane of T1/)
    await expect(placeOnTracing(deps({ tracings: { list: async () => ({ next: 1, tracings: [] }) } }), 'bracket', pin([3, 4, 10]))).rejects.toThrow('no tracing T1; tracings: none')
  })

  it('hands back a mark that names no tracing as it came, asking nothing', async () => {
    let asked = 0
    const plain = { ...pin([3, 4, 99]), tracing: undefined } as NewMark
    const out = await placeOnTracing(deps({ tracings: { list: async () => (asked++, file()) } }), 'bracket', plain)
    expect(out).toBe(plain)
    expect(asked).toBe(0)
  })
})

describe('marks that move with their tracing', () => {
  let root: string
  let tracings: TracingStore
  let marks: MarkStore

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'torno-tracing-marks-'))
    const dir = join(root, 'bracket')
    mkdirSync(dir)
    tracings = new TracingStore({ dirOf: (id) => (id === 'bracket' ? dir : undefined) })
    marks = new MarkStore({ dirOf: (id) => (id === 'bracket' ? dir : undefined), now: () => new Date('2026-11-17T10:00:00.000Z') })
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('after movePlane by 0.3 mm along the normal, every mark on the tracing has moved by it in one change, keeping its uv, and is in the plane', async () => {
    const t = await tracings.make('bracket', { name: '', layout: 'assembly', plane: FRAME }, 'person')
    const read = async (): Promise<TracingsFile> => tracings.list('bracket')
    await marks.add('bracket', withUv(pin([3, 4, 10]), await read()))
    await marks.add('bracket', withUv(pin([6, 2, 10], { note: 'again' }), await read()))
    // A mark of another tracing and a plain mark stay where they are.
    await marks.add('bracket', { ...BASE, kind: 'pin', anchor: { point: [1, 1, 3] } } as NewMark)
    const changes: number[] = []
    marks.on('changed', () => changes.push(1))

    const before = await tracings.list('bracket')
    const moved = await tracings.movePlane('bracket', t.id, { origin: [0, 0, 10.3] })
    await marks.followTracing('bracket', t.id, [0, 0, moved.plane.origin[2] - before.tracings[0].plane.origin[2]], moved.plane)

    const listed = await marks.list('bracket')
    expect(changes).toHaveLength(1)
    expect((listed[0] as PinMark).anchor.point[2]).toBeCloseTo(10.3, 12)
    expect((listed[1] as PinMark).anchor.point[2]).toBeCloseTo(10.3, 12)
    expect((listed[2] as PinMark).anchor.point).toEqual([1, 1, 3])
    expect(listed[0].uv).toEqual([[3, 4]])
    expect(listed[1].uv).toEqual([[6, 2]])
    expect(listed[2].uv).toBeUndefined()
    const now = await tracings.list('bracket')
    for (const mark of listed.slice(0, 2)) expect(checkOnTracing(mark, now)).toBeNull()
  })

  it('moves an ink sketch by its plane, its strokes in uv as they were', async () => {
    await tracings.make('bracket', { name: '', layout: 'assembly', plane: FRAME }, 'person')
    await marks.saveSketch('bracket', {
      objectId: 'bracket',
      layout: 'assembly',
      revision: 1,
      camera: CAMERA,
      name: '',
      note: '',
      take: 'rough',
      tracing: 'T1',
      planes: ink().planes,
      strokes: ink().strokes
    } as never)
    await marks.followTracing('bracket', 'T1', [0, 0, 0.3])
    const [sketch] = (await marks.list('bracket')) as SketchMark[]
    expect(sketch.tracing).toBe('T1')
    expect(sketch.planes[0].origin).toEqual([0, 0, 10.3])
    expect(sketch.planes[0].from).toEqual({ kind: 'tracing', tracing: 'T1' })
    expect(sketch.strokes[0].points2d).toEqual([[1, 1], [5, 6]])
  })

  it('leaves a mark that the move would take out of the plane where it is, and moves the others', async () => {
    await marks.add('bracket', pin([3, 4, 10]))
    // Never in the plane (a hand-edited marks.json): moving it with the plane cannot bring it there.
    await marks.add('bracket', pin([6, 2, 10.5]))
    await marks.followTracing('bracket', 'T1', [0, 0, 0.3], { ...FRAME, origin: [0, 0, 10.3] })
    const [first, second] = (await marks.list('bracket')) as PinMark[]
    expect(first.anchor.point[2]).toBeCloseTo(10.3, 12)
    expect(second.anchor.point).toEqual([6, 2, 10.5])
  })

  it('does not move a mark that is already in the new plane (a move asked twice)', async () => {
    await marks.add('bracket', pin([3, 4, 10.3]))
    await marks.followTracing('bracket', 'T1', [0, 0, 0.3], { ...FRAME, origin: [0, 0, 10.3] })
    expect(((await marks.list('bracket'))[0] as PinMark).anchor.point[2]).toBeCloseTo(10.3, 12)
  })

  it('moves nothing and writes nothing when no mark is on the tracing, or by nothing', async () => {
    await marks.add('bracket', pin([3, 4, 10], { tracing: undefined }))
    const changes: number[] = []
    marks.on('changed', () => changes.push(1))
    await marks.followTracing('bracket', 'T1', [0, 0, 0.3])
    await marks.followTracing('bracket', 'T1', [0, 0, 0])
    expect(changes).toEqual([])
  })

  it('a pin made while a round is open on its layout joins the round', async () => {
    await marks.startRound('bracket', { layout: 'assembly', build: 'h1', sources: 'abc', line: 'Review of h1' })
    const made = await marks.add('bracket', pin([3, 4, 10]))
    expect(made.round).toBe('R1')
  })

  it('keeps its tracing and uv through the marks file, and drops a tracing id that is none', async () => {
    await tracings.make('bracket', { name: '', layout: 'assembly', plane: FRAME }, 'person')
    const made = await marks.add('bracket', withUv(pin([3, 4, 10]), await tracings.list('bracket')))
    expect(made).toMatchObject({ tracing: 'T1', uv: [[3, 4]] })
    const odd = await marks.add('bracket', pin([3, 4, 10], { tracing: '../x', uv: [[1, 2]] }))
    expect(odd.tracing).toBeUndefined()
    expect(odd.uv).toBeUndefined()
  })
})
