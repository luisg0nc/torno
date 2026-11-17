import { describe, expect, it } from 'vitest'
import type { Sectioned } from '../../shared/geometry'
import type { Mark } from '../../shared/marks'
import type { Scene } from '../../shared/scene'
import { mainPlaneFrame } from '../../shared/planes'
import type { Layer, Tracing } from '../../shared/tracings'
import { type TracingDrawingDeps, PHOTO_NOT_YET, makeTracingDrawing, tracingExportPath } from './tracing'
import { NOT_BUILT } from './build'
import { NEW_BUILD } from './model'

const part = (name: string) => ({ key: `assembly:${name}`, name, layout: 'assembly' })
const scene = { layouts: ['assembly'], parts: [part('tub'), part('lid')] } as unknown as Scene
const cut: Sectioned = {
  plane: { origin: [0, 0, 10], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] },
  parts: [{ part: 'tub', loops: [{ points: [[-20, -10], [20, -10], [20, 10], [-20, 10]], closed: true, area: 800, areaExact: true, deflection: 0.01 }], area: 800, areaExact: true, open: 0, how: 'x' }],
  bounds: { min: [-20, -10], max: [20, 10] }
}
const layer = (over: Partial<Layer> = {}): Layer => ({ id: 1, name: 'bolts', colour: 'teal', by: 'agent', shapes: [{ kind: 'circle', centre: [5, 5], radius: 2 }], revision: 1, ...over })
const tracing = (over: Partial<Tracing> = {}): Tracing => ({
  id: 'T1',
  by: 'person',
  name: 'Front',
  layout: 'assembly',
  createdAt: '2026-11-17T10:00:00.000Z',
  plane: { ...mainPlaneFrame('XY', 10), from: { kind: 'main', axis: 'XY', offset: 10 } },
  layers: [layer(), layer({ id: 2, name: 'hidden one', hidden: true })],
  nextLayer: 3,
  ...over
})
const pin = { id: 'M9', kind: 'pin', author: 'user', status: 'sent', layout: 'assembly', anchor: { point: [3, 3, 10] }, tracing: 'T1' } as unknown as Mark
const elsewhere = { ...pin, id: 'M8', tracing: 'T2' } as unknown as Mark
const ticks = { layers: true, marks: false, photo: false }

function deps(over: Partial<TracingDrawingDeps> & { asked?: unknown[] } = {}): TracingDrawingDeps {
  const { asked, ...rest } = over
  return {
    object: (id) => (id === 'enclosure' ? { id, name: 'enclosure', dir: '/w/enclosure', model: 'enclosure.py' } : undefined),
    last: () => ({ revision: 3, scene }),
    tracings: async () => [tracing()],
    sceneFile: async () => ({ layers: { tub: { color: '#336699' } } }),
    marks: async () => [pin, elsewhere],
    query: (async (_id: string, _name: string, args: unknown) => (asked?.push(args), cut)) as TracingDrawingDeps['query'],
    now: () => new Date('2026-11-17T10:00:00Z'),
    ...rest
  }
}

describe('makeTracingDrawing', () => {
  it('cuts the tracing\'s own plane within 0.01 mm of the last good build, in its own axes, without snaps', async () => {
    const asked: unknown[] = []
    const made = await makeTracingDrawing(deps({ asked }), 'enclosure', 'T1', ticks)
    expect(asked).toEqual([{ layout: 'assembly', plane: { origin: [0, 0, 10], normal: [0, 0, 1] }, axes: { x: [1, 0, 0], y: [0, 1, 0] }, deflection: 0.01 }])
    expect(made).toMatchObject({ objectId: 'enclosure', name: 'enclosure', id: 'T1', revision: 3 })
    expect(made.svg).toContain('T1 Front')
    expect(made.svg).toContain('tub 800 mm²')
  })

  it('names the parts a tracing draws, and the parts\' colours as tabs', async () => {
    const asked: unknown[] = []
    const made = await makeTracingDrawing(deps({ asked, tracings: async () => [tracing({ parts: ['tub', 'gone'] })] }), 'enclosure', 'T1', ticks)
    expect(asked[0]).toMatchObject({ parts: ['tub'] })
    expect(made.svg).toContain('fill="#336699"')
  })

  it('draws the layers that are shown with the layers tick, and none without it', async () => {
    expect((await makeTracingDrawing(deps(), 'enclosure', 'T1', ticks)).svg).toContain('data-layer="1"')
    expect((await makeTracingDrawing(deps(), 'enclosure', 'T1', ticks)).svg).not.toContain('hidden one')
    expect((await makeTracingDrawing(deps(), 'enclosure', 'T1', { ...ticks, layers: false })).svg).not.toContain('data-layer')
  })

  it('draws the marks that are on the tracing with the marks tick, and not those of another', async () => {
    expect((await makeTracingDrawing(deps(), 'enclosure', 'T1', ticks)).svg).not.toContain('data-mark')
    const svg = (await makeTracingDrawing(deps(), 'enclosure', 'T1', { ...ticks, marks: true })).svg
    expect(svg).toContain('data-mark="M9"')
    expect(svg).not.toContain('data-mark="M8"')
  })

  it('refuses the photo until the photo is in the drawing', async () => {
    await expect(makeTracingDrawing(deps(), 'enclosure', 'T1', { ...ticks, photo: true })).rejects.toThrow(PHOTO_NOT_YET)
  })

  it('refuses with a sentence: a tracing that is not there, no build, no such project, a layout the build lacks, a build that landed meanwhile', async () => {
    await expect(makeTracingDrawing(deps(), 'enclosure', 'T9', ticks)).rejects.toThrow('no tracing T9; tracings: T1')
    await expect(makeTracingDrawing(deps({ last: () => undefined }), 'enclosure', 'T1', ticks)).rejects.toThrow(NOT_BUILT)
    await expect(makeTracingDrawing(deps(), 'nothing', 'T1', ticks)).rejects.toThrow('There is no project of that name')
    await expect(makeTracingDrawing(deps({ tracings: async () => [tracing({ layout: 'print' })] }), 'enclosure', 'T1', ticks)).rejects.toThrow('no layout print')
    let revision = 3
    await expect(makeTracingDrawing(deps({ last: () => ({ revision, scene }), query: (async () => ((revision = 4), cut)) as TracingDrawingDeps['query'] }), 'enclosure', 'T1', ticks)).rejects.toThrow(NEW_BUILD)
  })

  it('names the file <project>-T1-r<revision>.svg in the project\'s exports folder', async () => {
    const made = await makeTracingDrawing(deps(), 'enclosure', 'T1', ticks)
    expect(tracingExportPath('/w/enclosure', made, 'svg')).toBe('/w/enclosure/.torno/exports/enclosure-T1-r3.svg')
    expect(tracingExportPath('/w/enclosure', made, 'pdf')).toBe('/w/enclosure/.torno/exports/enclosure-T1-r3.pdf')
  })
})
