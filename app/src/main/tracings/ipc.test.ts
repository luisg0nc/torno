import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Described } from '../../shared/geometry'
import { applyLineup, fitStraight, transformKey } from '../../shared/lineup'
import { mainPlaneFrame } from '../../shared/planes'
import type { Scene } from '../../shared/scene'
import type { ViewState } from '../../shared/view'
import type { ObjectInfo } from '../../shared/workspace'
import { NO_SECTION } from '../export/section'
import { jpeg, png } from '../notes/testing'
import { Refusal } from '../refusal'
import { type TracingIpcDeps, tracingHandlers } from './ipc'
import { Outlines } from './outline'
import { TracingStore } from './store'

let root: string
let dir: string
let store: TracingStore
let outlines: Outlines
let scene: Scene
let revision: number
let view: ViewState | undefined
let queries: Array<{ name: string; args: Record<string, unknown> }>
let reply: (name: string, args: Record<string, any>) => unknown
let reply0: (name: string, args: Record<string, any>) => unknown

const obj = (): ObjectInfo => ({ id: 'bracket', name: 'bracket', dir, model: 'model.py' })
const part = (name: string, layout: string, tags?: Record<string, { faces?: number[] }>) => ({ name, layout, loc: { t: [0, 0, 0], q: [0, 0, 0, 1] }, bbox: { min: [0, 0, 0], max: [10, 10, 10] }, mesh: {}, ...(tags ? { tags } : {}) })
const plane = (over: Partial<Extract<Described, { kind: 'face' }>> = {}): Described => ({ kind: 'face', ref: 'block/F31', type: 'plane', area: 100, center: [5, 5, 10], normal: [0, 0, 1], radius: null, descriptor: 'plane, normal +Z, z = 10, 100 mm²', ...over })
const sectionReply = (args: Record<string, any>) => ({ plane: { ...args.plane, x: [1, 0, 0], y: [0, 1, 0] }, bounds: { min: [0, 0], max: [10, 10] }, parts: [] })

