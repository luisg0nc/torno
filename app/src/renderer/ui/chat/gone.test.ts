import { describe, expect, it } from 'vitest'
import { YOUR_MESSAGE, goneText } from './gone'

describe('what a picture whose data is gone says', () => {
  it('names the reference that is no longer there', () => {
    expect(goneText({ id: 'p1', mediaType: 'image/png', file: 'reference/doodle-1.png' }, YOUR_MESSAGE)).toBe('reference/doodle-1.png is no longer there')
  })
  it('says a picture of a tool was of an earlier build', () => {
    expect(goneText({ id: 'p1', mediaType: 'image/png' }, 'Look')).toBe('Picture of an earlier build, not kept')
  })
  it('says only that a picture of the person was not kept', () => {
    expect(goneText({ id: 'p1', mediaType: 'image/png' }, YOUR_MESSAGE)).toBe('Picture not kept')
  })
})
