import { expect, it } from 'vitest'
import { bytes, offsetNumber } from './format'

it('writes an offset to a tenth of a millimetre, always with the tenth, and never -0', () => {
  expect(offsetNumber(40)).toBe('40.0')
  expect(offsetNumber(12.04)).toBe('12.0')
  expect(offsetNumber(-0.04)).toBe('0.0')
  expect(offsetNumber(-3.26)).toBe('-3.3')
})

it('writes what a file weighs in KB and MB', () => {
  expect(bytes(0)).toBe('0 B')
  expect(bytes(413 * 1024)).toBe('413 KB')
  expect(bytes(1.1 * 1024 * 1024)).toBe('1.1 MB')
})