const deps = (): TracingIpcDeps => ({
  tracings: store,
  outlines,
  object: (id) => (id === 'bracket' ? obj() : undefined),
  build: () => ({ revision, scene }),
  view: () => view,
  query: async (_id, name, args) => {
    queries.push({ name, args: args as Record<string, unknown> })
    return reply(name, args as Record<string, any>) as never
  }
})
const handlers = () => tracingHandlers(deps())
const on = { main: 'XZ', offset: 40 }
const ask = (over: Record<string, unknown> = {}) => ({ on, layout: 'assembly', ...over })
const refused = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(Refusal)
    return (e as Error).message
  }
  throw new Error('was not refused')
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'torno-tracings-ipc-'))
  dir = join(root, 'bracket')
  mkdirSync(dir)
  store = new TracingStore({ dirOf: (id) => (id === 'bracket' ? dir : undefined), now: () => new Date('2026-11-17T12:00:00.000Z') })
  revision = 4
  scene = { layouts: ['assembly', 'print'], parts: [part('block', 'assembly', { top: { faces: [31] } }), part('lid', 'assembly'), part('block', 'print')] } as unknown as Scene
  view = undefined
  queries = []
  reply = (name, args) => {
    if (name === 'describe') return plane()
    if (name === 'selectors') return { selectors: [{ ref: args.refs[0], type: 'PLANE', center: [1, 2, 10], normal: [0, 0, 1], selector: null }] }
    if (name === 'section') return sectionReply(args)
    throw new Error(`unexpected ${name}`)
  }
  reply0 = reply
  outlines = new Outlines({ tracings: store, build: () => ({ revision, scene, blob: new Uint8Array(0) }), query: async (_id, name, args) => reply(name, args as Record<string, any>) as never, nearest: async () => [], refind: async () => [], log: () => {} })
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('tracings:make', () => {
  it('makes the person\'s tracing on a main plane: main makes the frame, the build is the last', async () => {
    const t = await handlers().make('bracket', ask({ name: 'front', parts: ['block'] }))
    expect(t).toMatchObject({ id: 'T1', by: 'person', name: 'front', layout: 'assembly', parts: ['block'], revision: 4, layers: [] })
    expect(t.plane).toMatchObject({ origin: [0, 40, 0], x: [1, 0, 0], y: [0, 0, 1], from: { kind: 'main', axis: 'XZ', offset: 40 } })
    expect(t.plane.label).toBe('XZ at y = 40.0 (u = +X, v = +Z)')
    expect(queries).toEqual([])
  })

  it('makes one on a planar face from the kernel\'s describe, with the tag the model gives that face', async () => {
    const t = await handlers().make('bracket', ask({ on: { face: 'block/F31' } }))
    expect(queries).toEqual([{ name: 'describe', args: { ref: 'assembly:block/F31' } }, { name: 'selectors', args: { layout: 'assembly', refs: ['block/F31'] } }])
    // The origin is the point on the face the kernel gives, not the centre `describe` says (which a hole may be at).
    expect(t.plane).toEqual({ origin: [1, 2, 10], x: [1, 0, 0], y: [0, 1, 0], label: 'plane through block/F31 offset 0 mm (u = +X, v = +Y)', from: { kind: 'face', ref: 'block/F31', tag: 'top', revision: 4 } })
  })

  it('takes a tag that names one face as that face', async () => {
    const t = await handlers().make('bracket', ask({ on: { face: 'block/@top' } }))
    expect(queries[0].args).toEqual({ ref: 'assembly:block/F31' })
    expect(queries[1].args).toEqual({ layout: 'assembly', refs: ['block/F31'] })
    expect(t.plane.from).toMatchObject({ kind: 'face', ref: 'block/F31', tag: 'top' })
  })

  it('refuses a curved face, in words, and an edge, a part, a ref of no part, and a tag of no single face', async () => {
    reply = () => plane({ type: 'cylinder', normal: [1, 0, 0], radius: 5 })
    expect(await refused(handlers().make('bracket', ask({ on: { face: 'block/F2' } })))).toBe('block/F2 is a cylinder, not a plane: a tracing lies on a flat face')
    expect(await refused(handlers().make('bracket', ask({ on: { face: 'block' } })))).toMatch(/face of a part/)
    expect(await refused(handlers().make('bracket', ask({ on: { face: 'nowhere/F1' } })))).toMatch(/no part nowhere/)
    expect(await refused(handlers().make('bracket', ask({ on: { face: 'block/@nothing' } })))).toMatch(/no tag @nothing/)
    expect((await store.list('bracket')).tracings).toEqual([])
  })

  it('refuses a face the kernel gives no point on', async () => {
    reply = (name) => (name === 'describe' ? plane() : { selectors: [{ ref: 'block/F31', selector: null, selectorWhy: 'the part has no face F31' }] })
    expect(await refused(handlers().make('bracket', ask({ on: { face: 'block/F31' } })))).toMatch(/no point on block\/F31/)
  })

  it('refuses a face the kernel cannot describe, saying why', async () => {
    reply = () => {
      throw new Error('block has 6 faces, F31 is not one')
    }
    expect(await refused(handlers().make('bracket', ask({ on: { face: 'block/F31' } })))).toMatch(/could not say.*F31 is not one/)
  })

  it('takes the section on screen, with the axes the kernel gives for it', async () => {
    view = { objectId: 'bracket', layout: 'assembly', camera: {}, visible: [], section: { origin: [3, 4, 12.5], normal: [0, 0, 1] } } as unknown as ViewState
    const t = await handlers().make('bracket', ask({ on: { section: true } }))
    expect(queries).toHaveLength(1)
    expect(queries[0]).toMatchObject({ name: 'section', args: { layout: 'assembly', plane: { origin: [3, 4, 12.5], normal: [0, 0, 1] }, parts: ['block'] } })
    expect(t.plane).toMatchObject({ origin: [3, 4, 12.5], x: [1, 0, 0], y: [0, 1, 0], from: { kind: 'section', origin: [3, 4, 12.5], normal: [0, 0, 1] } })
  })

  it('refuses a section when none is on screen, or it is of another layout', async () => {
    expect(await refused(handlers().make('bracket', ask({ on: { section: true } })))).toBe(NO_SECTION)
    view = { objectId: 'bracket', layout: 'print', camera: {}, visible: [], section: { origin: [0, 0, 1], normal: [0, 0, 1] } } as unknown as ViewState
    expect(await refused(handlers().make('bracket', ask({ on: { section: true } })))).toMatch(/section on screen is of the print layout/)
    expect(queries).toEqual([])
  })

  it('ignores id, by and everything else that is main\'s, and makes the person\'s tracing T1', async () => {
    const t = await handlers().make('bracket', { ...ask(), id: 'T9', by: 'agent', nextLayer: 9, lost: 'x', layers: [{ id: 1 }], photo: { file: 'p-0123456789ab.jpg' }, revision: 99, build: { id: 'x', sources: 'y' } })
    expect(t).toMatchObject({ id: 'T1', by: 'person', nextLayer: 1, layers: [], revision: 4 })
    expect(t).not.toHaveProperty('lost')
    expect(t).not.toHaveProperty('photo')
    expect(t).not.toHaveProperty('build')
    expect(await store.list('bracket')).toMatchObject({ next: 2 })
  })

  it('refuses what is not a tracing: the project, the plane, the layout, the parts, the name', async () => {
    const h = handlers()
    expect(await refused(h.make('nope', ask()))).toBe('That project is not open.')
    expect(await refused(h.make('bracket', 'x' as never))).toMatch(/not a tracing/)
    expect(await refused(h.make('bracket', ask({ on: undefined })))).toMatch(/plane/)
    expect(await refused(h.make('bracket', ask({ on: { main: 'AB', offset: 1 } })))).toMatch(/XY, XZ or YZ/)
    expect(await refused(h.make('bracket', ask({ on: { main: 'XY', offset: 'far' } })))).toMatch(/offset/)
    expect(await refused(h.make('bracket', ask({ on: { main: 'XY', offset: 1, face: 'block/F1' } })))).toMatch(/one of/)
    expect(await refused(h.make('bracket', ask({ layout: 'elsewhere' })))).toMatch(/no layout elsewhere/)
    expect(await refused(h.make('bracket', ask({ layout: 7 })))).toMatch(/layout/)
    expect(await refused(h.make('bracket', ask({ parts: ['ghost'] })))).toMatch(/no part ghost/)
    expect(await refused(h.make('bracket', ask({ name: 'two\nlines' })))).toMatch(/one line/)
    expect((await store.list('bracket')).tracings).toEqual([])
  })

  it('refuses a face or a section of a project that has no build, but makes a main plane', async () => {
    const none = tracingHandlers({ ...deps(), build: () => undefined })
    expect(await refused(none.make('bracket', ask({ on: { face: 'block/F31' } })))).toMatch(/not been built/)
    expect((await none.make('bracket', ask())).id).toBe('T1')
  })

  it('refuses a face when a build landed while the kernel was asked', async () => {
    reply = () => {
      revision = 5
      return plane()
    }
    expect(await refused(handlers().make('bracket', ask({ on: { face: 'block/F31' } })))).toMatch(/new build landed/)
  })
})

