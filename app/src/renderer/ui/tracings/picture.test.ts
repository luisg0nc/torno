import { describe, expect, it } from 'vitest'
import type { Sectioned } from '../../../shared/geometry'
import { mainPlaneFrame } from '../../../shared/planes'
import type { TracingPictureRequest } from '../../../shared/tracings'
import { pictureSvg } from './picture'

// The drawing Claude is sent of a tracing: `tracingSvg`'s elements on a white sheet, a 10 mm grid, the layers in their colours, at a long edge
// of `size` px, with what maps pixels to mm. Drawn to a canvas by `drawTracingPicture`; the svg and the mapping are made here, apart from it.

const cut = (down: boolean): Sectioned => ({
  plane: { origin: [0, 0, 0], normal: [0, -1, 0], x: [1, 0, 0], y: down ? [0, 0, -1] : [0, 0, 1] },
  parts: [{ part: 'plate', loops: [{ points: [[0, 0], [40, 0], [40, 30], [0, 30]], closed: true, area: 1200, areaExact: true, deflection: 0.01 }], area: 1200, areaExact: true, open: 0, how: '' }],
  bounds: { min: [0, 0], max: [40, 30] }
})
const request = (over: Partial<TracingPictureRequest> = {}): TracingPictureRequest => ({
  objectId: 'bracket',
  object: 'bracket',
  tracing: 'T1',
  name: 'front',
  plane: mainPlaneFrame('XZ', 0).label,
  layout: 'assembly',
  revision: 7,
  cut: cut(false),
  layers: [{ id: 1, name: 'bolts', colour: 'plum', by: 'agent', shapes: [{ kind: 'circle', centre: [10, 10], radius: 3 }], revision: 1 }],
  size: 1280,
  ...over
})

