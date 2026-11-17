import { describe, expect, it } from 'vitest'
import type { Sectioned } from '../../shared/geometry'
import { mainPlaneFrame } from '../../shared/planes'
import type { Layer, Tracing, TracingCut, TracingsFile } from '../../shared/tracings'
import { PHOTO_LINEUP_CLOSING, tracingData, tracingText, tracingsList } from './text'

const tracing = (over: Partial<Tracing> = {}): Tracing => ({
  id: 'T1',
  by: 'person',
  name: 'Front of the block',
  layout: 'assembly',
  createdAt: '2026-11-17T12:00:00.000Z',
  plane: { ...mainPlaneFrame('XZ', 0), from: { kind: 'main', axis: 'XZ', offset: 0 } },
  layers: [],
  nextLayer: 1,
  ...over
})
const layer = (over: Partial<Layer> = {}): Layer => ({ id: 1, name: 'head bolts', colour: 'teal', by: 'agent', shapes: [], revision: 1, ...over })

const square = (side: number, at = 0): [number, number][] => [[at, at], [at + side, at], [at + side, at + side], [at, at + side]]
const ring = (n: number, r: number): [number, number][] => Array.from({ length: n }, (_, i) => [r * Math.cos((2 * Math.PI * i) / n), r * Math.sin((2 * Math.PI * i) / n)])
const loop = (points: [number, number][], over: Record<string, unknown> = {}) => ({ points, closed: true, area: 1200, areaExact: true, deflection: 0.01, ...over })
const cutOf = (parts: Sectioned['parts']): TracingCut => ({
  tracing: 'T1',
  revision: 7,
  cut: { plane: { origin: [0, 0, 0], normal: [0, -1, 0], x: [1, 0, 0], y: [0, 0, 1] }, parts, bounds: { min: [0, 0], max: [40, 30] } },
  snaps: []
})
const plate = cutOf([{ part: 'plate', loops: [loop([[0, 0], [40, 0], [40, 30], [0, 30]]), loop(square(10, 5), { area: -100, areaExact: false })], area: 1100, areaExact: true, open: 0, how: 'cross-section of the solid' }])

describe('the list', () => {
  it('says each tracing by id, name, plane, layout, who made it and its counts', () => {
    const file: TracingsFile = {
      next: 3,
      tracings: [
        tracing({ layers: [layer({ shapes: [{ kind: 'label', at: [1, 1], text: 'x' }, { kind: 'label', at: [2, 1], text: 'y' }] }), layer({ id: 2, name: 'b', by: 'person' })] }),
        tracing({ id: 'T2', by: 'agent', name: '', layout: 'print', plane: { ...mainPlaneFrame('XY', 12), from: { kind: 'main', axis: 'XY', offset: 12 } } })
      ]
    }
    const said = tracingsList(file)
    expect(said).toContain('T1 "Front of the block": XZ at y = 0.0 (u = +X, v = +Z), layout assembly, by the person, 2 layers, 2 shapes')
    expect(said).toContain('T2 "Tracing T2": XY at z = 12.0 (u = +X, v = +Y), layout print, by you, 0 layers, 0 shapes')
  })

  it('says there are none', () => {
    expect(tracingsList({ next: 1, tracings: [] })).toMatch(/no tracings/i)
  })

  it('says a tracing whose face is lost, and a photo', () => {
    const said = tracingsList({ next: 2, tracings: [tracing({ lost: 'block/F31 is not in this plane any more' })] })
    expect(said).toContain('block/F31 is not in this plane any more')
  })
})

