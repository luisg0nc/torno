import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { NewMark, SketchMark, Vec3 } from '../../shared/marks'
import { SKETCH_PICTURE } from '../../shared/marks'
import { REFUSED } from '../../shared/refusal'
import type { ObjectInfo } from '../../shared/workspace'
import { droppedNames } from '../dropped'
import { MarkStore } from '../marks/store'
import { isNoteFile } from '../notes/files'
import { png, jpeg } from '../notes/testing'
import { NoteSweep } from '../notes/sweep'
import { refusable } from '../refusal'
import { forgetOpenSketches, openSketch, sketchHandlers } from './ipc'
import { fixture, VERTICES, world } from './testing'

const CAMERA = { position: [100, -100, 80], target: [0, 0, 10], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 }
const XY = { id: 1, origin: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], label: 'XY at z = 0.0', from: { kind: 'main', axis: 'XY', offset: 0 } }

let root: string
let dir: string
let store: MarkStore
let built: ReturnType<typeof fixture> | undefined
let asked: Array<{ name: string; anchors: number }>
let placed: string[]
let kernelFails: boolean

const obj = (): ObjectInfo => ({ id: 'bracket', name: 'bracket', dir, model: 'model.py' })
const handlers = () =>
  sketchHandlers({
    marks: store,
    object: (id) => (id === 'bracket' ? obj() : undefined),
    build: () => (built ? { revision: built.build.revision, scene: built.scene, blob: Buffer.from(built.blob) } : undefined),
    query: async <T>(_id: string, name: string, args: object): Promise<T> => {
      const anchors = (args as { anchors: Array<{ part: string; point: Vec3 }> }).anchors
      asked.push({ name, anchors: anchors.length })
      if (kernelFails) throw new Error('the kernel is busy')
      return { anchors: anchors.map(({ part, point }) => ({ part, found: true, point, normal: null, ref: `${part}/F2`, distance: 0, descriptor: null })) } as T
    },
    placed: <M extends NewMark>(mark: M): M => {
      placed.push(mark.kind)
      return mark
    }
  })
const folder = (): string => join(dir, '.torno', 'notes')
const files = (): string[] => (existsSync(folder()) ? readdirSync(folder()).filter((n) => n !== '.gitignore' && n !== 'dropped.json').sort() : [])

