import { describe, expect, it } from 'vitest'
import { CAPTION_OFFSET, captionPlace } from './captionPlace'

const pane = { width: 800, height: 600 }

describe('where the caption stands by the pointer', () => {
  it('is 18 px below and to the right of the pointer', () => {
    expect(CAPTION_OFFSET).toBe(18)
    expect(captionPlace([100, 100], { width: 120, height: 22 }, pane)).toEqual([118, 118])
  })

  it('goes to the left of the pointer, and above it, where it would run out of the view', () => {
    expect(captionPlace([780, 100], { width: 120, height: 22 }, pane)).toEqual([780 - 18 - 120, 118])
    expect(captionPlace([100, 590], { width: 120, height: 22 }, pane)).toEqual([118, 590 - 18 - 22])
  })

  it('stays inside the view when neither side has room', () => {
    expect(captionPlace([30, 10], { width: 900, height: 22 }, pane)).toEqual([8, 28])
  })

  it('stands below what already stands there (the readout), so that the two are read', () => {
    expect(captionPlace([100, 100], { width: 120, height: 22 }, pane, 20)).toEqual([118, 118 + 20 + 4])
  })

  describe('with boxes it keeps clear of (the switch of Model and Board, a band)', () => {
    const switchBox = { x: 8, y: 8, width: 150, height: 30 }

    it('is where it was when the boxes are not in its way', () => {
      expect(captionPlace([300, 300], { width: 120, height: 22 }, pane, 0, [switchBox])).toEqual([318, 318])
      expect(captionPlace([100, 100], { width: 120, height: 22 }, pane, 0, [switchBox])).toEqual([118, 118])
    })

    it('ignores a box that is not drawn', () => {
      expect(captionPlace([60, 10], { width: 120, height: 22 }, pane, 0, [{ x: 70, y: 20, width: 0, height: 0 }])).toEqual([78, 28])
    })

    it('stands below a box that the pointer near it would put it over', () => {
      const [x, y] = captionPlace([60, 10], { width: 120, height: 22 }, pane, 0, [switchBox])
      expect([x, y]).toEqual([78, 8 + 30 + 4])
    })

    it('stands below the lowest of the boxes it meets, and meets none of them', () => {
      const band = { x: 8, y: 8, width: 400, height: 44 }
      const [x, y] = captionPlace([60, 10], { width: 120, height: 22 }, pane, 0, [switchBox, band])
      expect(y).toBe(8 + 44 + 4)
      for (const box of [switchBox, band]) expect(x + 120 <= box.x || box.x + box.width <= x || y + 22 <= box.y || box.y + box.height <= y).toBe(true)
    })

    it('goes above the pointer when below the box there is no room left', () => {
      const low = { x: 0, y: 560, width: 800, height: 30 }
      const [, y] = captionPlace([100, 570], { width: 120, height: 22 }, pane, 0, [low])
      expect(y + 22 <= 560).toBe(true)
    })
  })
})
