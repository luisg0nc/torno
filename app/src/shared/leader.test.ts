import { describe, expect, it } from 'vitest'
import { crossesBoxes, leaderPath, RING_R, SHOULDER } from './leader'

describe('leaderPath', () => {
  it('ends in a 12 px shoulder into the nearest edge', () => {
    const p = leaderPath({ x: 100, y: 200 }, { x: 160, y: 100, w: 80, h: 30 })!
    expect(p.ring).toEqual({ x: 100, y: 200 })
    expect(p.shoulder[1].y).toBe(130) // the tag's bottom edge
    expect(Math.abs(p.shoulder[1].y - p.shoulder[0].y) + Math.abs(p.shoulder[1].x - p.shoulder[0].x)).toBe(12)
    expect(p.leg[1]).toEqual(p.shoulder[0])
  })
  it('is null when the subject is under the tag', () => {
    expect(leaderPath({ x: 170, y: 110 }, { x: 160, y: 100, w: 80, h: 30 })).toBeNull()
  })
  it('stops at the pane edge for a borrowed leader', () => {
    const p = leaderPath({ x: 300, y: 300 }, { x: 900, y: 500, w: 40, h: 18 }, { x: 0, y: 0, w: 700, h: 800 })!
    expect(p.shoulder[1].x).toBe(700)
    expect(p.shoulder[1].y).toBe(509)
    expect(p.shoulder[0]).toEqual({ x: 688, y: 509 }) // 12 px inside the pane
    expect(p.leg[1]).toEqual(p.shoulder[0])
  })
  it('says when it crosses text', () => {
    const p = leaderPath({ x: 0, y: 0 }, { x: 200, y: 200, w: 40, h: 20 })!
    expect(crossesBoxes(p, [{ x: 90, y: 90, w: 20, h: 20 }])).toBe(true)
    expect(crossesBoxes(p, [{ x: 0, y: 150, w: 20, h: 20 }])).toBe(false)
  })

  it('has the constants of the rule', () => {
    expect([RING_R, SHOULDER]).toEqual([3, 12])
  })
  it('comes in at the side edge when the tag is mostly to one side, straight when the subject is level with it', () => {
    const left = leaderPath({ x: 0, y: 105 }, { x: 160, y: 100, w: 80, h: 30 })!
    expect(left.shoulder[1]).toEqual({ x: 160, y: 105 })
    expect(left.shoulder[0]).toEqual({ x: 148, y: 105 })
    const right = leaderPath({ x: 400, y: 125 }, { x: 160, y: 100, w: 80, h: 30 })!
    expect(right.shoulder[1]).toEqual({ x: 240, y: 125 })
    expect(right.shoulder[0]).toEqual({ x: 252, y: 125 })
    const above = leaderPath({ x: 170, y: 0 }, { x: 160, y: 100, w: 80, h: 30 })!
    expect(above.shoulder[1]).toEqual({ x: 170, y: 100 })
    expect(above.shoulder[0]).toEqual({ x: 170, y: 88 })
  })
  it('lands on the middle of the edge when the subject is beside its span', () => {
    const p = leaderPath({ x: 150, y: 300 }, { x: 160, y: 100, w: 80, h: 30 })!
    expect(p.shoulder[1]).toEqual({ x: 200, y: 130 })
  })
  it('does not borrow a pane edge when the tag is inside the pane', () => {
    const p = leaderPath({ x: 300, y: 300 }, { x: 500, y: 500, w: 40, h: 18 }, { x: 0, y: 0, w: 700, h: 800 })!
    expect(p.shoulder[1].y).toBe(500)
  })
  it('borrows the pane edge nearest a tag that is below the pane too', () => {
    const p = leaderPath({ x: 300, y: 300 }, { x: 100, y: 900, w: 40, h: 18 }, { x: 0, y: 0, w: 700, h: 800 })!
    expect(p.shoulder[1]).toEqual({ x: 120, y: 800 })
    expect(p.shoulder[0]).toEqual({ x: 120, y: 788 })
  })
})

describe('crossesBoxes', () => {
  it('counts the shoulder as part of the line', () => {
    const p = leaderPath({ x: 100, y: 200 }, { x: 160, y: 100, w: 80, h: 30 })!
    expect(crossesBoxes(p, [{ x: p.shoulder[0].x - 2, y: p.shoulder[0].y - 2, w: 4, h: 4 }])).toBe(true)
    expect(crossesBoxes(p, [])).toBe(false)
  })
})