const inside = world([20, 15, 10])
const draft = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  objectId: 'bracket',
  layout: 'assembly',
  revision: 7,
  camera: CAMERA,
  name: 'Hose',
  note: 'route it here',
  take: 'flow',
  diameter: 19,
  planes: [XY],
  strokes: [{ pen: 'free', points: [inside, [inside[0], inside[1], inside[2] + 1]], revision: 7 }],
  ...over
})
const made = async (over: Record<string, unknown> = {}): Promise<SketchMark> => (await handlers().sketch(draft(over) as never)) as SketchMark

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'torno-sketch-ipc-'))
  dir = join(root, 'bracket')
  mkdirSync(dir)
  store = new MarkStore({ dirOf: (id) => (id === 'bracket' ? dir : undefined) })
  built = fixture(7)
  asked = []
  placed = []
  kernelFails = false
  forgetOpenSketches()
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('marks:sketch', () => {
  it('makes a sketch of the person\'s, a draft, with what main worked out of its strokes', async () => {
    const sketch = await made()
    expect(sketch).toMatchObject({ id: 'M1', kind: 'sketch', author: 'user', status: 'draft', name: 'Hose', take: 'flow', diameter: 19, revision: 7 })
    expect(sketch.strokes[0].touches).toEqual(['block/F2'])
    expect(asked.map((a) => a.name)).toEqual(['nearest'])
    expect((await store.list('bracket')).map((m) => m.id)).toEqual(['M1'])
    expect(placed).toEqual([])
  })

  it('has main place the anchor, as it does a mark\'s, and name no tag the window gave', async () => {
    const withTag = sketchHandlers({
      marks: store,
      object: () => obj(),
      build: () => ({ revision: 7, scene: built!.scene, blob: Buffer.from(built!.blob) }),
      query: async <T>() => ({ anchors: [] }) as T,
      placed: <M extends NewMark>(mark: M): M => (mark.kind === 'sketch' && mark.anchor ? { ...mark, anchor: { point: mark.anchor.point, part: mark.anchor.part, arranged: [0, 0, 0] as Vec3 } } : mark)
    })
    const sketch = (await withTag.sketch(draft({ anchor: { point: [1, 2, 3], part: 'block', ref: 'block/F2', tag: 'top' } }) as never)) as SketchMark
    expect(sketch.anchor).toEqual({ point: [1, 2, 3], part: 'block', arranged: [0, 0, 0] })
  })

  it('takes nothing main says from the window: no id, author, status, picture or touches', async () => {
    const sketch = await made({ author: 'agent', status: 'resolved', sentBefore: true, picture: 'k-0123456789ab.png', checkedRevision: 3, strokes: [{ pen: 'free', points: [inside], revision: 7, touches: ['x/F1'] }] })
    expect(sketch).toMatchObject({ id: 'M1', author: 'user', status: 'draft' })
    for (const key of ['sentBefore', 'picture', 'checkedRevision', 'resolvedBy']) expect(sketch).not.toHaveProperty(key)
    expect(sketch.strokes[0].touches).toEqual(['block/F2'])
  })

  it('replaces a sketch of the person\'s that it is given the id of, and works out only what the new strokes touch', async () => {
    const first = await made()
    asked = []
    const more = { pen: 'free', points: [[inside[0], inside[1], inside[2] + 2]], revision: 7 }
    const changed = (await handlers().sketch(draft({ id: first.id, name: 'Hose, longer', strokes: [...first.strokes, more] }) as never)) as SketchMark
    expect(changed).toMatchObject({ id: 'M1', name: 'Hose, longer' })
    expect(changed.strokes).toHaveLength(2)
    expect(changed.strokes[0]).toEqual(first.strokes[0])
    expect(changed.strokes[1].touches).toEqual(['block/F2'])
    expect(asked).toHaveLength(1)
    expect(asked[0].anchors).toBe(1)
  })

  it('keeps the strokes of an earlier build as they were, when the model was built again since', async () => {
    const first = await made()
    built = fixture(9)
    const changed = (await handlers().sketch(draft({ id: first.id, revision: 9, note: 'later', strokes: first.strokes.map((s) => ({ ...s, touches: ['x/F1'] })) }) as never)) as SketchMark
    expect(changed.strokes[0].revision).toBe(7)
    expect(changed.strokes[0].touches).toEqual(['block/F2'])
    expect(changed).toMatchObject({ revision: 9, note: 'later' })
  })

  it('refuses a stroke of a build that is not the last, and writes nothing', async () => {
    await expect(handlers().sketch(draft({ strokes: [{ pen: 'free', points: [inside], revision: 6 }] }) as never)).rejects.toThrow(/build/)
    expect(await store.list('bracket')).toEqual([])
  })

  it('refuses a snap the build does not bear out, and writes nothing', async () => {
    const stroke = { pen: 'points', points: [world(VERTICES[0])], snaps: [{ i: 0, vertex: 'block/V99' }], revision: 7 }
    await expect(handlers().sketch(draft({ strokes: [stroke] }) as never)).rejects.toThrow(/V99/)
    expect(await store.list('bracket')).toEqual([])
  })

  it('refuses an id that is no sketch, or one that is not the person\'s, or not there', async () => {
    await store.add('bracket', { kind: 'pin', author: 'user', note: '', layout: 'assembly', revision: 1, camera: CAMERA, anchor: { point: [1, 1, 1] } } as NewMark)
    await expect(handlers().sketch(draft({ id: 'M1' }) as never)).rejects.toThrow(/pin/)
    await expect(handlers().sketch(draft({ id: 'M9' }) as never)).rejects.toThrow(/M9/)
    await expect(handlers().sketch(draft({ id: 'x' }) as never)).rejects.toThrow(/sketch/)
    await store.saveSketch('bracket', draft() as never, [[]], { author: 'agent' })
    await expect(handlers().sketch(draft({ id: 'M2' }) as never)).rejects.toThrow(/agent/)
  })

  it('refuses when the project has no build to check against', async () => {
    built = undefined
    await expect(handlers().sketch(draft() as never)).rejects.toThrow(/built/)
    expect(await store.list('bracket')).toEqual([])
  })

  it('refuses a project that is not open, and a draft that is not one', async () => {
    await expect(handlers().sketch(draft({ objectId: 'nope' }) as never)).rejects.toThrow(/not open/)
    await expect(handlers().sketch(null as never)).rejects.toThrow(/sketch/)
    expect(existsSync(join(dir, '.torno'))).toBe(false)
  })

  it('keeps the sketch when the kernel cannot be asked what its strokes touch: they touch nothing known', async () => {
    kernelFails = true
    const sketch = await made()
    expect(sketch.strokes[0].touches).toEqual([])
  })

  it('is refused as a refusal, which the window reads as one', async () => {
    expect(await refusable(handlers().sketch)(draft({ take: 'rough' }) as never)).toHaveProperty([REFUSED])
  })

  it('works from a blob that is a view into a larger buffer, as the kernel\'s are', async () => {
    const big = Buffer.alloc(built!.blob.byteLength + 7)
    Buffer.from(built!.blob).copy(big, 3)
    const blob = big.subarray(3, 3 + built!.blob.byteLength)
    const there = sketchHandlers({ marks: store, object: () => obj(), build: () => ({ revision: 7, scene: built!.scene, blob }), query: async <T>() => ({ anchors: [] }) as T })
    const v1 = world(VERTICES[1])
    const sketch = (await there.sketch(draft({ strokes: [{ pen: 'points', points: [v1], snaps: [{ i: 0, vertex: 'block/V1' }], revision: 7 }] }) as never)) as SketchMark
    expect(sketch.strokes[0].snaps).toEqual([{ i: 0, vertex: 'block/V1' }])
  })
})

