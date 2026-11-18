import { describe, expect, it } from 'vitest'
import { MONO_FACE, UI_FACE } from '../../shared/fonts'
import type { SectionLoop, Sectioned, SectionedPart } from '../../shared/geometry'
import { FILL_ALPHA, SHEET, drawSection, sectionSheet, toSheet } from './sectionDrawing'

const loop = (points: [number, number][], area: number | null, closed = true): SectionLoop => ({ points, closed, area, areaExact: true, deflection: 0.05 })
const rect = (u0: number, v0: number, u1: number, v1: number): [number, number][] => [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]
const solid = (part: string, loops: SectionLoop[], more: Partial<SectionedPart> = {}): SectionedPart => ({ part, loops, area: loops.reduce((sum, l) => sum + (l.area ?? 0), 0), areaExact: true, open: 0, how: 'cross-section of the solid', ...more })

/** A plate 40 × 30 cut across Z, with a hole 10 × 10 in it. */
const PLATE: Sectioned = {
  plane: { origin: [0, 0, 3], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] },
  parts: [solid('plate', [loop(rect(-20, -15, 20, 15), 1200), loop(rect(-5, -5, 5, 5).reverse() as [number, number][], -100)])],
  bounds: { min: [-20, -15], max: [20, 15] }
}

/** A canvas context that keeps what was drawn on it: each fill of a path with its colour, its rule and its sub-paths, each stroke, and each text. */
function recorder() {
  const fills: Array<{ colour: string; rule: string | undefined; alpha: number; paths: Array<{ points: Array<[number, number]>; closed: boolean }> }> = []
  const strokes: Array<{ colour: string; width: number; paths: number; alpha?: number }> = []
  /** Every fill of a part and every stroke of an outline, in the order they were drawn. */
  const order: string[] = []
  const texts: Array<{ text: string; font: string; x: number; y: number }> = []
  let paths: Array<{ points: Array<[number, number]>; closed: boolean }> = []
  const ctx = {
    globalAlpha: 1,
    strokeStyle: '',
    fillStyle: '',
    font: '',
    lineWidth: 1,
    textAlign: 'left',
    textBaseline: 'alphabetic',
    lineJoin: 'miter',
    lineCap: 'butt',
    save: () => {},
    restore: () => {},
    translate: () => {},
    rotate: () => {},
    fillRect: () => {},
    strokeRect: () => {},
    rect: () => {},
    clip: () => {},
    setLineDash: () => {},
    measureText: (text: string) => ({ width: 7 * text.length }),
    beginPath: () => void (paths = []),
    moveTo: (x: number, y: number) => void paths.push({ points: [[x, y]], closed: false }),
    lineTo: (x: number, y: number) => void paths.at(-1)!.points.push([x, y]),
    closePath: () => void (paths.at(-1)!.closed = true),
    fill: (rule?: string) => {
      fills.push({ colour: ctx.fillStyle, rule, alpha: ctx.globalAlpha, paths })
      order.push(`fill ${ctx.fillStyle} ${ctx.globalAlpha}`)
    },
    stroke: () => {
      strokes.push({ colour: ctx.strokeStyle, width: ctx.lineWidth, paths: paths.length })
      if (ctx.globalAlpha === 1 && ctx.lineWidth !== 1) return
      order.push(`stroke ${ctx.strokeStyle} ${ctx.globalAlpha}`)
    },
    fillText: (text: string, x: number, y: number) => void texts.push({ text, font: ctx.font, x, y })
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, fills, strokes, texts, order }
}

