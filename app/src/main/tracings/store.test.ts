import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mainPlaneFrame } from '../../shared/planes'
import { MOST_LAYERS, MOST_SHAPES, MOST_TRACINGS, type LayerShape, type TracingPlane, type TracingsFile } from '../../shared/tracings'
import * as fileModule from './file'
import { TracingStore } from './store'

vi.mock('./file', async (importActual) => {
  const actual = await importActual<typeof import('./file')>()
  return { ...actual, saveTracingsFile: vi.fn(actual.saveTracingsFile) }
})
const saves = vi.mocked(fileModule.saveTracingsFile)

let root: string
let dir: string
let store: TracingStore
let changes: Array<{ objectId: string; file: TracingsFile }>
let problems: string[]

const plane = (offset = 0): TracingPlane => ({ ...mainPlaneFrame('XZ', offset), from: { kind: 'main', axis: 'XZ', offset } })
const ask = (name = 'front', extra: Record<string, unknown> = {}) => ({ name, layout: 'assembly', plane: plane(), ...extra })
const square: LayerShape[] = [{ kind: 'polyline', points: [[0, 0], [10, 0], [10, 10], [0, 10]], closed: true }]
const onDisk = (): TracingsFile => JSON.parse(readFileSync(join(dir, '.torno', 'tracings.json'), 'utf8'))
const newStore = (): TracingStore => {
  const s = new TracingStore({ dirOf: (id) => (id === 'bracket' ? dir : undefined), now: () => new Date('2026-11-17T12:00:00.000Z') })
  s.on('changed', (m) => changes.push(m))
  s.on('problem', (m) => problems.push(m.message))
  return s
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'torno-tracings-store-'))
  dir = join(root, 'bracket')
  mkdirSync(dir)
  changes = []
  problems = []
  saves.mockClear()
  store = newStore()
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('listing', () => {
  it('lists nothing and writes nothing for a project with no tracings file', async () => {
    expect(await store.list('bracket')).toEqual({ next: 1, tracings: [] })
    expect(saves).not.toHaveBeenCalled()
  })

  it('rejects for a project that is not open', async () => {
    await expect(store.list('nope')).rejects.toThrow(/no project named nope/)
  })
})

