import { describe, expect, it } from 'vitest'
import type { Mark } from '../../../shared/marks'
import { onIt, onItSaid, partsOfRefs } from './onIt'

const dim = (id: string, part: string, verdict: 'pass' | 'fail', other?: string): Mark =>
  ({ id, kind: 'dimension', status: 'draft', measure: 'distance', a: { point: [0, 0, 0], part, ref: `${part}/F1` }, ...(other ? { b: { point: [1, 0, 0], part: other } } : {}), value: 1, expected: 1, verdict, measuredRevision: 3 }) as unknown as Mark
const note = (id: string, part: string, status = 'draft'): Mark => ({ id, kind: 'pick', status, author: 'user', note: 'here', anchor: { point: [0, 0, 0], part } }) as unknown as Mark

describe('the parts a selection is on', () => {
  it('names each part once, from part, face and edge refs, and leaves a stroke out', () => {
    expect(partsOfRefs(['lid/F2', 'lid', 'base/E3', 'M4/k1'], (r) => r.includes('/k'))).toEqual(['lid', 'base'])
  })
})

describe('what is on the part in hand', () => {
  const marks = [dim('M7', 'lid', 'pass'), dim('M8', 'lid', 'pass'), dim('M9', 'lid', 'fail', 'base'), dim('M10', 'base', 'fail'), note('M11', 'lid'), note('M12', 'lid', 'resolved'), note('M13', 'base')]

  it('lists the checks that fail and hold on it, by either end, and the marks that are neither', () => {
    const on = onIt(marks, 3, ['lid'])
    expect(on.failing).toEqual(['M9'])
    expect(on.holding).toEqual(['M7', 'M8'])
    expect(on.marks).toBe(1)
  })

  it('is empty for a part nothing is on', () => {
    expect(onIt(marks, 3, ['cap'])).toEqual({ failing: [], holding: [], marks: 0 })
  })

  it('says it in a line', () => {
    expect(onItSaid(onIt(marks, 3, ['lid']))).toBe('M9 fails, M7 M8 hold, 1 mark')
    expect(onItSaid(onIt(marks, 3, ['base']))).toBe('M9 M10 fail, 1 mark')
    expect(onItSaid(onIt(marks, 3, ['cap']))).toBe('')
  })
})
