import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyLineup, fitStraight, transformKey } from '../../shared/lineup'
import { faceLabel, mainPlaneFrame } from '../../shared/planes'
import { MOST_LAYERS, MOST_SHAPES, MOST_TRACINGS, type LayerShape, type PlaneSnap, type TracingPlane, type TracingsFile } from '../../shared/tracings'
import { droppedNames } from '../dropped'
import { jpeg, png } from '../notes/testing'
import { PHOTOS_FOLDER, isPhotoName } from './dropped'
import { readPhoto } from './photos'
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

  it('refuses the agent a tracing of its own that holds the person\'s photo or layer, naming what blocks it', async () => {
    await store.make('bracket', ask('its'), 'agent')
    await store.layer('bracket', 'T1', { make: { name: 'bolts', colour: 'plum', shapes: square } }, 'person')
    await store.layer('bracket', 'T1', { make: { name: 'its own', colour: 'teal', shapes: square } }, 'agent')
    await expect(store.remove('bracket', 'T1', 'agent')).rejects.toThrow('T1 holds the layer "bolts"')
    await store.setPhoto('bracket', 'T1', pic(1))
    await expect(store.remove('bracket', 'T1', 'agent')).rejects.toThrow("T1 holds the person's photo and the layer \"bolts\"")
    await store.layer('bracket', 'T1', { make: { name: 'holes', colour: 'blue', shapes: square } }, 'person')
    await expect(store.remove('bracket', 'T1', 'agent')).rejects.toThrow("T1 holds the person's photo and the layers \"bolts\" and \"holes\"")
    expect(onDisk().tracings).toHaveLength(1)
    // The person may remove it, and an agent tracing with only its own layers goes.
    await store.remove('bracket', 'T1', 'person')
    await store.make('bracket', ask('plain'), 'agent')
    await store.layer('bracket', 'T2', { make: { name: 'mine', colour: 'teal', shapes: square } }, 'agent')
    expect((await store.remove('bracket', 'T2', 'agent')).id).toBe('T2')
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

  describe('restore', () => {
    const add = (name: string, by: 'person' | 'agent' = 'person') => store.layer('bracket', 'T1', { make: { name, colour: 'blue', shapes: square } }, by)

    it('puts a removed layer back with its own number, name, colour, shapes and revision, in its place, and keeps the numbers given', async () => {
      await add('a')
      await add('b')
      await add('c')
      await store.layer('bracket', 'T1', { edit: 2, colour: 'plum' }, 'person')
      await store.layer('bracket', 'T1', { remove: 2 }, 'person')
      const t = await store.layer('bracket', 'T1', { restore: 2 }, 'person')
      expect(t.layers.map((l) => [l.id, l.name])).toEqual([[1, 'a'], [2, 'b'], [3, 'c']])
      expect(t.layers[1]).toEqual({ id: 2, name: 'b', colour: 'plum', by: 'person', shapes: square, revision: 2 })
      expect(t.nextLayer).toBe(4)
      expect(onDisk().tracings[0].layers.map((l) => l.id)).toEqual([1, 2, 3])
      // A restore is once only.
      await expect(store.layer('bracket', 'T1', { restore: 2 }, 'person')).rejects.toThrow(/nothing to put back/)
    })

    it('puts back the agent\'s layer for the agent, and refuses the other side, naming the owner', async () => {
      await add('its', 'agent')
      await store.layer('bracket', 'T1', { remove: 1 }, 'agent')
      await expect(store.layer('bracket', 'T1', { restore: 1 }, 'person')).rejects.toThrow(/Claude's/)
      expect((await store.layer('bracket', 'T1', { restore: 1 }, 'agent')).layers[0]).toMatchObject({ id: 1, by: 'agent' })
    })

    it('refuses when the name was taken meanwhile, and leaves the file as it was', async () => {
      await add('a')
      await store.layer('bracket', 'T1', { remove: 1 }, 'person')
      await add('A')
      const before = JSON.stringify(onDisk())
      await expect(store.layer('bracket', 'T1', { restore: 1 }, 'person')).rejects.toThrow(/taken/)
      expect(JSON.stringify(onDisk())).toBe(before)
    })

    it('does not put back what was never removed, nor after forget', async () => {
      await add('a')
      await expect(store.layer('bracket', 'T1', { restore: 1 }, 'person')).rejects.toThrow(/nothing to put back/)
      await store.layer('bracket', 'T1', { remove: 1 }, 'person')
      store.forget()
      await expect(store.layer('bracket', 'T1', { restore: 1 }, 'person')).rejects.toThrow(/nothing to put back/)
    })

    it('keeps the last 20 removed layers of a project', async () => {
      for (let i = 0; i < 21; i++) await store.make('bracket', ask(`t${i}`), 'person')
      for (let i = 0; i < 21; i++) {
        await store.layer('bracket', `T${i + 2}`, { make: { name: 'x', colour: 'blue', shapes: [] } }, 'person')
        await store.layer('bracket', `T${i + 2}`, { remove: 1 }, 'person')
      }
      await expect(store.layer('bracket', 'T2', { restore: 1 }, 'person')).rejects.toThrow(/nothing to put back/)
      expect((await store.layer('bracket', 'T3', { restore: 1 }, 'person')).layers).toHaveLength(1)
    })

    it('is for a tracing that is there', async () => {
      await add('a')
      await store.layer('bracket', 'T1', { remove: 1 }, 'person')
      await store.remove('bracket', 'T1', 'person')
      await expect(store.layer('bracket', 'T1', { restore: 1 }, 'person')).rejects.toThrow(/no tracing T1/)
    })
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

  it('names the face now found by a new ref and the build it is of, only for a face tracing and only when asked', async () => {
    await store.make('bracket', ask('face', { plane: { ...plane(), from: { kind: 'face', ref: 'block/F31', tag: 'top', revision: 1 } } }), 'person')
    await store.make('bracket', ask('main'), 'person')
    const moved = await store.movePlane('bracket', 'T1', { origin: [0, 12.5, 0] }, undefined, { ref: 'block/F7', revision: 5 })
    expect(moved.plane.from).toEqual({ kind: 'face', ref: 'block/F7', tag: 'top', revision: 5 })
    expect(onDisk().tracings[0].plane.from).toEqual({ kind: 'face', ref: 'block/F7', tag: 'top', revision: 5 })
    // Nothing is written for the same ref again, whatever build it is asked on.
    saves.mockClear()
    await store.movePlane('bracket', 'T1', { origin: [0, 12.5, 0] }, undefined, { ref: 'block/F7', revision: 9 })
    expect(saves).not.toHaveBeenCalled()
    await expect(store.movePlane('bracket', 'T1', { origin: [0, 12.5, 0] }, undefined, { ref: '', revision: 9 })).rejects.toThrow(/face/)
    // A tracing that is not on a face keeps its plane's origin.
    expect((await store.movePlane('bracket', 'T2', { origin: [0, 0, 0] }, undefined, { ref: 'block/F7', revision: 5 })).plane.from).toMatchObject({ kind: 'main' })
  })

  it('rebuilds the label of a face plane when the face has another ref now', async () => {
    await store.make('bracket', ask('face', { plane: { ...plane(), label: 'plane through block/F31 offset 0 mm (u = +X, v = +Z)', from: { kind: 'face', ref: 'block/F31', revision: 1 } } }), 'person')
    const moved = await store.movePlane('bracket', 'T1', { origin: [0, 12.5, 0] }, undefined, { ref: 'block/F7', revision: 5 })
    expect(moved.plane.label).toBe(faceLabel('block/F7', 0, moved.plane.x, moved.plane.y))
    expect(moved.plane.label).toContain('block/F7')
    expect(onDisk().tracings[0].plane.label).toBe(moved.plane.label)
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

  it('never gives again a layer number removed in this run, whatever a pulled file says next is', async () => {
    await store.make('bracket', ask('a'), 'person')
    await store.layer('bracket', 'T1', { make: { name: 'one', colour: 'blue', shapes: square } }, 'person')
    await store.layer('bracket', 'T1', { make: { name: 'two', colour: 'teal', shapes: square } }, 'person')
    await store.layer('bracket', 'T1', { remove: 2 }, 'person')
    const text = onDisk()
    text.tracings[0].nextLayer = 2
    writeFileSync(join(dir, '.torno', 'tracings.json'), JSON.stringify(text))
    const t = await store.layer('bracket', 'T1', { make: { name: 'three', colour: 'plum', shapes: square } }, 'person')
    expect(t.layers.map((l) => l.id)).toEqual([1, 3])
    expect(t.nextLayer).toBe(4)
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

/** A picture the checks read the size of, and that no other is the same as. */
const pic = (seed: number, width = 1000, height = 800): Uint8Array => {
  const bytes = png(width, height)
  bytes[30] = seed
  return bytes
}
const photoFiles = (): string[] => readdirSync(join(dir, '.torno', 'tracings', 'photos')).filter((n) => !n.startsWith('.') && n !== 'dropped.json').sort()
const dropped = (): Promise<string[]> => droppedNames(dir, PHOTOS_FOLDER, isPhotoName).then((n) => n.sort())

/** Four photo points on the corners of a 100 × 80 mm plate at 5 px/mm, and the same with the photo turned a little. */
const SQUARE = [
  { photo: [100, 100], uv: [0, 80] },
  { photo: [600, 100], uv: [100, 80] },
  { photo: [600, 500], uv: [100, 0] },
  { photo: [100, 500], uv: [0, 0] }
]
const snaps: PlaneSnap[] = [
  { kind: 'corner', uv: [0, 0], part: 'block' },
  { kind: 'corner', uv: [100, 0], part: 'block' },
  { kind: 'centre', uv: [50, 40], radius: 8, part: 'block', edge: 'block/E14' },
  { kind: 'vertex', uv: [100, 80], part: 'block', ref: 'block/V3' },
  { kind: 'vertex', uv: [0, 80], part: 'block', ref: 'block/V4', projected: true }
]

describe('the photo', () => {
  beforeEach(async () => {
    await store.make('bracket', ask('front'), 'person')
  })

  describe('setPhoto', () => {
    it('keeps the file under a name of main, with its hash and size, and writes the tracing before it tells', async () => {
      const bytes = pic(1, 1200, 900)
      const t = await store.setPhoto('bracket', 'T1', bytes)
      expect(t.photo).toMatchObject({ width: 1200, height: 900, pairs: [], method: 'similar', fade: 0.5 })
      expect(t.photo?.file).toMatch(/^p-[0-9a-f]{12}\.png$/)
      expect(t.photo?.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(photoFiles()).toEqual([t.photo?.file])
      expect(await readPhoto(dir, t.photo?.file as string)).toEqual(bytes)
      expect(onDisk().tracings[0].photo).toEqual(t.photo)
      expect(changes.at(-1)?.file.tracings[0].photo).toEqual(t.photo)
      expect(await dropped()).toEqual([])
    })

    it('names the reference it was taken from, and only a file of reference/', async () => {
      expect((await store.setPhoto('bracket', 'T1', pic(1), 'reference/photo-2.jpg')).photo?.from).toBe('reference/photo-2.jpg')
      for (const bad of ['../secret.jpg', 'reference/../x.jpg', '/etc/passwd', 'photo-2.jpg', 7]) {
        await expect(store.setPhoto('bracket', 'T1', pic(2), bad as string)).rejects.toThrow(/reference/)
      }
      expect(photoFiles()).toHaveLength(1)
    })

    it('refuses what is not a photo, and a tracing that is not there, listing a file it wrote for nothing', async () => {
      await expect(store.setPhoto('bracket', 'T1', png(4001, 10))).rejects.toThrow(/PNG or JPEG/)
      await expect(store.setPhoto('bracket', 'T9', pic(3))).rejects.toThrow(/no tracing T9/)
      const [file] = photoFiles()
      expect(await dropped()).toEqual([file])
      expect((await store.list('bracket')).tracings[0].photo).toBeUndefined()
    })

    it('swaps: keeps the tracing side of the pairs, clears the photo side and the line-up, and lists the old files', async () => {
      await store.setPhoto('bracket', 'T1', pic(1))
      await store.lineUp('bracket', 'T1', SQUARE, 'straight')
      const lined = (await store.list('bracket')).tracings[0].photo
      const copy = await store.setStraightened('bracket', 'T1', jpeg(500, 400), { sha256: lined?.sha256 as string, transform: transformKey(lined?.transform as number[]) })
      await store.setLook('bracket', 'T1', { fade: 0.3, hidden: true })
      const before = copy.photo
      const swapped = (await store.setPhoto('bracket', 'T1', pic(2, 900, 700))).photo
      expect(swapped?.file).not.toBe(before?.file)
      expect(swapped).toMatchObject({ width: 900, height: 700, method: 'straight', fade: 0.3, hidden: true })
      expect(swapped?.pairs).toEqual(SQUARE.map((p) => ({ uv: p.uv })))
      for (const gone of ['transform', 'scale', 'angle', 'fit', 'straightened', 'caption']) expect(swapped).not.toHaveProperty(gone)
      expect(await dropped()).toEqual([before?.file, before?.straightened].sort())
      // The tracing side is what the file keeps, and it reads back.
      store.forget()
      expect((await store.list('bracket')).tracings[0].photo?.pairs).toEqual(SQUARE.map((p) => ({ uv: p.uv })))
    })
  })

  describe('lineUp', () => {
    beforeEach(async () => {
      await store.setPhoto('bracket', 'T1', pic(1))
    })

    it('fits a similarity from 2 points itself and keeps transform, scale and angle, with no fit', async () => {
      const t = await store.lineUp('bracket', 'T1', [SQUARE[0], SQUARE[2]], 'similar')
      expect(t.photo).toMatchObject({ method: 'similar', pairs: [SQUARE[0], SQUARE[2]] })
      expect(t.photo?.scale).toBeCloseTo(5, 9)
      expect(t.photo?.angle).toBeCloseTo(0, 9)
      expect(t.photo?.transform).toHaveLength(9)
      expect(t.photo).not.toHaveProperty('fit')
      expect(onDisk().tracings[0].photo).toEqual(t.photo)
    })

    it('gives a fit when there is a spare point, and straightens from 4', async () => {
      const three = await store.lineUp('bracket', 'T1', SQUARE.slice(0, 3), 'similar')
      expect(three.photo?.fit).toBeLessThan(1e-9)
      const four = await store.lineUp('bracket', 'T1', SQUARE, 'straight')
      expect(four.photo).toMatchObject({ method: 'straight', pairs: SQUARE })
      expect(four.photo?.scale).toBeCloseTo(5, 7)
      expect(four.photo).not.toHaveProperty('fit')
    })

    it('tells a homography\'s scale and angle at the centre it is given (the middle of the outline), not at the clicks', async () => {
      const H = [0.21, 0.02, -30, -0.015, -0.19, 160, 0.00004, 0.00007, 1]
      const pairs = [[120, 90], [880, 130], [900, 700], [60, 640]].map((photo) => ({ photo, uv: applyLineup(H, photo as [number, number]) }))
      const centre: [number, number] = applyLineup(H, [100, 100])
      const at = (await store.lineUp('bracket', 'T1', pairs, 'straight', undefined, centre)).photo
      const clicks = (await store.lineUp('bracket', 'T1', pairs, 'straight')).photo
      const known = fitStraight(pairs as never, { centre })
      if ('error' in known) throw new Error(known.error)
      expect(at?.scale).toBeCloseTo(known.scale, 9)
      expect(at?.angle).toBeCloseTo(known.angle, 9)
      expect(at?.scale).not.toBeCloseTo(clicks?.scale as number, 3)
    })

    it('refuses a straightening whose vanishing line crosses the photo, by the photo\'s own size, and one that would be mirrored', async () => {
      // The photo is 1000 × 800 px; w = 1 - 0.0015 x is zero at x = 667, outside the clicks and inside the photo.
      const bent = [[100, 100], [500, 120], [520, 600], [90, 580]].map(([x, y]) => ({ photo: [x, y], uv: [0.2 * x / (1 - 0.0015 * x), -0.2 * y / (1 - 0.0015 * x)] }))
      await expect(store.lineUp('bracket', 'T1', bent, 'straight')).rejects.toThrow(/the photo would fold/)
      const mirrored = SQUARE.map((p) => ({ photo: p.photo, uv: [p.uv[0], 80 - p.uv[1]] }))
      await expect(store.lineUp('bracket', 'T1', mirrored, 'straight')).rejects.toThrow(/mirrored/)
      expect((await store.list('bracket')).tracings[0].photo?.pairs).toEqual([])
    })

    it('ignores what the window says that is main\'s: a pair keeps only its photo, uv and snap', async () => {
      const lie = { ...SQUARE[0], transform: [9, 9, 9, 9, 9, 9, 9, 9, 9], scale: 99, file: 'p-aaaaaaaaaaaa.png', fit: 0 }
      const t = await store.lineUp('bracket', 'T1', [lie, SQUARE[2]], 'similar')
      expect(t.photo?.pairs[0]).toEqual(SQUARE[0])
      expect(t.photo?.scale).toBeCloseTo(5, 9)
      expect(t.photo?.file).not.toBe('p-aaaaaaaaaaaa.png')
    })

    it('refuses too few, too many, a point outside the photo, a method it does not know, and a tracing with no photo', async () => {
      await expect(store.lineUp('bracket', 'T1', [SQUARE[0]], 'similar')).rejects.toThrow(/2 to 8 points/)
      await expect(store.lineUp('bracket', 'T1', SQUARE.slice(0, 3), 'straight')).rejects.toThrow(/4 to 8 points/)
      await expect(store.lineUp('bracket', 'T1', Array(9).fill(SQUARE[0]), 'similar')).rejects.toThrow(/2 to 8 points/)
      await expect(store.lineUp('bracket', 'T1', [SQUARE[0], { photo: [1001, 5], uv: [1, 1] }], 'similar')).rejects.toThrow(/outside the photo, which is 1000 × 800 px/)
      await expect(store.lineUp('bracket', 'T1', [SQUARE[0], { photo: [Number.NaN, 5], uv: [1, 1] }], 'similar')).rejects.toThrow(/finite/)
      await expect(store.lineUp('bracket', 'T1', SQUARE, 'curved')).rejects.toThrow(/similar/)
      await store.make('bracket', ask('back'), 'person')
      await expect(store.lineUp('bracket', 'T2', SQUARE, 'straight')).rejects.toThrow(/no photo to line up/)
      expect((await store.list('bracket')).tracings[0].photo?.pairs).toEqual([])
    })

    it('refuses points that fix nothing, in words, and leaves the line-up as it was', async () => {
      await store.lineUp('bracket', 'T1', SQUARE, 'straight')
      const was = (await store.list('bracket')).tracings[0].photo
      await expect(store.lineUp('bracket', 'T1', [SQUARE[0], { photo: SQUARE[0].photo, uv: [5, 5] }], 'similar')).rejects.toThrow(/on top of each other/)
      const line = [{ photo: [100, 100], uv: [0, 80] }, { photo: [350, 101], uv: [50, 80] }, { photo: [600, 100], uv: [100, 80] }, { photo: [350, 500], uv: [50, 0] }]
      await expect(store.lineUp('bracket', 'T1', line, 'straight')).rejects.toThrow(/almost in a line/)
      expect((await store.list('bracket')).tracings[0].photo).toEqual(was)
    })

    it('a new line-up makes the straightened copy out of date: it goes and is listed', async () => {
      await store.lineUp('bracket', 'T1', SQUARE, 'straight')
      const lined = (await store.list('bracket')).tracings[0].photo
      const copied = (await store.setStraightened('bracket', 'T1', jpeg(500, 400), { sha256: lined?.sha256 as string, transform: transformKey(lined?.transform as number[]) })).photo
      const t = await store.lineUp('bracket', 'T1', [SQUARE[0], SQUARE[1]], 'similar')
      expect(t.photo).not.toHaveProperty('straightened')
      expect(await dropped()).toEqual([copied?.straightened])
    })

    describe('snapped points', () => {
      const pairs = (uv: [number, number], snap: object) => [{ photo: [100, 500], uv, snap }, SQUARE[1]]

      it('replaces a corner 0.005 mm off by the kernel\'s, and says so in what it keeps', async () => {
        const t = await store.lineUp('bracket', 'T1', pairs([0.005, 0], { corner: [0.005, 0] }), 'similar', snaps)
        expect(t.photo?.pairs[0]).toEqual({ photo: [100, 500], uv: [0, 0], snap: { corner: [0, 0] } })
      })

      it('refuses one 0.02 mm off, and keeps nothing', async () => {
        await expect(store.lineUp('bracket', 'T1', pairs([0.02, 0], { corner: [0, 0] }), 'similar', snaps)).rejects.toThrow(/Point 1 says it was snapped to a corner of the cut, and it is 0\.02 mm from it/)
        expect((await store.list('bracket')).tracings[0].photo?.pairs).toEqual([])
      })

      it('finds a hole centre by its edge or by its place, and a vertex by its ref', async () => {
        const centre = await store.lineUp('bracket', 'T1', pairs([50.004, 40], { centre: 'block/E14' }), 'similar', snaps)
        expect(centre.photo?.pairs[0]).toMatchObject({ uv: [50, 40], snap: { centre: 'block/E14' } })
        const place = await store.lineUp('bracket', 'T1', pairs([50, 40.009], { centre: [50, 40] }), 'similar', snaps)
        expect(place.photo?.pairs[0]).toMatchObject({ uv: [50, 40], snap: { centre: [50, 40] } })
        const vertex = await store.lineUp('bracket', 'T1', [{ photo: [600, 100], uv: [100, 80], snap: { vertex: 'block/V3' } }, SQUARE[3]], 'similar', snaps)
        expect(vertex.photo?.pairs[0]).toMatchObject({ uv: [100, 80], snap: { vertex: 'block/V3' } })
      })

      it('refuses a snap to something the outline does not have, a vertex that is only projected, and a snap that names two things', async () => {
        await expect(store.lineUp('bracket', 'T1', pairs([5, 5], { corner: [5, 5] }), 'similar', [{ kind: 'vertex', uv: [1, 1], part: 'b', ref: 'b/V1' }])).rejects.toThrow(/has no corner of the cut/)
        await expect(store.lineUp('bracket', 'T1', pairs([0, 80], { vertex: 'block/V4' }), 'similar', snaps)).rejects.toThrow(/not in the tracing's plane/)
        await expect(store.lineUp('bracket', 'T1', pairs([0, 0], { vertex: 'block/V9' }), 'similar', snaps)).rejects.toThrow(/has no vertex block\/V9/)
        await expect(store.lineUp('bracket', 'T1', pairs([0, 0], { corner: [0, 0], vertex: 'block/V3' }), 'similar', snaps)).rejects.toThrow(/one of them/)
      })

      it('refuses every snap when there is no outline to check it against', async () => {
        await expect(store.lineUp('bracket', 'T1', pairs([0, 0], { corner: [0, 0] }), 'similar')).rejects.toThrow(/no outline of this tracing on a build/)
      })

      it('takes a point that says nothing of a snap as it is, with or without an outline', async () => {
        const t = await store.lineUp('bracket', 'T1', [SQUARE[0], SQUARE[1]], 'similar', snaps)
        expect(t.photo?.pairs[0]).toEqual(SQUARE[0])
      })
    })
  })

  describe('setLook', () => {
    it('sets the fade and hides or shows, one at a time, and travels', async () => {
      await store.setPhoto('bracket', 'T1', pic(1))
      expect((await store.setLook('bracket', 'T1', { fade: 0.2 })).photo).toMatchObject({ fade: 0.2 })
      const hidden = await store.setLook('bracket', 'T1', { hidden: true })
      expect(hidden.photo).toMatchObject({ fade: 0.2, hidden: true })
      expect(onDisk().tracings[0].photo).toMatchObject({ fade: 0.2, hidden: true })
      expect((await store.setLook('bracket', 'T1', { hidden: false })).photo).not.toHaveProperty('hidden')
      expect((await store.setLook('bracket', 'T1', { fade: 0 })).photo?.fade).toBe(0)
    })

    it('refuses a fade outside 0 to 1, a hidden that is no boolean and a tracing with no photo, and takes no other key', async () => {
      await expect(store.setLook('bracket', 'T1', { fade: 0.5 })).rejects.toThrow(/no photo/)
      await store.setPhoto('bracket', 'T1', pic(1))
      for (const fade of [-0.1, 1.1, Number.NaN, '0.5']) await expect(store.setLook('bracket', 'T1', { fade } as never)).rejects.toThrow(/0 to 1/)
      await expect(store.setLook('bracket', 'T1', { hidden: 'yes' } as never)).rejects.toThrow(/hidden or shown/)
      const t = await store.setLook('bracket', 'T1', { fade: 0.4, scale: 3, file: 'p-aaaaaaaaaaaa.png' } as never)
      expect(t.photo?.fade).toBe(0.4)
      expect(t.photo).not.toHaveProperty('scale')
    })
  })

  describe('setStraightened', () => {
    let of: { sha256: string; transform: string }
    beforeEach(async () => {
      await store.setPhoto('bracket', 'T1', pic(1))
      const t = await store.lineUp('bracket', 'T1', SQUARE, 'straight')
      of = { sha256: t.photo?.sha256 as string, transform: transformKey(t.photo?.transform as number[]) }
    })

    it('keeps the copy as s-<12 hex> for the photo and the line-up it was made from, and lists the one it replaces', async () => {
      const first = (await store.setStraightened('bracket', 'T1', jpeg(500, 400), of)).photo?.straightened
      expect(first).toMatch(/^s-[0-9a-f]{12}\.jpg$/)
      expect(await readPhoto(dir, first as string)).toEqual(jpeg(500, 400))
      expect(await dropped()).toEqual([])
      const second = (await store.setStraightened('bracket', 'T1', pic(7, 500, 400), of)).photo?.straightened
      expect(second).toMatch(/^s-[0-9a-f]{12}\.png$/)
      expect(await dropped()).toEqual([first])
      expect(onDisk().tracings[0].photo?.straightened).toBe(second)
    })

    it('refuses a copy made for another line-up or another photo, and writes no file for it', async () => {
      await expect(store.setStraightened('bracket', 'T1', jpeg(500, 400), { ...of, transform: '1,2,3' })).rejects.toThrow(/another photo or another line-up/)
      await expect(store.setStraightened('bracket', 'T1', jpeg(500, 400), { ...of, sha256: 'a'.repeat(64) })).rejects.toThrow(/another photo or another line-up/)
      expect(photoFiles()).toHaveLength(1)
      expect((await store.list('bracket')).tracings[0].photo).not.toHaveProperty('straightened')
    })

    it('refuses a copy of the old transform once a new line-up is made, even when the line-up lands while it is kept', async () => {
      const turned = SQUARE.map((p, i) => (i === 0 ? { ...p, photo: [120, 110] } : p))
      const [late] = await Promise.allSettled([store.setStraightened('bracket', 'T1', jpeg(500, 400), of), store.lineUp('bracket', 'T1', turned, 'straight')])
      expect(late.status).toBe('rejected')
      expect((await store.list('bracket')).tracings[0].photo).not.toHaveProperty('straightened')
      // The file it wrote is listed, so that the sweep takes it.
      expect((await dropped()).filter((n) => n.startsWith('s-'))).toHaveLength(1)
    })

    it('refuses a copy that is no picture, a tracing with no line-up and an `of` that says nothing', async () => {
      await expect(store.setStraightened('bracket', 'T1', png(4001, 4), of)).rejects.toThrow(/PNG or JPEG/)
      await expect(store.setStraightened('bracket', 'T1', jpeg(5, 5), {} as never)).rejects.toThrow(/says the photo and the line-up/)
      await store.setPhoto('bracket', 'T1', pic(9))
      await expect(store.setStraightened('bracket', 'T1', jpeg(5, 5), of)).rejects.toThrow(/no line-up/)
    })
  })

  describe('removing', () => {
    it('removePhoto takes the photo and lists both files', async () => {
      await store.setPhoto('bracket', 'T1', pic(1))
      const t = await store.lineUp('bracket', 'T1', SQUARE, 'straight')
      const lined = t.photo
      const copied = (await store.setStraightened('bracket', 'T1', jpeg(500, 400), { sha256: lined?.sha256 as string, transform: transformKey(lined?.transform as number[]) })).photo
      const gone = await store.removePhoto('bracket', 'T1')
      expect(gone).not.toHaveProperty('photo')
      expect(await dropped()).toEqual([copied?.file, copied?.straightened].sort())
      await expect(store.removePhoto('bracket', 'T1')).rejects.toThrow(/no photo/)
    })

    it('removing the tracing lists its photo too, and putting it back leaves the files named', async () => {
      const file = (await store.setPhoto('bracket', 'T1', pic(1))).photo?.file as string
      await store.remove('bracket', 'T1', 'person')
      expect(await dropped()).toEqual([file])
      await store.restore('bracket', 'T1')
      expect((await store.list('bracket')).tracings[0].photo?.file).toBe(file)
    })
  })

  describe('withPhotos', () => {
    it('gives the files the tracings name as live, and those of a tracing removed in this run as kept', async () => {
      const a = (await store.setPhoto('bracket', 'T1', pic(1))).photo?.file as string
      await store.make('bracket', ask('back'), 'person')
      const b = (await store.setPhoto('bracket', 'T2', pic(2))).photo?.file as string
      await store.remove('bracket', 'T2', 'person')
      await store.withPhotos('bracket', async (held, where, problem) => {
        expect([...held.live]).toEqual([a])
        expect([...held.kept]).toEqual([b])
        expect(where).toBe(dir)
        expect(problem).toBeNull()
      })
    })

    it('reads tracings.json again when the disk text is not what main last wrote (a git pull), so the photos a pull brought are live', async () => {
      const mine = (await store.setPhoto('bracket', 'T1', pic(1))).photo?.file as string
      const text = onDisk()
      text.tracings.push({ ...structuredClone(text.tracings[0]), id: 'T2', photo: { file: 'p-ffffffffffff.png', sha256: 'a'.repeat(64), width: 10, height: 10, pairs: [], method: 'similar', fade: 0.5 } })
      text.next = 3
      writeFileSync(join(dir, '.torno', 'tracings.json'), `${JSON.stringify(text, null, 2)}\n`)
      await store.withPhotos('bracket', async (held) => {
        expect([...held.live].sort()).toEqual([mine, 'p-ffffffffffff.png'].sort())
      })
      // What was read is kept, and the window is told of it, as any change does.
      expect((await store.list('bracket')).tracings.map((t) => t.id)).toEqual(['T1', 'T2'])
      expect(changes.at(-1)?.file.tracings.map((t) => t.id)).toEqual(['T1', 'T2'])
    })

    it('says what was wrong with the file when it was read', async () => {
      writeFileSync(join(dir, '.torno', 'tracings.json'), 'not json')
      store.forget()
      await store.withPhotos('bracket', async (_held, _where, problem) => {
        expect(problem).toMatch(/could not be read/)
      })
    })
  })
})