describe('make', () => {
  it('gives T1, then T2, writing each before it tells', async () => {
    const one = await store.make('bracket', ask('front'), 'person')
    expect(one).toMatchObject({ id: 'T1', by: 'person', name: 'front', layout: 'assembly', layers: [], nextLayer: 1, createdAt: '2026-11-17T12:00:00.000Z' })
    expect(onDisk().tracings.map((t) => t.id)).toEqual(['T1'])
    expect(changes).toHaveLength(1)
    const two = await store.make('bracket', ask('side'), 'agent')
    expect(two.id).toBe('T2')
    expect(two.by).toBe('agent')
    expect(onDisk().next).toBe(3)
    expect(changes[1].file.tracings.map((t) => t.id)).toEqual(['T1', 'T2'])
  })

  it('never gives a number again after a removal', async () => {
    await store.make('bracket', ask('a'), 'person')
    await store.make('bracket', ask('b'), 'person')
    await store.remove('bracket', 'T2', 'person')
    expect((await store.make('bracket', ask('c'), 'person')).id).toBe('T3')
  })

  it('never gives a number again after a restart either', async () => {
    await store.make('bracket', ask('a'), 'person')
    await store.make('bracket', ask('b'), 'person')
    await store.remove('bracket', 'T2', 'person')
    const later = newStore()
    expect((await later.make('bracket', ask('c'), 'person')).id).toBe('T3')
  })

  it('ignores an id, an author and a layer count that the asker brings', async () => {
    const got = await store.make('bracket', ask('front', { id: 'T9', by: 'agent', nextLayer: 40, lost: 'x', layers: [{ id: 1 }], createdAt: '1999-01-01', photo: { file: 'x' } }), 'person')
    expect(got).toMatchObject({ id: 'T1', by: 'person', nextLayer: 1, layers: [], createdAt: '2026-11-17T12:00:00.000Z' })
    expect(got).not.toHaveProperty('lost')
    expect(got).not.toHaveProperty('photo')
    expect(onDisk().next).toBe(2)
  })

  it('keeps the build it was made on in memory only, and the build id in the file', async () => {
    const got = await store.make('bracket', ask('front', { revision: 4, build: { id: 'h41', sources: 'abc' }, parts: ['block'] }), 'person')
    expect(got).toMatchObject({ revision: 4, build: { id: 'h41', sources: 'abc' }, parts: ['block'] })
    expect(onDisk().tracings[0]).not.toHaveProperty('revision')
    expect(onDisk().tracings[0].build).toEqual({ id: 'h41', sources: 'abc' })
    expect((await store.list('bracket')).tracings[0].revision).toBe(4)
  })

  it('refuses a name that is too long, over two lines, or not text', async () => {
    await expect(store.make('bracket', ask('x'.repeat(81)), 'person')).rejects.toThrow(/80/)
    await expect(store.make('bracket', ask('two\nlines'), 'person')).rejects.toThrow(/one line/)
    await expect(store.make('bracket', ask(7 as unknown as string), 'person')).rejects.toThrow(/name/)
    expect(saves).not.toHaveBeenCalled()
  })

  it('refuses a plane that is not a frame, and a layout that is empty', async () => {
    await expect(store.make('bracket', ask('f', { plane: { ...plane(), y: [1, 0, 0] } }), 'person')).rejects.toThrow(/plane/)
    await expect(store.make('bracket', ask('f', { plane: { ...plane(), origin: [0, Number.NaN, 0] } }), 'person')).rejects.toThrow(/plane/)
    await expect(store.make('bracket', ask('f', { layout: '' }), 'person')).rejects.toThrow(/layout/)
    expect(saves).not.toHaveBeenCalled()
  })

  it('refuses the 51st tracing', async () => {
    for (let i = 0; i < MOST_TRACINGS; i++) await store.make('bracket', ask(`t${i}`), 'person')
    await expect(store.make('bracket', ask('one more'), 'person')).rejects.toThrow(/50/)
    expect(onDisk().tracings).toHaveLength(MOST_TRACINGS)
  })

  it('leaves the file as it was when the write fails, and still gives the number next time', async () => {
    await store.make('bracket', ask('a'), 'person')
    saves.mockRejectedValueOnce(new Error('disk full'))
    await expect(store.make('bracket', ask('b'), 'person')).rejects.toThrow(/disk full/)
    expect((await store.list('bracket')).tracings.map((t) => t.id)).toEqual(['T1'])
    expect((await store.make('bracket', ask('b'), 'person')).id).toBe('T2')
    expect(changes).toHaveLength(2)
  })

  it('does one change at a time', async () => {
    const made = await Promise.all([1, 2, 3, 4, 5].map((i) => store.make('bracket', ask(`t${i}`), 'person')))
    expect(made.map((t) => t.id)).toEqual(['T1', 'T2', 'T3', 'T4', 'T5'])
    expect(onDisk().tracings.map((t) => t.name)).toEqual(['t1', 't2', 't3', 't4', 't5'])
  })
})

describe('edit', () => {
  it('renames, and sets and clears the parts, on any tracing', async () => {
    await store.make('bracket', ask('a'), 'agent')
    const named = await store.edit('bracket', 'T1', { name: ' side ' })
    expect(named.name).toBe('side')
    const parted = await store.edit('bracket', 'T1', { parts: ['block', 'lid'] })
    expect(parted.parts).toEqual(['block', 'lid'])
    const whole = await store.edit('bracket', 'T1', { parts: null })
    expect(whole).not.toHaveProperty('parts')
    expect(onDisk().tracings[0]).not.toHaveProperty('parts')
    expect(changes).toHaveLength(4)
  })

  it('ignores what is main\'s, and writes nothing when nothing is left', async () => {
    await store.make('bracket', ask('a'), 'person')
    saves.mockClear()
    const got = await store.edit('bracket', 'T1', { id: 'T9', by: 'agent', nextLayer: 9, lost: 'x', layers: [] } as never)
    expect(got).toMatchObject({ id: 'T1', by: 'person', nextLayer: 1 })
    expect(got).not.toHaveProperty('lost')
    expect(saves).not.toHaveBeenCalled()
    expect(changes).toHaveLength(1)
  })

  it('refuses a name that is too long, and a tracing that is not there', async () => {
    await store.make('bracket', ask('a'), 'person')
    await expect(store.edit('bracket', 'T1', { name: 'x'.repeat(81) })).rejects.toThrow(/80/)
    await expect(store.edit('bracket', 'T7', { name: 'x' })).rejects.toThrow(/no tracing T7/)
    await expect(store.edit('bracket', 'nonsense', { name: 'x' })).rejects.toThrow(/not a tracing/)
  })
})

