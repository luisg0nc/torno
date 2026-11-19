import { describe, expect, it } from 'vitest'
import type { Param } from '../../shared/scene'
import { filterCounts, findParams } from './paramFind'

const p = (name: string, doc: string | null, def: Param['default'] = 1): Param => ({ name, type: typeof def === 'number' ? 'float' : 'str', default: def, literal: true, doc }) as Param
const PARAMS = [p('leg_gap', 'brief: gap between the tabs'), p('fit', 'assumed: clearance a side'), p('wall', 'assumed: 5 perimeters'), p('label', 'brief: the text', 'M3'), p('runner_len', null)]

describe('finding among the Params', () => {
  it('keeps every field for All and an empty find, in the model’s order', () => {
    expect(findParams(PARAMS, '', 'all').map((x) => x.name)).toEqual(['leg_gap', 'fit', 'wall', 'label', 'runner_len'])
  })
  it('finds by name or comment, every word, any case', () => {
    expect(findParams(PARAMS, 'RUNNER', 'all').map((x) => x.name)).toEqual(['runner_len'])
    expect(findParams(PARAMS, 'clearance side', 'all').map((x) => x.name)).toEqual(['fit'])
    expect(findParams(PARAMS, 'clearance nothing', 'all')).toEqual([])
  })
  it('filters to the sizes the comments call assumed or from the brief, and not a text field', () => {
    expect(findParams(PARAMS, '', 'assumed').map((x) => x.name)).toEqual(['fit', 'wall'])
    expect(findParams(PARAMS, '', 'brief').map((x) => x.name)).toEqual(['leg_gap'])
    expect(findParams(PARAMS, 'w', 'assumed').map((x) => x.name)).toEqual(['wall'])
  })
  it('counts each chip', () => {
    expect(filterCounts(PARAMS)).toEqual({ all: 5, assumed: 2, brief: 1 })
  })
})
