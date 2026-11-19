import { describe, expect, it } from 'vitest'
import { ON_ROWS_SHOWN, onBlock, verdictSaid, type OnInput } from './onBlock'

const base: OnInput = { ask: null, failing: [], pass: 0, unchecked: 0, review: [], fromAgent: [], tried: [] }
const fail = (id: string) => ({ id, chip: id, words: `${id} fails`, reading: '6.2' })

describe('verdictSaid', () => {
  it('counts what fails and what passes', () => expect(verdictSaid(2, 5)).toBe('2 fail, 5 pass'))
  it('says one fails in the singular', () => expect(verdictSaid(1, 0)).toBe('1 fails'))
  it('says so when nothing is checked', () => expect(verdictSaid(0, 0)).toBe('nothing checked yet'))
  it('leaves out a zero', () => expect(verdictSaid(0, 3)).toBe('3 pass'))
})

describe('onBlock', () => {
  it('has no rows when nothing waits', () => {
    const b = onBlock(base)
    expect(b.rows).toEqual([])
    expect(b.more).toBe(0)
    expect(b.said).toBe('nothing checked yet')
  })
  it('orders the question, the failing checks, the sizes, the marks to review, then the marks from Claude, then tried values', () => {
    const b = onBlock({ ask: { text: 'Which way?' }, failing: [fail('M9')], pass: 5, unchecked: 2, review: [{ id: 'M12', words: 'rib' }], fromAgent: [{ id: 'M3', words: 'look' }], tried: [{ name: 'leg_gap', value: '96.9', file: '96.1' }] }, true)
    expect(b.rows.map((r) => r.kind)).toEqual(['ask', 'check', 'sizes', 'review', 'fromAgent', 'tried'])
    expect(b.said).toBe('1 fails, 5 pass')
  })
  it('shows at most four rows and counts the rest, unless it is opened', () => {
    const input = { ...base, failing: ['a', 'b', 'c', 'd', 'e', 'f'].map(fail) }
    const closed = onBlock(input)
    expect(closed.rows).toHaveLength(ON_ROWS_SHOWN)
    expect(closed.more).toBe(2)
    const open = onBlock(input, true)
    expect(open.rows).toHaveLength(6)
    expect(open.more).toBe(2)
  })
  it('makes one row of all the sizes nothing checks', () => {
    expect(onBlock({ ...base, unchecked: 4 }).rows).toEqual([{ kind: 'sizes', count: 4 }])
  })
  it('makes one row of the tried values', () => {
    const rows = onBlock({ ...base, tried: [{ name: 'a', value: '1', file: '0' }, { name: 'b', value: '2', file: '0' }] }).rows
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'tried' })
  })
})
