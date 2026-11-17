import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HistoryList } from '../../shared/history'
import { planeOfFrom, type Layer, type Tracing, type TracingCut, type TracingPhoto, type TracingsFile } from '../../shared/tracings'
import { boardActions, boardStore } from './board'
import { actions, store } from './store'
import { setSketchEnv } from './sketching'
import { reviewStore } from './review'
import { transformKey } from '../../shared/lineup'
import { buildName, connectTracings, facePicked, nextPartsOf, photoDrawn, referencePhotos, setPhotoTools, shownIds, traceTarget, tracingActions, tracingsStore, useTracings } from './tracings'

const plane = (axis: 'XY' | 'XZ' | 'YZ' = 'XZ', offset = 0) => planeOfFrom({ kind: 'main', axis, offset })!
const tracing = (id: string, over: Partial<Tracing> = {}): Tracing => ({ id, by: 'person', name: '', layout: 'assembly', createdAt: '2026-11-17T10:00:00.000Z', plane: plane(), layers: [], nextLayer: 1, ...over })
const file = (...tracings: Tracing[]): TracingsFile => ({ next: tracings.length + 1, tracings })
const cut = (id: string, revision = 3): TracingCut => ({ tracing: id, revision, cut: { plane: { origin: [0, 0, 0], normal: [0, -1, 0], x: [1, 0, 0], y: [0, 0, 1] }, parts: [], bounds: { min: [0, 0], max: [40, 30] } }, snaps: [] })

/** Lets what the connection asked of main at the start answer. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

const NONE = { objectId: null, file: null, open: null, cuts: {}, building: false, refused: null, facing: false, removed: null, problem: null, tool: 'select' as const, selected: null, ink: 'free' as const, markRemoved: null, trace: 'line' as const, into: null, layerRemoved: null, photos: {}, lining: null }

/** `window.torno.tracings` as far as the window asks of it. */
function fake(initial: TracingsFile = file()) {
  const tracings = {
    list: vi.fn(async () => initial),
    make: vi.fn(async (_o: string, ask: { name?: string }) => tracing('T7', { name: ask.name ?? '' })),
    edit: vi.fn(async (_o: string, id: string) => tracing(id)),
    remove: vi.fn(async () => {}),
    restore: vi.fn(async (_o: string, id: string) => tracing(id)),
    layer: vi.fn(),
    outline: vi.fn(async (_o: string, id: string) => cut(id) as TracingCut | null),
    shown: vi.fn(),
    onChanged: vi.fn(() => () => {}),
    onOutline: vi.fn(() => () => {}),
    onProblem: vi.fn(() => () => {}),
    problem: vi.fn(async () => null as string | null),
    dismissProblem: vi.fn(async () => {})
  }
  vi.stubGlobal('window', { torno: { tracings } })
  return tracings
}

beforeEach(() => {
  store.setState({ objectId: 'bracket', layout: 'assembly', selection: [], picked: {}, build: null })
  tracingsStore.setState({ ...NONE, objectId: 'bracket' }, true)
  boardActions.reset()
  boardActions.open('bracket', null)
})
afterEach(() => {
  vi.unstubAllGlobals()
  store.setState({ objectId: null, selection: [], picked: {}, build: null })
  tracingsStore.setState(NONE, true)
  boardActions.reset()
})

describe('what main told of the tracings', () => {
  it('is kept for the open project, and not for another', () => {
    tracingActions.told({ objectId: 'other', file: file(tracing('T1')) })
    expect(tracingsStore.getState().file).toBeNull()
    tracingActions.told({ objectId: 'bracket', file: file(tracing('T1'), tracing('T2')) })
    expect(tracingsStore.getState().file?.tracings.map((t) => t.id)).toEqual(['T1', 'T2'])
  })

  it('opens the first tracing when none is open, and keeps the open one while it is there', () => {
    fake()
    tracingActions.told({ objectId: 'bracket', file: file(tracing('T1'), tracing('T2')) })
    expect(tracingsStore.getState().open).toBe('T1')
    tracingActions.open('T2')
    tracingActions.told({ objectId: 'bracket', file: file(tracing('T1'), tracing('T2')) })
    expect(tracingsStore.getState().open).toBe('T2')
  })

  it('goes to the first when the open one is gone, and to none when there are none', () => {
    fake()
    tracingActions.told({ objectId: 'bracket', file: file(tracing('T1'), tracing('T2')) })
    tracingActions.open('T2')
    tracingActions.told({ objectId: 'bracket', file: file(tracing('T1')) })
    expect(tracingsStore.getState().open).toBe('T1')
    boardActions.show('tracing')
    // The last one removed while it is shown: the view stays, with the way to make another.
    tracingActions.told({ objectId: 'bracket', file: file() })
    expect(tracingsStore.getState().open).toBeNull()
    expect(boardStore.getState().shown).toBe('tracing')
  })

  it('leaves a tracing the window was left on for the model when the first read finds none', () => {
    fake()
    boardActions.show('tracing')
    tracingActions.told({ objectId: 'bracket', file: file() })
    expect(boardStore.getState().shown).toBe('model')
  })

  it('keeps each tracing as it was when it is the same, so that what is drawn for it is not drawn again', () => {
    fake()
    const first = file(tracing('T1'), tracing('T2'))
    tracingActions.told({ objectId: 'bracket', file: first })
    const kept = tracingsStore.getState().file!.tracings[1]
    tracingActions.told({ objectId: 'bracket', file: JSON.parse(JSON.stringify(first)) as TracingsFile })
    expect(tracingsStore.getState().file!.tracings[1]).toBe(kept)
  })
})

