import { describe, expect, it } from 'vitest'
import type { Sectioned } from './geometry'
import type { Mark, PinMark } from './marks'
import { LAYER_INKS, tracingSvg } from './tracingSvg'
import type { Layer } from './tracings'

const loop = (points: Array<[number, number]>, area: number) => ({ points, closed: true, area, areaExact: true, deflection: 0.01 })

/** A square part 40 mm on a side, with a 10 mm square hole, cut by z = 5. */
function square(): Sectioned {
  return {
    plane: { origin: [0, 0, 5], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] },
    parts: [{ part: 'block', loops: [loop([[-20, -20], [20, -20], [20, 20], [-20, 20]], 1600), loop([[-5, -5], [5, -5], [5, 5], [-5, 5]], -100)], area: 1500, areaExact: true, open: 0, how: 'cross-section of the solid' }],
    bounds: { min: [-20, -20], max: [20, 20] }
  }
}
const info = { object: 'enclosure', layout: 'assembly', revision: 3, date: new Date('2026-11-17T10:00:00Z'), marks: [] }
const sheet = { ...info, tracing: { id: 'T1', name: 'Front', plane: 'XY at z = 5' } }
const layer = (over: Partial<Layer> = {}): Layer => ({ id: 1, name: 'head bolts', colour: 'ochre', by: 'agent', shapes: [{ kind: 'circle', centre: [10, 10], radius: 2 }, { kind: 'polyline', points: [[0, 0], [30, 5]] }, { kind: 'label', at: [12, 14], text: 'M8' }], revision: 1, ...over })
const pairs = (d: string): Array<[number, number]> => [...d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])])

