import { describe, expect, it } from 'vitest'
import { askedBox, dialSizes } from './scanDial'

describe('dialSizes', () => {
  it('gives the longest side as each unit would make it, in the monospace form', () => {
    const sizes = dialSizes([0.412, 0.18, 0.29])
    expect(sizes.map((s) => s.unit)).toEqual(['mm', 'cm', 'm', 'in', 'ft'])
    expect(sizes.map((s) => s.size)).toEqual(['0.412', '4.12', '412', '10.46', '125.6'])
  })

  it('takes the longest side whichever it is', () => {
    expect(dialSizes([2, 60, 50]).find((s) => s.unit === 'm')?.size).toBe('60000')
    expect(dialSizes([60, 50, 2]).find((s) => s.unit === 'cm')?.size).toBe('600')
  })

  it('reads a negative or empty box as nothing', () => {
    expect(dialSizes([0, 0, 0]).map((s) => s.size)).toEqual(['0', '0', '0', '0', '0'])
  })
})

describe('askedBox', () => {
  it('scales the box about its lowest corner, which stays where it is', () => {
    expect(askedBox({ min: [10, 20, 30], max: [20, 30, 32] }, 10)).toEqual({ min: [10, 20, 30], max: [110, 120, 50] })
  })

  it('is the same box for a factor of one', () => {
    expect(askedBox({ min: [0, 0, 0], max: [4, 5, 6] }, 1)).toEqual({ min: [0, 0, 0], max: [4, 5, 6] })
  })
})