describe('the outline of the tracing that is open', () => {
  it('is asked of main when a tracing is opened, and held by its id', async () => {
    const bridge = fake()
    tracingActions.told({ objectId: 'bracket', file: file(tracing('T1')) })
    await vi.waitFor(() => expect(tracingsStore.getState().cuts.T1?.revision).toBe(3))
    expect(bridge.outline).toHaveBeenCalledWith('bracket', 'T1')
  })

  it('is let go when main has none to give (no build of this run yet)', async () => {
    const bridge = fake()
    tracingsStore.setState({ file: file(tracing('T1')), open: 'T1', cuts: { T1: cut('T1') } })
    bridge.outline.mockResolvedValueOnce(null)
    tracingActions.open('T1')
    await vi.waitFor(() => expect(tracingsStore.getState().cuts.T1).toBeUndefined())
  })

  it('takes the one main tells after a build, for the open project only', () => {
    tracingActions.cutTold({ objectId: 'other', cut: cut('T1', 9) })
    expect(tracingsStore.getState().cuts.T1).toBeUndefined()
    tracingActions.cutTold({ objectId: 'bracket', cut: cut('T1', 9) })
    expect(tracingsStore.getState().cuts.T1?.revision).toBe(9)
  })

  it('is asked again when the plane or the parts of the open tracing change', async () => {
    const bridge = fake()
    tracingActions.told({ objectId: 'bracket', file: file(tracing('T1')) })
    await vi.waitFor(() => expect(bridge.outline).toHaveBeenCalledTimes(1))
    tracingActions.told({ objectId: 'bracket', file: file(tracing('T1', { name: 'Front' })) })
    expect(bridge.outline).toHaveBeenCalledTimes(1)
    tracingActions.told({ objectId: 'bracket', file: file(tracing('T1', { parts: ['lid'] })) })
    await vi.waitFor(() => expect(bridge.outline).toHaveBeenCalledTimes(2))
    tracingActions.told({ objectId: 'bracket', file: file(tracing('T1', { parts: ['lid'], plane: plane('XY', 5) })) })
    await vi.waitFor(() => expect(bridge.outline).toHaveBeenCalledTimes(3))
  })

  it('follows the build: building while one runs', () => {
    fake()
    const off = connectTracings()
    expect(tracingsStore.getState().building).toBe(false)
    store.setState({ build: { objectId: 'bracket', status: 'building', revision: 2, stale: false } })
    expect(tracingsStore.getState().building).toBe(true)
    store.setState({ build: { objectId: 'bracket', status: 'ok', revision: 3, stale: false } })
    expect(tracingsStore.getState().building).toBe(false)
    off()
  })
})

describe('what is told to main as shown', () => {
  it('is the open tracing while the view is on a tracing, and nothing otherwise', () => {
    expect(shownIds('model', 'T1')).toEqual([])
    expect(shownIds('board', 'T1')).toEqual([])
    expect(shownIds('tracing', 'T1')).toEqual(['T1'])
    expect(shownIds('tracing', null)).toEqual([])
  })

  it('is the tracings of the cards on the board while the board is shown, the hidden ones left out', () => {
    const card = (id: string, source: string, over: object = {}) => ({ id, kind: 'tracing' as const, x: 0, y: 0, w: 1, h: 1, by: 'torno' as const, source, ...over })
    const cards = [card('C1', 'T1'), card('C2', 'T2', { hidden: true }), { ...card('C3', 'M1'), kind: 'mark' as const }, card('C4', 'T3')]
    expect(shownIds('board', 'T1', { next: 5, cards, arrows: [] })).toEqual(['T1', 'T3'])
    expect(shownIds('model', 'T1', { next: 5, cards, arrows: [] })).toEqual([])
    expect(shownIds('tracing', 'T2', { next: 5, cards, arrows: [] })).toEqual(['T2'])
  })

  it('is said when the view or the open tracing changes', async () => {
    const bridge = fake(file(tracing('T1'), tracing('T2')))
    const off = connectTracings()
    await vi.waitFor(() => expect(tracingsStore.getState().open).toBe('T1'))
    bridge.shown.mockClear()
    boardActions.show('tracing')
    expect(bridge.shown).toHaveBeenLastCalledWith('bracket', ['T1'])
    tracingActions.open('T2')
    expect(bridge.shown).toHaveBeenLastCalledWith('bracket', ['T2'])
    boardActions.show('model')
    expect(bridge.shown).toHaveBeenLastCalledWith('bracket', [])
    off()
  })
})

describe('making a tracing', () => {
  it('asks main in the layout shown, opens the one it made, and shows it', async () => {
    const bridge = fake()
    const made = await tracingActions.make({ main: 'XZ', offset: 2 }, 'Front')
    expect(bridge.make).toHaveBeenCalledWith('bracket', { on: { main: 'XZ', offset: 2 }, name: 'Front', layout: 'assembly' })
    expect(made?.id).toBe('T7')
    expect(tracingsStore.getState().open).toBe('T7')
    expect(tracingsStore.getState().file?.tracings.map((t) => t.id)).toEqual(['T7'])
    expect(boardStore.getState().shown).toBe('tracing')
  })

  it('leaves the name out when there is none', async () => {
    const bridge = fake()
    await tracingActions.make({ section: true })
    expect(bridge.make).toHaveBeenCalledWith('bracket', { on: { section: true }, layout: 'assembly' })
  })

  it('says why main refused, in its words, and shows nothing new', async () => {
    const bridge = fake()
    bridge.make.mockRejectedValueOnce(new Error('block/F3 is not flat: a tracing lies on a plane'))
    expect(await tracingActions.make({ face: 'block/F3' })).toBeNull()
    expect(tracingsStore.getState().refused).toBe('block/F3 is not flat: a tracing lies on a plane')
    expect(boardStore.getState().shown).toBe('model')
  })
})

describe('changing a tracing', () => {
  it('renames, and sets the parts, through main', async () => {
    const bridge = fake()
    await tracingActions.rename('T1', 'Front of the block')
    expect(bridge.edit).toHaveBeenLastCalledWith('bracket', 'T1', { name: 'Front of the block' })
    await tracingActions.setParts('T1', ['lid'])
    expect(bridge.edit).toHaveBeenLastCalledWith('bracket', 'T1', { parts: ['lid'] })
    await tracingActions.setParts('T1', null)
    expect(bridge.edit).toHaveBeenLastCalledWith('bracket', 'T1', { parts: null })
  })

  it('removes, and puts it back by restore, once', async () => {
    const bridge = fake()
    tracingsStore.setState({ file: file(tracing('T1', { name: 'Front' })), open: 'T1' })
    await tracingActions.remove('T1')
    expect(bridge.remove).toHaveBeenCalledWith('bracket', 'T1')
    expect(tracingsStore.getState().removed).toEqual({ id: 'T1', name: 'Front' })
    await tracingActions.undoRemove()
    expect(bridge.restore).toHaveBeenCalledWith('bracket', 'T1')
    expect(tracingsStore.getState().removed).toBeNull()
    await tracingActions.undoRemove()
    expect(bridge.restore).toHaveBeenCalledTimes(1)
  })

  it('says why main refused', async () => {
    const bridge = fake()
    bridge.edit.mockRejectedValueOnce(new Error('No tracing T9'))
    await tracingActions.rename('T9', 'x')
    expect(tracingsStore.getState().refused).toBe('No tracing T9')
  })
})

