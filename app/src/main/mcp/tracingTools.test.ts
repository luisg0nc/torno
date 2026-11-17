import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { BuildState } from '../../shared/build'
import type { Described, Sectioned } from '../../shared/geometry'
import type { Scene } from '../../shared/scene'
import { MOST_SHAPES, type TracingPictureRequest, type TracingPictureResult, type TracingsFile } from '../../shared/tracings'
import { checkedImage } from '../images'
import { Outlines } from '../tracings/outline'
import { tracingHandlers } from '../tracings/ipc'
import { TracingStore } from '../tracings/store'
import { TOOLS, refusedKeys } from './schemas'
import { addLayerTool, addTracingTool, tracingsTool } from './tracingTools'
import type { ToolDeps } from './tools'

// `tracings`, `add_tracing` and `add_layer`: through a real store and the real handlers over a folder, a kernel that answers `describe`,
// `selectors` and `section`, and a window that draws pictures.

const OK: BuildState = { objectId: 'bracket', status: 'ok', revision: 7, seconds: 1, stale: false }
const part = (name: string, layout: string, tags?: Record<string, { faces?: number[] }>) => ({ name, layout, loc: { t: [0, 0, 0], q: [0, 0, 0, 1] }, bbox: { min: [0, 0, 0], max: [40, 30, 10] }, mesh: {}, ...(tags ? { tags } : {}) })
const scene = { model: 'm.py', layouts: ['assembly', 'print'], parts: [part('block', 'assembly'), part('lid', 'assembly'), part('block', 'print')] } as unknown as Scene

let root: string
let dir: string
let store: TracingStore
let deps: ToolDeps
let revision: number
let kernel: (name: string, args: Record<string, any>) => unknown
let drawn: TracingPictureRequest[]
let draw: (req: TracingPictureRequest) => Promise<TracingPictureResult>

const text = (r: { content: Array<{ type: string; text?: string }> }): string => r.content.map((c) => c.text ?? '').join('\n')
const json = (r: { content: Array<{ type: string; text?: string }> }): Record<string, any> => JSON.parse(r.content.find((c) => c.type === 'text')!.text!)
const onDisk = (): TracingsFile => JSON.parse(readFileSync(join(dir, '.torno', 'tracings.json'), 'utf8'))
const png = (w: number, h: number): Uint8Array => {
  const b = new Uint8Array(33)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  new DataView(b.buffer).setUint32(16, w)
  new DataView(b.buffer).setUint32(20, h)
  return b
}
const loop = (points: [number, number][], over: Record<string, unknown> = {}) => ({ points, closed: true, area: 1200, areaExact: true, deflection: 0.01, ...over })
const ring = (n: number, r: number): [number, number][] => Array.from({ length: n }, (_, i) => [r * Math.cos((2 * Math.PI * i) / n), r * Math.sin((2 * Math.PI * i) / n)])
/** What the kernel cuts of the parts: a plate with a hole, by default. */
let parts: Sectioned['parts']
const PLATE: Sectioned['parts'] = [
  { part: 'block', loops: [loop([[0, 0], [40, 0], [40, 30], [0, 30]]), loop([[5, 5], [15, 5], [15, 15], [5, 15]], { area: -100, areaExact: false })], area: 1100, areaExact: false, open: 0, how: '' }
]
/** The axes the kernel gives a plane: +X and the normal's cross with it, or the layout's own for a plane across Y. */
const planeOf = (args: Record<string, any>) => (Math.abs(args.plane.normal[2]) > 0.9 ? { ...args.plane, x: [1, 0, 0], y: [0, Math.sign(args.plane.normal[2]), 0] } : { ...args.plane, x: [1, 0, 0], y: [0, 0, 1] })

