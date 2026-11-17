import { describe, expect, it } from 'vitest'
import type { Sectioned } from '../../shared/geometry'
import type { Mark } from '../../shared/marks'
import type { Scene } from '../../shared/scene'
import { mainPlaneFrame } from '../../shared/planes'
import type { Layer, Tracing, TracingPhoto } from '../../shared/tracings'
import { png } from '../../test/pngFixtures'
import { type TracingDrawingDeps, makeTracingDrawing, tracingExportPath } from './tracing'
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

  describe('the photo', () => {
    const lined = (over: Partial<TracingPhoto> = {}): TracingPhoto => ({
      file: 'p-aaaaaaaaaaaa.jpg',
      sha256: 'a'.repeat(64),
      width: 200,
      height: 100,
      pairs: [{ photo: [0, 0], uv: [-20, 10] }, { photo: [200, 100], uv: [20, -10] }],
      method: 'similar',
      // 5 px per mm, y down is v down: the photo covers u -20 to 20 and v 10 down to -10.
      transform: [0.2, 0, -20, 0, -0.2, 10, 0, 0, 1],
      scale: 5,
      angle: 0,
      straightened: 's-bbbbbbbbbbbb.png',
      fade: 0.4,
      ...over
    })
    const withPhoto = (photo: TracingPhoto | undefined, bytes: Uint8Array | null = new Uint8Array(png(40, 20))): Partial<TracingDrawingDeps> => ({
      tracings: async () => [tracing(photo === undefined ? {} : { photo })],
      photoBytes: async (_id, file) => (file === 's-bbbbbbbbbbbb.png' ? bytes : null)
    })

    it('holds no image without the photo tick, even for a tracing with a photo', async () => {
      const made = await makeTracingDrawing(deps(withPhoto(lined())), 'enclosure', 'T1', ticks)
      expect(made.svg).not.toContain('<image')
      expect(made.svg).not.toContain('Photo')
    })

    it('holds one data: image, at its fade, placed by its rectangle, with the line-up and that it is not exact in the title block, with the tick', async () => {
      const made = await makeTracingDrawing(deps(withPhoto(lined())), 'enclosure', 'T1', { ...ticks, photo: true })
      expect(made.svg.match(/<image /g)).toHaveLength(1)
      expect(made.svg).toMatch(/<image data-photo="" href="data:image\/png;base64,[A-Za-z0-9+/=]+"/)
      expect(made.svg).toContain('opacity="0.4"')
      // The rectangle is 40 by 20 mm.
      expect(made.svg).toMatch(/width="40" height="20"/)
      expect(made.svg).toMatch(/>lined up by 2 points: 5 px\/mm at the centre, turned 0°, no spare point to check it; not exact, and true only in the tracing's plane</)
      expect(made.svg.replace(/xmlns="[^"]+"/, "")).not.toMatch(/https?:/)
    })

    it('says in words when the photo is ticked and there is none, it is not lined up, or its copy is not on this computer', async () => {
      const ticked = { ...ticks, photo: true }
      await expect(makeTracingDrawing(deps(withPhoto(undefined)), 'enclosure', 'T1', ticked)).rejects.toThrow('T1 has no photo to put in the drawing')
      await expect(makeTracingDrawing(deps(withPhoto(lined({ transform: undefined, scale: undefined, angle: undefined, straightened: undefined }))), 'enclosure', 'T1', ticked)).rejects.toThrow('The photo of T1 is not lined up yet')
      await expect(makeTracingDrawing(deps(withPhoto(lined({ straightened: undefined }))), 'enclosure', 'T1', ticked)).rejects.toThrow('The straightened photo of T1 is not on this computer')
      await expect(makeTracingDrawing(deps(withPhoto(lined(), null)), 'enclosure', 'T1', ticked)).rejects.toThrow('The straightened photo of T1 is not on this computer')
      await expect(makeTracingDrawing(deps(withPhoto(lined(), new Uint8Array([1, 2, 3]))), 'enclosure', 'T1', ticked)).rejects.toThrow('is not a picture')
    })

    it('draws a hidden photo when the person ticked it: hiding is how the view looks', async () => {
      const made = await makeTracingDrawing(deps(withPhoto(lined({ hidden: true }))), 'enclosure', 'T1', { ...ticks, photo: true })
      expect(made.svg).toContain('<image ')
    })
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
