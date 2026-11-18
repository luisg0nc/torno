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
})