describe('the sheet a section is laid out on', () => {
  it('has the long edge asked for, 1280 when none is, and never more than 2000', () => {
    const edge = (size?: number): number => {
      const sheet = sectionSheet(PLATE, 'assembly', size)!
      return Math.max(sheet.width, sheet.height)
    }
    expect(edge()).toBe(1280)
    expect(edge(800)).toBe(800)
    expect(edge(9000)).toBe(2000)
    expect(edge(10)).toBe(256)
  })

  it('draws a millimetre as many pixels along u as along v, with the whole cut inside the plot', () => {
    const sheet = sectionSheet(PLATE, 'assembly')!
    const [x0, y0] = toSheet(sheet, [-20, -15])
    const [x1, y1] = toSheet(sheet, [20, 15])
    expect((x1 - x0) / 40).toBeCloseTo(sheet.scale)
    // v runs up the sheet.
    expect((y0 - y1) / 30).toBeCloseTo(sheet.scale)
    expect(x0).toBeGreaterThan(sheet.plot.x)
    expect(x1).toBeLessThan(sheet.plot.x + sheet.plot.width)
    expect(y1).toBeGreaterThan(sheet.plot.y)
    expect(y0).toBeLessThan(sheet.plot.y + sheet.plot.height)
    expect(sheet.plot.x + sheet.plot.width).toBeLessThan(sheet.width)
    expect(sheet.plot.y + sheet.plot.height).toBeLessThan(sheet.height)
    // The plot takes the shape of the cut and its margin: 8 % of the longer side, all round.
    expect(sheet.shown).toEqual({ min: [-23.2, -18.2], max: [23.2, 18.2] })
    expect(sheet.plot.width / sheet.plot.height).toBeCloseTo(46.4 / 36.4)
    // The same drawing at twice the size is twice as large in everything.
    const twice = sectionSheet(PLATE, 'assembly', 2000)!
    expect(twice.scale / sheet.scale).toBeCloseTo(2000 / 1280, 1)
  })

  it('writes the extents of the whole cut, the plane as its title, the layout, and each part with its area', () => {
    const sheet = sectionSheet(PLATE, 'assembly')!
    expect(sheet.extents).toEqual({ u: '40 mm', v: '30 mm' })
    expect(sheet.title).toBe('plane normal +Z at z = 3')
    expect(sheet.layout).toBe('layout assembly')
    expect(sheet.axes).toEqual({ u: 'u (+X)', v: 'v (+Y)' })
    expect(sheet.legend).toEqual([{ part: 'plate', text: ' 1100 mm²' }])
  })

  it('names a plane across no axis by its point and its normal, and its axes without a direction of the world', () => {
    const s = Math.SQRT1_2
    const sheet = sectionSheet({ ...PLATE, plane: { origin: [1, 2, 3], normal: [s, 0, s], x: [s, 0, -s], y: [0, 1, 0] } }, 'print')!
    expect(sheet.title).toBe('plane through (1, 2, 3), normal (0.7071, 0, 0.7071)')
    expect(sheet.axes).toEqual({ u: 'u', v: 'v (+Y)' })
  })

  it('says ≈ of an area that is not exact, open of an outline that does not close, and counts the parts it has no room to name', () => {
    const many = Array.from({ length: 11 }, (_, i) => solid(`p${i}`, [loop(rect(0, 0, 4, 4), 16)]))
    many[0] = solid('p0', [loop(rect(0, 0, 4, 4), 16)], { areaExact: false })
    many[1] = solid('p1', [loop([[0, 0], [4, 4]], null, false)], { area: null, open: 1, how: 'outline of the surface: the part is not a solid' })
    const sheet = sectionSheet({ ...PLATE, parts: many, bounds: { min: [0, 0], max: [4, 4] } }, 'assembly')!
    expect(sheet.legend.slice(0, 3)).toEqual([{ part: 'p0', text: ' ≈ 16 mm²' }, { part: 'p1', text: ', open' }, { part: 'p2', text: ' 16 mm²' }])
    expect(sheet.legend).toHaveLength(9)
    expect(sheet.legend.at(-1)).toEqual({ part: null, text: 'and 3 more' })
  })

  it('keeps what is up in the world up on the sheet: a plane whose v points down is drawn with v running down', () => {
    // Across Y the kernel's axes are u = +X and v = -Z.
    const acrossY = sectionSheet({ ...PLATE, plane: { origin: [0, 0, 0], normal: [0, 1, 0], x: [1, 0, 0], y: [0, 0, -1] } }, 'assembly')!
    expect(acrossY.vDown).toBe(true)
    expect(acrossY.axes.v).toBe('v (-Z)')
    // The point with the greater v, which is lower in the world, is lower on the sheet.
    expect(toSheet(acrossY, [0, 15])[1]).toBeGreaterThan(toSheet(acrossY, [0, -15])[1])
    expect(toSheet(acrossY, [0, -15])[1]).toBeGreaterThan(acrossY.plot.y)
    const upright = sectionSheet(PLATE, 'assembly')!
    expect(upright.vDown).toBe(false)
    expect(toSheet(upright, [0, 15])[1]).toBeLessThan(toSheet(upright, [0, -15])[1])
    // Across Z, Y is what is up on the sheet.
    expect(sectionSheet({ ...PLATE, plane: { origin: [0, 0, 0], normal: [0, 0, -1], x: [1, 0, 0], y: [0, -1, 0] } }, 'assembly')!.vDown).toBe(true)
  })

  it('chooses the grid as the ground grid is chosen, and numbers lines no closer than can be read', () => {
    const sheet = sectionSheet(PLATE, 'assembly')!
    // 46.4 mm across: 5 mm cells, as `gridStep` gives a scene that size.
    expect(sheet.step).toBe(5)
    expect(sheet.labelEvery * sheet.step * sheet.scale).toBeGreaterThanOrEqual(46)
  })

  it('gives a cut that is a sliver a sheet that is not one, and a cut with no width room to be drawn', () => {
    const sliver = sectionSheet({ ...PLATE, parts: [solid('rod', [loop(rect(0, 0, 200, 2), 400)])], bounds: { min: [0, 0], max: [200, 2] } }, 'assembly')!
    expect(sliver.width).toBe(1280)
    expect(sliver.height).toBeGreaterThanOrEqual(1280 * 0.45)
    const [, y] = toSheet(sliver, [0, 1])
    expect(y).toBeGreaterThan(sliver.plot.y)
    expect(y).toBeLessThan(sliver.plot.y + sliver.plot.height)
    const line = sectionSheet({ ...PLATE, parts: [solid('sheet', [loop([[0, 0], [10, 0]], null, false)], { area: null, open: 1 })], bounds: { min: [0, 0], max: [10, 0] } }, 'assembly')!
    expect(Number.isFinite(line.scale)).toBe(true)
    expect(line.extents).toEqual({ u: '10 mm', v: '0 mm' })
  })

  it('is none when the plane cut nothing', () => {
    expect(sectionSheet({ ...PLATE, parts: [solid('plate', [])], bounds: null }, 'assembly')).toBeNull()
  })
})

