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
