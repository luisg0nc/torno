import { describe, expect, it } from 'vitest'
import type { ObjectCard } from '../../shared/show'
import { BENCH_MM_PER_PX } from '../../shared/thumbnail'
import { benchScale, cellWidth, figureOf, GHOST, lookOf, packRows, pageScale, shelvesOf, stepAcross, TILE, widthOf } from './bench'

const card = (id: string, over: Partial<ObjectCard> = {}): ObjectCard => ({ id, name: id, opened: false, thumb: null, marks: { open: 0, drafts: 0 }, dimensions: null, session: null, ...over })
const pictured = (id: string, x: number, y: number, z: number, over: Partial<ObjectCard> = {}): ObjectCard =>
  card(id, { thumb: { at: '2026-11-01T10:00:00.000Z', layout: 'assembly', behind: false, bench: true }, box: { x, y, z, exact: true }, ...over })

describe('who is on which shelf', () => {
  it('puts the one that waits first, the one that builds second, the others by their last save, newest first', () => {
    const cards = [
      card('a', { sourcesMtimeMs: 10 }),
      card('b', { sourcesMtimeMs: 50 }),
      card('ask', { waiting: { question: 'Which wall?', since: 1 }, session: 'needs_input', sourcesMtimeMs: 1 }),
      card('c'),
      card('build', { opened: true, build: { status: 'building', revision: 2, stale: true }, sourcesMtimeMs: 99 }),
      card('d', { sourcesMtimeMs: 30 }),
      card('e', { sourcesMtimeMs: 40 }),
      card('f', { sourcesMtimeMs: 20 })
    ]
    const { needs, working, rest } = shelvesOf(cards, null)
    expect(needs.map((x) => x.id)).toEqual(['ask'])
    expect(working.map((x) => x.id)).toEqual(['build'])
    expect(rest.map((x) => x.id)).toEqual(['b', 'e', 'd', 'f', 'a', 'c'])
  })

  it('counts a session that needs you or that works, and puts a waiting one among those that need you first', () => {
    const s = shelvesOf([card('w', { session: 'working' }), card('n', { session: 'needs_input' }), card('both', { session: 'working', waiting: { question: '?', since: 1 } }), card('idle', { session: 'idle' }), card('gone', { session: 'exited' })], null)
    expect(s.needs.map((x) => x.id)).toEqual(['n', 'both'])
    expect(s.working.map((x) => x.id)).toEqual(['w'])
    expect(s.rest.map((x) => x.id).sort()).toEqual(['gone', 'idle'])
  })

  it('keeps the list order for equal saves, the open one first among them', () => {
    const s = shelvesOf([card('x'), card('y'), card('z')], 'z')
    expect(s.rest.map((c) => c.id)).toEqual(['z', 'x', 'y'])
    expect(shelvesOf([card('x'), card('y')], null).rest.map((c) => c.id)).toEqual(['x', 'y'])
  })
})

describe('what a picture is drawn as', () => {
  it('draws at true scale only a picture made for the bench, with its box', () => {
    expect(lookOf(pictured('a', 100, 60, 40)).kind).toBe('scale')
    expect(lookOf(card('b', { thumb: { at: 'x', layout: 'a', behind: false } })).kind).toBe('tile')
    expect(lookOf(card('c', { thumb: { at: 'x', layout: 'a', behind: false, bench: true } })).kind).toBe('tile')
    expect(lookOf(card('d', { box: { x: 1, y: 1, z: 1, exact: true } })).kind).toBe('ghost')
    expect(lookOf(card('e', { problem: 'two models', thumb: { at: 'x', layout: 'a', behind: false, bench: true }, box: { x: 1, y: 1, z: 1, exact: true } })).kind).toBe('ghost')
  })

  it('sizes a picture as the box projected over the scale, and two of the same size are the same', () => {
    const a = lookOf(pictured('a', 100, 60, 40))
    const b = lookOf(pictured('b', 100, 60, 40))
    expect(a).toEqual(b)
    if (a.kind !== 'scale') throw new Error('scale')
    // The iso projection of a box 100 × 60 × 40: half its width is |r|·half, over mm per pixel, twice, with the margin.
    const across = (Math.SQRT1_2 * 50 + Math.SQRT1_2 * 30) / BENCH_MM_PER_PX
    expect(a.w).toBeGreaterThanOrEqual(Math.floor(2 * across))
    expect(a.w).toBeLessThanOrEqual(Math.ceil(2 * across) + 8)
    // A part twice the size is twice the pixels, so one scale puts them side by side as they are.
    const big = lookOf(pictured('c', 200, 120, 80))
    if (big.kind !== 'scale') throw new Error('scale')
    expect(big.w / a.w).toBeGreaterThan(1.9)
    expect(big.w / a.w).toBeLessThan(2.1)
  })

  it('crops the picture to its part, centred, at the page\'s scale', () => {
    const f = figureOf(pictured('a', 100, 60, 40), 'scale', 0.5)
    expect(f.kind).toBe('scale')
    const look = lookOf(pictured('a', 100, 60, 40))
    if (look.kind !== 'scale') throw new Error('scale')
    expect(f.w).toBe(Math.round(look.w * 0.5))
    expect(f.h).toBe(Math.round(look.h * 0.5))
    expect(f.img).toMatchObject({ w: 240, h: 180 })
    expect(f.img!.x).toBeCloseTo(-(480 - look.w) / 4)
    expect(f.img!.y).toBeCloseTo(-(360 - look.h) / 4)
  })

  it('fits every picture to an equal box in Grid, whatever it is', () => {
    const small = figureOf(pictured('a', 20, 10, 6), 'grid', 0.3)
    const big = figureOf(pictured('b', 200, 100, 60), 'grid', 0.3)
    for (const f of [small, big]) {
      expect(f.w).toBeLessThanOrEqual(TILE.w)
      expect(f.h).toBeLessThanOrEqual(TILE.h)
    }
    expect(figureOf(card('t', { thumb: { at: 'x', layout: 'a', behind: false } }), 'grid', 1)).toMatchObject({ kind: 'tile', w: TILE.w, h: TILE.h })
    expect(figureOf(card('g'), 'scale', 1)).toMatchObject({ kind: 'ghost', w: GHOST.w, h: GHOST.h })
  })

  it('says nothing of a size the kernel did not give: a project with no picture is a ghost whatever its box', () => {
    expect(figureOf(card('g'), 'grid', 1).kind).toBe('ghost')
  })
})