describe('the svg of a tracing picture', () => {
  it('is as wide as asked on its long edge and as tall as the box is, on a white sheet, in the box of what is drawn plus a margin', () => {
    const drawn = pictureSvg(request())
    // The box is the cut and the layers (0 to 40 by 0 to 30) with a 4 mm margin each side: 48 by 38 mm.
    expect(drawn.width).toBe(1280)
    expect(drawn.height).toBe(Math.round((38 / 48) * 1280))
    expect(drawn.svg).toContain(`width="${drawn.width}" height="${drawn.height}"`)
    expect(drawn.svg).toMatch(/viewBox="-4 -34 48 38"/)
    expect(drawn.svg).toContain('fill="#FFFFFF"')
  })

  it('draws the 10 mm grid, the outline, and the layers in the colour of the layer, with no title block or sheet', () => {
    const { svg } = pictureSvg(request())
    expect(svg).toContain('data-grid="10"')
    expect(svg).not.toContain('data-grid="1"')
    expect(svg).toContain('data-part="plate"')
    expect(svg).toContain('class="tr-layer tr-layer-plum"')
    expect(svg).toMatch(/\.tr-layer-plum\s*\{\s*color:\s*#9B3E7C/)
    expect(svg).not.toContain('data-title-block')
    expect(svg).not.toContain('data-scale-bar')
  })

  it('says what a pixel is in mm and where u = 0 and v = 0 are, v up when the plane\'s y points up in the world', () => {
    const drawn = pictureSvg(request())
    // 48 mm over 1280 px.
    expect(drawn.mmPerPx).toBeCloseTo(48 / 1280, 6)
    // u = 0 is 4 mm in from the left; v = 0 is the bottom edge of the box (v up: 30 mm above it is the top, 4 mm margin).
    expect(drawn.origin[0]).toBeCloseTo(4 / drawn.mmPerPx, 3)
    expect(drawn.origin[1]).toBeCloseTo((34 / 38) * drawn.height, 1)
    expect(drawn.vUp).toBe(true)
  })

  it('says v runs down when the plane\'s y points down in the world, and puts v = 0 at the top', () => {
    const drawn = pictureSvg(request({ cut: cut(true) }))
    expect(drawn.vUp).toBe(false)
    expect(drawn.origin[1]).toBeCloseTo((4 / 38) * drawn.height, 1)
  })

  it('takes the long edge to be the tall one when it is', () => {
    const tall = pictureSvg(request({ cut: { ...cut(false), bounds: { min: [0, 0], max: [10, 90] } }, layers: [], size: 800 }))
    expect(tall.height).toBe(800)
    expect(tall.width).toBeLessThan(800)
  })

  it('is no larger than the window may send', () => {
    expect(pictureSvg(request({ size: 99999 })).width).toBe(2000)
    expect(pictureSvg(request({ size: 1 })).width).toBe(256)
  })

  it('leaves a hidden layer out, and escapes what a label says', () => {
    const drawn = pictureSvg(
      request({ layers: [{ id: 1, name: 'x', colour: 'blue', by: 'agent', hidden: true, shapes: [], revision: 1 }, { id: 2, name: 'y', colour: 'teal', by: 'agent', shapes: [{ kind: 'label', at: [5, 5], text: '<b>&' }], revision: 1 }] })
    )
    expect(drawn.svg).not.toContain('class="tr-layer tr-layer-blue"')
    expect(drawn.svg).toContain('class="tr-layer tr-layer-teal"')
    expect(drawn.svg).toContain('&lt;b&gt;&amp;')
  })
})

describe('the photo in the picture Claude is sent', () => {
  const href = 'data:image/png;base64,iVBORw0KGgo='
  const photo = { rect: { min: [-30, -20] as [number, number], max: [70, 50] as [number, number] }, fade: 0.5 }

  it('is drawn under the outline at its fade, on the white sheet, by its rectangle in mm', () => {
    const { svg } = pictureSvg(request({ photo }), href)
    expect(svg).toMatch(/<image data-photo="" href="data:image\/png;base64,iVBORw0KGgo=" x="-30" y="-50" width="100" height="70"[^>]*opacity="0.5"/)
    expect(svg.indexOf('<rect')).toBeLessThan(svg.indexOf('<image'))
    expect(svg.indexOf('<image')).toBeLessThan(svg.indexOf('data-part="plate"'))
  })

  it('is not drawn when there is no image to put in, or the tracing shows none', () => {
    expect(pictureSvg(request({ photo }), undefined).svg).not.toContain('<image')
    expect(pictureSvg(request(), href).svg).not.toContain('<image')
  })

  it('stays within 2000 px on the long edge whatever the photo is, and its box is in the picture\'s mapping', () => {
    for (const size of [1280, 2000, 99999]) {
      const drawn = pictureSvg(request({ photo, size }), href)
      expect(Math.max(drawn.width, drawn.height)).toBeLessThanOrEqual(2000)
    }
    // The photo is wider than the outline: the box grows to it, plus the margin, and a pixel is that many mm.
    const drawn = pictureSvg(request({ photo, size: 1000 }), href)
    expect(drawn.mmPerPx).toBeCloseTo(108 / 1000, 6)
  })
})

describe('ink on the picture', () => {
  const ink = {
    id: 'M7',
    kind: 'sketch',
    author: 'user',
    status: 'draft',
    note: '',
    tracing: 'T1',
    planes: [{ id: 1, origin: [0, 0, 0], x: [1, 0, 0], y: [0, 0, 1], label: 'XZ', from: { kind: 'tracing', tracing: 'T1' } }],
    strokes: [{ id: 'k1', plane: 1, pen: 'free', revision: 7, points2d: [[5, 5], [30, 20]] }]
  } as never

  it('draws the marks it is given in their colours, with the stylesheet a canvas has none of, and nothing without them', () => {
    const drawn = pictureSvg(request(), undefined, [ink])
    expect(drawn.svg).toContain('data-mark="M7"')
    expect(drawn.svg).toContain('data-stroke="k1"')
    expect(drawn.svg).toContain('.tr-mark-user{stroke:#C23B3B}')
    expect(pictureSvg(request()).svg).not.toContain('data-mark')
  })

  it('still maps its pixels to mm with ink beyond the outline: the box grows to hold it', () => {
    const far = { ...(ink as object), strokes: [{ id: 'k1', plane: 1, pen: 'line', revision: 7, points2d: [[5, 5], [100, 5]] }] } as never
    const drawn = pictureSvg(request(), undefined, [far])
    expect(drawn.width).toBe(1280)
    expect(drawn.mmPerPx).toBeGreaterThan(pictureSvg(request()).mmPerPx)
  })
})
