import { describe, expect, it } from 'vitest'
import type { Mark } from '../../../shared/marks'
import { litPart, litRows } from './lit'

const on = (id: string, part: string | undefined, over: object = {}): Mark =>
  ({ id, kind: 'pin', author: 'user', note: '', status: 'sent', anchorState: 'ok', layout: 'assembly', revision: 1, anchor: { point: [0, 0, 0], part }, ...over }) as unknown as Mark
const dimension = (id: string, a: string, b: string): Mark =>
  ({ id, kind: 'dimension', author: 'user', note: '', status: 'sent', anchorState: 'ok', layout: 'assembly', revision: 1, measure: 'distance', a: { point: [0, 0, 0], part: a }, b: { point: [1, 0, 0], part: b } }) as unknown as Mark

describe('the rows lit when the pointer is on a part', () => {
  const marks = [on('M3', 'airbox-tub'), on('M4', 'airbox-lid'), on('M5', 'airbox-tub'), on('M6', undefined)]
  const checks = [
    { id: 'tub wall', part: 'airbox-tub' },
    { id: 'lid fit', part: 'airbox-lid' },
    { id: 'overall', part: undefined }
  ]

  it('lights the marks on that part and its checks, and nothing of the lid', () => {
    const lit = litRows('airbox-tub', marks, checks)
    expect([...lit.marks]).toEqual(['M3', 'M5'])
    expect([...lit.checks]).toEqual(['tub wall'])
  })

  it('lights nothing for no part, or for a part nothing is on', () => {
    expect(litRows(null, marks, checks)).toEqual({ marks: new Set(), checks: new Set() })
    expect(litRows('snorkel', marks, checks)).toEqual({ marks: new Set(), checks: new Set() })
  })

  it('lights a dimension between two parts for each of them', () => {
    const between = [dimension('M7', 'airbox-tub', 'airbox-lid')]
    expect([...litRows('airbox-lid', between, []).marks]).toEqual(['M7'])
    expect([...litRows('airbox-tub', between, []).marks]).toEqual(['M7'])
  })

  it('leaves out a mark of a scan, which is on no part', () => {
    const region = { id: 'M8', kind: 'region', author: 'user', note: '', status: 'sent', anchorState: 'ok', layout: 'assembly', revision: 1 } as unknown as Mark
    expect(litRows('airbox-tub', [region], []).marks.size).toBe(0)
  })
})

describe('the part the pointer is on, from the refs lit in the view', () => {
  const names = ['airbox-tub', 'airbox-lid']
  it('is the part a ref names, whole or by one of its faces', () => {
    expect(litPart(['airbox-tub'], names)).toBe('airbox-tub')
    expect(litPart(['airbox-lid/F12'], names)).toBe('airbox-lid')
  })
  it('is none for a mark, a set, a stroke, or a part the layout lacks', () => {
    expect(litPart([], names)).toBeNull()
    expect(litPart(['M3'], names)).toBeNull()
    expect(litPart(['#deck'], names)).toBeNull()
    expect(litPart(['M7/k3'], names)).toBeNull()
    expect(litPart(['snorkel/F1'], names)).toBeNull()
  })
  it('is the first part named', () => {
    expect(litPart(['M3', 'airbox-lid/F1', 'airbox-tub'], names)).toBe('airbox-lid')
  })
})
