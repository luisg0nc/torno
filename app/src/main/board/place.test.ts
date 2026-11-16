import { describe, expect, it } from 'vitest'
import type { Card } from '../../shared/board'
import { GAP, ROW_WIDTH, freeSpot, freeSpotBelow } from './place'

const card = (id: number, x: number, y: number, w = 240, h = 120, extra: Partial<Card> = {}): Card => ({ id: `C${id}`, kind: 'text', x, y, w, h, by: 'person', ...extra })

const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean =>
  a.x < b.x + b.w + GAP && b.x < a.x + a.w + GAP && a.y < b.y + b.h + GAP && b.y < a.y + a.h + GAP

describe('freeSpot', () => {
  it('puts the first card at the origin', () => {
    expect(freeSpot([], { w: 240, h: 120 })).toEqual({ x: 0, y: 0 })
  })

  it('goes to the right of the last row, a gap away', () => {
    expect(freeSpot([card(1, 0, 0)], { w: 240, h: 120 })).toEqual({ x: 240 + GAP, y: 0 })
  })

  it('wraps below the cards when the row would pass the width', () => {
    const row = Array.from({ length: 9 }, (_, i) => card(i + 1, i * (240 + GAP), 0))
    expect(Math.max(...row.map((c) => c.x + c.w))).toBeLessThanOrEqual(ROW_WIDTH)
    expect(freeSpot(row, { w: 240, h: 120 })).toEqual({ x: 0, y: 120 + GAP })
  })

  it('places 200 cards one by one without any overlap, the last in under 5 ms', () => {
    const cards: Card[] = []
    let last = 0
    for (let i = 0; i < 200; i++) {
      const started = performance.now()
      const spot = freeSpot(cards, { w: 240, h: 120 })
      last = performance.now() - started
      expect(spot).not.toBeNull()
      const placed = card(i + 1, spot!.x, spot!.y)
      for (const other of cards) expect(overlaps(placed, other)).toBe(false)
      expect(placed.x + placed.w).toBeLessThanOrEqual(ROW_WIDTH)
      cards.push(placed)
    }
    expect(last).toBeLessThan(5)
  })

  it('never lands on a frame or a card that is in the way of the row', () => {
    const cards = [card(1, 0, 0), card(2, 264, 0, 600, 400, { kind: 'frame', name: 'Latch' })]
    const spot = freeSpot(cards, { w: 240, h: 120 })!
    for (const other of cards) expect(overlaps({ ...spot, w: 240, h: 120 }, other)).toBe(false)
  })

  it('finds a hole a card was removed from', () => {
    const cards = [card(1, 0, 0), card(3, 528, 0, 240, 120), card(4, 0, 144, 240, 120)]
    const spot = freeSpot(cards, { w: 240, h: 120 })!
    for (const other of cards) expect(overlaps({ ...spot, w: 240, h: 120 }, other)).toBe(false)
  })

  describe('inside a frame', () => {
    const frame = card(9, 100, 100, 600, 400, { kind: 'frame', name: 'Latch', by: 'person' })

    it('lands inside the frame, clear of what is in it', () => {
      const inside = [card(1, 124, 140, 240, 120, { frame: 'C9' })]
      const spot = freeSpot([frame, ...inside], { w: 240, h: 120 }, frame)!
      expect(spot.x).toBeGreaterThanOrEqual(frame.x)
      expect(spot.y).toBeGreaterThanOrEqual(frame.y)
      expect(spot.x + 240).toBeLessThanOrEqual(frame.x + frame.w)
      expect(spot.y + 120).toBeLessThanOrEqual(frame.y + frame.h)
      expect(overlaps({ ...spot, w: 240, h: 120 }, inside[0])).toBe(false)
    })

    it('is null when the frame is full', () => {
      const full: Card[] = []
      for (let i = 0; i < 20; i++) full.push(card(i + 1, 124 + (i % 2) * 264, 140 + Math.floor(i / 2) * 144, 240, 120, { frame: 'C9' }))
      expect(freeSpot([frame, ...full], { w: 240, h: 120 }, frame)).toBeNull()
    })

    it('is null when the card is larger than the frame', () => {
      expect(freeSpot([frame], { w: 700, h: 120 }, frame)).toBeNull()
    })
  })
})

describe('freeSpotBelow', () => {
  const frame = card(9, 100, 100, 600, 400, { kind: 'frame', name: 'Latch', by: 'person' })

  it('is just below the frame, a gap away, at its left edge', () => {
    expect(freeSpotBelow([frame], { w: 240, h: 120 }, frame)).toEqual({ x: 100, y: 100 + 400 + GAP })
  })

  it('goes on to the right, then further down, when that is taken', () => {
    const taken = [frame, card(1, 100, 524, 240, 120)]
    const spot = freeSpotBelow(taken, { w: 240, h: 120 }, frame)!
    expect(spot.y).toBeGreaterThanOrEqual(524)
    for (const other of taken) expect(overlaps({ ...spot, w: 240, h: 120 }, other)).toBe(false)
  })
})