describe('remove and restore', () => {
  it('lets the person remove any tracing, and the agent only its own, naming the owner', async () => {
    await store.make('bracket', ask('mine'), 'person')
    await store.make('bracket', ask('its'), 'agent')
    saves.mockClear()
    await expect(store.remove('bracket', 'T1', 'agent')).rejects.toThrow(/person's/)
    expect(saves).not.toHaveBeenCalled()
    expect((await store.remove('bracket', 'T2', 'agent')).id).toBe('T2')
    await store.make('bracket', ask('its again'), 'agent')
    await store.remove('bracket', 'T3', 'person')
    await store.remove('bracket', 'T1', 'person')
    expect(onDisk().tracings).toEqual([])
    expect(onDisk().next).toBe(4)
  })

  it('brings back a tracing removed in this run, whole, once, in its place', async () => {
    await store.make('bracket', ask('a'), 'person')
    await store.make('bracket', ask('b', { build: { id: 'h1', sources: 's' }, revision: 3 }), 'person')
    await store.make('bracket', ask('c'), 'person')
    await store.layer('bracket', 'T2', { make: { name: 'jacket', colour: 'blue', shapes: square } }, 'person')
    const before = (await store.list('bracket')).tracings[1]
    await store.remove('bracket', 'T2', 'person')
    const back = await store.restore('bracket', 'T2')
    expect(back).toEqual(before)
    expect((await store.list('bracket')).tracings.map((t) => t.id)).toEqual(['T1', 'T2', 'T3'])
    expect(onDisk().tracings[1].layers).toHaveLength(1)
    await expect(store.restore('bracket', 'T2')).rejects.toThrow(/no removed tracing T2|nothing to put back/)
  })

  it('does not bring back what was never removed, nor after forget', async () => {
    await store.make('bracket', ask('a'), 'person')
    await expect(store.restore('bracket', 'T5')).rejects.toThrow()
    await store.remove('bracket', 'T1', 'person')
    store.forget()
    await expect(store.restore('bracket', 'T1')).rejects.toThrow()
  })

  it('keeps the last 20 removed per project', async () => {
    for (let i = 0; i < 22; i++) await store.make('bracket', ask(`t${i}`), 'person')
    for (let i = 1; i <= 22; i++) await store.remove('bracket', `T${i}`, 'person')
    await expect(store.restore('bracket', 'T1')).rejects.toThrow()
    await expect(store.restore('bracket', 'T2')).rejects.toThrow()
    expect((await store.restore('bracket', 'T3')).id).toBe('T3')
    expect((await store.restore('bracket', 'T22')).id).toBe('T22')
  })
})

describe('layers', () => {
  beforeEach(async () => {
    await store.make('bracket', ask('person tracing'), 'person')
  })

  it('makes a layer of the asker\'s, with the next number and its first revision', async () => {
    const t = await store.layer('bracket', 'T1', { make: { name: 'water jacket', colour: 'teal', shapes: square } }, 'agent')
    expect(t.layers).toEqual([{ id: 1, name: 'water jacket', colour: 'teal', by: 'agent', shapes: square, revision: 1 }])
    expect(t.nextLayer).toBe(2)
    const t2 = await store.layer('bracket', 'T1', { make: { name: 'bolts', colour: 'plum', shapes: [] } }, 'person')
    expect(t2.layers.map((l) => [l.id, l.by])).toEqual([[1, 'agent'], [2, 'person']])
    expect(onDisk().tracings[0].layers).toHaveLength(2)
  })

  it('lets the agent add a layer to the person\'s tracing', async () => {
    const t = await store.layer('bracket', 'T1', { make: { name: 'idea', colour: 'ochre', shapes: square } }, 'agent')
    expect(t.by).toBe('person')
    expect(t.layers[0].by).toBe('agent')
  })

  it('replaces a layer by name, keeping its id and bumping its revision', async () => {
    await store.layer('bracket', 'T1', { make: { name: 'jacket', colour: 'teal', shapes: square } }, 'agent')
    const bigger: LayerShape[] = [{ kind: 'circle', centre: [5, 5], radius: 2 }]
    const t = await store.layer('bracket', 'T1', { make: { name: 'jacket', colour: 'violet', shapes: bigger } }, 'agent')
    expect(t.layers).toHaveLength(1)
    expect(t.layers[0]).toMatchObject({ id: 1, name: 'jacket', colour: 'violet', revision: 2, shapes: bigger })
    expect(t.nextLayer).toBe(2)
  })

  it('replaces a layer by id, with what is given of it', async () => {
    await store.layer('bracket', 'T1', { make: { name: 'jacket', colour: 'teal', shapes: square } }, 'agent')
    const renamed = await store.layer('bracket', 'T1', { edit: 1, name: 'water jacket' }, 'agent')
    expect(renamed.layers[0]).toMatchObject({ name: 'water jacket', colour: 'teal', shapes: square, revision: 2 })
    const recoloured = await store.layer('bracket', 'T1', { edit: 1, colour: 'olive', shapes: [] }, 'agent')
    expect(recoloured.layers[0]).toMatchObject({ colour: 'olive', shapes: [], revision: 3 })
  })

  it('writes nothing when an edit changes nothing', async () => {
    await store.layer('bracket', 'T1', { make: { name: 'jacket', colour: 'teal', shapes: square } }, 'agent')
    saves.mockClear()
    const t = await store.layer('bracket', 'T1', { edit: 1, name: 'jacket', colour: 'teal' }, 'agent')
    expect(t.layers[0].revision).toBe(1)
    expect(saves).not.toHaveBeenCalled()
  })

  it('refuses the agent a layer of the person\'s, by id, by name and to remove, naming the person, and leaves the file as it was', async () => {
    await store.layer('bracket', 'T1', { make: { name: 'mine', colour: 'blue', shapes: square } }, 'person')
    const before = readFileSync(join(dir, '.torno', 'tracings.json'), 'utf8')
    saves.mockClear()
    await expect(store.layer('bracket', 'T1', { edit: 1, name: 'x' }, 'agent')).rejects.toThrow(/person's/)
    await expect(store.layer('bracket', 'T1', { make: { name: 'mine', colour: 'blue', shapes: [] } }, 'agent')).rejects.toThrow(/person's/)
    await expect(store.layer('bracket', 'T1', { make: { name: 'MINE', colour: 'blue', shapes: [] } }, 'agent')).rejects.toThrow(/person's/)
    await expect(store.layer('bracket', 'T1', { remove: 1 }, 'agent')).rejects.toThrow(/person's/)
    expect(saves).not.toHaveBeenCalled()
    expect(readFileSync(join(dir, '.torno', 'tracings.json'), 'utf8')).toBe(before)
  })

  it('refuses the person a layer of the agent\'s, naming Claude', async () => {
    await store.layer('bracket', 'T1', { make: { name: 'its', colour: 'blue', shapes: square } }, 'agent')
    await expect(store.layer('bracket', 'T1', { edit: 1, name: 'x' }, 'person')).rejects.toThrow(/Claude's/)
    await expect(store.layer('bracket', 'T1', { remove: 1 }, 'person')).rejects.toThrow(/Claude's/)
  })

  it('removes one\'s own layer, and never gives its number again', async () => {
    await store.layer('bracket', 'T1', { make: { name: 'a', colour: 'blue', shapes: [] } }, 'agent')
    await store.layer('bracket', 'T1', { make: { name: 'b', colour: 'blue', shapes: [] } }, 'agent')
    const t = await store.layer('bracket', 'T1', { remove: 2 }, 'agent')
    expect(t.layers.map((l) => l.id)).toEqual([1])
    const again = await store.layer('bracket', 'T1', { make: { name: 'c', colour: 'blue', shapes: [] } }, 'agent')
    expect(again.layers.map((l) => l.id)).toEqual([1, 3])
  })

  it('refuses a layer that is not there, a name that is taken, a colour that is not one', async () => {
    await store.layer('bracket', 'T1', { make: { name: 'a', colour: 'blue', shapes: [] } }, 'agent')
    await store.layer('bracket', 'T1', { make: { name: 'b', colour: 'blue', shapes: [] } }, 'agent')
    await expect(store.layer('bracket', 'T1', { edit: 7, name: 'x' }, 'agent')).rejects.toThrow(/no layer 7/)
    await expect(store.layer('bracket', 'T1', { remove: 7 }, 'agent')).rejects.toThrow(/no layer 7/)
    await expect(store.layer('bracket', 'T1', { edit: 2, name: 'A' }, 'agent')).rejects.toThrow(/taken/)
    await expect(store.layer('bracket', 'T1', { make: { name: 'c', colour: 'red' as never, shapes: [] } }, 'agent')).rejects.toThrow(/colour/)
    await expect(store.layer('bracket', 'T1', { make: { name: '', colour: 'blue', shapes: [] } }, 'agent')).rejects.toThrow(/name/)
    await expect(store.layer('bracket', 'T1', { make: { name: 'x'.repeat(61), colour: 'blue', shapes: [] } }, 'agent')).rejects.toThrow(/60/)
    await expect(store.layer('bracket', 'T9', { make: { name: 'c', colour: 'blue', shapes: [] } }, 'agent')).rejects.toThrow(/no tracing T9/)
  })

  it('lets the person hide any layer, and show it again', async () => {
    await store.layer('bracket', 'T1', { make: { name: 'its', colour: 'blue', shapes: square } }, 'agent')
    const hidden = await store.hideLayer('bracket', 'T1', 1, true)
    expect(hidden.layers[0].hidden).toBe(true)
    expect(onDisk().tracings[0].layers[0].hidden).toBe(true)
    expect(hidden.layers[0].revision).toBe(1)
    const shown = await store.hideLayer('bracket', 'T1', 1, false)
    expect(shown.layers[0]).not.toHaveProperty('hidden')
    await expect(store.hideLayer('bracket', 'T1', 4, true)).rejects.toThrow(/no layer 4/)
  })

  it('keeps a layer hidden when it is replaced', async () => {
    await store.layer('bracket', 'T1', { make: { name: 'a', colour: 'blue', shapes: [] } }, 'agent')
    await store.hideLayer('bracket', 'T1', 1, true)
    const t = await store.layer('bracket', 'T1', { make: { name: 'a', colour: 'blue', shapes: square } }, 'agent')
    expect(t.layers[0].hidden).toBe(true)
  })

  describe('caps and numbers', () => {
    it('refuses the 21st layer', async () => {
      for (let i = 0; i < MOST_LAYERS; i++) await store.layer('bracket', 'T1', { make: { name: `l${i}`, colour: 'blue', shapes: [] } }, 'agent')
      await expect(store.layer('bracket', 'T1', { make: { name: 'one more', colour: 'blue', shapes: [] } }, 'agent')).rejects.toThrow(/20/)
      // a layer that is replaced is not a new one
      const t = await store.layer('bracket', 'T1', { make: { name: 'l3', colour: 'olive', shapes: [] } }, 'agent')
      expect(t.layers).toHaveLength(MOST_LAYERS)
    })

    it('refuses the 501st shape of a layer, and takes 500', async () => {
      const shapes = (n: number): LayerShape[] => Array.from({ length: n }, (_, i) => ({ kind: 'circle', centre: [i % 50, 1], radius: 0.5 }))
      const t = await store.layer('bracket', 'T1', { make: { name: 'bolts', colour: 'blue', shapes: shapes(MOST_SHAPES) } }, 'agent')
      expect(t.layers[0].shapes).toHaveLength(500)
      await expect(store.layer('bracket', 'T1', { edit: 1, shapes: shapes(MOST_SHAPES + 1) }, 'agent')).rejects.toThrow(/500/)
      await expect(store.layer('bracket', 'T1', { make: { name: 'other', colour: 'blue', shapes: shapes(MOST_SHAPES + 1) } }, 'agent')).rejects.toThrow(/500/)
    })

    it('refuses points past 20 000 in a tracing', async () => {
      const line = (n: number): LayerShape => ({ kind: 'polyline', points: Array.from({ length: n }, (_, i) => [i % 100, Math.floor(i / 100)] as [number, number]) })
      await store.layer('bracket', 'T1', { make: { name: 'a', colour: 'blue', shapes: [line(10_000)] } }, 'agent')
      await store.layer('bracket', 'T1', { make: { name: 'b', colour: 'blue', shapes: [line(10_000)] } }, 'agent')
      await expect(store.layer('bracket', 'T1', { make: { name: 'c', colour: 'blue', shapes: [line(2)] } }, 'agent')).rejects.toThrow(/20000|20 000/)
      // taking its own points away makes room
      await store.layer('bracket', 'T1', { edit: 1, shapes: [line(100)] }, 'agent')
      await store.layer('bracket', 'T1', { make: { name: 'c', colour: 'blue', shapes: [line(2)] } }, 'agent')
    })

    it('refuses a number that is not finite, in any shape', async () => {
      const bad: LayerShape[][] = [
        [{ kind: 'polyline', points: [[0, 0], [Number.NaN, 1]] }],
        [{ kind: 'polyline', points: [[0, 0], [1, Number.POSITIVE_INFINITY]] }],
        [{ kind: 'circle', centre: [Number.NaN, 0], radius: 1 }],
        [{ kind: 'circle', centre: [0, 0], radius: Number.NaN }],
        [{ kind: 'label', at: [0, Number.NEGATIVE_INFINITY], text: 'x' }]
      ]
      for (const shapes of bad) await expect(store.layer('bracket', 'T1', { make: { name: 'n', colour: 'blue', shapes } }, 'agent')).rejects.toThrow(/finite|number/)
      expect((await store.list('bracket')).tracings[0].layers).toEqual([])
    })

    it('refuses a shape that is not whole', async () => {
      const bad: unknown[][] = [
        [{ kind: 'polyline', points: [[0, 0]] }],
        [{ kind: 'circle', centre: [0, 0], radius: 0 }],
        [{ kind: 'circle', centre: [0, 0], radius: -2 }],
        [{ kind: 'label', at: [0, 0], text: '' }],
        [{ kind: 'wall' }],
        [7]
      ]
      for (const shapes of bad) await expect(store.layer('bracket', 'T1', { make: { name: 'n', colour: 'blue', shapes: shapes as LayerShape[] } }, 'agent')).rejects.toThrow()
    })

    it('keeps only the keys a shape has', async () => {
      const t = await store.layer('bracket', 'T1', { make: { name: 'n', colour: 'blue', shapes: [{ kind: 'circle', centre: [1, 1], radius: 2, name: 'bolt 1', id: 4, by: 'person' } as LayerShape] } }, 'agent')
      expect(t.layers[0].shapes).toEqual([{ kind: 'circle', centre: [1, 1], radius: 2, name: 'bolt 1' }])
    })

    it('refuses a number past ten diagonals of the outline\'s bounds', async () => {
      const bounds = { min: [0, 0] as [number, number], max: [30, 40] as [number, number] } // diagonal 50
      const circle = (x: number): LayerShape[] => [{ kind: 'circle', centre: [x, 0], radius: 1 }]
      await store.layer('bracket', 'T1', { make: { name: 'in', colour: 'blue', shapes: circle(530) } }, 'agent', bounds)
      await expect(store.layer('bracket', 'T1', { make: { name: 'out', colour: 'blue', shapes: circle(531) } }, 'agent', bounds)).rejects.toThrow(/diagonal|bounds|outline/)
      await expect(store.layer('bracket', 'T1', { make: { name: 'out', colour: 'blue', shapes: circle(-501) } }, 'agent', bounds)).rejects.toThrow(/diagonal|bounds|outline/)
      await expect(store.layer('bracket', 'T1', { make: { name: 'out', colour: 'blue', shapes: [{ kind: 'circle', centre: [0, 0], radius: 600 }] } }, 'agent', bounds)).rejects.toThrow(/diagonal|bounds|outline/)
      // with no bounds only the finite rule holds
      await store.layer('bracket', 'T1', { make: { name: 'far', colour: 'blue', shapes: circle(1e6) } }, 'agent')
    })
  })
})

describe('movePlane', () => {
  it('moves the origin, keeps the axes, and sets and clears what is lost', async () => {
    await store.make('bracket', ask('face', { plane: { ...plane(), from: { kind: 'face', ref: 'block/F31', revision: 1 } } }), 'person')
    const moved = await store.movePlane('bracket', 'T1', { origin: [0, 12.5, 0] })
    expect(moved.plane.origin).toEqual([0, 12.5, 0])
    expect(moved.plane.x).toEqual([1, 0, 0])
    expect(moved.plane.from).toEqual({ kind: 'face', ref: 'block/F31', revision: 1 })
    const lost = await store.movePlane('bracket', 'T1', { origin: [0, 12.5, 0] }, 'block/F31 is not in this plane any more')
    expect(lost.lost).toBe('block/F31 is not in this plane any more')
    expect(onDisk().tracings[0].lost).toBe('block/F31 is not in this plane any more')
    const found = await store.movePlane('bracket', 'T1', { origin: [0, 12.5, 0] })
    expect(found).not.toHaveProperty('lost')
  })

  it('writes nothing when nothing moved, and refuses an origin that is not finite', async () => {
    await store.make('bracket', ask('a'), 'person')
    saves.mockClear()
    await store.movePlane('bracket', 'T1', { origin: [0, 0, 0] })
    expect(saves).not.toHaveBeenCalled()
    await expect(store.movePlane('bracket', 'T1', { origin: [0, Number.NaN, 0] })).rejects.toThrow(/origin/)
  })
})

describe('what is on the disk', () => {
  it('makes the change on the disk\'s file when it is not what main last read (a pull), and tells the window', async () => {
    await store.make('bracket', ask('mine'), 'person')
    changes.length = 0
    const pulled = onDisk()
    pulled.tracings.push({ ...pulled.tracings[0], id: 'T2', name: 'theirs' })
    pulled.next = 3
    writeFileSync(join(dir, '.torno', 'tracings.json'), JSON.stringify(pulled, null, 2))
    const made = await store.make('bracket', ask('after'), 'person')
    expect(made.id).toBe('T3')
    expect(onDisk().tracings.map((t) => t.name)).toEqual(['mine', 'theirs', 'after'])
    // the pull is told first, then the change
    expect(changes.map((c) => c.file.tracings.length)).toEqual([2, 3])
  })

  it('never gives again a number removed in this run, whatever a pulled file says next is', async () => {
    await store.make('bracket', ask('a'), 'person')
    await store.make('bracket', ask('b'), 'person')
    await store.make('bracket', ask('c'), 'person')
    await store.remove('bracket', 'T3', 'person')
    const text = JSON.parse(readFileSync(join(dir, '.torno', 'tracings.json'), 'utf8'))
    text.next = 1
    writeFileSync(join(dir, '.torno', 'tracings.json'), JSON.stringify(text))
    const made = await store.make('bracket', ask('d'), 'person')
    expect(made.id).toBe('T4')
  })

  it('raises next above a T<n> a pulled file holds', async () => {
    await store.make('bracket', ask('a'), 'person')
    const text = onDisk()
    text.tracings.push({ ...text.tracings[0], id: 'T6' })
    text.next = 1
    writeFileSync(join(dir, '.torno', 'tracings.json'), JSON.stringify(text))
    expect((await store.make('bracket', ask('b'), 'person')).id).toBe('T7')
  })

  it('keeps a build number it holds for a tracing a pull leaves in place', async () => {
    await store.make('bracket', ask('a', { revision: 5 }), 'person')
    const text = onDisk()
    text.tracings[0].name = 'renamed elsewhere'
    writeFileSync(join(dir, '.torno', 'tracings.json'), JSON.stringify(text))
    await store.edit('bracket', 'T1', { parts: ['block'] })
    const got = (await store.list('bracket')).tracings[0]
    expect(got.name).toBe('renamed elsewhere')
    expect(got.revision).toBe(5)
  })

  it('keeps a file it cannot read aside, says so as a problem, and keeps it until dismissed', async () => {
    mkdirSync(join(dir, '.torno'))
    writeFileSync(join(dir, '.torno', 'tracings.json'), '{"next": 4, "tracings": [{"id": "T3", ')
    expect(await store.list('bracket')).toEqual({ next: 4, tracings: [] })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/could not be read/)
    expect(await store.problem('bracket')).toBe(problems[0])
    expect(readdirSync(join(dir, '.torno')).some((n) => n.startsWith('tracings.json.corrupt-'))).toBe(true)
    expect((await store.make('bracket', ask('a'), 'person')).id).toBe('T4')
    await store.dismissProblem('bracket')
    expect(await store.problem('bracket')).toBeNull()
  })

  it('reads the file again after forget', async () => {
    await store.make('bracket', ask('a'), 'person')
    const text = onDisk()
    text.tracings[0].name = 'other'
    writeFileSync(join(dir, '.torno', 'tracings.json'), JSON.stringify(text))
    store.forget()
    expect((await store.list('bracket')).tracings[0].name).toBe('other')
  })

  it('does not tell a workspace that was left, of a write that lands after it', async () => {
    const pending = store.make('bracket', ask('a'), 'person')
    store.forget()
    await pending
    expect(changes).toEqual([])
  })

  it('says when nothing is under way, and waits for what is', async () => {
    expect(store.settled()).toBeNull()
    const pending = store.make('bracket', ask('a'), 'person')
    const settled = store.settled()
    expect(settled).not.toBeNull()
    await settled
    await pending
    expect(store.settled()).toBeNull()
  })
})