describe('the parts a tracing draws', () => {
  const all = ['base', 'lid', 'tub']
  it('takes one off the whole, puts it back, and is the whole (undefined) again when all are on', () => {
    expect(nextPartsOf(undefined, all, 'lid', false)).toEqual(['base', 'tub'])
    expect(nextPartsOf(['base', 'tub'], all, 'lid', true)).toBeNull()
    expect(nextPartsOf(['base'], all, 'tub', true)).toEqual(['base', 'tub'])
  })
  it('is refused for the last part: a tracing of no part draws nothing', () => {
    expect(nextPartsOf(['lid'], all, 'lid', false)).toBe('last')
  })
})

describe('the build a tracing was drawn for', () => {
  const list = (entries: Array<{ id: string; revision: number; failed?: true }>): HistoryList => ({ run: 'r', base: '/x', ghosts: [], entries: entries.map((e) => ({ at: '', run: 'r', sources: '', model: 'm.py', files: [], parts: 1, seconds: 1, line: '', ...e })) as HistoryList['entries'] })
  it('is the history id of the newest build of that revision, else the revision', () => {
    expect(buildName(list([{ id: 'h40', revision: 2 }, { id: 'h41', revision: 3 }]), 3)).toBe('h41')
    expect(buildName(list([{ id: 'h30', revision: 3 }, { id: 'h41', revision: 3 }]), 3)).toBe('h41')
    expect(buildName(list([{ id: 'h41', revision: 3, failed: true }]), 3)).toBe('r3')
    expect(buildName(undefined, 3)).toBe('r3')
    expect(buildName(null, 3)).toBe('r3')
  })
})

describe('a tracing on a face', () => {
  it('sends the view to the model with the Select tool, and waits for a flat face', () => {
    fake()
    boardActions.show('tracing')
    tracingActions.pickFace()
    expect(tracingsStore.getState().facing).toBe(true)
    expect(boardStore.getState().shown).toBe('model')
  })

  it('takes one selected face, and only a face of one part', () => {
    expect(facePicked(['block/F12'])).toBe('block/F12')
    expect(facePicked(['block/F12', 'block/F3'])).toBeNull()
    expect(facePicked(['block/E4'])).toBeNull()
    expect(facePicked(['block'])).toBeNull()
    expect(facePicked([])).toBeNull()
  })

  it('makes the tracing when a face is selected, and stops waiting', async () => {
    const bridge = fake()
    const off = connectTracings()
    await flush()
    tracingActions.pickFace()
    actions.setSelection(['block/E4'])
    expect(bridge.make).not.toHaveBeenCalled()
    actions.setSelection(['block/F12'])
    await vi.waitFor(() => expect(bridge.make).toHaveBeenCalledWith('bracket', { on: { face: 'block/F12' }, layout: 'assembly' }))
    await vi.waitFor(() => expect(boardStore.getState().shown).toBe('tracing'))
    expect(tracingsStore.getState().facing).toBe(false)
    off()
  })

  it('keeps waiting after a face that is refused, and says why', async () => {
    const bridge = fake()
    bridge.make.mockRejectedValueOnce(new Error('block/F3 is not flat'))
    const off = connectTracings()
    await flush()
    tracingActions.pickFace()
    actions.setSelection(['block/F3'])
    await vi.waitFor(() => expect(tracingsStore.getState().refused).toBe('block/F3 is not flat'))
    expect(tracingsStore.getState().facing).toBe(true)
    off()
  })

  it('can be given up', () => {
    fake()
    tracingActions.pickFace()
    tracingActions.cancelFace()
    expect(tracingsStore.getState().facing).toBe(false)
  })
})

describe('the store as the window reads it', () => {
  it('is a hook over the store', () => {
    expect(typeof useTracings).toBe('function')
  })
})

const layer = (over: Partial<Layer> = {}): Layer => ({ id: 1, name: 'Mine', colour: 'blue', by: 'person', shapes: [], revision: 1, ...over })
/** A tracing with layers, made the open one. */
function withLayers(...layers: Layer[]) {
  const t = tracing('T1', { layers, nextLayer: layers.length + 1 })
  tracingActions.told({ objectId: 'bracket', file: file(t) })
  return t
}

describe('the layer the person traces into', () => {
  it('is the one chosen when it is theirs, else their last, and none when they have none', () => {
    const agent = layer({ id: 1, by: 'agent', name: 'Claude’s' })
    const a = layer({ id: 2, name: 'A' })
    const b = layer({ id: 3, name: 'B' })
    expect(traceTarget({ file: file(tracing('T1', { layers: [agent] })), open: 'T1', into: null })).toBeUndefined()
    expect(traceTarget({ file: file(tracing('T1', { layers: [agent, a, b] })), open: 'T1', into: null })?.id).toBe(3)
    expect(traceTarget({ file: file(tracing('T1', { layers: [agent, a, b] })), open: 'T1', into: 2 })?.id).toBe(2)
    // Claude's layer is never traced into, and one that is gone is not either.
    expect(traceTarget({ file: file(tracing('T1', { layers: [agent, a] })), open: 'T1', into: 1 })?.id).toBe(2)
    expect(traceTarget({ file: file(tracing('T1', { layers: [agent, a] })), open: 'T1', into: 9 })?.id).toBe(2)
  })
})