describe('marks:sketchPicture', () => {
  it('writes the picture under a name of main\'s own and puts it on the sketch', async () => {
    const sketch = await made()
    await handlers().sketchPicture('bracket', sketch.id, png(640, 480))
    const mark = (await store.list('bracket'))[0] as SketchMark
    expect(mark.picture).toMatch(SKETCH_PICTURE)
    expect(files()).toEqual([mark.picture])
    expect([...readFileSync(join(folder(), mark.picture!))]).toEqual([...png(640, 480)])
    expect(readFileSync(join(folder(), '.gitignore'), 'utf8')).toBe('*\n')
  })

  it('lists the picture it replaces as dropped, and keeps the file for an undo until the sweep', async () => {
    const sketch = await made()
    await handlers().sketchPicture('bracket', sketch.id, png(640, 480))
    const first = ((await store.list('bracket'))[0] as SketchMark).picture!
    await handlers().sketchPicture('bracket', sketch.id, png(640, 481))
    const second = ((await store.list('bracket'))[0] as SketchMark).picture!
    expect(second).not.toBe(first)
    expect(files().sort()).toEqual([first, second].sort())
    expect(await droppedNames(dir, ['notes'], isNoteFile)).toEqual([first])
  })

  it('is of a sketch of the agent\'s too, which the window draws the picture of', async () => {
    const agents = await store.saveSketch('bracket', draft() as never, [[]], { author: 'agent' })
    await handlers().sketchPicture('bracket', agents.id, png(640, 480))
    expect(((await store.list('bracket'))[0] as SketchMark).picture).toMatch(SKETCH_PICTURE)
  })

  it('refuses a picture that is not a PNG within the size an agent is given, and writes nothing', async () => {
    const sketch = await made()
    await expect(handlers().sketchPicture('bracket', sketch.id, jpeg(640, 480))).rejects.toThrow(/PNG/)
    await expect(handlers().sketchPicture('bracket', sketch.id, png(2001, 100))).rejects.toThrow(/PNG/)
    await expect(handlers().sketchPicture('bracket', sketch.id, 'bytes' as never)).rejects.toThrow(/PNG/)
    expect(files()).toEqual([])
  })

  it('refuses a mark that is no sketch, or not there, and leaves the file it wrote as dropped', async () => {
    await store.add('bracket', { kind: 'pin', author: 'user', note: '', layout: 'assembly', revision: 1, camera: CAMERA, anchor: { point: [1, 1, 1] } } as NewMark)
    await expect(handlers().sketchPicture('bracket', 'M1', png(10, 10))).rejects.toThrow(/not a sketch/)
    await expect(handlers().sketchPicture('bracket', 'M9', png(10, 10))).rejects.toThrow(/M9/)
    await expect(handlers().sketchPicture('bracket', 'x', png(10, 10))).rejects.toThrow(/sketch/)
    expect(files()).toEqual([])
  })

  it('lists what it wrote as dropped when the mark was not changed', async () => {
    const sketch = await made()
    const failing = sketchHandlers({ marks: { list: store.list.bind(store), saveSketch: store.saveSketch.bind(store), setSketchPicture: () => Promise.reject(new Error('disk full')) }, object: () => obj(), build: () => undefined, query: async <T>() => ({}) as T })
    await expect(failing.sketchPicture('bracket', sketch.id, png(10, 10))).rejects.toThrow(/disk full/)
    expect(await droppedNames(dir, ['notes'], isNoteFile)).toEqual(files())
  })
})