describe('the rest of the person\'s door', () => {
  it('lists the file, edits the name and parts, removes and restores', async () => {
    const h = handlers()
    await h.make('bracket', ask())
    expect(await h.list('bracket')).toMatchObject({ next: 2, tracings: [{ id: 'T1' }] })
    expect(await h.edit('bracket', 'T1', { name: 'front', parts: ['lid'], id: 'T5', by: 'agent' } as never)).toMatchObject({ id: 'T1', by: 'person', name: 'front', parts: ['lid'] })
    expect(await h.edit('bracket', 'T1', { parts: null })).not.toHaveProperty('parts')
    expect(await refused(h.edit('bracket', 'T1', { parts: ['ghost'] }))).toMatch(/no part ghost/)
    await h.remove('bracket', 'T1')
    expect((await h.list('bracket')).tracings).toEqual([])
    expect(await h.restore('bracket', 'T1')).toMatchObject({ id: 'T1', name: 'front' })
  })

  it('names a project that is open and a tracing as T<n>', async () => {
    const h = handlers()
    expect(await refused(h.list('nope'))).toBe('That project is not open.')
    expect(await refused(h.remove('bracket', '../T1'))).toMatch(/not a tracing/)
    expect(await refused(h.edit('bracket', 7 as never, {}))).toMatch(/not a tracing/)
    expect(await refused(h.restore('bracket', 'T1'))).toMatch(/nothing to put back/)
  })

  it('removes the agent\'s tracing: the person removes any', async () => {
    await handlers().make('bracket', ask())
    await store.make('bracket', { name: 'its', layout: 'assembly', plane: { ...mainPlaneFrame('XY', 0), from: { kind: 'main', axis: 'XY', offset: 0 } } }, 'agent')
    await handlers().remove('bracket', 'T2')
    expect((await store.list('bracket')).tracings.map((t) => t.id)).toEqual(['T1'])
  })
})