describe('one tracing', () => {
  it('says its plane on a main plane and who made it', () => {
    const t = tracingText(tracing(), { cut: plate })
    expect(t).toContain('T1 "Front of the block" by the person, layout assembly')
    expect(t).toContain('plane: XZ at y = 0.0 (u = +X, v = +Z)')
  })

  it('says how a face tracing follows its face, and the lost sentence when it is lost', () => {
    const face = tracing({ plane: { ...mainPlaneFrame('XY', 10), label: 'plane of block/F31 (u = +X, v = +Y)', from: { kind: 'face', ref: 'block/F31', revision: 3 } } })
    expect(tracingText(face, { cut: plate })).toContain('plane of block/F31, followed along its normal after each build')
    expect(tracingText({ ...face, lost: 'block/F31 is not in this plane any more' }, { cut: plate })).toContain('block/F31 is not in this plane any more')
    const section = tracing({ plane: { ...mainPlaneFrame('XY', 10), label: 'section through (0, 0, 10)', from: { kind: 'section', origin: [0, 0, 10], normal: [0, 0, 1] } } })
    expect(tracingText(section, { cut: plate })).toMatch(/plane: section through \(0, 0, 10\).*frozen/)
  })

  it('says the build the outline is of and the area of each part as the kernel says it, exact or ≈, with the loops and the bounds', () => {
    const t = tracingText(tracing(), { cut: plate })
    expect(t).toContain('outline of build r7')
    expect(t).toContain('plate 1100 mm², 2 loops, u 0 to 40, v 0 to 30')
    const approximate = cutOf([{ ...plate.cut.parts[0], area: 99.5, areaExact: false }])
    expect(tracingText(tracing(), { cut: approximate })).toContain('plate ≈ 99.5 mm²')
    // A loop's own area keeps its own exactness.
    expect(t).toMatch(/loop 2: closed, ≈ -100 mm²/)
    expect(t).toMatch(/loop 1: closed, 1200 mm²/)
  })

  it('tells the points of a loop in mm, in full to a tenth of a micron', () => {
    const t = tracingText(tracing(), { cut: cutOf([{ part: 'p', loops: [loop([[0, 0], [12.34567891, 0], [12.34567891, 5.5], [0, 5.5]])], area: 68, areaExact: true, open: 0, how: '' }]) })
    expect(t).toContain('[0, 0] [12.3457, 0] [12.3457, 5.5] [0, 5.5]')
  })

  it('thins the points as the section tool does, and says how many were kept, of how many, and the deflection', () => {
    const big = cutOf([{ part: 'wheel', loops: [loop(ring(2000, 20)), loop(ring(2000, 10), { area: -314, deflection: 0.01 })], area: 942, areaExact: false, open: 0, how: '' }])
    const t = tracingText(tracing(), { cut: big })
    expect(t).toMatch(/thinned: 1[45]\d\d of the 4000 points cut/)
    expect(t).toMatch(/within 0\.0[0-9]+ mm of the true outline/)
    const data = tracingData(tracing(), { cut: big }) as { outline: { parts: Array<{ points: number; of: number; thinned?: true; deflection: number }> } }
    expect(data.outline.parts[0]).toMatchObject({ of: 4000, thinned: true })
    expect(data.outline.parts[0].points).toBeLessThanOrEqual(1500)
    expect(data.outline.parts[0].points).toBeGreaterThan(1400)
    expect(data.outline.parts[0].deflection).toBeGreaterThanOrEqual(0.01)
  })

  it('says an outline of a surface (open) as lines, and a part that is not cut', () => {
    const t = tracingText(tracing(), { cut: cutOf([{ part: 'shell', loops: [loop([[0, 0], [10, 0], [10, 5]], { closed: false, area: null, areaExact: true })], area: null, areaExact: true, open: 1, how: '' }, { part: 'lid', loops: [], area: null, areaExact: true, open: 0, how: '' }]) })
    expect(t).toContain('shell, open')
    expect(t).toContain('lid, not cut')
  })

  it('says why there is no outline, instead of inventing one', () => {
    expect(tracingText(tracing(), { cut: null, cutWhy: 'no build yet' })).toContain('outline: none (no build yet)')
  })

  it('says every shape of every layer in mm, by whom, with its number and what each shape is called', () => {
    const t = tracingText(
      tracing({
        layers: [
          layer({ shapes: [{ kind: 'circle', name: 'head bolt 1', centre: [10, 5.25], radius: 3.2 }, { kind: 'polyline', points: [[0, 0], [10, 0], [10, 10]], closed: true }, { kind: 'label', at: [2, 3], text: 'M6' }] }),
          layer({ id: 2, name: 'jacket', colour: 'blue', by: 'person', revision: 3, shapes: [{ kind: 'polyline', name: 'wall', points: [[1, 1], [5, 5]] }] })
        ]
      }),
      { cut: plate }
    )
    expect(t).toContain('layer 1 "head bolts" (teal, by you, 3 shapes, revision 1)')
    expect(t).toContain('circle "head bolt 1" centre [10, 5.25] radius 3.2')
    expect(t).toContain('polyline (shape 2 of head bolts) closed [0, 0] [10, 0] [10, 10]')
    expect(t).toContain('label at [2, 3] "M6"')
    expect(t).toContain('layer 2 "jacket" (blue, by the person, 1 shape, revision 3)')
    expect(t).toContain('polyline "wall" open [1, 1] [5, 5]')
  })

  it('says a hidden layer', () => {
    expect(tracingText(tracing({ layers: [layer({ hidden: true })] }), { cut: plate })).toContain('hidden by the person')
  })

  it('says when there is no photo, and nothing of marks that are not there yet', () => {
    const t = tracingText(tracing(), { cut: plate })
    expect(t).toContain('photo: none')
  })

  it('says the photo\'s line-up words, always ending as the photo is not exact and true only in the tracing\'s plane', () => {
    const photo = { file: 'p-0123456789ab.jpg', sha256: 'x', width: 4000, height: 3000, pairs: [1, 2, 3, 4].map((i) => ({ photo: [i, i] as [number, number], uv: [i, i] as [number, number] })), method: 'straight' as const, transform: [1, 0, 0, 0, -1, 0, 0, 0, 1] as never, scale: 4.73, angle: 2.1, fit: 0.4, straightened: 's-0123456789ab.jpg', fade: 0.5 }
    const t = tracingText(tracing({ photo }), { cut: plate })
    expect(t).toContain('photo: lined up by 4 points, straightened: 4.73 px/mm at the centre, turned 2.1°, fit 0.4 mm; not exact, and true only in the tracing\'s plane')
    expect(PHOTO_LINEUP_CLOSING).toBe("not exact, and true only in the tracing's plane")
    const none = { ...photo, pairs: photo.pairs.slice(0, 2), method: 'similar' as const, fit: undefined }
    expect(tracingText(tracing({ photo: none }), { cut: plate })).toContain('lined up by 2 points: 4.73 px/mm at the centre, turned 2.1°, no spare point to check it; not exact')
    // The photo is not on this computer, and the line-up is still told: it is in the file that travels.
    const away = tracingText(tracing({ photo }), { cut: plate, photoHere: false })
    expect(away).toContain("photo: the photo is not on this computer; lined up by 4 points, straightened: 4.73 px/mm at the centre, turned 2.1°, fit 0.4 mm; not exact, and true only in the tracing's plane")
    expect(tracingText(tracing({ photo: { ...photo, pairs: [], transform: undefined, scale: undefined } }), { cut: plate, photoHere: false })).toContain('photo: the photo is not on this computer')
    expect(tracingText(tracing({ photo: { ...photo, pairs: [], transform: undefined, scale: undefined } }), { cut: plate })).toMatch(/photo: .*not lined up yet/)
  })

  it('says a hidden photo is hidden, and still ends its line as the photo is not exact and true only in the tracing\'s plane', () => {
    const photo = { file: 'p-0123456789ab.jpg', sha256: 'x', width: 4000, height: 3000, pairs: [1, 2].map((i) => ({ photo: [i, i] as [number, number], uv: [i, i] as [number, number] })), method: 'similar' as const, transform: [1, 0, 0, 0, -1, 0, 0, 0, 1] as never, scale: 4.73, angle: 2.1, straightened: 's-0123456789ab.png', fade: 0.5, hidden: true as const }
    const line = tracingText(tracing({ photo }), { cut: plate }).split('\n').find((l) => l.startsWith('photo'))!
    expect(line).toBe("photo (hidden by the person, so not in a picture of the tracing): lined up by 2 points: 4.73 px/mm at the centre, turned 2.1°, no spare point to check it; not exact, and true only in the tracing's plane")
    expect(line.endsWith("not exact, and true only in the tracing's plane")).toBe(true)
  })

  it('says a photo swapped for another is not lined up, though the pairs keep the tracing side; the line-up is told with the data even when the photo is away', () => {
    const swapped = { file: 'p-0123456789ab.jpg', sha256: 'x', width: 4000, height: 3000, pairs: [{ uv: [1, 1] as [number, number] }, { uv: [2, 2] as [number, number] }], method: 'similar' as const, fade: 0.5 }
    expect((tracingData(tracing({ photo: swapped }), { cut: plate }) as Record<string, any>).photo).toMatchObject({ lined: false })
    expect(tracingText(tracing({ photo: swapped }), { cut: plate })).toMatch(/photo: .*not lined up yet/)
    const lined = { ...swapped, pairs: [{ photo: [1, 1] as [number, number], uv: [1, 1] as [number, number] }, { photo: [9, 9] as [number, number], uv: [2, 2] as [number, number] }], transform: [1, 0, 0, 0, -1, 0, 0, 0, 1] as never, scale: 4.73, angle: 2.1, fit: 0.4 }
    expect((tracingData(tracing({ photo: lined }), { cut: plate, photoHere: false }) as Record<string, any>).photo).toEqual({ here: false, lined: true, scale: 4.73, angle: 2.1, fit: 0.4, exact: false })
  })

  it('has data with the facts and the text, and no shapes or points of its own beyond the text', () => {
    const data = tracingData(tracing({ by: 'agent', layers: [layer({ shapes: [{ kind: 'label', at: [2, 3], text: 'M6' }] })] }), { cut: plate }) as Record<string, any>
    expect(data).toMatchObject({ id: 'T1', by: 'agent', name: 'Front of the block', layout: 'assembly', plane: { label: 'XZ at y = 0.0 (u = +X, v = +Z)', from: { kind: 'main' } } })
    expect(data.layers).toEqual([{ id: 1, name: 'head bolts', colour: 'teal', by: 'agent', shapes: 1, revision: 1 }])
    expect(data.outline).toMatchObject({ revision: 7, parts: [{ part: 'plate', area: 1100, areaExact: true, loops: 2, bounds: { min: [0, 0], max: [40, 30] } }] })
    expect(data.photo).toBeNull()
    expect(data.text).toContain('label at [2, 3] "M6"')
    expect(JSON.stringify(data)).not.toMatch(/"points":\[/)
  })
})
