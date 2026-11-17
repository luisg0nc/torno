import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Sectioned } from '../../shared/geometry'
import { mainPlaneFrame } from '../../shared/planes'
import type { Scene } from '../../shared/scene'
import type { TracingCut, TracingPlane } from '../../shared/tracings'
import { KernelError } from '../kernel/client'
import type { AskedAnchor, NearestAnchor } from '../marks/reanchor'
import { Refusal } from '../refusal'
import { type OutlineDeps, Outlines } from './outline'
import { TracingStore } from './store'

let root: string
let dir: string
let store: TracingStore
let outlines: Outlines
let revision: number
let scene: Scene
type Fn = Mock<(...args: any[]) => any>
let query: Fn
let nearest: Fn
let told: Array<{ objectId: string; cut: TracingCut }>

const part = (name: string, layout: string, over: Record<string, unknown> = {}) => ({ name, layout, loc: { t: [0, 0, 0], q: [0, 0, 0, 1] }, bbox: { min: [0, 0, 0], max: [10, 10, 10] }, mesh: {}, ...over })
const sceneOf = (parts: unknown[]): Scene => ({ layouts: ['assembly', 'print'], parts }) as unknown as Scene

/** What the kernel says of a cut: one 10 x 10 loop of each part asked, shifted by `by` along u. */
function sectioned(args: { plane: { origin: [number, number, number]; normal: [number, number, number] }; axes: { x: [number, number, number]; y: [number, number, number] }; parts?: string[] }, by = 0): Sectioned {
  const names = args.parts ?? ['block']
  const square = [[by, 0], [by + 10, 0], [by + 10, 10], [by, 10]] as [number, number][]
  return {
    plane: { ...args.plane, x: args.axes.x, y: args.axes.y },
    bounds: { min: [by, 0], max: [by + 10, 10] },
    parts: names.map((name) => ({ part: name, area: 100, areaExact: true, open: 0, how: 'cross-section of the solid', loops: [{ points: square, closed: true, area: 100, areaExact: true, deflection: 0.01, corners: square, circles: [] }] }))
  }
}

