import { describe, expect, it } from 'vitest'
import { borrowedAt } from './borrowAt'

const pane = { x: 100, y: 40, w: 600, h: 500 }
// The dock stands to the right of the view: a chip there is outside the pane.
const chip = { x: 760, y: 300, w: 60, h: 18 }

describe('the leader a pointed ref borrows', () => {
  it('has the subject in window pixels, the chip and the pane it may not leave', () => {
    expect(borrowedAt({ x: 200, y: 120 }, chip, pane, [])).toEqual({ subject: { x: 200, y: 120 }, chip, clip: pane })
  })

  it('is none with no subject, or one off the view', () => {
    expect(borrowedAt(null, chip, pane, [])).toBeNull()
    expect(borrowedAt({ x: 50, y: 120 }, chip, pane, [])).toBeNull()
    expect(borrowedAt({ x: 200, y: 600 }, chip, pane, [])).toBeNull()
  })

  it('is none when the line would run through text', () => {
    // The leg runs from (200, 120) to the pane's edge at the chip's height, 300.
    expect(borrowedAt({ x: 200, y: 300 }, chip, pane, [{ x: 400, y: 295, w: 80, h: 20 }])).toBeNull()
    expect(borrowedAt({ x: 200, y: 300 }, chip, pane, [{ x: 400, y: 100, w: 80, h: 20 }])).not.toBeNull()
  })
})
