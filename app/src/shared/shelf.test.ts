import { describe, expect, it } from 'vitest'
import type { Param } from './scene'
import { assumedCount, holeText, isPartId, type ShelfPart } from './shelf'

const size = (name: string, doc: string | null, value = 1): Param => ({ name, type: 'float', default: value, literal: true, doc })

function part(over: Partial<ShelfPart> = {}): ShelfPart {
  return { id: 'ec11', file: 'common/parts/ec11/part.py', name: 'EC11 rotary encoder', what: 'Rotary encoder', params: [], checked: {}, files: [], ...over }
}

describe('isPartId', () => {
  it.each(['ec11', 'push_button_16', 'esp32_c6_lcd_147', '_x', 'a'])('%s is an id', (id) => expect(isPartId(id)).toBe(true))
  it.each(['', 'EC11', 'esp32-c6', '1ec11', 'a b', 'ec11.py', 'é', 'a'.repeat(49), 'class', 'import', 'None', 'lambda', 'match'.toUpperCase()])('%j is not', (id) => expect(isPartId(id)).toBe(false))
  it('is up to 48 characters', () => expect(isPartId('a'.repeat(48))).toBe(true))
  it('is not a thing that is not a string', () => expect(isPartId(7 as unknown as string)).toBe(false))
})

describe('holeText', () => {
  it('says a round hole by its diameter', () => expect(holeText(part({ cutout: { side: [], plan: [], size: { d: 7 } } }))).toBe('hole Ø7'))
  it('says a window by its two sides, to four digits', () => {
    expect(holeText(part({ cutout: { side: [], plan: [], size: { w: 33.4, h: 18.4 } } }))).toBe('window 33.4 × 18.4')
    expect(holeText(part({ cutout: { side: [], plan: [], size: { w: 33.40001, h: 18.123456 } } }))).toBe('window 33.4 × 18.12')
  })
  it('says a diameter to four digits', () => expect(holeText(part({ cutout: { side: [], plan: [], size: { d: 7.04 } } }))).toBe('hole Ø7.04'))
  it('is nothing when there is no cutout', () => expect(holeText(part())).toBe(''))
})

describe('assumedCount', () => {
  it('counts the sizes whose comment says assumed', () => {
    const params = [size('a', 'assumed: a guess'), size('b', 'datasheet: ok'), size('c', 'Assumed: capital'), size('d', null), size('e', 'derived: x')]
    expect(assumedCount(part({ params }))).toBe(2)
  })
  it('counts sizes only, never a flag or a text', () => {
    const flag: Param = { name: 'f', type: 'bool', default: true, literal: true, doc: 'assumed: yes' }
    expect(assumedCount(part({ params: [flag, size('a', 'assumed: x')] }))).toBe(1)
  })
  it('is 0 for a part with none', () => expect(assumedCount(part())).toBe(0))
})
