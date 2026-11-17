import { describe, expect, it } from 'vitest'
import type { Mark } from '../../../shared/marks'
import type { Layer, Tracing } from '../../../shared/tracings'
import { HIT_PX, canRemove, hitTest, selectedElements, selectedShapeElements } from './selectTool'

const PLANE = { origin: [0, 0, 10], x: [1, 0, 0], y: [0, 1, 0], label: 'XY at z = 10', from: { kind: 'main', axis: 'XY', offset: 10 } }
const tracing = { id: 'T1', layout: 'assembly', plane: PLANE } as unknown as Tracing
const base = { author: 'user', note: '', status: 'draft', anchorState: 'ok', layout: 'assembly', revision: 1, camera: {}, createdAt: 'x' }
const pin = (id: string, point: [number, number, number], over: object = {}): Mark => ({ ...base, id, kind: 'pin', tracing: 'T1', anchor: { point }, ...over }) as unknown as Mark
const ink = (id: string, points2d: [number, number][], over: object = {}): Mark =>
  ({ ...base, id, kind: 'sketch', name: '', take: 'rough', nextStroke: 2, tracing: 'T1', planes: [{ id: 1, origin: [0, 0, 10], x: [1, 0, 0], y: [0, 1, 0], label: 'T1', from: { kind: 'tracing', tracing: 'T1' } }], strokes: [{ id: 'k1', plane: 1, pen: 'free', revision: 1, points2d }], ...over }) as unknown as Mark
const layer = (id: number, shapes: Layer['shapes'], over: Partial<Layer> = {}): Layer => ({ id, name: `L${id}`, colour: 'blue', by: 'person', shapes, revision: 1, ...over })
/** Ten pixels to the millimetre: the reach is `HIT_PX / 10` mm. */
const K = 10

describe('what is under the pointer', () => {
  it('is a pin of the tracing within the reach, and nothing beyond it', () => {
    const marks = [pin('M1', [5, 5, 10])]
    expect(hitTest(marks, [], tracing, [5.5, 5], K)).toEqual({ kind: 'mark', id: 'M1' })
    expect(hitTest(marks, [], tracing, [5 + (HIT_PX + 2) / K, 5], K)).toBeNull()
  })

  it('leaves out a mark of another tracing, of none, and a resolved one is still there to be seen', () => {
    const marks = [pin('M1', [5, 5, 10], { tracing: 'T2' }), pin('M2', [5, 5, 10], { tracing: undefined }), pin('M3', [5, 5, 10], { status: 'resolved' })]
    expect(hitTest(marks, [], tracing, [5, 5], K)).toEqual({ kind: 'mark', id: 'M3' })
  })

  it('is the stroke of ink under the pointer, along the segments of it', () => {
    const marks = [ink('M2', [[0, 0], [10, 0], [10, 10]])]
    expect(hitTest(marks, [], tracing, [5, 0.3], K)).toEqual({ kind: 'mark', id: 'M2' })
    expect(hitTest(marks, [], tracing, [10.4, 6], K)).toEqual({ kind: 'mark', id: 'M2' })
    expect(hitTest(marks, [], tracing, [5, 3], K)).toBeNull()
  })

  it('is a shape of a layer: a line along it, a circle on its ring, a label at its point', () => {
    const layers = [
      layer(1, [
        { kind: 'polyline', points: [[0, 0], [20, 0]] },
        { kind: 'circle', centre: [30, 30], radius: 5 },
        { kind: 'label', at: [50, 50], text: 'hole' }
      ])
    ]
    expect(hitTest([], layers, tracing, [10, 0.2], K)).toEqual({ kind: 'shape', layer: 1, index: 0 })
    expect(hitTest([], layers, tracing, [34.8, 30], K)).toEqual({ kind: 'shape', layer: 1, index: 1 })
    expect(hitTest([], layers, tracing, [30, 30], K)).toBeNull()
    expect(hitTest([], layers, tracing, [50.3, 50.2], K)).toEqual({ kind: 'shape', layer: 1, index: 2 })
  })

  it('does not see a hidden layer, and takes a mark before a shape under it, the nearer of two marks, and the top layer before the one beneath', () => {
    const layers = [layer(1, [{ kind: 'polyline', points: [[0, 0], [20, 0]] }], { hidden: true })]
    expect(hitTest([], layers, tracing, [10, 0], K)).toBeNull()
    const both = [layer(1, [{ kind: 'polyline', points: [[0, 0], [20, 0]] }]), layer(2, [{ kind: 'polyline', points: [[0, 0], [20, 0]] }])]
    expect(hitTest([], both, tracing, [10, 0], K)).toEqual({ kind: 'shape', layer: 2, index: 0 })
    expect(hitTest([pin('M1', [10, 0.1, 10])], both, tracing, [10, 0], K)).toEqual({ kind: 'mark', id: 'M1' })
    expect(hitTest([pin('M1', [10, 0.4, 10]), pin('M2', [10, 0.1, 10])], [], tracing, [10, 0], K)).toEqual({ kind: 'mark', id: 'M2' })
  })

  it('uses the uv a mark was placed with, and its own point when it has none', () => {
    expect(hitTest([pin('M1', [5, 5, 10.3], { uv: [[7, 7]] })], [], tracing, [7, 7], K)).toEqual({ kind: 'mark', id: 'M1' })
  })
})

describe('removing', () => {
  it('is the person\'s mark only: the agent\'s is for them to resolve', () => {
    expect(canRemove(pin('M1', [0, 0, 10]))).toBe(true)
    expect(canRemove(pin('M1', [0, 0, 10], { author: 'agent' }))).toBe(false)
  })
})

describe('the selection as it is drawn', () => {
  it('is a ring round a pin and a halo along a stroke, in the sheet\'s millimetres', () => {
    expect(selectedElements(pin('M1', [5, 5, 10]), tracing, true, K)).toContain('cx="5" cy="5"')
    expect(selectedElements(pin('M1', [5, 5, 10]), tracing, false, K)).toContain('cx="5" cy="-5"')
    expect(selectedElements(ink('M2', [[0, 0], [10, 0]]), tracing, true, K)).toContain('d="M0 0 L10 0"')
  })

  it('is a halo along a shape of a layer, a ring on a label', () => {
    expect(selectedShapeElements({ kind: 'polyline', points: [[0, 0], [4, 2]], closed: true }, true, K)).toContain('d="M0 0 L4 2 Z"')
    expect(selectedShapeElements({ kind: 'circle', centre: [3, 4], radius: 2 }, false, K)).toContain('cx="3" cy="-4" r="2"')
    expect(selectedShapeElements({ kind: 'label', at: [3, 4], text: 'x' }, true, K)).toContain('cx="3" cy="4"')
  })
})
