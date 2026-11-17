import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { OffsetMark, SpanMark } from '../../shared/marks'
import type { PlaneSnap, TracingCut, TracingPlane } from '../../shared/tracings'
import { layerRevisions } from '../../shared/tracings'
import { describeMark } from '../marks/describe'
import { MarkStore } from '../marks/store'
import { Refusal } from '../refusal'
import { makeOffset, makeSpan, type MeasureDeps } from './measures'
import { TracingStore } from './store'

const CAMERA = { position: [100, -100, 80], target: [0, 0, 10], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 }
/** T1: the XZ plane at y = 0, u along X and v along Z. */
const FRAME: TracingPlane = { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 0, 1], label: 'XZ at y = 0.0 (u = +X, v = +Z)', from: { kind: 'main', axis: 'XZ', offset: 0 } }
const SNAPS: PlaneSnap[] = [
  { kind: 'corner', uv: [0, 0], part: 'block' },
  { kind: 'corner', uv: [30, 40], part: 'block' }
]

let root: string
let tracings: TracingStore
let marks: MarkStore
let revision: number | undefined
let cut: TracingCut | Refusal
const deps = (): MeasureDeps => ({ tracings, marks, outlines: { cut: async () => cut }, revision: () => revision })

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'torno-measures-'))
  const dir = join(root, 'bracket')
  mkdirSync(dir)
  tracings = new TracingStore({ dirOf: (id) => (id === 'bracket' ? dir : undefined) })
  marks = new MarkStore({ dirOf: (id) => (id === 'bracket' ? dir : undefined), now: () => new Date('2026-11-17T10:00:00.000Z') })
  await tracings.make('bracket', { name: '', layout: 'assembly', plane: FRAME }, 'person')
  await tracings.layer('bracket', 'T1', { make: { name: 'head bolts', colour: 'blue', shapes: [{ kind: 'circle', centre: [10, 5], radius: 3 }, { name: 'head bolt 3', kind: 'circle', centre: [20, 5], radius: 3 }] } }, 'agent')
  revision = 1
  cut = { tracing: 'T1', revision: 1, cut: { plane: { origin: [0, 0, 0], normal: [0, -1, 0], x: [1, 0, 0], y: [0, 0, 1] }, parts: [], bounds: null }, snaps: SNAPS }
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const end = (uv: [number, number], over: object = {}): object => ({ uv, on: 'tracing', ...over })
const corner = (uv: [number, number]): object => end(uv, { snap: { kind: 'corner', uv, part: 'block' } })

describe('makeSpan', () => {
  it('keeps a span between two snapped corners as exact on the build, its points the plane\'s in the object frame', async () => {
    const made = (await makeSpan(deps(), 'bracket', { tracing: 'T1', a: corner([0, 0]), b: corner([30, 40]), camera: CAMERA })) as SpanMark
    expect(made).toMatchObject({ id: 'M1', kind: 'span', author: 'user', tracing: 'T1', layout: 'assembly', revision: 1, value: 50, exact: true, how: 'exact on build 1', measuredOn: 1, status: 'draft' })
    expect(made.b.point).toEqual([30, 0, 40])
    expect(made.uv).toEqual([[0, 0], [30, 40]])
    expect(describeMark(made, { revision: 1, tracings: ['T1'] })).toBe('M1 · span on T1: 50 mm, exact on build 1')
  })

  it('takes the end\'s point from the kernel, and refuses one 0.02 mm off it', async () => {
    const made = (await makeSpan(deps(), 'bracket', { tracing: 'T1', a: corner([0, 0]), b: end([30.005, 40], { snap: { kind: 'corner', uv: [30, 40], part: 'block' } }), camera: CAMERA })) as SpanMark
    expect(made.b.uv).toEqual([30, 40])
    await expect(makeSpan(deps(), 'bracket', { tracing: 'T1', a: corner([0, 0]), b: end([30.02, 40], { snap: { kind: 'corner', uv: [30, 40], part: 'block' } }), camera: CAMERA })).rejects.toThrow(/0\.02 mm/)
    expect(await marks.list('bracket')).toHaveLength(1)
  })

  it('keeps a free span as ≈, says freehand, and needs no outline; the window\'s claim to be exact is not taken', async () => {
    cut = new Refusal('no build yet')
    const made = (await makeSpan(deps(), 'bracket', { tracing: 'T1', a: end([0, 0]), b: end([3, 4]), camera: CAMERA, ...{ exact: true, value: 99, how: 'exact', measuredOn: 7 } })) as SpanMark
    expect(made).toMatchObject({ value: 5, exact: false, how: 'freehand', measuredOn: 1 })
  })

  it('refuses a snapped end when the outline cannot be had, a tracing that is not there, and a project with no build', async () => {
    cut = new Refusal('no build yet')
    await expect(makeSpan(deps(), 'bracket', { tracing: 'T1', a: corner([0, 0]), b: corner([30, 40]), camera: CAMERA })).rejects.toThrow('no build yet')
    await expect(makeSpan(deps(), 'bracket', { tracing: 'T9', a: end([0, 0]), b: end([3, 4]), camera: CAMERA })).rejects.toThrow(/no tracing T9/)
    revision = undefined
    await expect(makeSpan(deps(), 'bracket', { tracing: 'T1', a: end([0, 0]), b: end([3, 4]), camera: CAMERA })).rejects.toThrow(/build/)
  })

  it('never joins a round and has no intent, even when one is sent', async () => {
    const made = await makeSpan(deps(), 'bracket', { tracing: 'T1', a: end([0, 0]), b: end([3, 4]), camera: CAMERA, ...{ intent: 'want' } })
    expect(made).not.toHaveProperty('intent')
    expect(made.round).toBeUndefined()
  })

  it('is never measured again: a later build leaves it as it was', async () => {
    await makeSpan(deps(), 'bracket', { tracing: 'T1', a: end([0, 0]), b: end([3, 4]), camera: CAMERA })
    await marks.reanchor('bracket', [])
    const [one] = (await marks.list('bracket')) as SpanMark[]
    expect(one).toMatchObject({ value: 5, how: 'freehand', measuredOn: 1 })
    expect(describeMark(one, { revision: 2, tracings: ['T1'] })).toBe('M1 · span on T1: ≈ 5 mm (freehand), measured on build 1')
  })
})

