import { describe, expect, it } from 'vitest'
import { placePopover } from './popoverPlace'

const view = { w: 1000, h: 700 }
const size = { w: 290, h: 120 }

describe('placePopover', () => {
  it('stands below the anchor, centred on it, with its stem on the anchor', () => {
    const at = placePopover({ x: 400, y: 100, w: 80, h: 26 }, size, view, 'below')
    expect(at).toMatchObject({ side: 'below', x: 295, y: 136 })
    expect(at.stem).toBe(145)
  })

  it('stands above when asked to', () => {
    const at = placePopover({ x: 400, y: 300, w: 80, h: 26 }, size, view, 'above')
    expect(at.side).toBe('above')
    expect(at.y).toBe(300 - 10 - 120)
  })

  it('goes to the other side when its side has no room and the other has', () => {
    expect(placePopover({ x: 400, y: 640, w: 80, h: 26 }, size, view, 'below').side).toBe('above')
    expect(placePopover({ x: 400, y: 20, w: 80, h: 26 }, size, view, 'above').side).toBe('below')
  })

  it('is kept inside the view, and the stem still points at the anchor', () => {
    const left = placePopover({ x: 4, y: 100, w: 30, h: 26 }, size, view, 'below')
    expect(left.x).toBe(8)
    expect(left.stem).toBe(14)
    const right = placePopover({ x: 970, y: 100, w: 24, h: 26 }, size, view, 'below')
    expect(right.x).toBe(1000 - 8 - 290)
    expect(right.stem).toBe(290 - 14)
  })

  it('keeps the stem on the card when the anchor is out past its corner', () => {
    const at = placePopover({ x: 990, y: 100, w: 4, h: 26 }, size, view, 'below')
    expect(at.stem).toBeLessThanOrEqual(size.w - 14)
  })
})
