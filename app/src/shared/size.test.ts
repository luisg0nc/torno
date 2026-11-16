import { describe, expect, it } from 'vitest'
import { MAX_SIZE_NOTE, MAX_SIZE_VALUE, MAX_SIZE_WHAT, MAX_SIZES, type SizeFact, checkSize, parseSize, saySize } from './size'

describe('parseSize', () => {
  it('reads one to three numbers joined by x or ×', () => {
    for (const value of ['186 × 128', '186x128', '186 x 128', '186X128']) expect(parseSize(value), value).toEqual({ numbers: [186, 128] })
    expect(parseSize('1 x 2 x 3')).toEqual({ numbers: [1, 2, 3] })
    expect(parseSize('  42  ')).toEqual({ numbers: [42] })
  })
  it('takes a comma or a point for decimals', () => {
    expect(parseSize('62,5')).toEqual({ numbers: [62.5] })
    expect(parseSize('62.5 x 0,25')).toEqual({ numbers: [62.5, 0.25] })
  })
  it('takes a leading Ø or R as the mark', () => {
    expect(parseSize('Ø62')).toEqual({ mark: 'Ø', numbers: [62] })
    expect(parseSize('Ø 62')).toEqual({ mark: 'Ø', numbers: [62] })
    expect(parseSize('R 5,5')).toEqual({ mark: 'R', numbers: [5.5] })
  })
  it('is null for what is not numbers: words, four numbers, none, a sign, a dangling x', () => {
    for (const value of ['about 60', '1 x 2 x 3 x 4', '', '  ', 'Ø', '-5', '5 x', 'x 5', '5 mm', '1,2,3', '1..2']) expect(parseSize(value), value).toBeNull()
  })
})

const fact = (over: Partial<SizeFact> = {}): SizeFact => ({ what: 'battery tray', value: '186 × 128', unit: 'mm', source: 'measured', ...over })

describe('a unit typed after the value', () => {
  it('is read as the unit the row has, and is not said twice', () => {
    expect(parseSize('62 mm', 'mm')).toEqual({ numbers: [62] })
    expect(parseSize('Ø62mm', 'mm')).toEqual({ mark: 'Ø', numbers: [62] })
    expect(parseSize('186 x 128 MM', 'mm')).toEqual({ numbers: [186, 128] })
    expect(parseSize('12°', '°')).toEqual({ numbers: [12] })
    expect(parseSize('12 °', '°')).toEqual({ numbers: [12] })
    // Another unit than the row's is no number: it stays as typed.
    expect(parseSize('62 mm', '°')).toBeNull()
    expect(parseSize('12°', 'mm')).toBeNull()
    expect(saySize(fact({ value: '62 mm' }))).toBe('battery tray 62 mm (measured)')
    expect(saySize(fact({ value: 'about 60 mm', source: 'a guess' }))).toBe('battery tray about 60 mm (as typed, a guess)')
    expect(saySize(fact({ value: '12°', unit: '°' }))).toBe('battery tray 12° (measured)')
  })
  it('reads the diameter signs as Ø', () => {
    for (const sign of ['\u2300', '\u2205', 'ø']) expect(parseSize(`${sign}62`), sign).toEqual({ mark: 'Ø', numbers: [62] })
    expect(saySize(fact({ value: '\u230062' }))).toBe('battery tray Ø 62 mm (measured)')
  })
})

describe('saySize', () => {
  it('says what, the numbers, the unit and where it came from', () => {
    expect(saySize(fact())).toBe('battery tray 186 × 128 mm (measured)')
    expect(saySize(fact({ what: 'snorkel hole', value: 'Ø62', source: 'from a manual or datasheet', note: 'the manual' }))).toBe('snorkel hole Ø 62 mm (from a manual or datasheet: the manual)')
  })
  it('says the numbers as parsed, so a comma becomes a point', () => {
    expect(saySize(fact({ value: '62,5x10' }))).toBe('battery tray 62.5 × 10 mm (measured)')
  })
  it('sets a degree against its number', () => {
    expect(saySize(fact({ what: 'lean', value: '12', unit: '°' }))).toBe('lean 12° (measured)')
  })
  it('says text that is no numbers as typed, and that it is not taken for a size', () => {
    expect(saySize(fact({ what: 'gap', value: 'about 60', source: 'a guess' }))).toBe('gap about 60 mm (as typed, a guess)')
    expect(saySize(fact({ what: 'gap', value: 'about 60', source: 'a guess', note: 'by eye' }))).toBe('gap about 60 mm (as typed, a guess: by eye)')
  })
  it('says a size from Claude', () => {
    expect(saySize(fact({ source: 'from Claude' }))).toBe('battery tray 186 × 128 mm (from Claude)')
  })
})