describe('makeOffset', () => {
  const drag = (over: object = {}): object => ({ tracing: 'T1', layer: 1, shape: 1, by: [-1.8, 0.6], camera: CAMERA, ...over })

  it('keeps what main finds: the shape as it was, where it was and is in the object frame, the layer and its revision', async () => {
    const made = (await makeOffset(deps(), 'bracket', drag())) as OffsetMark
    expect(made).toMatchObject({
      id: 'M1',
      kind: 'offset',
      tracing: 'T1',
      layout: 'assembly',
      layer: { id: 1, name: 'head bolts', revision: 1 },
      shape: { index: 1, name: 'head bolt 3' },
      was: { name: 'head bolt 3', kind: 'circle', centre: [20, 5], radius: 3 },
      by: [-1.8, 0.6],
      from: [20, 0, 5],
      to: [18.2, 0, 5.6]
    })
    expect(made.uv).toEqual([[20, 5], [18.2, 5.6]])
  })

  it('is never exact and never judged by a build, and has no intent or round', async () => {
    const made = (await makeOffset(deps(), 'bracket', drag({ intent: 'dont' }))) as OffsetMark
    expect(made.anchorState).toBe('ok')
    expect(made).not.toHaveProperty('intent')
    expect(made).not.toHaveProperty('exact')
    await marks.reanchor('bracket', [{ id: made.id, judged: [], anchors: [], anchorState: 'orphaned' }])
    expect((await marks.list('bracket'))[0].anchorState).toBe('ok')
  })

  it('moves a polyline by its centroid, and a shape dragged again changes the draft\'s by', async () => {
    await tracings.layer('bracket', 'T1', { make: { name: 'plate', colour: 'teal', shapes: [{ kind: 'polyline', points: [[0, 0], [4, 0], [4, 2], [0, 2]], closed: true }] } }, 'agent')
    const first = (await makeOffset(deps(), 'bracket', drag({ layer: 2, shape: 0, by: [1, 0] }))) as OffsetMark
    expect(first.from).toEqual([2, 0, 1])
    expect(first.shape.name).toBe('')
    const again = await makeOffset(deps(), 'bracket', drag({ layer: 2, shape: 0, by: [1.5, 0.5] }))
    expect(again.id).toBe(first.id)
    expect(await marks.list('bracket')).toHaveLength(1)
  })

  it('refuses a layer or a shape that is not there, a move that is not two numbers and a move by nothing', async () => {
    await expect(makeOffset(deps(), 'bracket', drag({ layer: 7 }))).rejects.toThrow(/no layer 7/)
    await expect(makeOffset(deps(), 'bracket', drag({ shape: 5 }))).rejects.toThrow(/no shape 6/)
    await expect(makeOffset(deps(), 'bracket', drag({ by: [Number.NaN, 1] }))).rejects.toThrow(/two finite numbers/)
    await expect(makeOffset(deps(), 'bracket', drag({ by: [0, 0] }))).rejects.toThrow(/nothing/)
    await expect(makeOffset(deps(), 'bracket', drag({ tracing: 'T9' }))).rejects.toThrow(/no tracing T9/)
  })

  it('says "layer changed since" after add_layer replaces the layer, and keeps what the shape was', async () => {
    const made = (await makeOffset(deps(), 'bracket', drag())) as OffsetMark
    const layers = async (): Promise<Record<string, number>> => layerRevisions((await tracings.list('bracket')).tracings)
    expect(describeMark(made, { layers: await layers() })).not.toContain('changed since')
    // Claude replaces the layer by its name, with shapes elsewhere.
    await tracings.layer('bracket', 'T1', { make: { name: 'head bolts', colour: 'blue', shapes: [{ kind: 'circle', centre: [50, 50], radius: 3 }] } }, 'agent')
    const line = describeMark((await marks.list('bracket'))[0], { layers: await layers() })
    expect(line).toContain('layer changed since')
    expect(line).toContain('was circle centre (20, 5) radius 3')
  })
})
