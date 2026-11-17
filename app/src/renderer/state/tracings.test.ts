import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HistoryList } from '../../shared/history'
import { planeOfFrom, type Layer, type Tracing, type TracingCut, type TracingsFile } from '../../shared/tracings'
import { boardActions, boardStore } from './board'
import { actions, store } from './store'
import { buildName, connectTracings, facePicked, nextPartsOf, shownIds, traceTarget, tracingActions, tracingsStore, useTracings } from './tracings'

const plane = (axis: 'XY' | 'XZ' | 'YZ' = 'XZ', offset = 0) => planeOfFrom({ kind: 'main', axis, offset })!
const tracing = (id: string, over: Partial<Tracing> = {}): Tracing => ({ id, by: 'person', name: '', layout: 'assembly', createdAt: '2026-11-17T10:00:00.000Z', plane: plane(), layers: [], nextLayer: 1, ...over })
const file = (...tracings: Tracing[]): TracingsFile => ({ next: tracings.length + 1, tracings })
const cut = (id: string, revision = 3): TracingCut => ({ tracing: id, revision, cut: { plane: { origin: [0, 0, 0], normal: [0, -1, 0], x: [1, 0, 0], y: [0, 0, 1] }, parts: [], bounds: { min: [0, 0], max: [40, 30] } }, snaps: [] })

/** Lets what the connection asked of main at the start answer. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

const NONE = { objectId: null, file: null, open: null, cuts: {}, building: false, refused: null, facing: false, removed: null, problem: null, tool: 'select' as const, trace: 'line' as const, into: null, layerRemoved: null }

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