describe('shapes traced into a layer', () => {
  it('are sent one to a layer change, after the shapes the layer has', async () => {
    const bridge = fake()
    const first = { kind: 'label' as const, at: [1, 1] as [number, number], text: 'a' }
    withLayers(layer({ shapes: [first] }))
    const circle = { kind: 'circle' as const, centre: [20, 15] as [number, number], radius: 8 }
    bridge.layer.mockResolvedValueOnce(tracing('T1', { layers: [layer({ shapes: [first, circle] })], nextLayer: 2 }))
    expect(await tracingActions.addShape(circle)).toBe(true)
    expect(bridge.layer).toHaveBeenCalledWith('bracket', 'T1', { edit: 1, shapes: [first, circle] })
    expect(tracingsStore.getState().file?.tracings[0].layers[0].shapes).toHaveLength(2)
  })

  it('are all kept when two come at once: each is sent on the layer as the one before left it', async () => {
    const bridge = fake()
    withLayers(layer())
    const a = { kind: 'polyline' as const, points: [[0, 0], [1, 0]] as [number, number][] }
    const b = { kind: 'circle' as const, centre: [5, 5] as [number, number], radius: 2 }
    bridge.layer.mockImplementation(async (_o: string, _id: string, change: { shapes: Layer['shapes'] }) => tracing('T1', { layers: [layer({ shapes: change.shapes })], nextLayer: 2 }))
    await Promise.all([tracingActions.addShape(a), tracingActions.addShape(b)])
    expect(bridge.layer).toHaveBeenNthCalledWith(1, 'bracket', 'T1', { edit: 1, shapes: [a] })
    expect(bridge.layer).toHaveBeenNthCalledWith(2, 'bracket', 'T1', { edit: 1, shapes: [a, b] })
  })

  it('are not sent with no layer of the person’s, and the window says why', async () => {
    const bridge = fake()
    withLayers(layer({ by: 'agent' }))
    expect(await tracingActions.addShape({ kind: 'label', at: [0, 0], text: 'x' })).toBe(false)
    expect(bridge.layer).not.toHaveBeenCalled()
    expect(tracingsStore.getState().refused).toBe('Add a layer of your own to trace into')
  })

  it('say what main refused', async () => {
    const bridge = fake()
    withLayers(layer())
    bridge.layer.mockRejectedValueOnce(new Error('A layer holds at most 500 shapes.'))
    expect(await tracingActions.addShape({ kind: 'label', at: [0, 0], text: 'x' })).toBe(false)
    expect(tracingsStore.getState().refused).toBe('A layer holds at most 500 shapes.')
  })
})

describe('the person’s layers', () => {
  it('are added empty with a name and a colour, and traced into from then on', async () => {
    const bridge = fake()
    withLayers(layer({ id: 1, by: 'agent' }))
    bridge.layer.mockResolvedValueOnce(tracing('T1', { layers: [layer({ id: 1, by: 'agent' }), layer({ id: 2, name: 'Water jacket', colour: 'teal' })], nextLayer: 3 }))
    expect(await tracingActions.addLayer('Water jacket', 'teal')).toBe(true)
    expect(bridge.layer).toHaveBeenCalledWith('bracket', 'T1', { make: { name: 'Water jacket', colour: 'teal', shapes: [] } })
    expect(tracingsStore.getState().into).toBe(2)
    expect(traceTarget(tracingsStore.getState())?.name).toBe('Water jacket')
  })

  it('are hidden or shown, Claude’s too', async () => {
    const bridge = fake()
    withLayers(layer({ by: 'agent' }))
    bridge.layer.mockResolvedValueOnce(tracing('T1', { layers: [layer({ by: 'agent', hidden: true })] }))
    await tracingActions.hideLayer(1, true)
    expect(bridge.layer).toHaveBeenCalledWith('bracket', 'T1', { hide: 1, hidden: true })
    expect(tracingsStore.getState().file?.tracings[0].layers[0].hidden).toBe(true)
  })

  it('are removed with their shapes kept in the window, and put back by main with the number they had', async () => {
    const bridge = fake()
    const shapes = [{ kind: 'label' as const, at: [1, 1] as [number, number], text: 'a' }]
    withLayers(layer({ shapes }))
    bridge.layer.mockResolvedValueOnce(tracing('T1', { layers: [], nextLayer: 2 }))
    expect(await tracingActions.removeLayer(1)).toBe(true)
    expect(bridge.layer).toHaveBeenLastCalledWith('bracket', 'T1', { remove: 1 })
    expect(tracingsStore.getState().layerRemoved).toMatchObject({ tracing: 'T1', layer: { name: 'Mine', shapes } })
    bridge.layer.mockResolvedValueOnce(tracing('T1', { layers: [layer({ shapes })], nextLayer: 2 }))
    expect(await tracingActions.undoRemoveLayer()).toBe(true)
    expect(bridge.layer).toHaveBeenLastCalledWith('bracket', 'T1', { restore: 1 })
    expect(tracingsStore.getState().layerRemoved).toBeNull()
    expect(tracingsStore.getState().into).toBe(1)
  })

  it('are not removed when they are Claude’s: that is not asked of main', async () => {
    const bridge = fake()
    withLayers(layer({ by: 'agent' }))
    expect(await tracingActions.removeLayer(1)).toBe(false)
    expect(bridge.layer).not.toHaveBeenCalled()
    expect(tracingsStore.getState().refused).toMatch(/Claude/)
  })

  it('forget what was removed after a while, and when another tracing is opened', () => {
    fake()
    tracingsStore.setState({ layerRemoved: { tracing: 'T1', layer: layer() } })
    tracingActions.forgetLayerRemoved()
    expect(tracingsStore.getState().layerRemoved).toBeNull()
  })
})

describe('the tool in hand', () => {
  it('is Select until the Trace tool is taken, and Select again when the tracing is changed', () => {
    fake()
    tracingActions.told({ objectId: 'bracket', file: file(tracing('T1'), tracing('T2')) })
    expect(tracingsStore.getState().tool).toBe('select')
    tracingActions.setTool('trace')
    expect(tracingsStore.getState().tool).toBe('trace')
    tracingActions.open('T2')
    expect(tracingsStore.getState().tool).toBe('select')
  })

  it('traces a line, a circle or a label', () => {
    fake()
    tracingActions.setTrace('circle')
    expect(tracingsStore.getState().trace).toBe('circle')
  })
})

// The photo of a tracing: added from bytes, lined up by main, straightened here and shown by an object URL the window holds.

const PHOTO = { file: 'p-0123456789ab.jpg', sha256: 'f'.repeat(64), width: 200, height: 100 }
const lined = (over: Partial<TracingPhoto> = {}): TracingPhoto => ({
  ...PHOTO,
  pairs: [{ photo: [0, 0], uv: [-20, 10] }, { photo: [200, 100], uv: [20, -10] }],
  method: 'similar',
  transform: [0.2, 0, -20, 0, -0.2, 10, 0, 0, 1],
  scale: 5,
  angle: 0,
  fade: 0.5,
  ...over
})

/** The browser's part of the photo work, as far as a test goes: bytes in, a URL out, and a copy that is the bytes it was made from. */
function photoWork() {
  const tools = {
    prepare: vi.fn(async (bytes: Uint8Array, name: string) => {
      if (name.endsWith('.txt')) throw new Error(`${name} is not a PNG, JPEG or WebP picture.`)
      return { image: bytes, type: 'image/jpeg' as const, width: 200, height: 100, from: { width: 200, height: 100 } }
    }),
    makeUrl: vi.fn((bytes: Uint8Array) => `blob:${bytes[0]}`),
    revoke: vi.fn(),
    straighten: vi.fn(async (_bytes: Uint8Array, _transform: readonly number[], _width: number, _height: number, _scale: number) => new Uint8Array([9, 9, 9]))
  }
  setPhotoTools(tools)
  return tools
}