describe('the drawing of a section', () => {
  const colourOf = (part: string): string => (part === 'plate' ? '#7B93B4' : '#C28B6C')

  it('fills all the closed loops of a part as one path, by the even-odd rule: a loop inside another is a hole', () => {
    const { ctx, fills } = recorder()
    const sheet = sectionSheet(PLATE, 'assembly')!
    drawSection(ctx, sheet, PLATE, colourOf)
    const parts = fills.filter((fill) => fill.rule !== undefined)
    expect(parts).toHaveLength(1)
    expect(parts[0]).toMatchObject({ colour: '#7B93B4', rule: 'evenodd' })
    expect(parts[0].paths.map((path) => [path.points.length, path.closed])).toEqual([[4, true], [4, true]])
    // The outline is where the kernel put it, to the pixel.
    expect(parts[0].paths[0].points[0]).toEqual(toSheet(sheet, [-20, -15]))
    expect(parts[0].paths[1].points).toContainEqual(toSheet(sheet, [5, 5]))
  })

  it('draws a hairline round each loop in the darker tint of its part, after every fill, and an open outline as a line only', () => {
    const open: Sectioned = {
      ...PLATE,
      parts: [PLATE.parts[0], solid('skin', [loop([[-20, 0], [0, 10], [20, 0]], null, false)], { area: null, open: 1, how: 'outline of the surface: the part is not a solid' })]
    }
    const { ctx, fills, strokes } = recorder()
    drawSection(ctx, sectionSheet(open, 'assembly')!, open, colourOf)
    expect(fills.filter((fill) => fill.rule !== undefined)).toHaveLength(1)
    const outlines = strokes.filter((stroke) => stroke.colour === '#3E4A5A' || stroke.colour === '#614636')
    expect(outlines).toEqual([
      { colour: '#3E4A5A', width: 1, paths: 1 },
      { colour: '#3E4A5A', width: 1, paths: 1 },
      { colour: '#614636', width: 1.75, paths: 1 }
    ])
  })

  it('fills each part a little short of opaque, so that two parts lying over each other show as a darker region, and draws every outline after, in full', () => {
    // A lid pressed 2 mm into a tub: an interference.
    const two: Sectioned = { ...PLATE, parts: [solid('plate', [loop(rect(-20, -15, 20, 0), 600)]), solid('lid', [loop(rect(-20, -2, 20, 15), 680)])] }
    const { ctx, order } = recorder()
    drawSection(ctx, sectionSheet(two, 'assembly')!, two, colourOf)
    const parts = order.filter((step) => /#7B93B4|#C28B6C|#3E4A5A|#614636/.test(step))
    expect(FILL_ALPHA).toBe(0.8)
    expect(parts).toEqual(['fill #7B93B4 0.8', 'fill #C28B6C 0.8', 'stroke #3E4A5A 1', 'stroke #614636 1'])
  })

  it('says on the sheet when the parts were spread for display, and which way v runs when that is down', () => {
    const { ctx, texts } = recorder()
    const down = { ...PLATE, plane: { ...PLATE.plane, normal: [0, 1, 0] as [number, number, number], y: [0, 0, -1] as [number, number, number] } }
    drawSection(ctx, sectionSheet(down, 'print (parts spread for display)')!, down, colourOf)
    expect(texts.map((t) => t.text)).toContain('v (-Z) ↓, mm')
    expect(texts.map((t) => t.text).join('')).toContain('layout print (parts spread for display)')
  })

  it('writes the title, the two extents and the legend, every number in the mono face', () => {
    const { ctx, texts } = recorder()
    drawSection(ctx, sectionSheet(PLATE, 'assembly')!, PLATE, colourOf)
    const said = (text: string) => texts.find((t) => t.text === text)
    for (const figure of ['40 mm', '30 mm', '+Z', 'z', '=', '3', 'plate', '1100', 'mm²', '-20', '15', 'u (+X), mm', 'v (+Y), mm']) expect(said(figure)?.font, figure).toContain(MONO_FACE)
    for (const word of ['plane normal ', ' at ', 'layout assembly']) expect(said(word)?.font, word).toContain(UI_FACE)
  })

  describe('with a scan the plane cuts', () => {
    // The scan's surface 2 mm above the plate over its whole width and 60 mm beyond it on one side, and a wall of the room 3 m away.
    const SCAN = { id: 'S1', polylines: [{ points: [[-80, 17], [0, 17.5], [20, 17]] as [number, number][], closed: false }, { points: rect(3000, 3000, 3010, 3010), closed: true }] }

    it('has its line in the legend as a scan and as approximate, after the parts', () => {
      const sheet = sectionSheet(PLATE, 'assembly', undefined, SCAN)!
      // Its lines go on past what is shown of them: the sheet says so, where it would read as the whole of the scan.
      expect(sheet.legend).toEqual([{ part: 'plate', text: ' 1100 mm²' }, { part: null, scan: 'S1', text: ' (scan, ≈; it goes on beyond the plot)' }])
      const whole = sectionSheet(PLATE, 'assembly', undefined, { id: 'S1', polylines: [{ points: [[-10, 17], [10, 17]], closed: false }] })!
      expect(whole.legend[1]).toEqual({ part: null, scan: 'S1', text: ' (scan, ≈)' })
      const { ctx, texts } = recorder()
      drawSection(ctx, sheet, PLATE, colourOf, SCAN)
      expect(texts.find((t) => t.text === 'S1')?.font).toContain(MONO_FACE)
      expect(texts.map((t) => t.text).join('')).toContain('S1 (scan, ≈; it goes on beyond the plot)')
    })

    it('widens the plot to hold what of the scan is near the cut, never so far that the parts are lost, and keeps the extents those of the parts', () => {
      const plain = sectionSheet(PLATE, 'assembly')!
      const sheet = sectionSheet(PLATE, 'assembly', undefined, SCAN)!
      // The cut is 40 wide: the scan is shown as far as 40 beyond it, and its line 2 mm above the plate is all inside.
      expect(sheet.shown.min[0]).toBeLessThanOrEqual(-60)
      expect(sheet.shown.min[0]).toBeGreaterThan(-80)
      expect(sheet.shown.max[1]).toBeGreaterThan(17.5)
      expect(sheet.shown.max[0]).toBeLessThan(100)
      expect(sheet.scale).toBeLessThan(plain.scale)
      expect(sheet.bounds).toEqual(plain.bounds)
      expect(sheet.extents).toEqual({ u: '40 mm', v: '30 mm' })
      // Without a scan nothing is widened.
      expect(sectionSheet(PLATE, 'assembly', undefined, { id: 'S1', polylines: [] })!.shown).toEqual(plain.shown)
    })

    it('draws it as a dashed hairline in the quiet ink, over the parts and within the plot', () => {
      const dashes: number[][] = []
      const clips: number[] = []
      const { ctx, strokes, order } = recorder()
      Object.assign(ctx, { setLineDash: (dash: number[]) => void dashes.push(dash), rect: () => {}, clip: () => void clips.push(strokes.length) })
      const sheet = sectionSheet(PLATE, 'assembly', undefined, SCAN)!
      drawSection(ctx, sheet, PLATE, colourOf, SCAN)
      const lines = strokes.filter((stroke) => stroke.colour === SHEET.muted && stroke.paths === 2)
      expect(lines).toEqual([{ colour: SHEET.muted, width: 1, paths: 2 }])
      // Dashed for the scan (and its legend), solid again after each.
      expect(dashes).toEqual([[4, 2], [], [4, 2], []])
      // Clipped to the plot before it is drawn, and after the parts' own outlines.
      expect(clips).toEqual([strokes.indexOf(lines[0])])
      expect(order.indexOf(`stroke ${SHEET.muted} 1`)).toBeGreaterThan(order.indexOf('stroke #3E4A5A 1'))
    })

    it('is all there is to draw where the plane cuts no part: the sheet is laid out on the scan\'s own lines', () => {
      const none: Sectioned = { ...PLATE, parts: [solid('plate', [])], bounds: { min: [-80, 17], max: [20, 17.5] } }
      const sheet = sectionSheet(none, 'assembly', undefined, { id: 'S1', polylines: [SCAN.polylines[0]] })!
      expect(sheet.bounds).toEqual({ min: [-80, 17], max: [20, 17.5] })
      expect(sheet.legend).toEqual([{ part: 'plate', text: ', not cut' }, { part: null, scan: 'S1', text: ' (scan, ≈)' }])
      // The extents written are then the scan's: not exact, and said so.
      expect(sheet.extents).toEqual({ u: '≈ 100 mm', v: '≈ 0.5 mm' })
    })
  })

  it('is on the light sheet whatever the theme', () => {
    expect(SHEET.paper).toBe('#F1EFEA')
  })
})
