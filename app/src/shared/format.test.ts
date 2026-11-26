import { expect, it } from 'vitest'
import { bytes, dollars, offsetNumber, tokens } from './format'

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

it('writes a count of tokens to three digits, in k and M', () => {
  expect(tokens(742)).toBe('742')
  expect(tokens(14_200)).toBe('14.2 k')
  expect(tokens(742_000)).toBe('742 k')
  expect(tokens(999_900)).toBe('1 M')
  expect(tokens(1_180_000)).toBe('1.18 M')
  expect(tokens(26_300_000)).toBe('26.3 M')
})

it('writes dollars to the cent, and a cost under a cent as under one', () => {
  expect(dollars(0.64)).toBe('$0.64')
  expect(dollars(10.8)).toBe('$10.80')
  expect(dollars(0)).toBe('$0')
  expect(dollars(0.004)).toBe('under $0.01')
  expect(dollars(123.456)).toBe('$123')
})