function withPhotoApi(initial: TracingsFile) {
  const t = fake(initial)
  const photo = {
    photo: vi.fn(async (_o: string, id: string, _bytes: Uint8Array, _from?: string) => tracing(id, { photo: { ...PHOTO, pairs: [], method: 'similar', fade: 0.5 } })),
    lineUp: vi.fn(async (_o: string, id: string) => tracing(id, { photo: lined() })),
    look: vi.fn(async (_o: string, id: string, look: { fade?: number; hidden?: boolean }) => tracing(id, { photo: lined({ ...(look.fade === undefined ? {} : { fade: look.fade }), ...(look.hidden ? { hidden: true as const } : {}) }) })),
    straightened: vi.fn(async (_o: string, id: string) => tracing(id, { photo: lined({ straightened: 's-aaaaaaaaaaaa.png' }) })),
    photoBytes: vi.fn(async (_o: string, _id: string, which: string) => (which === 'photo' ? new Uint8Array([1, 2, 3]) : (null as Uint8Array | null))),
    removePhoto: vi.fn(async (_o: string, id: string) => tracing(id))
  }
  const all = Object.assign(t, photo)
  vi.stubGlobal('window', { torno: { tracings: all, board: { reference: vi.fn(async () => ({ mediaType: 'image/jpeg', bytes: new Uint8Array([7]) })) } } })
  return all
}

describe('adding a photo', () => {
  it('sends the prepared bytes to main with the reference they came from, and opens the line-up of that tracing', async () => {
    const tools = photoWork()
    const api = withPhotoApi(file(tracing('T1')))
    tracingActions.told({ objectId: 'bracket', file: file(tracing('T1')) })
    expect(await tracingActions.addPhoto({ name: 'photo-1.jpg', bytes: async () => new Uint8Array([5, 5]), from: 'reference/photo-1.jpg' })).toBe(true)
    expect(tools.prepare).toHaveBeenCalledWith(new Uint8Array([5, 5]), 'photo-1.jpg')
    expect(api.photo).toHaveBeenCalledWith('bracket', 'T1', new Uint8Array([5, 5]), 'reference/photo-1.jpg')
    expect(tracingsStore.getState().lining).toBe('T1')
    expect(tracingsStore.getState().file?.tracings[0].photo?.file).toBe(PHOTO.file)
  })

  it('says in words what is not a picture, and opens no line-up', async () => {
    photoWork()
    const api = withPhotoApi(file(tracing('T1')))
    tracingActions.told({ objectId: 'bracket', file: file(tracing('T1')) })
    expect(await tracingActions.addPhoto({ name: 'notes.txt', bytes: async () => new Uint8Array([1]) })).toBe(false)
    expect(tracingsStore.getState().refused).toContain('not a PNG, JPEG or WebP picture')
    expect(api.photo).not.toHaveBeenCalled()
    expect(tracingsStore.getState().lining).toBeNull()
  })

  it('says what main refuses', async () => {
    photoWork()
    const api = withPhotoApi(file(tracing('T1')))
    api.photo.mockRejectedValueOnce(new Error('That is not a picture torno can keep'))
    tracingActions.told({ objectId: 'bracket', file: file(tracing('T1')) })
    expect(await tracingActions.addPhoto({ name: 'a.jpg', bytes: async () => new Uint8Array([1]) })).toBe(false)
    expect(tracingsStore.getState().refused).toBe('That is not a picture torno can keep')
  })
})

describe('where a photo comes from', () => {
  it('is the first picture the photo dialog gives, read by main, and nothing when the dialog is cancelled', async () => {
    photoWork()
    const api = withPhotoApi(file(tracing('T1')))
    const objects = { pickPhotos: vi.fn(async () => ['/home/me/pics/IMG_1.jpg', '/home/me/pics/IMG_2.jpg']), readPhoto: vi.fn(async () => new Uint8Array([6])) }
    vi.stubGlobal('window', { torno: { tracings: api, objects } })
    tracingActions.told({ objectId: 'bracket', file: file(tracing('T1')) })
    expect(await tracingActions.choosePhoto()).toBe(true)
    expect(objects.readPhoto).toHaveBeenCalledWith('/home/me/pics/IMG_1.jpg')
    expect(api.photo).toHaveBeenCalledTimes(1)
    objects.pickPhotos.mockResolvedValueOnce([])
    expect(await tracingActions.choosePhoto()).toBe(false)
    expect(api.photo).toHaveBeenCalledTimes(1)
  })

  it('can be a photo of the project\'s references, named so that the tracing says where it came from', async () => {
    photoWork()
    const api = withPhotoApi(file(tracing('T1')))
    tracingActions.told({ objectId: 'bracket', file: file(tracing('T1')) })
    expect(await tracingActions.addReference('reference/photo-1.jpg')).toBe(true)
    expect(api.photo).toHaveBeenCalledWith('bracket', 'T1', new Uint8Array([7]), 'reference/photo-1.jpg')
  })
})