const square = [{ kind: 'polyline', points: [[0, 0], [10, 0], [10, 10], [0, 10]], closed: true, name: 'frame' }]
const person = () => store.make('bracket', { name: 'Front', layout: 'assembly', plane: { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 0, 1], label: 'XZ at y = 0.0 (u = +X, v = +Z)', from: { kind: 'main', axis: 'XZ', offset: 0 } } }, 'person')

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'torno-tracing-tools-'))
  dir = join(root, 'bracket')
  mkdirSync(dir)
  revision = 7
  parts = PLATE
  drawn = []
  draw = async (req) => (drawn.push(req), { png: png(req.size, Math.round(req.size * 0.75)), width: req.size, height: Math.round(req.size * 0.75), mmPerPx: 48 / req.size, origin: [140, 860], vUp: true })
  store = new TracingStore({ dirOf: (id) => (id === 'bracket' ? dir : undefined), now: () => new Date('2026-11-17T12:00:00.000Z') })
  kernel = (name, args) => {
    if (name === 'describe') return { kind: 'face', ref: 'block/F31', type: 'plane', area: 100, center: [5, 5, 10], normal: [0, 0, 1], radius: null, descriptor: 'plane' } satisfies Described
    if (name === 'selectors') return { selectors: [{ ref: args.refs[0], type: 'PLANE', center: [1, 2, 10], normal: [0, 0, 1], selector: null }] }
    if (name === 'section') return { plane: planeOf(args), bounds: { min: [0, 0], max: [40, 30] }, parts: args.parts && !args.parts.includes('block') ? [] : parts } satisfies Sectioned
    throw new Error(`unexpected ${name}`)
  }
  const query = async (_id: string, name: string, args: object) => kernel(name, args as Record<string, any>) as never
  const outlines = new Outlines({ tracings: store, build: () => ({ revision, scene, blob: new Uint8Array(0) }), query, nearest: async () => [], refind: async () => [], log: () => {} })
  const doors = tracingHandlers({
    tracings: store,
    outlines,
    object: (id) => (id === 'bracket' ? { id, name: 'bracket', dir, model: 'm.py' } : undefined),
    build: () => ({ revision, scene }),
    view: () => undefined,
    query
  })
  deps = {
    object: (id: string) => (id === 'bracket' ? { id, name: 'bracket', dir, model: 'm.py' } : undefined),
    build: () => OK,
    scene: () => ({ revision, scene }),
    openObjectId: () => 'bracket',
    view: () => ({ objectId: 'bracket', layout: 'assembly', camera: {}, visible: [] }),
    tracings: doors,
    tracingPicture: (_id: string, req: TracingPictureRequest) => draw(req)
  } as unknown as ToolDeps
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('add_tracing', () => {
  it('lays Claude\'s tracing on a main plane, with the label the person sees, and says which way u and v run', async () => {
    const result = await addTracingTool(deps, 'bracket', { on: { main: 'XZ', offset: 0 }, name: 'Front of the block' })
    expect(result.isError, text(result)).toBeUndefined()
    const told = json(result)
    expect(told).toMatchObject({ tracing: 'T1', by: 'agent', plane: 'XZ at y = 0.0 (u = +X, v = +Z)', layout: 'assembly' })
    expect(text(result)).toContain('XZ at y = 0.0 (u = +X, v = +Z)')
    const made = onDisk().tracings[0]
    expect(made).toMatchObject({ id: 'T1', by: 'agent', name: 'Front of the block', layout: 'assembly', plane: { label: 'XZ at y = 0.0 (u = +X, v = +Z)' }, layers: [] })
  })

  it('lays one on a flat face of the last build, and on a plane given by a point and a normal, in the layout named', async () => {
    const face = await addTracingTool(deps, 'bracket', { on: { face: 'block/F31' }, name: 'Top' })
    expect(face.isError, text(face)).toBeUndefined()
    expect(onDisk().tracings[0].plane.from).toMatchObject({ kind: 'face', ref: 'block/F31' })
    const pointed = await addTracingTool(deps, 'bracket', { on: { origin: [0, 0, 5], normal: [0, 0, 1] }, layout: 'print' })
    expect(pointed.isError, text(pointed)).toBeUndefined()
    expect(onDisk().tracings[1]).toMatchObject({ id: 'T2', by: 'agent', layout: 'print', name: '' })
  })

  it('refuses a plane that is none, with what one looks like, and a layout the project lacks, and writes nothing', async () => {
    for (const on of [undefined, 'XZ', { main: 'AB' }, { main: 'XZ', face: 'block/F1' }, {}, { origin: [0, 0, 0] }]) {
      const r = await addTracingTool(deps, 'bracket', { ...(on === undefined ? {} : { on }) } as never)
      expect(r.isError, JSON.stringify(on)).toBe(true)
    }
    expect(text(await addTracingTool(deps, 'bracket', { name: 'x' }))).toMatch(/"main": "XZ"/)
    expect(text(await addTracingTool(deps, 'bracket', { on: { main: 'XZ' }, layout: 'bed' }))).toMatch(/no layout 'bed'/)
    expect(onDisk).toThrow()
  })

  it('does not drop a key the plane does not take, nor the section on screen, which is the person\'s', async () => {
    const r = await addTracingTool(deps, 'bracket', { on: { main: 'XZ', ofset: 5 } as never })
    expect(r.isError).toBe(true)
    expect(text(r)).toMatch(/ofset.*offset/)
    expect((await addTracingTool(deps, 'bracket', { on: { section: true } as never })).isError).toBe(true)
  })

  it('refuses a face that is not flat, a name that is too long, and a name that is not text', async () => {
    kernel = (name, args) => (name === 'describe' ? { kind: 'face', ref: 'block/F2', type: 'cylinder', area: 1, center: [0, 0, 0], normal: null, radius: 5, descriptor: 'cylinder' } : name === 'selectors' ? { selectors: [{ ref: args.refs[0], center: [0, 0, 0] }] } : { plane: planeOf(args), bounds: null, parts: [] })
    expect((await addTracingTool(deps, 'bracket', { on: { face: 'block/F2' } })).isError).toBe(true)
    expect(text(await addTracingTool(deps, 'bracket', { on: { main: 'XY' }, name: 'x'.repeat(81) }))).toMatch(/81 characters/)
    expect((await addTracingTool(deps, 'bracket', { on: { main: 'XY' }, name: 4 as never })).isError).toBe(true)
  })

  it('takes down a tracing of its own, and refuses the person\'s by name of its owner, leaving the file as it was', async () => {
    await person()
    await addTracingTool(deps, 'bracket', { on: { main: 'XY' } })
    const before = readFileSync(join(dir, '.torno', 'tracings.json'), 'utf8')
    const refused = await addTracingTool(deps, 'bracket', { tracing: 'T1', remove: true })
    expect(refused.isError).toBe(true)
    expect(text(refused)).toMatch(/T1 is the person's/)
    expect(readFileSync(join(dir, '.torno', 'tracings.json'), 'utf8')).toBe(before)
    const done = await addTracingTool(deps, 'bracket', { tracing: 'T2', remove: true })
    expect(done.isError, text(done)).toBeUndefined()
    expect(onDisk().tracings.map((t) => t.id)).toEqual(['T1'])
  })

  it('takes remove only with the tracing, and the tracing only with remove', async () => {
    await addTracingTool(deps, 'bracket', { on: { main: 'XY' } })
    expect((await addTracingTool(deps, 'bracket', { tracing: 'T1' })).isError).toBe(true)
    expect((await addTracingTool(deps, 'bracket', { remove: true } as never)).isError).toBe(true)
    expect(text(await addTracingTool(deps, 'bracket', { tracing: 'T1', remove: true, on: { main: 'XY' } }))).toMatch(/remove takes only/)
    expect((await addTracingTool(deps, 'bracket', { tracing: 'x', remove: true })).isError).toBe(true)
    expect(onDisk().tracings).toHaveLength(1)
  })

  it('says it is not available where there are no tracings, and when the project is not there', async () => {
    expect(text(await addTracingTool({ ...deps, tracings: undefined }, 'bracket', { on: { main: 'XY' } }))).toMatch(/not available/)
    expect(text(await addTracingTool(deps, 'nope', { on: { main: 'XY' } }))).toMatch(/unknown project/)
  })
})

describe('add_layer', () => {
  it('makes Claude\'s layer on the person\'s tracing, and says its number and its shapes', async () => {
    await person()
    const r = await addLayerTool(deps, 'bracket', { tracing: 'T1', name: 'head bolts', colour: 'teal', shapes: [{ kind: 'circle', centre: [10, 5.25], radius: 3.2, name: 'head bolt 1' }, ...square] })
    expect(r.isError, text(r)).toBeUndefined()
    expect(json(r).reading).toContain('layer 1 "head bolts" on T1: 2 shapes')
    expect(json(r)).toMatchObject({ tracing: 'T1', layer: 1, name: 'head bolts', colour: 'teal', shapes: 2, replaced: false })
    expect(onDisk().tracings[0].layers).toMatchObject([{ id: 1, name: 'head bolts', colour: 'teal', by: 'agent' }])
  })

  it('replaces its layer of the same name, with the same number, and says so', async () => {
    await person()
    await addLayerTool(deps, 'bracket', { tracing: 'T1', name: 'head bolts', colour: 'teal', shapes: square })
    const r = await addLayerTool(deps, 'bracket', { tracing: 'T1', name: 'Head Bolts', colour: 'plum', shapes: [] })
    expect(json(r).reading).toContain('layer 1 "Head Bolts" on T1: 0 shapes')
    expect(json(r)).toMatchObject({ layer: 1, replaced: true })
    expect(onDisk().tracings[0].layers).toMatchObject([{ id: 1, colour: 'plum', revision: 2 }])
  })

  it('refuses a layer of the person\'s, to replace or to remove, naming them, and leaves the file as it was', async () => {
    await person()
    await store.layer('bracket', 'T1', { make: { name: 'jacket', colour: 'blue', shapes: [] } }, 'person')
    const before = readFileSync(join(dir, '.torno', 'tracings.json'), 'utf8')
    const replace = await addLayerTool(deps, 'bracket', { tracing: 'T1', name: 'jacket', colour: 'teal', shapes: square })
    expect(replace.isError).toBe(true)
    expect(text(replace)).toMatch(/the person's/)
    const remove = await addLayerTool(deps, 'bracket', { tracing: 'T1', name: 'jacket', remove: true })
    expect(remove.isError).toBe(true)
    expect(text(remove)).toMatch(/the person's/)
    expect(readFileSync(join(dir, '.torno', 'tracings.json'), 'utf8')).toBe(before)
  })

  it('takes away its own layer by name, and says what layers there are when there is none', async () => {
    await person()
    await addLayerTool(deps, 'bracket', { tracing: 'T1', name: 'bolts', colour: 'teal', shapes: square })
    const gone = await addLayerTool(deps, 'bracket', { tracing: 'T1', name: 'BOLTS', remove: true })
    expect(json(gone).reading).toContain('Removed layer 1 "bolts" from T1')
    expect(onDisk().tracings[0].layers).toEqual([])
    const none = await addLayerTool(deps, 'bracket', { tracing: 'T1', name: 'bolts', remove: true })
    expect(none.isError).toBe(true)
    expect(text(none)).toMatch(/no layer "bolts" on T1/)
  })

  it('refuses a number 1e6 mm away, and a 501st shape, and writes nothing', async () => {
    await person()
    const far = await addLayerTool(deps, 'bracket', { tracing: 'T1', name: 'far', colour: 'blue', shapes: [{ kind: 'polyline', points: [[0, 0], [1e6, 0]] }] })
    expect(far.isError).toBe(true)
    expect(text(far)).toMatch(/ten diagonals/)
    const many = Array.from({ length: MOST_SHAPES + 1 }, (_, i) => ({ kind: 'label', at: [i % 40, 1], text: 'x' }))
    const over = await addLayerTool(deps, 'bracket', { tracing: 'T1', name: 'many', colour: 'blue', shapes: many })
    expect(over.isError).toBe(true)
    expect(text(over)).toMatch(/at most 500 shapes/)
    expect(onDisk().tracings[0].layers).toEqual([])
    const fits = await addLayerTool(deps, 'bracket', { tracing: 'T1', name: 'many', colour: 'blue', shapes: many.slice(0, MOST_SHAPES) })
    expect(fits.isError, text(fits)).toBeUndefined()
  })

  it('refuses a number that is not finite, a shape that is not whole, and a key a shape does not take', async () => {
    await person()
    for (const shapes of [[{ kind: 'label', at: [Number.NaN, 0], text: 'x' }], [{ kind: 'circle', centre: [0, 0] }], [{ kind: 'dot' }], ['x'], [{ kind: 'circle', centre: [0, 0], radius: 1, color: 'red' }], [{ kind: 'label', at: [0, 0], text: 'x', name: 'n' }]]) {
      expect((await addLayerTool(deps, 'bracket', { tracing: 'T1', name: 'x', colour: 'blue', shapes: shapes as never })).isError, JSON.stringify(shapes)).toBe(true)
    }
    expect(text(await addLayerTool(deps, 'bracket', { tracing: 'T1', name: 'x', colour: 'blue', shapes: [{ kind: 'circle', centre: [0, 0], radius: 1, colour: 'red' }] as never }))).toMatch(/colour.*takes: kind, name, centre, radius/s)
  })

  it('asks for a colour that is one of the eight, a list of shapes, a name, and a tracing that is there', async () => {
    await person()
    expect(text(await addLayerTool(deps, 'bracket', { tracing: 'T1', name: 'x', shapes: [] }))).toMatch(/colour is one of blue, teal/)
    expect(text(await addLayerTool(deps, 'bracket', { tracing: 'T1', name: 'x', colour: 'red', shapes: [] }))).toMatch(/colour is one of/)
    expect(text(await addLayerTool(deps, 'bracket', { tracing: 'T1', name: 'x', colour: 'blue' }))).toMatch(/shapes/)
    expect((await addLayerTool(deps, 'bracket', { tracing: 'T1', colour: 'blue', shapes: [] } as never)).isError).toBe(true)
    expect(text(await addLayerTool(deps, 'bracket', { tracing: 'T9', name: 'x', colour: 'blue', shapes: [] }))).toMatch(/no tracing T9; tracings: T1/)
    expect((await addLayerTool(deps, 'bracket', { tracing: 'one', name: 'x', colour: 'blue', shapes: [] })).isError).toBe(true)
    expect(text(await addLayerTool(deps, 'bracket', { tracing: 'T1', name: 'x', remove: true, colour: 'blue' }))).toMatch(/remove takes only/)
  })

  it('refuses the 21st layer, and a name over 60 characters', async () => {
    await person()
    for (let i = 0; i < 20; i++) await addLayerTool(deps, 'bracket', { tracing: 'T1', name: `l${i}`, colour: 'blue', shapes: [] })
    expect(text(await addLayerTool(deps, 'bracket', { tracing: 'T1', name: 'l20', colour: 'blue', shapes: [] }))).toMatch(/at most 20 layers/)
    expect(text(await addLayerTool(deps, 'bracket', { tracing: 'T1', name: 'x'.repeat(61), colour: 'blue', shapes: [] }))).toMatch(/61 characters/)
  })
})

describe('tracings', () => {
  it('lists the tracings with who made each, and says when there are none', async () => {
    expect(text(await tracingsTool(deps, 'bracket', {}))).toMatch(/no tracings/)
    await person()
    await addTracingTool(deps, 'bracket', { on: { main: 'XY', offset: 12 }, name: 'Plan' })
    const told = json(await tracingsTool(deps, 'bracket', {}))
    expect(told.tracings).toMatchObject([{ id: 'T1', by: 'person', name: 'Front', layers: 0 }, { id: 'T2', by: 'agent', name: 'Plan' }])
    expect(told.reading).toContain('T2 "Plan": XY at z = 12.0 (u = +X, v = +Y), layout assembly, by you, 0 layers, 0 shapes')
    expect(told.revision).toBe(7)
  })

  it('tells one tracing: its plane, the build its outline is of, the area as the kernel\'s with ≈ where it is not exact, loops, bounds and the layers in mm', async () => {
    await person()
    await addLayerTool(deps, 'bracket', { tracing: 'T1', name: 'head bolts', colour: 'teal', shapes: [{ kind: 'circle', centre: [10, 5.25], radius: 3.2, name: 'head bolt 1' }] })
    const told = json(await tracingsTool(deps, 'bracket', { tracing: 'T1' }))
    expect(told).toMatchObject({ id: 'T1', by: 'person', plane: { label: 'XZ at y = 0.0 (u = +X, v = +Z)' }, outline: { revision: 7, parts: [{ part: 'block', area: 1100, areaExact: false, loops: 2 }] }, revision: 7 })
    expect(told.text).toContain('outline of build r7')
    expect(told.text).toContain('block ≈ 1100 mm², 2 loops, u 0 to 40, v 0 to 30')
    expect(told.text).toContain('circle "head bolt 1" centre [10, 5.25] radius 3.2')
    parts = [{ ...PLATE[0], areaExact: true }]
    revision = 8
    expect(json(await tracingsTool(deps, 'bracket', { tracing: 'T1' })).text).toMatch(/block 1100 mm²/)
  })

  it('thins the points as section does and says it, with the deflection', async () => {
    await person()
    parts = [{ part: 'block', loops: [loop(ring(2000, 20)), loop(ring(2000, 10), { area: -314 })], area: 942, areaExact: false, open: 0, how: '' }]
    const told = json(await tracingsTool(deps, 'bracket', { tracing: 'T1' }))
    expect(told.outline.parts[0]).toMatchObject({ of: 4000, thinned: true })
    expect(told.text).toMatch(/thinned: 1[45]\d\d of the 4000 points cut/)
    expect(told.text).toMatch(/within 0\.0\d+ mm of the true outline/)
  })

  it('says why there is no outline, and still tells the layers', async () => {
    await person()
    deps = { ...deps, build: () => undefined, scene: () => undefined } as ToolDeps
    const told = json(await tracingsTool({ ...deps, tracings: { ...deps.tracings!, agentOutline: async () => ({ why: 'no build yet' }) } as never }, 'bracket', { tracing: 'T1' }))
    expect(told.outline).toBeNull()
    expect(told.text).toContain('outline: none (no build yet)')
  })

  it('says a tracing whose face was lost, as main says it', async () => {
    await addTracingTool(deps, 'bracket', { on: { face: 'block/F31' } })
    await store.movePlane('bracket', 'T1', { origin: [1, 2, 10] }, 'block/F31 is not in this plane any more')
    expect(json(await tracingsTool(deps, 'bracket', { tracing: 'T1' })).text).toContain('block/F31 is not in this plane any more')
  })

  it('names the tracings there are for one that is not there, and refuses an id that is none', async () => {
    await person()
    expect(text(await tracingsTool(deps, 'bracket', { tracing: 'T4' }))).toMatch(/no tracing T4; tracings: T1/)
    expect((await tracingsTool(deps, 'bracket', { tracing: 'front' })).isError).toBe(true)
    expect(text(await tracingsTool(deps, 'bracket', { picture: true }))).toMatch(/picture.*tracing/)
  })

  describe('with a picture', () => {
    it('asks the window for the drawing at 1280 px by default, and tells what maps it to mm', async () => {
      await person()
      await addLayerTool(deps, 'bracket', { tracing: 'T1', name: 'bolts', colour: 'plum', shapes: square })
      const r = await tracingsTool(deps, 'bracket', { tracing: 'T1', picture: true })
      expect(r.isError, text(r)).toBeUndefined()
      expect(drawn).toHaveLength(1)
      expect(drawn[0]).toMatchObject({ objectId: 'bracket', object: 'bracket', tracing: 'T1', name: 'Front', plane: 'XZ at y = 0.0 (u = +X, v = +Z)', layout: 'assembly', revision: 7, size: 1280 })
      expect(drawn[0].layers).toMatchObject([{ id: 1, name: 'bolts' }])
      expect(drawn[0].cut.parts[0].part).toBe('block')
      const image = r.content.find((c) => c.type === 'image') as { data: string; mimeType: string }
      expect(image.mimeType).toBe('image/png')
      expect(checkedImage(new Uint8Array(Buffer.from(image.data, 'base64')))).toMatchObject({ width: 1280 })
      expect(text(r)).toContain('1 px = 0.0375 mm; u = 0 at x = 140, v = 0 at y = 860, v up')
      expect(json(r).picture).toMatchObject({ width: 1280, height: 960, mmPerPx: 0.0375, origin: [140, 860], vUp: true })
    })

    it('clamps a size of 4000 to 2000, and the image it gets passes the 2000 px check', async () => {
      await person()
      const r = await tracingsTool(deps, 'bracket', { tracing: 'T1', picture: true, size: 4000 })
      expect(drawn[0].size).toBe(2000)
      const image = r.content.find((c) => c.type === 'image') as { data: string }
      expect(checkedImage(new Uint8Array(Buffer.from(image.data, 'base64')))).toMatchObject({ width: 2000, height: 1500 })
      await tracingsTool(deps, 'bracket', { tracing: 'T1', picture: true, size: 10 })
      expect(drawn[1].size).toBe(256)
    })

    it('sends no image the window made that the check does not pass, and says so, with the text of the tracing', async () => {
      await person()
      draw = async () => ({ png: png(4000, 3000), width: 4000, height: 3000, mmPerPx: 0.01, origin: [0, 0], vUp: true })
      const r = await tracingsTool(deps, 'bracket', { tracing: 'T1', picture: true })
      expect(r.content.some((c) => c.type === 'image')).toBe(false)
      expect(json(r).picture).toMatch(/not sent/)
      expect(json(r).text).toContain('outline of build r7')
      draw = async () => ({ png: new Uint8Array([1, 2, 3]) as never, width: 1, height: 1, mmPerPx: 1, origin: [0, 0], vUp: true })
      expect(json(await tracingsTool(deps, 'bracket', { tracing: 'T1', picture: true })).picture).toMatch(/not sent/)
    })

    it('says v runs down, when it does, and that the picture was not drawn when the window cannot', async () => {
      await person()
      draw = async (req) => ({ png: png(req.size, 100), width: req.size, height: 100, mmPerPx: 0.05, origin: [10.4, 20.6], vUp: false })
      expect(text(await tracingsTool(deps, 'bracket', { tracing: 'T1', picture: true }))).toContain('1 px = 0.05 mm; u = 0 at x = 10.4, v = 0 at y = 20.6, v down')
      draw = async () => {
        throw new Error('the torno window is closed')
      }
      const r = await tracingsTool(deps, 'bracket', { tracing: 'T1', picture: true })
      expect(r.isError).toBeUndefined()
      expect(r.content.some((c) => c.type === 'image')).toBe(false)
      expect(json(r).picture).toMatch(/not drawn: the torno window is closed/)
    })

    it('draws nothing of a plane that cuts nothing with no layers on it, and says so; with no outline, it cannot draw', async () => {
      await person()
      parts = []
      kernel = (name, args) => (name === 'section' ? { plane: planeOf(args), bounds: null, parts: [] } : (undefined as never))
      const r = await tracingsTool(deps, 'bracket', { tracing: 'T1', picture: true })
      expect(drawn).toHaveLength(0)
      expect(json(r).picture).toMatch(/not drawn: .*nothing/)
    })

    it('says the window cannot draw where it is not joined', async () => {
      await person()
      const r = await tracingsTool({ ...deps, tracingPicture: undefined }, 'bracket', { tracing: 'T1', picture: true })
      expect(json(r).picture).toMatch(/not drawn/)
    })
  })
})

describe('the tools\' keys', () => {
  it('refuse a key the schema does not name, so that nothing is done on a guess', () => {
    expect(refusedKeys('tracings', { tracing: 'T1', pictures: true })?.isError).toBe(true)
    expect(text(refusedKeys('add_tracing', { on: { main: 'XZ' }, name: 'x', by: 'person' })!)).toMatch(/"by"/)
    expect(text(refusedKeys('add_layer', { tracing: 'T1', name: 'x', colour: 'blue', shapes: [], id: 9 })!)).toMatch(/"id"/)
    expect(refusedKeys('add_layer', { tracing: 'T1', name: 'x', colour: 'blue', shapes: [] })).toBeNull()
    expect(Object.keys(TOOLS.add_layer.inputSchema)).not.toContain('by')
  })
})
