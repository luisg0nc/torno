import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { planeOfFrom, type Tracing, type TracingCut, type TracingPhoto } from '../../shared/tracings'
import type { ShownTracing } from '../viewport/tracings'
import { actions, store } from './store'
import { tracingsStore } from './tracings'
import { connectTracings3D, pictureOf, shownTracings } from './tracingsIn3d'

const tracing = (id: string, over: Partial<Tracing> = {}): Tracing => ({ id, by: 'person', name: '', layout: 'assembly', createdAt: '2026-11-17T10:00:00.000Z', plane: planeOfFrom({ kind: 'main', axis: 'XZ', offset: 0 })!, layers: [], nextLayer: 1, ...over })
const photo = (over: Partial<TracingPhoto> = {}): TracingPhoto => ({ file: 'p-0123456789ab.jpg', sha256: 'a'.repeat(64), width: 400, height: 300, pairs: [], method: 'similar', transform: [0.25, 0, 0, 0, -0.25, 75, 0, 0, 1], scale: 4, angle: 0, straightened: 's-0123456789ab.png', fade: 0.5, ...over })
const cut = (id: string): TracingCut => ({ tracing: id, revision: 3, cut: { plane: { origin: [0, 0, 0], normal: [0, -1, 0], x: [1, 0, 0], y: [0, 0, 1] }, parts: [], bounds: { min: [0, 0], max: [40, 30] } }, snaps: [] })

const NONE = { objectId: null, file: null, open: null, cuts: {}, building: false, refused: null, facing: false, removed: null, problem: null, tool: 'select' as const, selected: null, ink: 'free' as const, markRemoved: null, trace: 'line' as const, into: null, layerRemoved: null, photos: {}, lining: null }
/** Lets the microtasks of the connection, and the pictures it decodes, finish. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

describe('which tracings are drawn in 3D', () => {
  it('are those named that the project has, in the order of its file, and none before the file is read', () => {
    const all = [tracing('T1'), tracing('T2'), tracing('T3')]
    expect(shownTracings(['T3', 'T1', 'T9'], all).map((t) => t.id)).toEqual(['T1', 'T3'])
    expect(shownTracings(['T1'], undefined)).toEqual([])
    expect(shownTracings([], all)).toEqual([])
  })

  it('has a picture only for a photo that is lined up, not hidden, and whose straightened copy is here', () => {
    const photos = { 's-0123456789ab.png': { url: 'blob:copy' } }
    expect(pictureOf({ photo: photo() }, photos)).toBe('blob:copy')
    expect(pictureOf({ photo: photo({ hidden: true }) }, photos)).toBeNull()
    expect(pictureOf({ photo: photo({ transform: undefined }) }, photos)).toBeNull()
    expect(pictureOf({ photo: photo({ straightened: undefined }) }, photos)).toBeNull()
    expect(pictureOf({ photo: photo() }, { 's-0123456789ab.png': { missing: true as const } })).toBeNull()
    expect(pictureOf({}, photos)).toBeNull()
  })
})

describe('the connection of the tracings to the viewport', () => {
  const outline = vi.fn(async (_o: string, id: string) => cut(id) as TracingCut | null)
  const bitmap = { width: 400, height: 300, close: vi.fn() } as unknown as ImageBitmap
  const decode = vi.fn(async () => bitmap)
  let drawn: ShownTracing[][]
  const viewport = { setTracings: (s: readonly ShownTracing[]) => void drawn.push([...s]) }

  beforeEach(() => {
    drawn = []
    outline.mockClear()
    decode.mockClear()
    vi.stubGlobal('window', { torno: { tracings: { outline, photoBytes: vi.fn(async () => null), shown: vi.fn() } } })
    actions.openObject('bracket', { layers: {} })
    tracingsStore.setState({ ...NONE, objectId: 'bracket', file: { next: 3, tracings: [tracing('T1'), tracing('T2', { photo: photo() })] } }, true)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    store.setState({ objectId: null, tracingsShown: [] })
    tracingsStore.setState(NONE, true)
  })

  it('draws nothing until a tracing is shown, then the tracing with its outline once main has cut it', async () => {
    const off = connectTracings3D({ viewport, decode })
    await settle()
    expect(drawn.at(-1) ?? []).toEqual([])
    actions.setTracingShown('T1', true)
    await settle()
    // Asked for its outline, once: it counts as shown.
    expect(outline).toHaveBeenCalledTimes(1)
    expect(outline).toHaveBeenCalledWith('bracket', 'T1')
    await vi.waitFor(() => expect(drawn.at(-1)?.[0]?.cut?.tracing).toBe('T1'))
    expect(drawn.at(-1)?.map((s) => s.tracing.id)).toEqual(['T1'])
    off()
  })

  it('draws the photo’s picture once it is decoded, and lets it go with the tracing', async () => {
    tracingsStore.setState({ photos: { 's-0123456789ab.png': { url: 'blob:copy' } } })
    actions.setTracingShown('T2', true)
    const off = connectTracings3D({ viewport, decode })
    await vi.waitFor(() => expect(drawn.at(-1)?.[0]?.photo).toBe(bitmap))
    expect(decode).toHaveBeenCalledTimes(1)
    actions.setTracingShown('T2', false)
    await settle()
    expect(drawn.at(-1)).toEqual([])
    expect(bitmap.close).toHaveBeenCalled()
    off()
  })

  it('does not give the viewport the same list twice, nor ask for an outline it has asked for', async () => {
    actions.setTracingShown('T1', true)
    const off = connectTracings3D({ viewport, decode })
    await vi.waitFor(() => expect(drawn.length).toBeGreaterThan(0))
    const count = drawn.length
    tracingsStore.setState({ refused: 'nothing to do with it' })
    tracingsStore.setState({ file: { ...tracingsStore.getState().file!, next: 4 } })
    await settle()
    expect(drawn).toHaveLength(count)
    expect(outline).toHaveBeenCalledTimes(1)
    // A plane that moved is cut again.
    tracingsStore.setState({ file: { next: 3, tracings: [tracing('T1', { plane: planeOfFrom({ kind: 'main', axis: 'XZ', offset: 5 })! }), tracing('T2')] } })
    await settle()
    expect(outline).toHaveBeenCalledTimes(2)
    off()
  })

  it('stops showing a tracing the project no longer has, in the scene file too', async () => {
    actions.setTracingShown('T1', true)
    actions.setTracingShown('T9', true)
    const off = connectTracings3D({ viewport, decode })
    await settle()
    expect(store.getState().tracingsShown).toEqual(['T1'])
    off()
  })

  it('draws nothing of another project’s tracings, and nothing once it is stopped', async () => {
    actions.setTracingShown('T1', true)
    const off = connectTracings3D({ viewport, decode })
    await vi.waitFor(() => expect(drawn.at(-1)?.length).toBe(1))
    off()
    expect(drawn.at(-1)).toEqual([])
    const count = drawn.length
    actions.setTracingShown('T2', true)
    await settle()
    expect(drawn).toHaveLength(count)
  })
})
