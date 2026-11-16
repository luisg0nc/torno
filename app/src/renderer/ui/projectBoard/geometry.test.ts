import { describe, expect, it } from 'vitest'
import type { Card } from '../../../shared/board'
import { arrowLine, boardBox, cardsIn, frameAt, minimapMap, pictureSize } from './geometry'

const card = (id: string, x: number, y: number, w = 100, h = 50, over: Partial<Card> = {}): Card => ({ id, kind: 'text', x, y, w, h, by: 'person', ...over })

describe('the box of a board', () => {
  it('holds every card that is shown, and not a hidden one', () => {
    expect(boardBox([card('C1', 0, 0), card('C2', 300, 200), card('C3', 9000, 9000, 10, 10, { hidden: true })])).toEqual({ x: 0, y: 0, w: 400, h: 250 })
  })

  it('is a stand-in sheet for a board with nothing on it', () => {
    expect(boardBox([])).toEqual({ x: 0, y: 0, w: 800, h: 600 })
  })
})

describe('an arrow between two cards', () => {
  it('runs from the edge of one to the edge of the other, along the line between their middles', () => {
    expect(arrowLine(card('C1', 0, 0), card('C2', 300, 0))).toEqual({ x1: 100, y1: 25, x2: 300, y2: 25 })
    expect(arrowLine(card('C1', 0, 0), card('C2', 0, 200))).toEqual({ x1: 50, y1: 50, x2: 50, y2: 200 })
  })

  it('leaves a corner on the side the line crosses', () => {
    const { x1, y1 } = arrowLine(card('C1', 0, 0, 100, 100), card('C2', 400, 400, 100, 100))
    expect(x1).toBeCloseTo(100, 6)
    expect(y1).toBeCloseTo(100, 6)
  })

  it('is a point for two cards on the same spot, never NaN', () => {
    const line = arrowLine(card('C1', 0, 0), card('C2', 0, 0))
    expect(Object.values(line).every(Number.isFinite)).toBe(true)
  })
})

describe('the minimap', () => {
  const box = { x: 0, y: 0, w: 2000, h: 1000 }
  const map = minimapMap(box, { width: 200, height: 120 })

  it('draws the whole box inside its frame, centred, with a margin', () => {
    const a = map.toMap(0, 0)
    const b = map.toMap(2000, 1000)
    expect(a.x).toBeGreaterThanOrEqual(0)
    expect(b.x).toBeLessThanOrEqual(200)
    expect(a.y).toBeGreaterThanOrEqual(0)
    expect(b.y).toBeLessThanOrEqual(120)
    expect((a.x + b.x) / 2).toBeCloseTo(100, 6)
    expect((a.y + b.y) / 2).toBeCloseTo(60, 6)
  })

  it('maps a point of the frame back to the board', () => {
    const p = map.toMap(700, 400)
    const q = map.toBoard(p.x, p.y)
    expect(q.x).toBeCloseTo(700, 6)
    expect(q.y).toBeCloseTo(400, 6)
  })
})

describe('which frame a card is in', () => {
  const frames = [card('C1', 0, 0, 400, 300, { kind: 'frame' }), card('C2', 50, 50, 100, 100, { kind: 'frame' })]

  it('is the frame its middle is in, the smaller one when frames overlap', () => {
    expect(frameAt(frames, { x: 300, y: 200, w: 40, h: 40 })).toBe('C1')
    expect(frameAt(frames, { x: 70, y: 70, w: 40, h: 40 })).toBe('C2')
  })

  it('is none outside every frame, and a frame left out is not asked', () => {
    expect(frameAt(frames, { x: 900, y: 900, w: 40, h: 40 })).toBeNull()
    expect(frameAt(frames, { x: 70, y: 70, w: 40, h: 40 }, ['C2'])).toBe('C1')
  })

  it('never takes a hidden card for a frame, nor a card that is not one', () => {
    expect(frameAt([card('C1', 0, 0, 400, 300, { kind: 'frame', hidden: true }), card('C2', 0, 0, 400, 300)], { x: 10, y: 10, w: 20, h: 20 })).toBeNull()
  })
})

describe('the cards a frame drawn there takes in', () => {
  it('are the shown cards, in no frame, that are not frames and whose middles are inside it', () => {
    const cards = [card('C1', 10, 10, 50, 50), card('C2', 500, 10), card('C3', 10, 10, 50, 50, { kind: 'frame' }), card('C4', 10, 10, 50, 50, { frame: 'C9' }), card('C5', 10, 10, 50, 50, { hidden: true })]
    expect(cardsIn(cards, { x: 0, y: 0, w: 200, h: 200 })).toEqual(['C1'])
  })
})

describe('the size of a picture on the board', () => {
  it('is its own proportion inside 320 by 240, never larger than it is', () => {
    expect(pictureSize(1600, 800)).toEqual({ w: 320, h: 160 })
    expect(pictureSize(300, 900)).toEqual({ w: 80, h: 240 })
    expect(pictureSize(64, 48)).toEqual({ w: 64, h: 48 })
  })

  it('is a stand-in for a picture whose size is not known', () => {
    expect(pictureSize(0, 0)).toEqual({ w: 320, h: 240 })
  })
})
