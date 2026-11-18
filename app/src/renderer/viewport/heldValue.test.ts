import { describe, expect, it } from 'vitest'
import { readingAt } from './heldValue'

describe('where the reading of a measurement stands', () => {
  it('is the middle of the kernel\'s two points', () => {
    expect(readingAt({ points: [[0, 0, 3], [0, 0, -3]], a: { point: [9, 9, 9] }, b: { point: [8, 8, 8] } })).toEqual([0, 0, 0])
  })
  it('is the middle of the two ends when the kernel gave none, and the one end of a diameter', () => {
    expect(readingAt({ a: { point: [0, 0, 0] }, b: { point: [10, 4, 2] } })).toEqual([5, 2, 1])
    expect(readingAt({ a: { point: [1, 2, 3] } })).toEqual([1, 2, 3])
  })
})