describe('lining the photo up', () => {
  it('sends the pairs and the method, and closes the line-up when main kept them', async () => {
    photoWork()
    const api = withPhotoApi(file(tracing('T1', { photo: lined() })))
    tracingActions.told({ objectId: 'bracket', file: file(tracing('T1', { photo: lined() })) })
    tracingActions.startLineUp()
    expect(tracingsStore.getState().lining).toBe('T1')
    const pairs = [{ photo: [1, 1] as [number, number], uv: [0, 0] as [number, number] }, { photo: [9, 9] as [number, number], uv: [3, 3] as [number, number] }]
    expect(await tracingActions.lineUp(pairs, 'similar')).toBe(true)
    expect(api.lineUp).toHaveBeenCalledWith('bracket', 'T1', pairs, 'similar')
    expect(tracingsStore.getState().lining).toBeNull()
  })

  it('keeps the line-up open and says why when main refuses the points', async () => {
    photoWork()
    const api = withPhotoApi(file(tracing('T1', { photo: lined() })))
    api.lineUp.mockRejectedValueOnce(new Error('The points do not line the photo up: two of the points are on top of each other'))
    tracingActions.told({ objectId: 'bracket', file: file(tracing('T1', { photo: lined() })) })
    tracingActions.startLineUp()
    expect(await tracingActions.lineUp([], 'similar')).toBe(false)
    expect(tracingsStore.getState().lining).toBe('T1')
    expect(tracingsStore.getState().refused).toContain('on top of each other')
  })

  it('leaves the line-up as it was on Cancel', async () => {
    photoWork()
    const api = withPhotoApi(file(tracing('T1', { photo: lined() })))
    tracingActions.told({ objectId: 'bracket', file: file(tracing('T1', { photo: lined() })) })
    tracingActions.startLineUp()
    tracingActions.cancelLineUp()
    expect(tracingsStore.getState().lining).toBeNull()
    expect(api.lineUp).not.toHaveBeenCalled()
    expect(tracingsStore.getState().file?.tracings[0].photo?.scale).toBe(5)
  })

  it('does not open for a tracing with no photo, nor stay open when the tracing is gone', () => {
    photoWork()
    withPhotoApi(file(tracing('T1')))
    tracingActions.told({ objectId: 'bracket', file: file(tracing('T1'), tracing('T2', { photo: lined() })) })
    tracingActions.startLineUp()
    expect(tracingsStore.getState().lining).toBeNull()
    tracingActions.open('T2')
    tracingActions.startLineUp()
    expect(tracingsStore.getState().lining).toBe('T2')
    tracingActions.told({ objectId: 'bracket', file: file(tracing('T1')) })
    expect(tracingsStore.getState().lining).toBeNull()
  })
})

describe('the look of the photo', () => {
  it('sends the fade and the hiding to main, once each call', async () => {
    photoWork()
    const api = withPhotoApi(file(tracing('T1', { photo: lined() })))
    // No copy to make meanwhile: the photo is not on this computer.
    api.photoBytes.mockImplementation(async () => null)
    tracingActions.told({ objectId: 'bracket', file: file(tracing('T1', { photo: lined() })) })
    await tracingActions.setFade(0.25)
    expect(api.look).toHaveBeenCalledWith('bracket', 'T1', { fade: 0.25 })
    await tracingActions.setHidden(true)
    expect(api.look).toHaveBeenLastCalledWith('bracket', 'T1', { hidden: true })
    expect(tracingsStore.getState().file?.tracings[0].photo?.hidden).toBe(true)
  })

  it('takes the photo off, and lets go of its pictures', async () => {
    const tools = photoWork()
    const api = withPhotoApi(file(tracing('T1', { photo: lined({ straightened: 's-aaaaaaaaaaaa.png' }) })))
    api.photoBytes.mockImplementation(async () => new Uint8Array([4]))
    tracingActions.told({ objectId: 'bracket', file: file(tracing('T1', { photo: lined({ straightened: 's-aaaaaaaaaaaa.png' }) })) })
    await tracingActions.sync('T1')
    expect(Object.keys(tracingsStore.getState().photos).sort()).toEqual(['p-0123456789ab.jpg', 's-aaaaaaaaaaaa.png'])
    await tracingActions.removePhoto()
    expect(api.removePhoto).toHaveBeenCalledWith('bracket', 'T1')
    tracingActions.told({ objectId: 'bracket', file: file(tracing('T1')) })
    expect(tracingsStore.getState().photos).toEqual({})
    expect(tools.revoke).toHaveBeenCalledTimes(2)
  })
})

describe('the straightened copy', () => {
  it('is made here when the photo is lined up and has none, and sent to main for the photo and line-up it was made of', async () => {
    const tools = photoWork()
    const api = withPhotoApi(file(tracing('T1', { photo: lined() })))
    tracingActions.told({ objectId: 'bracket', file: file(tracing('T1', { photo: lined() })) })
    await tracingActions.sync('T1')
    expect(tools.straighten).toHaveBeenCalledTimes(1)
    expect(tools.straighten.mock.calls[0].slice(1)).toEqual([[0.2, 0, -20, 0, -0.2, 10, 0, 0, 1], 200, 100, 5])
    expect(api.straightened).toHaveBeenCalledWith('bracket', 'T1', new Uint8Array([9, 9, 9]), { sha256: PHOTO.sha256, transform: transformKey([0.2, 0, -20, 0, -0.2, 10, 0, 0, 1]) })
    expect(tracingsStore.getState().file?.tracings[0].photo?.straightened).toBe('s-aaaaaaaaaaaa.png')
  })

  it('is made once however often it is asked for at the same time', async () => {
    const tools = photoWork()
    withPhotoApi(file(tracing('T1', { photo: lined() })))
    tracingActions.told({ objectId: 'bracket', file: file(tracing('T1', { photo: lined() })) })
    await Promise.all([tracingActions.sync('T1'), tracingActions.sync('T1'), tracingActions.sync('T1')])
    expect(tools.straighten).toHaveBeenCalledTimes(1)
  })

  it('is made again when the copy the tracing names is not on this computer', async () => {
    const tools = photoWork()
    const api = withPhotoApi(file(tracing('T1', { photo: lined({ straightened: 's-bbbbbbbbbbbb.png' }) })))
    tracingActions.told({ objectId: 'bracket', file: file(tracing('T1', { photo: lined({ straightened: 's-bbbbbbbbbbbb.png' }) })) })
    await tracingActions.sync('T1')
    expect(api.photoBytes).toHaveBeenCalledWith('bracket', 'T1', 'straightened')
    expect(tools.straighten).toHaveBeenCalledTimes(1)
  })

  it('is read, and not made again, when it is on this computer', async () => {
    const tools = photoWork()
    const api = withPhotoApi(file(tracing('T1', { photo: lined({ straightened: 's-bbbbbbbbbbbb.png' }) })))
    api.photoBytes.mockImplementation(async () => new Uint8Array([8]))
    tracingActions.told({ objectId: 'bracket', file: file(tracing('T1', { photo: lined({ straightened: 's-bbbbbbbbbbbb.png' }) })) })
    await tracingActions.sync('T1')
    expect(tools.straighten).not.toHaveBeenCalled()
    expect(tracingsStore.getState().photos['s-bbbbbbbbbbbb.png']).toEqual({ url: 'blob:8' })
  })

  it('is not made for a photo that is not on this computer, which is said of it', async () => {
    const tools = photoWork()
    const api = withPhotoApi(file(tracing('T1', { photo: lined() })))
    api.photoBytes.mockImplementation(async () => null)
    tracingActions.told({ objectId: 'bracket', file: file(tracing('T1', { photo: lined() })) })
    await tracingActions.sync('T1')
    expect(tools.straighten).not.toHaveBeenCalled()
    expect(tracingsStore.getState().photos[PHOTO.file]).toEqual({ missing: true })
  })

  it('is not made for a photo that is not lined up yet', async () => {
    const tools = photoWork()
    withPhotoApi(file(tracing('T1', { photo: lined({ transform: undefined, scale: undefined, angle: undefined, pairs: [] }) })))
    tracingActions.told({ objectId: 'bracket', file: file(tracing('T1', { photo: lined({ transform: undefined, scale: undefined, angle: undefined, pairs: [] }) })) })
    await tracingActions.sync('T1')
    expect(tools.straighten).not.toHaveBeenCalled()
  })

  it('says a copy main did not take (it was made for a line-up that has since changed) is no failure', async () => {
    photoWork()
    const api = withPhotoApi(file(tracing('T1', { photo: lined() })))
    api.straightened.mockRejectedValueOnce(new Error('That copy was made of another photo or another line-up'))
    tracingActions.told({ objectId: 'bracket', file: file(tracing('T1', { photo: lined() })) })
    await tracingActions.sync('T1')
    expect(tracingsStore.getState().refused).toBeNull()
  })
})

