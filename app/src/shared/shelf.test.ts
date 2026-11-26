import { describe, expect, it } from 'vitest'
import type { Param } from './scene'
import { assumedCount, holeText, isPartId, shelfFileOf, type ShelfPart } from './shelf'

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

describe('shelfFileOf', () => {
  it('reads the part and the file of a path inside common/parts, relative or absolute', () => {
    expect(shelfFileOf('common/parts/ec11/part.py')).toEqual({ id: 'ec11', file: 'part.py' })
    expect(shelfFileOf('/home/me/ws/common/parts/esp32_c6_lcd_147/part.py')).toEqual({ id: 'esp32_c6_lcd_147', file: 'part.py' })
    expect(shelfFileOf('./common/parts/ec11/datasheet/ec11.pdf')).toEqual({ id: 'ec11', file: 'datasheet/ec11.pdf' })
    expect(shelfFileOf('common//parts/ec11/./part.py')).toEqual({ id: 'ec11', file: 'part.py' })
    expect(shelfFileOf('C:\\ws\\common\\parts\\ec11\\part.py')).toEqual({ id: 'ec11', file: 'part.py' })
  })
  it('is null for anything else: another folder, a folder with no file, a name that is no id, a path that climbs out', () => {
    expect(shelfFileOf('common/parts.py')).toBeNull()
    expect(shelfFileOf('common/parts/ec11')).toBeNull()
    expect(shelfFileOf('common/parts/ec11/')).toBeNull()
    expect(shelfFileOf('common/parts/ec-11/part.py')).toBeNull()
    expect(shelfFileOf('common/parts/EC11/part.py')).toBeNull()
    expect(shelfFileOf('hollow/part.py')).toBeNull()
    expect(shelfFileOf('uncommon/parts/ec11/part.py')).toBeNull()
    expect(shelfFileOf('common/parts/ec11/../../x.py')).toBeNull()
    expect(shelfFileOf('')).toBeNull()
    expect(shelfFileOf(undefined)).toBeNull()
  })
})
