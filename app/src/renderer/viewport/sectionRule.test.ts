import { describe, expect, it } from 'vitest'
import { drawSectionRule } from './overlay'
import { handleAt, ruleAt, ruleSubject, ruleTicks } from './sectionRule'
import { sectionExtent, sectionOffset } from './section'

const BOX = { min: [-20, -15, -2.5], max: [20, 15, 22.5] }

describe('ruleTicks', () => {
  it('has a tick every 5 mm and a label every 20 mm', () => {
    const ticks = ruleTicks(-10, 100)
    expect(ticks).toHaveLength(23)
    expect(ticks[0].at).toBe(-10)
    expect(ticks.at(-1)!.at).toBe(100)
    expect(ticks.filter((t) => t.label !== undefined).map((t) => t.label)).toEqual(['0', '20', '40', '60', '80', '100'])
    expect(ticks.filter((t) => t.label !== undefined).map((t) => t.at)).toEqual([0, 20, 40, 60, 80, 100])
  })

  it('writes a negative label with a minus', () => {
    expect(ruleTicks(-45, 5).filter((t) => t.label).map((t) => t.label)).toEqual(['-40', '-20', '0'])
  })

  it('starts on the first multiple of 5 inside the range', () => {
    expect(ruleTicks(-12.5, 12.5).map((t) => t.at)).toEqual([-10, -5, 0, 5, 10])
  })

  it('has no tick where the range is empty or not a number', () => {
    expect(ruleTicks(3, 4)).toEqual([])
    expect(ruleTicks(NaN, 4)).toEqual([])
    expect(ruleTicks(4, 2)).toEqual([])
  })
})

describe('handleAt', () => {
  it('is where the offset is along the rule, 0 to 1', () => {
    expect(handleAt(44, -10, 100)).toBeCloseTo(0.4909, 4)
    expect(handleAt(-10, -10, 100)).toBe(0)
    expect(handleAt(100, -10, 100)).toBe(1)
  })

  it('stays on the rule', () => {
    expect(handleAt(500, -10, 100)).toBe(1)
    expect(handleAt(-500, -10, 100)).toBe(0)
  })

  it('is the middle of a rule with no length', () => {
    expect(handleAt(0, 0, 0)).toBe(0.5)
  })
})

describe('ruleAt', () => {
  const along = (normal: [number, number, number]) => {
    const { min, max } = sectionExtent(BOX, normal)
    return { min, max, at: (t: number) => ruleAt(BOX, normal, t) }
  }

  it('moves along the normal, one millimetre for one', () => {
    for (const normal of [[0, 0, 1], [1, 0, 0], [0, 1, 0], [0.6, 0, 0.8]] as Array<[number, number, number]>) {
      const { at } = along(normal)
      const [a, b] = [at(0), at(10)]
      expect(b.map((c, i) => c - a[i])).toEqual(normal.map((c) => expect.closeTo(c * 10, 9)))
    }
  })

  it('is in step with the plane: the point at an offset is on the plane that has that offset', () => {
    for (const normal of [[0, 0, 1], [0, -1, 0], [0.6, 0, 0.8]] as Array<[number, number, number]>) {
      const { at } = along(normal)
      const plane = { origin: at(7), normal }
      expect(sectionOffset(plane, BOX)).toBeCloseTo(7, 9)
    }
  })

  it('stands beside the parts, on the ground, on the right of the view from the corner, for a plane across a horizontal axis', () => {
    const [ax, ay] = ruleAt(BOX, [0, 1, 0], 0)
    expect(ax).toBeGreaterThan(20)
    expect(ay).toBe(0)
    const [x, y, z] = ruleAt(BOX, [1, 0, 0], 0)
    expect(z).toBe(BOX.min[2])
    expect(y).toBeGreaterThan(15)
    expect(x).toBe(0)
  })

  it('stands at a corner of the parts, upright, for a plane across Z', () => {
    const [x, y] = ruleAt(BOX, [0, 0, 1], 0)
    expect(x).toBeGreaterThan(20)
    expect(y).toBeLessThan(-15)
    // Upright: the same corner at any offset.
    expect(ruleAt(BOX, [0, 0, 1], 9).slice(0, 2)).toEqual([x, y])
  })
})

describe('ruleSubject', () => {
  it('is a point of the plane, on the edge of its rectangle that is the highest', () => {
    const plane = { origin: [0, 0, 10] as [number, number, number], normal: [1, 0, 0] as [number, number, number] }
    const at = ruleSubject(plane, BOX)
    // On the plane x = 0, at the top of the rectangle.
    expect(at[0]).toBeCloseTo(0, 9)
    expect(at[2]).toBeGreaterThan(22.5)
  })

  it('is on the back edge of a plane across Z, which has no top', () => {
    const plane = { origin: [0, 0, 10] as [number, number, number], normal: [0, 0, 1] as [number, number, number] }
    const at = ruleSubject(plane, BOX)
    expect(at[2]).toBeCloseTo(10, 9)
    expect(at[1]).toBeGreaterThan(15)
  })
})

describe('drawSectionRule', () => {
  const style = { accent: '#acc', muted: '#mmm', surface: '#sss' }
  /** What was drawn: the texts, the squares filled in the accent, and how many strokes. */
  function recorder() {
    const out = { texts: [] as string[], squares: [] as Array<{ x: number; y: number; w: number }>, strokes: 0 }
    let rect: { x: number; y: number; w: number } | null = null
    const ctx = {
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      font: '',
      save: () => {},
      restore: () => {},
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      roundRect: (x: number, y: number, w: number) => void (rect = { x, y, w }),
      fill: () => void (ctx.fillStyle === style.accent && rect && out.squares.push(rect)),
      stroke: () => void (out.strokes += 1),
      strokeText: () => {},
      fillText: (t: string) => void out.texts.push(t)
    }
    return { ctx: ctx as unknown as CanvasRenderingContext2D, out }
  }
  // Looking along y: x to the right, z up, 4 px to the mm, the middle of the box in the middle of a 400 x 300 view.
  const front = (p: readonly number[]) => ({ x: 200 + p[0] * 4, y: 150 - (p[2] - 10) * 4 })
  const plane = { origin: [0, 0, 10] as [number, number, number], normal: [0, 0, 1] as [number, number, number] }

  it('labels the rule every 20 mm and puts the handle on it', () => {
    const { ctx, out } = recorder()
    // Across Z the rule stands upright at a corner; the front view shows it as a vertical line.
    const handle = drawSectionRule(ctx, { plane, box: BOX }, front, style)
    expect(out.texts).toEqual(['0']) // offsets -12.5 to 12.5 about the middle of the parts
    expect(handle).not.toBeNull()
    expect(out.squares).toHaveLength(1)
    expect(out.squares[0].w).toBe(16)
    expect(out.strokes).toBeGreaterThan(10)
  })

  it('draws only its handle where it is seen end on', () => {
    const { ctx, out } = recorder()
    const top = (p: readonly number[]) => ({ x: 200 + p[0] * 4, y: 150 - p[1] * 4 })
    const handle = drawSectionRule(ctx, { plane, box: BOX }, top, style)
    expect(handle).not.toBeNull()
    expect(out.texts).toEqual([])
    expect(out.squares).toHaveLength(1)
  })

  it('draws nothing where the rule is behind the camera', () => {
    const { ctx, out } = recorder()
    expect(drawSectionRule(ctx, { plane, box: BOX }, () => null, style)).toBeNull()
    expect(out.squares).toEqual([])
  })
})