describe('where a photo is drawn', () => {
  const urls = { 's-aaaaaaaaaaaa.png': { url: 'blob:copy' } }

  it('is by the rectangle of its corners in mm, at its fade, with its line-up said, once the copy is there', () => {
    const drawn = photoDrawn(tracing('T1', { photo: lined({ straightened: 's-aaaaaaaaaaaa.png', fade: 0.3 }) }), urls)!
    expect(drawn.photo).toEqual({ href: 'blob:copy', rect: { min: [-20, -10], max: [20, 10] }, fade: 0.3 })
    expect(drawn.said).toBe("lined up by 2 points: 5 px/mm at the centre, turned 0°, no spare point to check it; not exact, and true only in the tracing's plane")
  })

  it('is nothing for a hidden photo, one with no copy yet, one not lined up, or a copy that is not here', () => {
    expect(photoDrawn(tracing('T1', { photo: lined({ straightened: 's-aaaaaaaaaaaa.png', hidden: true }) }), urls)).toBeUndefined()
    expect(photoDrawn(tracing('T1', { photo: lined() }), urls)).toBeUndefined()
    expect(photoDrawn(tracing('T1', { photo: lined({ straightened: 's-aaaaaaaaaaaa.png', transform: undefined }) }), urls)).toBeUndefined()
    expect(photoDrawn(tracing('T1', { photo: lined({ straightened: 's-aaaaaaaaaaaa.png' }) }), { 's-aaaaaaaaaaaa.png': { missing: true } })).toBeUndefined()
    expect(photoDrawn(tracing('T1'), urls)).toBeUndefined()
  })
})

describe('the photos of the project\'s references', () => {
  it('are the picture files its reference cards name, in the order of the board', () => {
    const card = (id: string, kind: string, source?: string) => ({ id, kind, source, x: 0, y: 0, w: 1, h: 1, by: 'torno' }) as never
    expect(referencePhotos([card('C1', 'brief', 'brief'), card('C2', 'reference', 'reference/photo-1.jpg'), card('C3', 'reference', 'reference/datasheet.pdf'), card('C4', 'reference', 'reference/doodle-1.png'), card('C5', 'reference', 'reference/part.STEP')])).toEqual(['reference/photo-1.jpg', 'reference/doodle-1.png'])
  })
})

describe('a pin on the tracing', () => {
  const here = { objectId: 'bracket', layout: 'assembly', revision: 3, camera: { position: [0, -100, 0], target: [0, 0, 0], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 } }
  const withMarks = (marks: Record<string, unknown>) => {
    const torno = { tracings: fake(), marks }
    vi.stubGlobal('window', { torno })
    return torno
  }
  const open = () => {
    tracingActions.told({ objectId: 'bracket', file: file(tracing('T1', { plane: plane('XY', 10) })) })
    tracingActions.open('T1')
  }
  afterEach(() => {
    setSketchEnv(null)
    reviewStore.setState({ rounds: [], choice: 'plain' } as never)
  })

  it('is made through main as a pin of the person\'s at the point of the plane, naming the tracing, and is selected after', async () => {
    const add = vi.fn(async (_o: string, mark: { note: string }) => ({ id: 'M5', ...mark }))
    withMarks({ add })
    setSketchEnv({ here: () => ({ ...here, centre: [0, 0, 0] }) } as never)
    open()
    expect(await tracingActions.pin([3, 4], 'too thin')).toBe(true)
    expect(add).toHaveBeenCalledWith('bracket', { kind: 'pin', author: 'user', note: 'too thin', layout: 'assembly', revision: 3, camera: here.camera, anchor: { point: [3, 4, 10] }, tracing: 'T1' })
    expect(tracingsStore.getState().selected).toEqual({ kind: 'mark', id: 'M5' })
  })

  it('takes what the bar of an open review says it is', async () => {
    const add = vi.fn(async (_o: string, mark: object) => ({ id: 'M5', ...mark }))
    withMarks({ add })
    setSketchEnv({ here: () => ({ ...here, centre: [0, 0, 0] }) } as never)
    reviewStore.setState({ rounds: [{ id: 'R1', layout: 'assembly', build: 'h1', sources: 'x', line: 'l', startedAt: '2026-11-17T10:00:00.000Z' }], choice: 'dont' } as never)
    open()
    await tracingActions.pin([3, 4], 'no')
    expect(add.mock.calls[0][1]).toMatchObject({ intent: 'dont' })
  })

  it('says why when main refuses it, and when there is no build on show', async () => {
    withMarks({ add: vi.fn(async () => { throw new Error('point 1 of the mark is not in the plane of T1') }) })
    setSketchEnv({ here: () => ({ ...here, centre: [0, 0, 0] }) } as never)
    open()
    expect(await tracingActions.pin([3, 4], 'x')).toBe(false)
    expect(tracingsStore.getState().refused).toBe('The pin was not kept: point 1 of the mark is not in the plane of T1')
    setSketchEnv(null)
    expect(await tracingActions.pin([3, 4], 'x')).toBe(false)
    expect(tracingsStore.getState().refused).toBe('The project has no build to leave a pin on yet')
  })
})