describe('tracings:layer', () => {
  const square = [{ kind: 'polyline', points: [[0, 0], [10, 0], [10, 10], [0, 10]], closed: true }]

  it('makes the person\'s layer, edits and hides it, and removes it; never takes by or id', async () => {
    const h = handlers()
    await h.make('bracket', ask())
    const made = await h.layer('bracket', 'T1', { make: { name: 'jacket', colour: 'teal', shapes: square, by: 'agent', id: 9 } } as never)
    expect(made.layers).toEqual([{ id: 1, name: 'jacket', colour: 'teal', by: 'person', shapes: square, revision: 1 }])
    expect((await h.layer('bracket', 'T1', { edit: 1, colour: 'blue', id: 4, by: 'agent' } as never)).layers[0]).toMatchObject({ id: 1, by: 'person', colour: 'blue', revision: 2 })
    expect((await h.layer('bracket', 'T1', { hide: 1, hidden: true })).layers[0].hidden).toBe(true)
    expect((await h.layer('bracket', 'T1', { hide: 1, hidden: false })).layers[0].hidden).toBeUndefined()
    expect((await h.layer('bracket', 'T1', { remove: 1 })).layers).toEqual([])
  })

  it("does not change the agent's layer", async () => {
    const h = handlers()
    await h.make('bracket', ask())
    await store.layer('bracket', 'T1', { make: { name: 'its', colour: 'sky', shapes: [] } }, 'agent')
    expect(await refused(h.layer('bracket', 'T1', { edit: 1, name: 'mine' }))).toMatch(/Claude's/)
    expect(await refused(h.layer('bracket', 'T1', { remove: 1 }))).toMatch(/Claude's/)
    expect((await h.layer('bracket', 'T1', { hide: 1, hidden: true })).layers[0].hidden).toBe(true)
  })

  it('refuses a change that is not one, an id that is not a layer, and shapes far from the outline', async () => {
    const h = handlers()
    await h.make('bracket', ask())
    expect(await refused(h.layer('bracket', 'T1', 'x' as never))).toMatch(/not a change/)
    expect(await refused(h.layer('bracket', 'T1', {} as never))).toMatch(/one of them/)
    expect(await refused(h.layer('bracket', 'T1', { edit: 'a' } as never))).toMatch(/no layer/)
    expect(await refused(h.layer('bracket', 'T1', { hide: 1, hidden: 'yes' } as never))).toMatch(/hidden or shown/)
    // The outline is 10 mm across: ten diagonals is far less than a million.
    expect(await refused(h.layer('bracket', 'T1', { make: { name: 'far', colour: 'blue', shapes: [{ kind: 'label', at: [1e6, 0], text: 'x' }] } }))).toMatch(/ten diagonals/)
  })
})

describe('shapes of a layer when the outline cannot be cut', () => {
  it('are held to the layout\'s parts instead, within ten diagonals of them, for the person and for Claude', async () => {
    const h = handlers()
    await h.make('bracket', ask({ parts: ['block'] }))
    reply = (name, args) => {
      if (name === 'section') throw new Error('the cut failed')
      return reply0(name, args)
    }
    const far = { make: { name: 'far', colour: 'blue' as const, shapes: [{ kind: 'label' as const, at: [1e6, 0] as [number, number], text: 'x' }] } }
    expect(await refused(h.layer('bracket', 'T1', far))).toMatch(/ten diagonals/)
    expect(await refused(h.agentLayer('bracket', 'T1', far))).toMatch(/ten diagonals/)
    const near = { make: { name: 'near', colour: 'teal' as const, shapes: [{ kind: 'label' as const, at: [30, 20] as [number, number], text: 'x' }] } }
    expect((await h.agentLayer('bracket', 'T1', near)).layers.map((l) => l.name)).toEqual(['near'])
  })

  it('takes the box of the parts in the tracing\'s own u and v, and only the parts it draws', async () => {
    const h = handlers()
    // The XZ plane: u runs along +X and v along +Z.
    scene = { layouts: ['assembly'], parts: [{ ...part('big', 'assembly'), bbox: { min: [0, 0, 0], max: [5000, 5000, 5000] } }, part('small', 'assembly')] } as unknown as Scene
    await h.make('bracket', ask({ parts: ['small'] }))
    reply = (name, args) => {
      if (name === 'section') throw new Error('the cut failed')
      return reply0(name, args)
    }
    const at = (u: number) => ({ make: { name: `at ${u}`, colour: 'blue' as const, shapes: [{ kind: 'label' as const, at: [u, 0] as [number, number], text: 'x' }] } })
    expect(await refused(h.layer('bracket', 'T1', at(4000)))).toMatch(/ten diagonals/)
    expect((await h.layer('bracket', 'T1', at(500))).layers).toHaveLength(1)
  })
})

describe('a plane given as a point and a normal', () => {
  it('is the frozen plane of that point and normal, with the kernel\'s axes, for the person and for Claude', async () => {
    const h = handlers()
    const t = await h.make('bracket', { on: { origin: [0, 0, 5], normal: [0, 0, 2] }, layout: 'assembly' })
    expect(t.plane.from).toEqual({ kind: 'section', origin: [0, 0, 5], normal: [0, 0, 1] })
    expect(t.plane.origin).toEqual([0, 0, 5])
    expect(queries.find((q) => q.name === 'section')?.args).toMatchObject({ layout: 'assembly', plane: { origin: [0, 0, 5], normal: [0, 0, 1] }, parts: ['block'] })
    const agent = await h.agentMake('bracket', { on: { origin: [0, 0, 5], normal: [0, 0, 1] }, name: 'cut', layout: 'assembly' })
    expect(agent).toMatchObject({ id: 'T2', by: 'agent', name: 'cut' })
  })

  it('is refused when it is not a point and a normal, or is given with another plane', async () => {
    const h = handlers()
    for (const on of [{ origin: [0, 0], normal: [0, 0, 1] }, { origin: [0, 0, 0], normal: [0, 0, 0] }, { origin: [0, 0, 0], normal: [0, 0, Number.NaN] }, { origin: [0, 0, 0] }, { normal: [0, 0, 1] }, { origin: [0, 0, 0], normal: [0, 0, 1], main: 'XZ' }]) {
      expect(await refused(h.make('bracket', { on, layout: 'assembly' })), JSON.stringify(on)).toMatch(/plane|normal|origin/)
    }
    expect((await store.list('bracket')).tracings).toEqual([])
  })
})

describe('what Claude may do through the tracings handlers', () => {
  const square = [{ kind: 'polyline', points: [[0, 0], [10, 0], [10, 10], [0, 10]], closed: true }]

  it('makes its own tracing on a main plane or a face, and removes only its own, naming the owner of another', async () => {
    const h = handlers()
    await h.make('bracket', ask({ name: 'mine' }))
    const on = await h.agentMake('bracket', { on: { main: 'XZ', offset: 0 }, name: 'front', layout: 'assembly' })
    expect(on).toMatchObject({ id: 'T2', by: 'agent', name: 'front', plane: { label: 'XZ at y = 0.0 (u = +X, v = +Z)' } })
    const face = await h.agentMake('bracket', { on: { face: 'block/F31' }, name: 'top', layout: 'assembly' })
    expect(face.plane.from).toMatchObject({ kind: 'face', ref: 'block/F31' })
    expect(await refused(h.agentRemove('bracket', 'T1'))).toMatch(/the person's/)
    expect((await store.list('bracket')).tracings.map((t) => t.id)).toEqual(['T1', 'T2', 'T3'])
    await h.agentRemove('bracket', 'T2')
    expect((await store.list('bracket')).tracings.map((t) => t.id)).toEqual(['T1', 'T3'])
  })

  it('refuses a face that is not flat, and keeps no key but the plane, the name and the layout', async () => {
    const h = handlers()
    reply = (name, args) => (name === 'describe' ? plane({ type: 'cylinder', descriptor: 'cylinder' }) : name === 'selectors' ? { selectors: [{ ref: args.refs[0], center: [1, 2, 10] }] } : sectionReply(args))
    expect(await refused(h.agentMake('bracket', { on: { face: 'block/F31' }, layout: 'assembly' }))).toMatch(/flat|plane|planar/)
    reply = (name, args) => (name === 'describe' ? plane() : name === 'selectors' ? { selectors: [{ ref: args.refs[0], center: [1, 2, 10] }] } : sectionReply(args))
    const t = await h.agentMake('bracket', { on: { main: 'XY' }, layout: 'assembly', by: 'person', id: 'T9', layers: [{ id: 1 }] } as never)
    expect(t).toMatchObject({ id: 'T1', by: 'agent', layers: [] })
  })

  it('makes and replaces its own layer by name, with the same number, and removes it; every number held to the outline', async () => {
    const h = handlers()
    await h.make('bracket', ask())
    const one = await h.agentLayer('bracket', 'T1', { make: { name: 'bolts', colour: 'plum', shapes: square } })
    expect(one.layers).toEqual([{ id: 1, name: 'bolts', colour: 'plum', by: 'agent', shapes: square, revision: 1 }])
    const two = await h.agentLayer('bracket', 'T1', { make: { name: 'Bolts', colour: 'blue', shapes: [] } })
    expect(two.layers).toMatchObject([{ id: 1, name: 'Bolts', colour: 'blue', revision: 2 }])
    expect(await refused(h.agentLayer('bracket', 'T1', { make: { name: 'far', colour: 'blue', shapes: [{ kind: 'label', at: [1e6, 0], text: 'x' }] } }))).toMatch(/ten diagonals/)
    expect((await h.agentLayer('bracket', 'T1', { remove: 1 })).layers).toEqual([])
  })

  it('does not change the person\'s layer, and takes no hide, edit or restore', async () => {
    const h = handlers()
    await h.make('bracket', ask())
    await h.layer('bracket', 'T1', { make: { name: 'jacket', colour: 'teal', shapes: square } })
    expect(await refused(h.agentLayer('bracket', 'T1', { make: { name: 'jacket', colour: 'blue', shapes: [] } }))).toMatch(/the person's/)
    expect(await refused(h.agentLayer('bracket', 'T1', { remove: 1 }))).toMatch(/the person's/)
    for (const change of [{ hide: 1, hidden: true }, { edit: 1, name: 'x' }, { restore: 1 }]) expect(await refused(h.agentLayer('bracket', 'T1', change as never)), JSON.stringify(change)).toMatch(/make or remove/)
  })
})

describe('tracings:layer restore', () => {
  it('puts the person\'s removed layer back with its number', async () => {
    const h = handlers()
    await h.make('bracket', ask())
    await h.layer('bracket', 'T1', { make: { name: 'a', colour: 'blue', shapes: [] } })
    await h.layer('bracket', 'T1', { make: { name: 'b', colour: 'blue', shapes: [] } })
    await h.layer('bracket', 'T1', { remove: 1 })
    expect((await h.layer('bracket', 'T1', { restore: 1 })).layers.map((l) => [l.id, l.name])).toEqual([[1, 'a'], [2, 'b']])
  })
})

describe('tracings:outline and tracings:shown', () => {
  it('answers the outline of a tracing, or null when there is none to be had', async () => {
    const h = handlers()
    await h.make('bracket', ask())
    expect(await h.outline('bracket', 'T1')).toMatchObject({ tracing: 'T1', revision: 4 })
    expect(await h.outline('bracket', 'T9')).toBeNull()
    expect(await refused(h.outline('nope', 'T1'))).toBe('That project is not open.')
    expect(await refused(h.outline('bracket', 'x'))).toMatch(/not a tracing/)
  })

  it('says to the outlines which tracings the window shows, and ignores a project that is not open', async () => {
    const shown = vi.spyOn(outlines, 'shown')
    const h = handlers()
    h.shown('bracket', ['T1', 'T2'])
    h.shown('nope', ['T1'])
    h.shown(7 as never, ['T1'])
    expect(shown).toHaveBeenCalledTimes(1)
    expect(shown).toHaveBeenCalledWith('bracket', ['T1', 'T2'])
  })

  it('says what is wrong with the file, and lets it be dismissed', async () => {
    const h = handlers()
    expect(await h.problem('bracket')).toBeNull()
    await h.dismissProblem('bracket')
  })
})

describe('the photo', () => {
  const pic = (seed: number): Uint8Array => {
    const bytes = png(1000, 800)
    bytes[30] = seed
    return bytes
  }
  const SQUARE = [
    { photo: [100, 100], uv: [0, 80] },
    { photo: [600, 100], uv: [100, 80] },
    { photo: [600, 500], uv: [100, 0] },
    { photo: [100, 500], uv: [0, 0] }
  ]
  const photos = (): string[] => readdirSync(join(dir, '.torno', 'tracings', 'photos')).filter((n) => !n.startsWith('.') && n !== 'dropped.json')

  beforeEach(async () => {
    await handlers().make('bracket', ask())
  })

  it('keeps a photo from bytes alone and answers the tracing; the file, its size and hash are main\'s', async () => {
    const t = await handlers().photo('bracket', 'T1', pic(1), 'reference/photo-2.jpg')
    expect(t.photo).toMatchObject({ width: 1000, height: 800, from: 'reference/photo-2.jpg', method: 'similar', pairs: [] })
    expect(t.photo?.file).toMatch(/^p-[0-9a-f]{12}\.png$/)
    expect(photos()).toEqual([t.photo?.file])
    expect(await refused(handlers().photo('bracket', 'T1', 'not bytes'))).toMatch(/PNG or JPEG/)
    expect(await refused(handlers().photo('nope', 'T1', pic(2)))).toBe('That project is not open.')
    expect(await refused(handlers().photo('bracket', 'x', pic(2)))).toMatch(/not a tracing/)
    expect(photos()).toHaveLength(1)
  })

  it('lines the photo up and takes only the pairs and a method: transform, scale, angle, fit and file sent are ignored', async () => {
    await handlers().photo('bracket', 'T1', pic(1))
    const lie = SQUARE.map((p) => ({ ...p, transform: [7, 7, 7, 7, 7, 7, 7, 7, 7], scale: 50, file: 'p-aaaaaaaaaaaa.png' }))
    const t = await handlers().lineUp('bracket', 'T1', lie, 'straight')
    expect(t.photo?.pairs).toEqual(SQUARE)
    expect(t.photo?.scale).toBeCloseTo(5, 7)
    expect(t.photo?.transform?.[0]).not.toBe(7)
    expect(t.photo?.file).not.toBe('p-aaaaaaaaaaaa.png')
    expect(await refused(handlers().lineUp('bracket', 'T1', 'pairs', 'similar'))).toMatch(/points on the photo/)
    expect(await refused(handlers().lineUp('bracket', 'T1', [SQUARE[0], null], 'similar'))).toMatch(/Point 2/)
  })

  it('checks a snapped point against the outline of the last build and keeps the kernel\'s point', async () => {
    const square = [[0, 0], [100, 0], [100, 100], [0, 100]]
    reply = (name, args) => (name === 'section' ? { plane: { ...args.plane, x: [1, 0, 0], y: [0, 0, 1] }, bounds: { min: [0, 0], max: [100, 100] }, parts: [{ part: 'block', area: 1, areaExact: true, open: 0, how: 'x', loops: [{ points: square, closed: true, area: 1, areaExact: true, deflection: 0.01, corners: square, circles: [] }] }] } : reply0(name, args))
    await handlers().photo('bracket', 'T1', pic(1))
    const near = [{ photo: [100, 500], uv: [0.004, 0.004], snap: { corner: [0.004, 0.004] } }, SQUARE[1]]
    const t = await handlers().lineUp('bracket', 'T1', near, 'similar')
    expect(t.photo?.pairs[0]).toEqual({ photo: [100, 500], uv: [0, 0], snap: { corner: [0, 0] } })
    const far = [{ photo: [100, 500], uv: [0.02, 0], snap: { corner: [0, 0] } }, SQUARE[1]]
    expect(await refused(handlers().lineUp('bracket', 'T1', far, 'similar'))).toMatch(/0\.02 mm from it/)
  })

  it('tells a straightening\'s scale at the middle of the outline, which it fetches for every straight line-up, snapped or not', async () => {
    await handlers().photo('bracket', 'T1', pic(1))
    const H = [0.21, 0.02, -30, -0.015, -0.19, 160, 0.00004, 0.00007, 1]
    const pairs = [[120, 90], [880, 130], [900, 700], [60, 640]].map((photo) => ({ photo, uv: applyLineup(H, photo as [number, number]) }))
    const t = await handlers().lineUp('bracket', 'T1', pairs, 'straight')
    // The outline of the tracing is 0 to 10 in each: its middle is [5, 5].
    const known = fitStraight(pairs as never, { centre: [5, 5] })
    if ('error' in known) throw new Error(known.error)
    expect(t.photo?.scale).toBeCloseTo(known.scale, 9)
    // And not at the middle of the clicks.
    const clicks = fitStraight(pairs as never)
    if ('error' in clicks) throw new Error(clicks.error)
    expect(t.photo?.scale).not.toBeCloseTo(clicks.scale, 3)
  })

  it('refuses a snap while there is no outline to check it against, and takes unsnapped points anyway', async () => {
    await handlers().photo('bracket', 'T1', pic(1))
    revision = 4
    reply = () => {
      throw new Error('the kernel is not there')
    }
    expect(await refused(handlers().lineUp('bracket', 'T1', [{ ...SQUARE[3], snap: { corner: [0, 0] } }, SQUARE[1]], 'similar'))).toMatch(/no outline of this tracing/)
    expect((await handlers().lineUp('bracket', 'T1', [SQUARE[3], SQUARE[1]], 'similar')).photo?.scale).toBeCloseTo(5, 9)
  })

  it('sets the look from fade and hidden alone', async () => {
    await handlers().photo('bracket', 'T1', pic(1))
    const t = await handlers().look('bracket', 'T1', { fade: 0.25, hidden: true, scale: 9, file: 'x' })
    expect(t.photo).toMatchObject({ fade: 0.25, hidden: true })
    expect(t.photo).not.toHaveProperty('scale')
    expect(await refused(handlers().look('bracket', 'T1', { fade: 2 }))).toMatch(/0 to 1/)
  })

  it('answers the bytes of the photo, and of the straightened copy, and null for a file that is gone or another one', async () => {
    const bytes = pic(1)
    const t = await handlers().photo('bracket', 'T1', bytes)
    expect(await handlers().photoBytes('bracket', 'T1', 'photo')).toEqual(bytes)
    expect(await handlers().photoBytes('bracket', 'T1', 'straightened')).toBeNull()
    const lined = (await handlers().lineUp('bracket', 'T1', SQUARE, 'straight')).photo
    const copy = jpeg(500, 400)
    await handlers().straightened('bracket', 'T1', copy, { sha256: lined?.sha256, transform: transformKey(lined?.transform as number[]), file: 'p-aaaaaaaaaaaa.png' })
    expect(await handlers().photoBytes('bracket', 'T1', 'straightened')).toEqual(copy)
    // Another file under the name: its hash is not the tracing's.
    writeFileSync(join(dir, '.torno', 'tracings', 'photos', t.photo?.file as string), pic(9))
    expect(await handlers().photoBytes('bracket', 'T1', 'photo')).toBeNull()
    rmSync(join(dir, '.torno', 'tracings', 'photos', t.photo?.file as string))
    expect(await handlers().photoBytes('bracket', 'T1', 'photo')).toBeNull()
    expect(await refused(handlers().photoBytes('bracket', 'T1', '../x'))).toMatch(/'photo' or 'straightened'/)
  })

  it('refuses a straightened copy of another line-up, and removes the photo', async () => {
    await handlers().photo('bracket', 'T1', pic(1))
    const lined = (await handlers().lineUp('bracket', 'T1', SQUARE, 'straight')).photo
    expect(await refused(handlers().straightened('bracket', 'T1', jpeg(5, 5), { sha256: lined?.sha256, transform: 'old' }))).toMatch(/another photo or another line-up/)
    expect(await refused(handlers().straightened('bracket', 'T1', jpeg(5, 5), null))).toMatch(/says the photo/)
    const t = await handlers().removePhoto('bracket', 'T1')
    expect(t).not.toHaveProperty('photo')
    expect(await handlers().photoBytes('bracket', 'T1', 'photo')).toBeNull()
  })
})
