import { describe, expect, it } from 'vitest'
import { GAP, REED_CLEAR, placeTag, tagSubject } from './tagPlace'
import type { Box } from './leader'

const view = { x: 0, y: 0, w: 670, h: 800 }
const size = { w: 120, h: 30 }
const meets = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

describe('placeTag', () => {
  it('goes above when there is room', () => expect(placeTag({ x: 300, y: 400 }, size, view, []).side).toBe('above'))
  it('keeps its side while it still fits', () => expect(placeTag({ x: 300, y: 400 }, size, view, [], 'right').side).toBe('right'))
  it('avoids the compass', () => expect(placeTag({ x: 600, y: 60 }, size, view, [{ x: 538, y: 0, w: 132, h: 330 }]).side).not.toBe('above'))
  it('stays clear of the reed', () => expect(placeTag({ x: 20, y: 400 }, size, view, []).box.x).toBeGreaterThanOrEqual(60))
  it('docks with no subject', () => expect(placeTag(null, size, view, [])).toEqual({ box: { x: 275, y: 714, w: 120, h: 30 }, side: 'docked' }))

  it('stands off its subject by the gap, centred on it', () => {
    expect(placeTag({ x: 300, y: 400 }, size, view, [])).toEqual({ box: { x: 240, y: 400 - GAP - 30, w: 120, h: 30 }, side: 'above' })
    expect(placeTag({ x: 300, y: 400 }, size, view, [], 'below').box).toEqual({ x: 240, y: 400 + GAP, w: 120, h: 30 })
    expect(placeTag({ x: 300, y: 400 }, size, view, [], 'right').box).toEqual({ x: 300 + GAP, y: 385, w: 120, h: 30 })
    expect(placeTag({ x: 300, y: 400 }, size, view, [], 'left').box).toEqual({ x: 300 - GAP - 120, y: 385, w: 120, h: 30 })
  })

  it('moves to the next side when the one it had would cover another tag', () => {
    const other: Box = { x: 200, y: 330, w: 250, h: 40 }
    const placed = placeTag({ x: 300, y: 400 }, size, view, [other], 'above')
    expect(placed.side).toBe('right')
    expect(meets(placed.box, other)).toBe(false)
  })

  it('never covers its subject, even clamped against an edge', () => {
    for (const subject of [{ x: 5, y: 5 }, { x: 665, y: 5 }, { x: 5, y: 795 }, { x: 665, y: 795 }, { x: 62, y: 400 }, { x: 335, y: 12 }]) {
      const placed = placeTag(subject, size, view, [])
      if (placed.side === 'docked') continue
      const { box } = placed
      expect(subject.x >= box.x && subject.x <= box.x + box.w && subject.y >= box.y && subject.y <= box.y + box.h).toBe(false)
      expect(box.x).toBeGreaterThanOrEqual(REED_CLEAR)
      expect(box.x + box.w).toBeLessThanOrEqual(view.w)
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.y + box.h).toBeLessThanOrEqual(view.h)
    }
  })

  it('docks when no side fits', () => {
    const tight = { x: 0, y: 0, w: 200, h: 100 }
    expect(placeTag({ x: 100, y: 50 }, { w: 190, h: 90 }, tight, []).side).toBe('docked')
  })

  it('does not hop between sides frame to frame while the last one fits', () => {
    let side: 'above' | 'right' | 'below' | 'left' | 'docked' = 'right'
    for (let y = 300; y < 500; y += 7) {
      side = placeTag({ x: 300, y }, size, view, [], side).side
      expect(side).toBe('right')
    }
  })

  it('docks a tag whose view is offset, in the view own coordinates', () => {
    expect(placeTag(null, size, { x: 100, y: 50, w: 400, h: 600 }, []).box).toEqual({ x: 240, y: 50 + 600 - 56 - 30, w: 120, h: 30 })
  })

  it('takes the box it clears, and the gap and rise of a note beside a mark', () => {
    const mark: Box = { x: 180, y: 280, w: 40, h: 40 }
    const placed = placeTag({ x: 200, y: 300 }, { w: 260, h: 110 }, { x: 60, y: 50, w: 740, h: 550 }, [], 'right', { around: mark, gap: 12, rise: 18 })
    expect(placed).toEqual({ box: { x: 232, y: 282, w: 260, h: 110 }, side: 'right' })
  })
})

describe('tagSubject', () => {
  it('is the subject while it is in the view', () => expect(tagSubject({ x: 300, y: 400 }, view)).toEqual({ x: 300, y: 400 }))
  it('is nothing for a subject off the view, so its tag docks and has no leader', () => {
    for (const out of [{ x: -1, y: 400 }, { x: 671, y: 400 }, { x: 300, y: -1 }, { x: 300, y: 801 }]) expect(tagSubject(out, view)).toBeNull()
    expect(placeTag(tagSubject({ x: 900, y: 400 }, view), size, view, []).side).toBe('docked')
  })
  it('is nothing for a point that is nowhere (behind the camera, or edge on)', () => expect(tagSubject(null, view)).toBeNull())
})