describe('tracingSvg', () => {
  it('draws a 40 mm square as a 40 mm path on a sheet named in millimetres, one unit one millimetre', () => {
    const { svg, width, height } = tracingSvg(square(), sheet)
    expect(svg).toContain(`width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}"`)
    const outer = pairs(/data-part="block" d="([^"]+?) Z M/.exec(svg)![1])
    expect(Math.max(...outer.map((p) => p[0])) - Math.min(...outer.map((p) => p[0]))).toBeCloseTo(40, 6)
    expect(Math.max(...outer.map((p) => p[1])) - Math.min(...outer.map((p) => p[1]))).toBeCloseTo(40, 6)
  })

  it('holds no workspace root, no home folder, no user name and no link but the namespace', () => {
    const { svg } = tracingSvg(square(), sheet, { layers: [layer()], grid: 1 })
    for (const bad of ['/home/', '/Users/', 'workspace', '.torno']) expect(svg).not.toContain(bad)
    expect(svg.replace('xmlns="http://www.w3.org/2000/svg"', '')).not.toContain('http')
  })

  it('names the tracing in the title block, and the parts on the outline with a tab in their colour', () => {
    const { svg, titleRows } = tracingSvg(square(), { ...sheet, partColours: { block: '#3355AA' } })
    expect(titleRows.slice(0, 3)).toEqual([['Project', 'enclosure'], ['Tracing', 'T1 Front'], ['Plane', 'XY at z = 5']])
    expect(svg).toContain('T1 Front')
    expect(svg).toMatch(/<g data-part-name="block">\s*<rect [^>]*fill="#3355AA"\/>\s*<text [^>]*fill="#646970">block<\/text>/)
  })

  it('draws the layers in their colours with a legend, and leaves a hidden layer out', () => {
    const { svg } = tracingSvg(square(), sheet, { layers: [layer(), layer({ id: 2, name: 'secret', hidden: true })] })
    expect(svg).toContain('data-layer="1"')
    expect(svg).toContain(`stroke="${LAYER_INKS.ochre}"`)
    expect(svg).toMatch(/<g data-legend=""[^>]*>[\s\S]*head bolts[\s\S]*3 shapes, by Claude/)
    expect(svg).not.toContain('secret')
    expect(svg).toContain('>M8</text>')
    expect(tracingSvg(square(), sheet, { layers: [layer({ hidden: true })] }).svg).not.toContain('data-legend')
  })

  it('sets a layer name and a label as text, never as markup', () => {
    const { svg } = tracingSvg(square(), sheet, { layers: [layer({ name: '<b>x</b> & "y"', shapes: [{ kind: 'label', at: [0, 0], text: '<script>\u0001' }] })] })
    expect(svg).not.toContain('<b>')
    expect(svg).not.toContain('<script>')
    expect(svg).not.toContain('\u0001')
    expect(svg).toContain('&lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot;')
  })

  it('holds no image when no photo is given', () => {
    expect(tracingSvg(square(), sheet, { layers: [layer()] }).svg).not.toContain('<image')
    expect(tracingSvg(square(), { ...sheet, photoSaid: '4.7 px/mm, not exact' }).svg).not.toContain('Photo')
  })

  it('places the photo by its rectangle in mm, under the outline, and says its line-up in the title block', () => {
    const href = 'data:image/png;base64,iVBORw0KGgo='
    const { svg, titleRows } = tracingSvg(square(), { ...sheet, photoSaid: '4.73 px/mm, not exact' }, { photo: { href, rect: { min: [-25, -22], max: [25, 22] }, fade: 0.4 } })
    const m = /<image data-photo="" href="([^"]+)" x="([\d.-]+)" y="([\d.-]+)" width="([\d.-]+)" height="([\d.-]+)" preserveAspectRatio="none" opacity="0.4"/.exec(svg)!
    expect(m[1]).toBe(href)
    expect(Number(m[4])).toBeCloseTo(50, 6)
    expect(Number(m[5])).toBeCloseTo(44, 6)
    expect(svg.indexOf('<image')).toBeLessThan(svg.indexOf('data-part="block"'))
    expect(titleRows).toContainEqual(['Photo', '4.73 px/mm, not exact'])
  })

  it('turns the photo over with the sheet when v runs down, so that its top row stays at the greatest v', () => {
    const href = 'data:image/png;base64,iVBORw0KGgo='
    const down = (): Sectioned => ({ ...square(), plane: { origin: [0, 0, 5], normal: [0, -1, 0], x: [1, 0, 0], y: [0, 0, -1] } })
    const extras = { photo: { href, rect: { min: [-25, -22], max: [25, 22] } as { min: [number, number]; max: [number, number] }, fade: 0.4 } }
    const flipped = tracingSvg(down(), sheet, extras)
    expect(flipped.down).toBe(true)
    // Turned about its own middle: y' = 2 y + height.
    const m = /<image data-photo="" [^>]*y="([\d.-]+)" width="[\d.-]+" height="([\d.-]+)" [^>]*transform="matrix\(1 0 0 -1 0 ([\d.-]+)\)"/.exec(flipped.svg)!
    expect(Number(m[3])).toBeCloseTo(2 * Number(m[1]) + Number(m[2]), 3)
    const screen = tracingSvg(down(), sheet, { ...extras, forScreen: true })
    expect(screen.svg).toMatch(/<image data-photo="" [^>]*y="-22" width="50" height="44" [^>]*transform="matrix\(1 0 0 -1 0 0\)"/)
    expect(tracingSvg(square(), sheet, extras).svg).not.toContain('transform=')
  })

  it('draws a sheet whose v runs up whatever the plane is, when asked: the way a photo from the front of the plane sees it', () => {
    const down: Sectioned = { ...square(), plane: { origin: [0, 0, 5], normal: [0, -1, 0], x: [1, 0, 0], y: [0, 0, -1] } }
    expect(tracingSvg(down, sheet, { forScreen: true }).down).toBe(true)
    expect(tracingSvg(down, sheet, { forScreen: true, vUp: true }).down).toBe(false)
  })

  it('draws no photo whose address is not its own bytes, in a file', () => {
    for (const href of ['http://example.com/a.png', 'file:///home/x/a.png', 'blob:abc', 'data:text/html;base64,AAAA']) {
      expect(tracingSvg(square(), sheet, { photo: { href, rect: { min: [0, 0], max: [10, 10] }, fade: 1 } }).svg).not.toContain('<image')
    }
  })

  it('draws the grid every 10 mm, and every mm between when asked', () => {
    const ten = tracingSvg(square(), sheet, { grid: 10 }).svg
    expect(ten).toContain('data-grid="10"')
    expect(ten).not.toContain('data-grid="1"')
    expect(tracingSvg(square(), sheet, { grid: 1 }).svg).toContain('data-grid="1"')
    expect(tracingSvg(square(), sheet).svg).not.toContain('data-grid')
  })

  it('draws a pin of the person in red and the agent\'s arrow in green, and not a resolved one', () => {
    const base = { note: '', status: 'sent', anchorState: 'ok', layout: 'assembly', revision: 3, camera: {}, createdAt: '' }
    const pin = { ...base, id: 'M4', kind: 'pin', author: 'user', anchor: { point: [10, 5, 5] } } as unknown as PinMark
    const arrow = { ...base, id: 'M5', kind: 'arrow', author: 'agent', from: { point: [0, 0, 5] }, to: [10, 10, 5] } as never
    const gone = { ...pin, id: 'M6', status: 'resolved' } as unknown as Mark
    const { svg } = tracingSvg(square(), sheet, { marks: [pin, arrow, gone] })
    expect(svg).toMatch(/data-mark="M4"[^>]*stroke="#C23B3B"/)
    expect(svg).toMatch(/data-mark="M5"[^>]*stroke="#2E8B57"/)
    expect(svg).not.toContain('data-mark="M6"')
  })

  describe('marks on the tracing', () => {
    const base = { note: '', status: 'draft', anchorState: 'ok', layout: 'assembly', revision: 3, camera: {}, createdAt: '' }
    const ink = (over: Record<string, unknown> = {}): Mark =>
      ({
        ...base,
        id: 'M7',
        kind: 'sketch',
        author: 'user',
        name: '',
        take: 'rough',
        nextStroke: 3,
        tracing: 'T1',
        planes: [{ id: 1, origin: [0, 0, 5], x: [1, 0, 0], y: [0, 1, 0], label: 'XY', from: { kind: 'tracing', tracing: 'T1' } }],
        strokes: [
          { id: 'k1', plane: 1, pen: 'free', revision: 3, points2d: [[0, 0], [10, 5], [20, 5]] },
          { id: 'k2', plane: 1, pen: 'points', revision: 3, points2d: [[-10, -10], [-10, 10]] }
        ],
        ...over
      }) as unknown as Mark

    it('draws ink as a path through the points of each stroke in the plane, in the person\'s colour, with its id', () => {
      const { svg } = tracingSvg(square(), sheet, { marks: [ink()], forScreen: undefined })
      expect(svg).toMatch(/data-mark="M7"[^>]*stroke="#C23B3B"/)
      expect(svg).toContain('data-stroke="k1"')
      expect(svg).toContain('data-stroke="k2"')
      const k1 = /data-stroke="k1">\s*<path d="([^"]+)"/.exec(svg)![1]
      expect(pairs(k1)).toHaveLength(3)
      // A point to point stroke marks its points.
      expect(svg.match(/data-stroke="k2"[\s\S]*?<\/g>/)![0]).toContain('<circle')
    })

    it('draws ink on the screen with the stylesheet\'s classes, v up the screen as y is down, the strokes in the millimetres of the sheet', () => {
      const { svg } = tracingSvg(square(), sheet, { marks: [ink()], forScreen: true })
      expect(svg).toContain('class="tr-mark tr-mark-user"')
      const k1 = /data-stroke="k1">\s*<path d="([^"]+)"/.exec(svg)![1]
      expect(pairs(k1)).toEqual([[0, 0], [10, -5], [20, -5]])
    })

    it('leaves out ink on another tracing, ink resolved, and a plane that is not a tracing\'s', () => {
      const other = ink({ id: 'M8', tracing: 'T2', planes: [{ id: 1, origin: [0, 0, 5], x: [1, 0, 0], y: [0, 1, 0], label: 'XY', from: { kind: 'tracing', tracing: 'T2' } }] })
      const done = ink({ id: 'M9', status: 'resolved' })
      const plain = ink({ id: 'M10', tracing: undefined, planes: [{ id: 1, origin: [0, 0, 5], x: [1, 0, 0], y: [0, 1, 0], label: 'XY', from: { kind: 'main', axis: 'XY', offset: 5 } }] })
      const { svg } = tracingSvg(square(), sheet, { marks: [other, done, plain] })
      for (const id of ['M8', 'M9', 'M10']) expect(svg).not.toContain(`data-mark="${id}"`)
    })

    it('grows the sheet to hold ink that lies beyond the outline', () => {
      const wide = ink({ strokes: [{ id: 'k1', plane: 1, pen: 'line', revision: 3, points2d: [[0, 0], [90, 0]] }] })
      const plain = tracingSvg(square(), sheet, { forScreen: true })
      const grown = tracingSvg(square(), sheet, { marks: [wide], forScreen: true })
      expect(grown.box![2]).toBeGreaterThan(plain.box![2] + 40)
    })

    it('frames the outline on the screen, not a photo far larger than it, while a file still holds the photo', () => {
      const href = `data:image/png;base64,${'A'.repeat(8)}`
      const huge = { photo: { href, rect: { min: [-900, -700] as [number, number], max: [1100, 800] as [number, number] }, fade: 0.5 } }
      const plain = tracingSvg(square(), sheet, { forScreen: true })
      expect(tracingSvg(square(), sheet, { ...huge, forScreen: true, frameOutline: true }).box).toEqual(plain.box)
      expect(tracingSvg(square(), sheet, { ...huge, forScreen: true }).box![2]).toBeGreaterThan(2000)
      expect(tracingSvg(square(), sheet, huge).width).toBeGreaterThan(tracingSvg(square(), sheet).width + 1000)
    })

    it('frames the photo on the screen when there is nothing else to frame', () => {
      const href = `data:image/png;base64,${'A'.repeat(8)}`
      const none = { ...square(), bounds: null, parts: [] } as unknown as ReturnType<typeof square>
      const out = tracingSvg(none, sheet, { photo: { href, rect: { min: [-30, -20], max: [30, 20] }, fade: 0.5 }, forScreen: true, frameOutline: true })
      expect(out.box).toEqual([-34, -24, 68, 48])
    })

    it('draws a pin with its note beside its id, on the screen and in the file', () => {
      const pin = { ...base, id: 'M4', kind: 'pin', author: 'user', tracing: 'T1', note: 'too thin here', anchor: { point: [10, 5, 5] } } as unknown as PinMark
      expect(tracingSvg(square(), sheet, { marks: [pin] }).svg).toContain('M4 too thin here')
    })

    it('draws a span as a line with its value, ≈ unless it is exact, and an offset as the shape where it was and where it should be', () => {
      const end = (uv: [number, number]): object => ({ uv, point: [uv[0], uv[1], 5], on: 'tracing' })
      const span = { ...base, id: 'M13', kind: 'span', author: 'user', tracing: 'T1', a: end([0, 0]), b: end([30, 0]), value: 30, exact: false, how: 'freehand', measuredOn: 3 } as unknown as Mark
      const exact = { ...span, id: 'M14', exact: true, how: 'exact on build 3' } as unknown as Mark
      const offset = { ...base, id: 'M12', kind: 'offset', author: 'user', tracing: 'T1', layer: { id: 1, name: 'head bolts', revision: 1 }, shape: { index: 0, name: '' }, was: { kind: 'circle', centre: [10, 10], radius: 2 }, by: [-1.8, 0.6], from: [10, 10, 5], to: [8.2, 10.6, 5], uv: [[10, 10], [8.2, 10.6]] } as unknown as Mark
      const { svg } = tracingSvg(square(), sheet, { marks: [span, exact, offset], forScreen: true })
      expect(svg).toContain('M13 ≈ 30 mm')
      expect(svg).toContain('M14 30 mm')
      expect(svg).toContain('data-mark="M12"')
      expect(svg).toContain('M12 1.8 mm left, 0.6 mm up')
      // The shape as it was is drawn, and the moved copy of it, 1.8 mm left and 0.6 up (the screen's y runs down).
      expect(svg).toMatch(/<circle[^>]*cx="10" cy="-10" r="2"/)
      expect(svg).toMatch(/<circle[^>]*cx="8.2" cy="-10.6" r="2"/)
    })
  })

  describe('for the screen', () => {
    it('gives the elements with class names, no inline colour, no sheet and no title block', () => {
      const out = tracingSvg(square(), { ...sheet, partColours: { block: '#3355AA' } }, { forScreen: true, layers: [layer()], grid: 1 })
      expect(out.svg).not.toMatch(/<svg|<\?xml|data-title-block|data-scale-bar|#[0-9A-Fa-f]{3,6}"/)
      expect(out.svg).toContain('class="tr-cut"')
      expect(out.svg).toContain('class="tr-layer tr-layer-ochre"')
      expect(out.svg).toContain('class="tr-tab"')
      expect(out.titleRows[0]).toEqual(['Project', 'enclosure'])
    })

    it('puts a point at its millimetres from the origin, y down the screen, and says the box', () => {
      const out = tracingSvg(square(), sheet, { forScreen: true })
      const outer = pairs(/data-part="block" d="([^"]+?) Z M/.exec(out.svg)![1])
      expect(outer[0]).toEqual([-20, 20])
      expect(outer[2]).toEqual([20, -20])
      expect(out.box).toEqual([-24, -24, 48, 48])
    })
  })
})