const face = (origin: [number, number, number] = [5, 5, 10]): TracingPlane => ({ origin, x: [1, 0, 0], y: [0, 1, 0], label: 'plane through block/F31', from: { kind: 'face', ref: 'block/F31', revision: 1 } })
const main = (offset = 0): TracingPlane => ({ ...mainPlaneFrame('XZ', offset), from: { kind: 'main', axis: 'XZ', offset } })
const make = (plane: TracingPlane, extra: Record<string, unknown> = {}) => store.make('bracket', { name: '', layout: 'assembly', plane, ...extra }, 'person')
/** The kernel's `nearest`, saying the face is at height `z` (the same plane), or no face at all. */
const faceAt = (z: number | null) => async (_layout: string, anchors: AskedAnchor[]): Promise<NearestAnchor[]> =>
  anchors.map((a) => (z === null ? ({ part: a.part, found: true, ref: 'block/F4', point: [0, 0, 0], normal: [1, 0, 0], distance: 0.1, descriptor: 'plane, normal +X, 10 mm²' } as NearestAnchor) : ({ part: a.part, found: true, ref: 'block/F31', point: [1, 1, z], normal: [0, 0, 1], distance: Math.abs(z - a.point[2]), descriptor: `plane, normal +Z, z = ${z}, 100 mm²` } as NearestAnchor)))

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'torno-tracings-outline-'))
  dir = join(root, 'bracket')
  mkdirSync(dir)
  store = new TracingStore({ dirOf: (id) => (id === 'bracket' ? dir : undefined) })
  revision = 1
  scene = sceneOf([part('block', 'assembly'), part('lid', 'assembly'), part('block', 'print')])
  query = vi.fn(async (_id: string, name: string, args: any) => {
    if (name !== 'section') throw new Error(`unexpected ${name}`)
    return sectioned(args)
  })
  nearest = vi.fn(faceAt(10))
  told = []
  const deps: OutlineDeps = {
    tracings: store,
    build: (id) => (id === 'bracket' ? { revision, scene, blob: new Uint8Array(0) } : undefined),
    query: (id, name, args) => query(id, name, args),
    nearest: (_id, layout, anchors) => nearest(layout, anchors),
    log: () => {}
  }
  outlines = new Outlines(deps)
  outlines.on('outline', (m) => told.push(m))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('cut', () => {
  it('asks the kernel for the section of the last build with the tracing axes, snaps and the deflection', async () => {
    const t = await make(main(40), { parts: ['block'] })
    const cut = await outlines.cut('bracket', t.id)
    expect(query).toHaveBeenCalledWith('bracket', 'section', {
      layout: 'assembly',
      plane: { origin: [0, 40, 0], normal: [0, -1, 0] },
      axes: { x: [1, 0, 0], y: [0, 0, 1] },
      parts: ['block'],
      deflection: 0.01,
      snaps: true
    })
    expect(cut).toMatchObject({ tracing: 'T1', revision: 1 })
    expect((cut as TracingCut).cut.parts.map((p) => p.part)).toEqual(['block'])
    expect((cut as TracingCut).snaps.filter((s) => s.kind === 'corner')).toHaveLength(4)
  })

  it('asks for every part when the tracing names none, and only the parts the layout has when it names some', async () => {
    const all = await make(main())
    await outlines.cut('bracket', all.id)
    expect(query.mock.calls[0][2]).not.toHaveProperty('parts')
    const some = await make(main(), { parts: ['block', 'gone'] })
    await outlines.cut('bracket', some.id)
    expect(query.mock.calls[1][2].parts).toEqual(['block'])
  })

  it('cuts nothing, without asking, a tracing none of whose parts are in the layout', async () => {
    const t = await make(main(), { parts: ['gone'] })
    const cut = (await outlines.cut('bracket', t.id)) as TracingCut
    expect(query).not.toHaveBeenCalled()
    expect(cut.cut).toMatchObject({ parts: [], bounds: null })
    expect(cut.snaps).toEqual([])
  })

  it('keeps the last two cuts by revision, and asks again only for a build it has not cut', async () => {
    const t = await make(main())
    await outlines.cut('bracket', t.id)
    await outlines.cut('bracket', t.id)
    expect(query).toHaveBeenCalledTimes(1)
    revision = 2
    expect(((await outlines.cut('bracket', t.id)) as TracingCut).revision).toBe(2)
    revision = 3
    await outlines.cut('bracket', t.id)
    expect(query).toHaveBeenCalledTimes(3)
    expect(outlines.kept('bracket', t.id)).toEqual([3, 2])
  })

  it('asks again when the tracing is cut otherwise on the same build (its parts changed)', async () => {
    const t = await make(main())
    await outlines.cut('bracket', t.id)
    await store.edit('bracket', t.id, { parts: ['lid'] })
    await outlines.cut('bracket', t.id)
    expect(query).toHaveBeenCalledTimes(2)
  })

  it('is cut unspread: a part set 60 mm along X by the print layout is where the kernel cut it, and nothing is shifted by arranged', async () => {
    scene = sceneOf([part('block', 'assembly'), part('block', 'print', { arranged: [60, 0, 0], loc: { t: [60, 0, 0], q: [0, 0, 0, 1] } })])
    // The kernel cuts the layout as it is built: the part is 60 mm along, so its outline is at u = 60 to 70.
    query.mockImplementation(async (_id: string, _name: string, args: any) => sectioned(args, 60))
    const t = await store.make('bracket', { name: 'print', layout: 'print', plane: { ...mainPlaneFrame('XY', 5), from: { kind: 'main', axis: 'XY', offset: 5 } } }, 'person')
    const cut = (await outlines.cut('bracket', t.id)) as TracingCut
    expect(cut.cut.parts[0].loops[0].points).toEqual([[60, 0], [70, 0], [70, 10], [60, 10]])
    expect(cut.snaps.filter((s) => s.kind === 'corner').map((s) => s.uv)).toEqual([[60, 0], [70, 0], [70, 10], [60, 10]])
    expect(JSON.stringify(query.mock.calls[0][2])).not.toMatch(/arranged|60/)
  })

  it('offers the vertices of the parts drawn, with the part loc applied', async () => {
    const points = new Float32Array([0, 0, 0, 0, 0, 5])
    const blob = new Uint8Array(points.buffer.slice(0))
    scene = sceneOf([part('block', 'assembly', { loc: { t: [20, 0, 0], q: [0, 0, 0, 1] }, mesh: { points: { offset: 0, length: 24 }, circles: { offset: 0, length: 0 } } })])
    const deps: OutlineDeps = { tracings: store, build: () => ({ revision, scene, blob }), query: (id, name, args) => query(id, name, args), nearest: (_id, layout, anchors) => nearest(layout, anchors), log: () => {} }
    const own = new Outlines(deps)
    const t = await make({ ...mainPlaneFrame('XY', 0), from: { kind: 'main', axis: 'XY', offset: 0 } })
    const cut = (await own.cut('bracket', t.id)) as TracingCut
    expect(cut.snaps.filter((s) => s.kind === 'vertex')).toEqual([
      { kind: 'vertex', uv: [20, 0], part: 'block', ref: 'block/V0' },
      { kind: 'vertex', uv: [20, 0], part: 'block', ref: 'block/V1', projected: true }
    ])
  })

  it('refuses in words: no such tracing, no build, a layout the build lacks, a kernel that cannot', async () => {
    const t = await make(main())
    expect(await outlines.cut('bracket', 'T9')).toEqual(new Refusal('no tracing T9; tracings: T1'))
    revision = 1
    const lacking = await store.make('bracket', { name: '', layout: 'elsewhere', plane: main() }, 'person')
    expect(await outlines.cut('bracket', lacking.id)).toBeInstanceOf(Refusal)
    query.mockRejectedValueOnce(new KernelError('bad_request', 'the plane has no normal'))
    expect(await outlines.cut('bracket', t.id)).toEqual(new Refusal('the plane has no normal'))
    const none = new Outlines({ tracings: store, build: () => undefined, query: query as never, nearest: (_id, layout, anchors) => nearest(layout, anchors), log: () => {} })
    expect(await none.cut('bracket', t.id)).toEqual(new Refusal('bracket has not been built successfully yet, so there is no outline to cut'))
  })

  it('refuses an answer that is not a section', async () => {
    query.mockResolvedValueOnce({ nonsense: true })
    const t = await make(main())
    expect(await outlines.cut('bracket', t.id)).toBeInstanceOf(Refusal)
  })

  it('refuses, and keeps nothing, when a newer build lands while it is cut', async () => {
    const t = await make(main())
    query.mockImplementationOnce(async (_id: string, _name: string, args: any) => {
      revision = 2
      return sectioned(args)
    })
    expect(await outlines.cut('bracket', t.id)).toBeInstanceOf(Refusal)
    expect(outlines.kept('bracket', t.id)).toEqual([])
  })
})