describe('one scale for the page', () => {
  const row = [pictured('a', 150, 80, 92), pictured('b', 64, 74, 96), pictured('c', 60, 78, 90), card('d'), card('e', { thumb: { at: 'x', layout: 'a', behind: false } })]

  it('is 1 where there is room, and for nothing to draw', () => {
    expect(benchScale(row, 5000)).toBe(1)
    expect(benchScale([], 100)).toBe(1)
  })

  it('makes the widest shelf fit, and not a little less than it could', () => {
    for (const width of [900, 1200, 700]) {
      const s = benchScale(row, width)
      // Where even the smallest does not fit, the shelf wraps (below).
      if (s > 0.25) expect(widthOf(row, s)).toBeLessThanOrEqual(width)
      if (s < 1 && s > 0.25) expect(widthOf(row, s + 0.02)).toBeGreaterThan(width)
    }
    expect(benchScale(row, 700)).toBeLessThan(benchScale(row, 1200))
  })

  it('never shrinks below what can be read, and wraps the shelf instead', () => {
    const many = Array.from({ length: 30 }, (_, i) => pictured(`p${i}`, 150, 80, 92))
    const s = benchScale(many, 1200)
    expect(s).toBe(0.25)
    const rows = packRows(many, 1200, s, 'scale')
    expect(rows.length).toBeGreaterThan(1)
    expect(rows.flat().map((c) => c.id)).toEqual(many.map((c) => c.id))
    for (const r of rows) expect(widthOf(r, s)).toBeLessThanOrEqual(1200)
  })

  it('takes the narrowest fit of the three shelves, the two on top side by side', () => {
    const shelves = { needs: [pictured('n', 150, 80, 92)], working: [pictured('w', 150, 80, 92)], rest: row }
    const alone = pageScale({ needs: [], working: [], rest: row }, 1000, 'scale')
    const together = pageScale(shelves, 1000, 'scale')
    expect(together).toBeLessThanOrEqual(alone)
    expect(pageScale({ needs: [], working: [], rest: [] }, 1000, 'scale')).toBe(1)
    // In Grid the boxes are equal and nothing is scaled.
    expect(pageScale(shelves, 300, 'grid')).toBe(1)
  })

  it('gives a label a cell no narrower than it needs', () => {
    expect(cellWidth(figureOf(card('g'), 'scale', 1))).toBeGreaterThanOrEqual(GHOST.w)
    expect(cellWidth(figureOf(pictured('a', 10, 10, 10), 'scale', 0.25))).toBeGreaterThanOrEqual(110)
  })
})

describe('moving up and down the shelves', () => {
  const spots = [
    { line: 0, x: 100 },
    { line: 0, x: 400 },
    { line: 1, x: 90 },
    { line: 1, x: 250 },
    { line: 1, x: 420 },
    { line: 2, x: 300 }
  ]
  it('goes to the nearest one on the line below or above', () => {
    expect(stepAcross('down', 1, spots)).toBe(4)
    expect(stepAcross('down', 0, spots)).toBe(2)
    expect(stepAcross('up', 5, spots)).toBe(3)
    expect(stepAcross('up', 4, spots)).toBe(1)
  })
  it('goes to the field above the first line, and stays at the last', () => {
    expect(stepAcross('up', 0, spots)).toBe('field')
    expect(stepAcross('down', 5, spots)).toBe(5)
  })
  it('starts at the first when none has the focus', () => {
    expect(stepAcross('down', -1, spots)).toBe(0)
    expect(stepAcross('up', -1, spots)).toBe(0)
  })
})
