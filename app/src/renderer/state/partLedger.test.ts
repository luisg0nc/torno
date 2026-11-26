import { describe, expect, it } from 'vitest'
import type { Param } from '../../shared/scene'
import type { ShelfPart } from '../../shared/shelf'
import { askAboutText, dayText, ledgerOf, measuredRequest, measuredValue } from './partLedger'

const size = (name: string, doc: string | null, value = 1, extra: Partial<Param> = {}): Param => ({ name, type: 'float', default: value, literal: true, doc, ...extra })
const part = (over: Partial<ShelfPart> = {}): ShelfPart => ({ id: 'ec11', file: 'common/parts/ec11/part.py', name: 'EC11', what: '', params: [], checked: {}, files: [], ...over })

describe('dayText', () => {
  it('says a day as 26 Nov', () => {
    expect(dayText('2026-11-26')).toBe('26 Nov')
    expect(dayText('2027-01-05')).toBe('5 Jan')
  })
  it('keeps what is no day as it is', () => {
    expect(dayText('yesterday')).toBe('yesterday')
  })
})

describe('measuredValue', () => {
  it('reads a number, with a comma or a point, above 0 and under 10,000', () => {
    expect(measuredValue('6.6')).toBe(6.6)
    expect(measuredValue(' 6,6 ')).toBe(6.6)
    expect(measuredValue('0.05')).toBe(0.05)
    expect(measuredValue('9999.9')).toBe(9999.9)
  })
  it('is null for anything else', () => {
    for (const text of ['', ' ', 'abc', '0', '-2', '10000', '1e9', '6.6mm', 'NaN', 'Infinity', '0x10']) expect(measuredValue(text)).toBeNull()
  })
})

describe('the requests for Claude', () => {
  it('asks about a part', () => {
    expect(askAboutText('ec11')).toBe("About the shelf's ec11:")
  })
  it('says what was measured, with the value in full', () => {
    expect(measuredRequest('ec11', 'body_h', 6.6)).toBe("In the shelf's ec11, set body_h to 6.6: I measured it on the part. Make its comment measured.")
    expect(measuredRequest('ec11', 'body_h', 12.3456)).toContain('to 12.3456:')
  })
})

describe('ledgerOf', () => {
  const p = part({
    params: [
      size('shaft_h', 'datasheet EC11: the shaft above the panel', 15),
      size('body_w', 'measured: the body', 12),
      size('body_h', 'assumed: the body below the panel', 6.5),
      size('hole_d', 'derived: the bush and 0.2 of play', 7.2),
      size('behind', 'assumed: the room kept clear', 10),
      size('pins', 'listing: the legs', 3, { type: 'int', editable: 'int' }),
      { name: 'label', type: 'str', default: 'x', literal: true, doc: 'assumed: text' }
    ],
    checked: { behind: { value: 11, date: '2026-11-26' } }
  })
  const rows = ledgerOf(p)

  it('is one row a size, in the part\'s order, never a text', () => {
    expect(rows.map((r) => r.name)).toEqual(['shaft_h', 'body_w', 'body_h', 'hole_d', 'behind', 'pins'])
  })
  it('gives the value with its unit, and the comment after its source', () => {
    expect(rows[0]).toMatchObject({ valueText: '15', unit: 'mm', what: 'the shaft above the panel', word: 'datasheet EC11' })
    expect(rows[5]).toMatchObject({ valueText: '3', unit: '' })
  })
  it('says how to read the word: assumed warm, measured green, derived and listed quiet, a checked assumed one quiet', () => {
    expect(rows.map((r) => r.tone)).toEqual(['plain', 'ok', 'warn', 'quiet', 'quiet', 'quiet'])
  })
  it('ends each row with what can be done: ask, from the maker, or checked', () => {
    expect(rows.map((r) => r.end.kind)).toEqual(['ask', 'ask', 'ask', 'maker', 'checked', 'ask'])
  })
  it('says a measured source with no entry in checked.json is still one the person may measure', () => {
    expect(rows[1].kind).toBe('ck')
    expect(rows[1].end.kind).toBe('ask')
  })
  it('says the day a size was checked, and the value only when it is not the one the part has', () => {
    expect(rows[4].end).toEqual({ kind: 'checked', day: '26 Nov', at: '11', differs: true })
    const same = ledgerOf(part({ params: [size('a', 'assumed: x', 6.5)], checked: { a: { value: 6.5, date: '2026-11-02' } } }))
    expect(same[0].end).toEqual({ kind: 'checked', day: '2 Nov', at: '6.5', differs: false })
  })
  it('names the rule kind of each, as the tab does', () => {
    expect(rows.map((r) => r.kind)).toEqual(['so', 'ck', 'as', 'mo', 'ck', 'so'])
  })
})