describe('checkSize', () => {
  const raw = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ what: 'battery tray', value: '186 x 128', unit: 'mm', source: 'measured', ...over })

  it('has the caps the plan names', () => {
    expect([MAX_SIZES, MAX_SIZE_WHAT, MAX_SIZE_VALUE, MAX_SIZE_NOTE]).toEqual([40, 200, 60, 300])
  })
  it('gives the fact, as typed, with only the fields it knows', () => {
    expect(checkSize({ ...raw(), extra: 1, by: 'agent' }, 'person')).toEqual(fact({ value: '186 x 128' }))
    expect(checkSize(raw({ unit: '°', note: 'by the lid' }), 'person')).toEqual(fact({ value: '186 x 128', unit: '°', note: 'by the lid' }))
  })
  it('takes mm when no unit is given, and drops an empty note', () => {
    expect(checkSize(raw({ unit: undefined, note: '' }), 'person')).toEqual(fact({ value: '186 x 128' }))
  })
  it('takes the longest what, value and note, and refuses one more', () => {
    expect(typeof checkSize(raw({ what: 'w'.repeat(MAX_SIZE_WHAT) }), 'person')).toBe('object')
    expect(typeof checkSize(raw({ value: '9'.repeat(MAX_SIZE_VALUE) }), 'person')).toBe('object')
    expect(typeof checkSize(raw({ note: 'n'.repeat(MAX_SIZE_NOTE) }), 'person')).toBe('object')
    expect(checkSize(raw({ what: 'w'.repeat(MAX_SIZE_WHAT + 1) }), 'person')).toMatch(/200/)
    expect(checkSize(raw({ value: '9'.repeat(MAX_SIZE_VALUE + 1) }), 'person')).toMatch(/60/)
    expect(checkSize(raw({ note: 'n'.repeat(MAX_SIZE_NOTE + 1) }), 'person')).toMatch(/300/)
  })
  it('refuses an empty what or value, text on more than one line, and what is not text', () => {
    expect(typeof checkSize(raw({ what: '  ' }), 'person')).toBe('string')
    expect(typeof checkSize(raw({ value: '' }), 'person')).toBe('string')
    expect(typeof checkSize(raw({ what: 'a\nb' }), 'person')).toBe('string')
    expect(typeof checkSize(raw({ note: 'a\nb' }), 'person')).toBe('string')
    expect(typeof checkSize(raw({ value: 186 }), 'person')).toBe('string')
    expect(typeof checkSize(null, 'person')).toBe('string')
    expect(typeof checkSize('186', 'agent')).toBe('string')
  })
  it('refuses a unit that is not mm or °', () => {
    expect(checkSize(raw({ unit: 'cm' }), 'person')).toMatch(/mm/)
    expect(checkSize(raw({ unit: 'cm' }), 'agent')).toMatch(/mm/)
  })
  it('refuses a source that is not one, and a person with none', () => {
    expect(typeof checkSize(raw({ source: 'my gut' }), 'person')).toBe('string')
    expect(typeof checkSize(raw({ source: undefined }), 'person')).toBe('string')
  })
  it('gives the person three sources, and from Claude to Claude alone', () => {
    for (const source of ['measured', 'from a manual or datasheet', 'a guess']) expect(checkSize(raw({ source }), 'person')).toMatchObject({ source })
    expect(checkSize(raw({ source: 'from Claude' }), 'person')).toMatch(/Claude/)
  })
  it('makes whatever the agent gives from Claude, and refuses any other source of it', () => {
    expect(checkSize(raw({ source: undefined }), 'agent')).toMatchObject({ source: 'from Claude' })
    expect(checkSize(raw({ source: 'from Claude' }), 'agent')).toMatchObject({ source: 'from Claude' })
    for (const source of ['measured', 'from a manual or datasheet', 'a guess']) expect(checkSize(raw({ source }), 'agent'), source).toMatch(/Claude/)
  })
})
