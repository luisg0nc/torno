import { describe, expect, it } from 'vitest'
import type { Param } from '../../shared/scene'
import type { ShelfPart } from '../../shared/shelf'
import { SHELF_LIMIT, shelfLine } from './told'

const size = (name: string, doc: string): Param => ({ name, type: 'float', default: 1, literal: true, doc })

function part(id: string, over: Partial<ShelfPart> = {}): ShelfPart {
  return { id, file: `common/parts/${id}/part.py`, name: id, what: '', params: [], checked: {}, files: [], ...over }
}

const HEAD = (n: number): string => `On the shelf, common/parts/ (${n} ${n === 1 ? 'part' : 'parts'}; use one before researching it, and say which sizes are assumed):`

const EC11 = part('ec11', { cutout: { side: [], plan: [], size: { d: 7 } }, params: [size('a', 'assumed: x'), size('b', 'assumed: y'), size('c', 'datasheet: z')] })
const JACK = part('jack', { cutout: { side: [], plan: [], size: { w: 33.4, h: 18.4 } }, params: [size('a', 'assumed: x')] })

describe('shelfLine', () => {
  it('is nothing for an empty shelf', () => expect(shelfLine([])).toBe(''))
  it('is a head and a line a part: its hole and how many sizes are assumed', () => {
    expect(shelfLine([EC11, JACK])).toBe([HEAD(2), 'ec11: hole Ø7, 2 sizes assumed', 'jack: window 33.4 × 18.4, 1 size assumed'].join('\n'))
  })
  it('says a single part in the singular', () => expect(shelfLine([JACK]).split('\n')[0]).toBe(HEAD(1)))
  it('leaves out what a part has none of', () => {
    const lines = shelfLine([part('plain', { cutout: { side: [], plan: [], size: { d: 5 } } }), part('guess', { params: [size('a', 'assumed: x')] }), part('bare')]).split('\n')
    expect(lines.slice(1)).toEqual(['plain: hole Ø5', 'guess: 1 size assumed', 'bare'])
  })
  it('says a part that does not build, whatever else it has', () => {
    expect(shelfLine([part('broken', { error: 'NameError: x', cutout: { side: [], plan: [], size: { d: 5 } } })]).split('\n')[1]).toBe('broken: does not build')
  })
  it('counts the parts it has no room for, and keeps to its limit', () => {
    const many = Array.from({ length: 30 }, (_, i) => part(`push_button_${i}`, { cutout: { side: [], plan: [], size: { d: 16 } }, params: [size('a', 'assumed: x')] }))
    const text = shelfLine(many)
    expect(text.length).toBeLessThanOrEqual(SHELF_LIMIT)
    const lines = text.split('\n')
    expect(lines[0]).toBe(HEAD(30))
    const listed = lines.length - 2
    expect(listed).toBeGreaterThan(10)
    expect(lines.at(-1)).toBe(`and ${30 - listed} more`)
    expect(lines[1]).toBe('push_button_0: hole Ø16, 1 size assumed')
  })
  it('lists all of them when they fit, with no count', () => {
    const few = Array.from({ length: 6 }, (_, i) => part(`p${i}`))
    expect(shelfLine(few)).not.toContain('more')
  })
  it('is 600 characters at most', () => expect(SHELF_LIMIT).toBe(600))
})