describe('a measure and a "should be here" on the tracing', () => {
  const here = { objectId: 'bracket', layout: 'assembly', revision: 3, camera: { position: [0, -100, 0], target: [0, 0, 0], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 } }
  const setup = (marks: Record<string, unknown>) => {
    vi.stubGlobal('window', { torno: { tracings: fake(), marks } })
    setSketchEnv({ here: () => ({ ...here, centre: [0, 0, 0] }) } as never)
    tracingActions.told({ objectId: 'bracket', file: file(tracing('T1', { plane: plane('XY', 10) })) })
    tracingActions.open('T1')
  }
  afterEach(() => {
    setSketchEnv(null)
    reviewStore.setState({ rounds: [], choice: 'plain' } as never)
  })

  it('has the two tools', () => {
    tracingActions.setTool('measure')
    expect(tracingsStore.getState().tool).toBe('measure')
    tracingActions.setTool('offset')
    expect(tracingsStore.getState().tool).toBe('offset')
  })

  it('makes a span through main with its ends and the camera, and no word of a review, even with the bar on don\'t want', async () => {
    const span = vi.fn(async (_o: string, draft: object) => ({ id: 'M7', ...draft }))
    setup({ span })
    reviewStore.setState({ rounds: [{ id: 'R1', layout: 'assembly', build: 'h1', sources: 'x', line: 'l', startedAt: '2026-11-17T10:00:00.000Z' }], choice: 'dont' } as never)
    expect(await tracingActions.span({ uv: [0, 0], on: 'tracing' }, { uv: [3, 4], on: 'photo' })).toBe(true)
    expect(span).toHaveBeenCalledWith('bracket', { tracing: 'T1', a: { uv: [0, 0], on: 'tracing' }, b: { uv: [3, 4], on: 'photo' }, camera: here.camera })
    expect(tracingsStore.getState().selected).toEqual({ kind: 'mark', id: 'M7' })
  })

  it('makes an offset through main, naming the layer by id and the shape by its place, with no word of a review', async () => {
    const offset = vi.fn(async (_o: string, draft: object) => ({ id: 'M8', ...draft }))
    setup({ offset })
    reviewStore.setState({ rounds: [{ id: 'R1', layout: 'assembly', build: 'h1', sources: 'x', line: 'l', startedAt: '2026-11-17T10:00:00.000Z' }], choice: 'want' } as never)
    expect(await tracingActions.offset(2, 3, [-1.8, 0.6])).toBe(true)
    expect(offset).toHaveBeenCalledWith('bracket', { tracing: 'T1', layer: 2, shape: 3, by: [-1.8, 0.6], camera: here.camera })
    expect(tracingsStore.getState().selected).toEqual({ kind: 'mark', id: 'M8' })
  })

  it('says why when main refuses, and when there is no build on show', async () => {
    setup({ span: vi.fn(async () => { throw new Error('End B says it was snapped to a corner of the cut, and it is 0.02 mm from it') }), offset: vi.fn(async () => { throw new Error('no layer 9') }) })
    expect(await tracingActions.span({ uv: [0, 0], on: 'tracing' }, { uv: [3, 4], on: 'tracing' })).toBe(false)
    expect(tracingsStore.getState().refused).toBe('The measure was not kept: End B says it was snapped to a corner of the cut, and it is 0.02 mm from it')
    expect(await tracingActions.offset(9, 0, [1, 1])).toBe(false)
    expect(tracingsStore.getState().refused).toBe('The "should be here" was not kept: no layer 9')
    setSketchEnv(null)
    expect(await tracingActions.span({ uv: [0, 0], on: 'tracing' }, { uv: [3, 4], on: 'tracing' })).toBe(false)
    expect(tracingsStore.getState().refused).toBe('The project has no build to measure on yet')
  })
})

describe('selecting and removing a mark', () => {
  const mark = (id: string, author: 'user' | 'agent') => ({ id, author, kind: 'pin', tracing: 'T1', anchor: { point: [0, 0, 0] } }) as never
  const setup = (remove = vi.fn(async () => {}), restore = vi.fn(async (_o: string, id: string) => ({ id }))) => {
    vi.stubGlobal('window', { torno: { tracings: fake(), marks: { remove, restore } } })
    store.setState({ marks: [mark('M1', 'user'), mark('M2', 'agent')] })
    tracingActions.told({ objectId: 'bracket', file: file(tracing('T1')) })
    return { remove, restore }
  }
  afterEach(() => store.setState({ marks: [] }))

  it('removes the person\'s mark that is selected, and offers it back', async () => {
    const { remove, restore } = setup()
    tracingActions.select({ kind: 'mark', id: 'M1' })
    expect(await tracingActions.removeSelected()).toBe(true)
    expect(remove).toHaveBeenCalledWith('bracket', 'M1')
    expect(tracingsStore.getState()).toMatchObject({ selected: null, markRemoved: 'M1' })
    expect(await tracingActions.undoMarkRemove()).toBe(true)
    expect(restore).toHaveBeenCalledWith('bracket', 'M1')
    expect(tracingsStore.getState()).toMatchObject({ markRemoved: null, selected: { kind: 'mark', id: 'M1' } })
  })

  it('leaves the agent\'s mark, and a shape of a layer, and says so', async () => {
    const { remove } = setup()
    tracingActions.select({ kind: 'mark', id: 'M2' })
    expect(await tracingActions.removeSelected()).toBe(false)
    expect(tracingsStore.getState().refused).toBe("M2 is Claude's mark: it is Claude's to resolve")
    tracingActions.select({ kind: 'shape', layer: 1, index: 0 })
    expect(await tracingActions.removeSelected()).toBe(false)
    expect(remove).not.toHaveBeenCalled()
  })

  it('lets go of the selection when another tool is taken, and when another tracing is opened', () => {
    setup()
    tracingActions.select({ kind: 'mark', id: 'M1' })
    tracingActions.setTool('pin')
    expect(tracingsStore.getState().selected).toBeNull()
    tracingActions.select({ kind: 'mark', id: 'M1' })
    tracingActions.setTool('select')
    expect(tracingsStore.getState().selected).not.toBeNull()
    tracingActions.open('T1')
    expect(tracingsStore.getState().selected).toBeNull()
  })

  it('takes Pin and Ink in hand', () => {
    setup()
    tracingActions.setTool('ink')
    expect(tracingsStore.getState().tool).toBe('ink')
    tracingActions.setInk('line')
    expect(tracingsStore.getState().ink).toBe('line')
  })
})