describe('recut', () => {
  it('cuts only the tracings that are shown, and tells the window the build each is of', async () => {
    const one = await make(main(0))
    const two = await make(main(20))
    outlines.shown('bracket', [one.id])
    revision = 4
    expect(await outlines.recut('bracket')).toBe(true)
    expect(query).toHaveBeenCalledTimes(1)
    expect(told.map((m) => [m.objectId, m.cut.tracing, m.cut.revision])).toEqual([['bracket', 'T1', 4]])
    // The other is cut when it is next asked, on the build it is asked for.
    expect(((await outlines.cut('bracket', two.id)) as TracingCut).revision).toBe(4)
    outlines.shown('bracket', [one.id, two.id])
    revision = 5
    await outlines.recut('bracket')
    expect(told.map((m) => m.cut.tracing)).toEqual(['T1', 'T1', 'T2'])
  })

  it('keeps of what is shown only what is a tracing id, and a recut passes over a tracing that is not there', async () => {
    await make(main())
    outlines.shown('bracket', ['T1', 'T7', '../x', 4, null] as unknown[] as string[])
    expect(outlines.shownOf('bracket')).toEqual(['T1', 'T7'])
    // T7 is no tracing: a recut cuts T1 and passes it over.
    revision = 2
    expect(await outlines.recut('bracket')).toBe(true)
    expect(told.map((m) => m.cut.tracing)).toEqual(['T1'])
  })

  it('moves the origin of a face tracing 0.3 mm along its normal, leaves x and y, and recuts it', async () => {
    const t = await make(face())
    outlines.shown('bracket', [t.id])
    nearest.mockImplementation(faceAt(10.3))
    revision = 2
    expect(await outlines.recut('bracket')).toBe(true)
    const [now] = (await store.list('bracket')).tracings
    expect(now.plane.origin).toEqual([5, 5, 10.3])
    expect(now.plane.x).toEqual([1, 0, 0])
    expect(now.plane.y).toEqual([0, 1, 0])
    expect(now.lost).toBeUndefined()
    expect(query.mock.calls[0][2].plane.origin).toEqual([5, 5, 10.3])
    expect(told.map((m) => m.cut.revision)).toEqual([2])
  })

  it('names the face by the ref it has now, and the build, when the model numbers it otherwise', async () => {
    await make(face())
    nearest.mockImplementation(async (_layout: string, anchors: AskedAnchor[]) => anchors.map((a) => ({ part: a.part, found: true, ref: 'block/F12', point: [1, 1, 10], normal: [0, 0, 1], distance: 0, descriptor: 'plane, normal +Z, z = 10, 100 mm²' }) as NearestAnchor))
    revision = 6
    await outlines.recut('bracket')
    expect((await store.list('bracket')).tracings[0].plane.from).toEqual({ kind: 'face', ref: 'block/F12', revision: 6 })
    // Lost, it is still said by that ref.
    nearest.mockImplementation(faceAt(null))
    revision = 7
    await outlines.recut('bracket')
    expect((await store.list('bracket')).tracings[0].lost).toBe('block/F12 is not in this plane any more')
  })

  it('follows the face of a tracing that is not shown too, so that it is where it should be when asked', async () => {
    const t = await make(face())
    nearest.mockImplementation(faceAt(10.3))
    await outlines.recut('bracket')
    expect(query).not.toHaveBeenCalled()
    expect((await store.list('bracket')).tracings[0].plane.origin).toEqual([5, 5, 10.3])
    expect(((await outlines.cut('bracket', t.id)) as TracingCut).cut.plane.origin).toEqual([5, 5, 10.3])
  })

  it('asks the kernel once for all the face tracings of a layout', async () => {
    await make(face())
    await make(face([5, 5, 20]))
    await outlines.recut('bracket')
    expect(nearest).toHaveBeenCalledTimes(1)
  })

  it('says a face that is gone is not in this plane any more, leaves the origin, and clears it when the face is back', async () => {
    const t = await make(face())
    outlines.shown('bracket', [t.id])
    nearest.mockImplementation(faceAt(null))
    revision = 2
    await outlines.recut('bracket')
    let [now] = (await store.list('bracket')).tracings
    expect(now.lost).toBe('block/F31 is not in this plane any more')
    expect(now.plane.origin).toEqual([5, 5, 10])
    // It is still cut, in the plane it has.
    expect(told.map((m) => m.cut.revision)).toEqual([2])
    nearest.mockImplementation(faceAt(10))
    revision = 3
    await outlines.recut('bracket')
    ;[now] = (await store.list('bracket')).tracings
    expect(now.lost).toBeUndefined()
  })

  it('writes nothing when a face did not move', async () => {
    await make(face())
    const changed = vi.fn()
    store.on('changed', changed)
    revision = 2
    await outlines.recut('bracket')
    expect(changed).not.toHaveBeenCalled()
  })

  it('does nothing and says all is well for a project with no build', async () => {
    await make(main())
    const none = new Outlines({ tracings: store, build: () => undefined, query: query as never, nearest: (_id, layout, anchors) => nearest(layout, anchors), log: () => {} })
    expect(await none.recut('bracket')).toBe(true)
  })

  it('says busy when the kernel is, and false when it failed otherwise, and tells the window what it could cut', async () => {
    const one = await make(main(0))
    const two = await make(main(20))
    outlines.shown('bracket', [one.id, two.id])
    let n = 0
    query.mockImplementation(async (_id: string, _name: string, args: any) => {
      n += 1
      if (n === 1) throw new KernelError('timeout', 'the kernel is still busy with a query it did not answer')
      return sectioned(args)
    })
    expect(await outlines.recut('bracket')).toBe('busy')
    expect(told.map((m) => m.cut.tracing)).toEqual(['T2'])
    query.mockRejectedValue(new Error('the worker died'))
    revision = 2
    expect(await outlines.recut('bracket')).toBe(false)
    nearest.mockRejectedValue(new KernelError('timeout', 'the kernel is still busy with a query it did not answer'))
    await make(face())
    expect(await outlines.recut('bracket')).toBe('busy')
  })

  it('drops what it found when a newer build lands meanwhile: nothing is moved or told', async () => {
    const t = await make(face())
    outlines.shown('bracket', [t.id])
    nearest.mockImplementation(async (layout: string, anchors: AskedAnchor[]) => {
      revision = 2
      scene = sceneOf([part('block', 'assembly')])
      return faceAt(10.3)(layout, anchors)
    })
    expect(await outlines.recut('bracket')).toBe(true)
    expect((await store.list('bracket')).tracings[0].plane.origin).toEqual([5, 5, 10])
    expect(told).toEqual([])
  })

  it('goes on when a tracing was removed meanwhile', async () => {
    const t = await make(face())
    nearest.mockImplementation(async (layout: string, anchors: AskedAnchor[]) => {
      await store.remove('bracket', t.id, 'person')
      return faceAt(10.3)(layout, anchors)
    })
    expect(await outlines.recut('bracket')).toBe(true)
  })
})

describe('forget', () => {
  it('lets go of what was cut and what is shown', async () => {
    const t = await make(main())
    outlines.shown('bracket', [t.id])
    await outlines.cut('bracket', t.id)
    outlines.forget()
    expect(outlines.shownOf('bracket')).toEqual([])
    expect(outlines.kept('bracket', t.id)).toEqual([])
  })
})