describe('the sweep of the pictures', () => {
  it('takes the picture a sketch let go of, and leaves the one it has', async () => {
    const sketch = await made()
    await handlers().sketchPicture('bracket', sketch.id, png(640, 480))
    const first = ((await store.list('bracket'))[0] as SketchMark).picture!
    await handlers().sketchPicture('bracket', sketch.id, png(640, 481))
    const second = ((await store.list('bracket'))[0] as SketchMark).picture!
    await new NoteSweep(store, 0).once('bracket', dir)
    expect(files()).toEqual([second])
    expect(first).not.toBe(second)
  })

  it('leaves the picture of a sketch that was taken away, for an undo, in the run it was taken away in', async () => {
    const sketch = await made()
    await handlers().sketchPicture('bracket', sketch.id, png(640, 480))
    const name = ((await store.list('bracket'))[0] as SketchMark).picture!
    await store.remove('bracket', sketch.id)
    await new NoteSweep(store, 0).once('bracket', dir)
    expect(files()).toEqual([name])
  })
})

describe('marks:sketching', () => {
  it('says which sketch of an object is open, and none once it is closed', () => {
    expect(openSketch('bracket')).toBeNull()
    handlers().sketching('bracket', 'M3')
    expect(openSketch('bracket')).toBe('M3')
    expect(openSketch('other')).toBeNull()
    handlers().sketching('bracket', null)
    expect(openSketch('bracket')).toBeNull()
  })

  it('takes nothing that is not a mark number of a project that is open', () => {
    handlers().sketching('bracket', 'M3')
    handlers().sketching('bracket', '../x' as never)
    expect(openSketch('bracket')).toBe('M3')
    handlers().sketching('nope', 'M4')
    expect(openSketch('nope')).toBeNull()
    handlers().sketching(7 as never, 'M4')
  })

  it('is forgotten with the workspace', () => {
    handlers().sketching('bracket', 'M3')
    forgetOpenSketches()
    expect(openSketch('bracket')).toBeNull()
  })
})
