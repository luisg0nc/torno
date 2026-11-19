import { describe, expect, it } from 'vitest'
import type { Param } from '../../shared/scene'
import { nudgeOf } from './nudge'

const param = (over: Partial<Param>): Param => ({ name: 'p', type: 'float', default: 2, literal: true, doc: null, editable: 'float', ...over })

describe('nudgeOf', () => {
  it('steps a number by a tenth, at least half a millimetre, from what the build used', () => {
    expect(nudgeOf(param({ default: 40 }))).toBe(44)
    expect(nudgeOf(param({ default: 2, value: 3 }))).toBe(3.5)
  })
  it('keeps to the range, stepping down at the top and to its end where a step does not fit', () => {
    expect(nudgeOf(param({ default: 5, metadata: { min: 1, max: 5 } }))).toBe(4.5)
    expect(nudgeOf(param({ default: 2, metadata: { min: 1.8, max: 2.2 } }))).toBe(2.2)
  })
  it('steps a count by one, turns a flag over and takes the next choice', () => {
    expect(nudgeOf(param({ editable: 'int', default: 3 }))).toBe(4)
    expect(nudgeOf(param({ editable: 'bool', default: true }))).toBe(false)
    expect(nudgeOf(param({ editable: 'choice', default: 'a', choices: ['a', 'b'] }))).toBe('b')
    expect(nudgeOf(param({ editable: 'choice', default: 'b', choices: ['a', 'b'] }))).toBe('a')
  })
  it('has none for a field that cannot be tried or has nowhere to go', () => {
    expect(nudgeOf(param({ editable: null }))).toBeNull()
    expect(nudgeOf(param({ editable: 'choice', default: 'a', choices: ['a'] }))).toBeNull()
    expect(nudgeOf(param({ default: 3, metadata: { min: 3, max: 3 } }))).toBeNull()
  })
})
