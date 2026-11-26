import { describe, expect, it } from 'vitest'
import type { Param, Scene } from '../../shared/scene'
import type { ShelfPart } from '../../shared/shelf'
import { drawingOf, holeParts, partGroups, ruleKinds, rulesTitle, timesUsed, usesPart } from './shelf'

const size = (name: string, doc: string | null, value = 1): Param => ({ name, type: 'float', default: value, literal: true, doc })

function part(over: Partial<ShelfPart> = {}): ShelfPart {
  return { id: 'ec11', file: 'common/parts/ec11/part.py', name: 'EC11 rotary encoder', what: 'Rotary encoder', params: [], checked: {}, files: [], ...over }
}

const scene = (over: Partial<Scene> = {}): Scene => ({ model: 'm', layouts: [], parts: [], seconds: 0, output: '', ...over })

describe('the rules of a part', () => {
  it('has a kind for each size: checked, assumed, derived, else sourced', () => {
    const params = [
      size('a', 'datasheet EC11: the shaft'),
      size('b', 'assumed: a guess'),
      size('c', 'derived: the bush and play'),
      size('d', 'measured: with calipers'),
      size('e', 'assumed: but the person checked it'),
      size('f', null)
    ]
    const checked = { e: { value: 5, date: '2026-11-26' } }
    expect(ruleKinds(part({ params, checked }))).toEqual(['so', 'as', 'mo', 'ck', 'ck', 'so'])
  })
  it('counts sizes only, never a flag or a text', () => {
    const flag: Param = { name: 'f', type: 'bool', default: true, literal: true, doc: 'assumed: yes' }
    expect(ruleKinds(part({ params: [flag, size('a', 'assumed: x')] }))).toEqual(['as'])
  })
  it('says in its title how many are sourced, assumed and checked', () => {
    const params = [size('a', 'datasheet: x'), size('b', 'assumed: x'), size('c', 'assumed: y'), size('d', 'measured: z')]
    expect(rulesTitle(part({ params }))).toBe('4 sizes: 2 with a source, 2 assumed, 1 checked on the part')
  })
  it('says size for one, and nothing is said of none', () => {
    expect(rulesTitle(part({ params: [size('a', 'assumed: x')] }))).toBe('1 size: 0 with a source, 1 assumed, 0 checked on the part')
    expect(rulesTitle(part())).toBe('No sizes')
  })
})

describe('the parts a project uses', () => {
  const parts = [part({ id: 'zed', name: 'Zed' }), part({ id: 'ec11', name: 'EC11' }), part({ id: 'bearing', name: 'Bearing' }), part({ id: 'abc', name: 'Abc' })]
  it('is the parts of the scene’s shelf, and those whose file it read', () => {
    const s = scene({ shelf: { ec11: 2 }, uses: ['common/parts/zed/part.py', 'common/other.py'] })
    expect(usesPart(s, 'ec11')).toBe(true)
    expect(usesPart(s, 'zed')).toBe(true)
    expect(usesPart(s, 'bearing')).toBe(false)
    expect(usesPart(s, 'other')).toBe(false)
  })
  it('puts them in a group sorted by name, the rest in another', () => {
    const g = partGroups(parts, scene({ shelf: { ec11: 2, zed: null } }))
    expect(g.here.map((p) => p.id)).toEqual(['ec11', 'zed'])
    expect(g.other.map((p) => p.id)).toEqual(['abc', 'bearing'])
  })
  it('has all of them in the other group while no build has landed', () => {
    const g = partGroups(parts, null)
    expect(g.here).toEqual([])
    expect(g.other).toHaveLength(4)
  })
  it('counts the times used, and says nothing when it is not known or not used', () => {
    const s = scene({ shelf: { ec11: 2, zed: null }, uses: ['common/parts/abc/part.py'] })
    expect(timesUsed(s, 'ec11')).toBe(2)
    expect(timesUsed(s, 'zed')).toBeNull()
    expect(timesUsed(s, 'abc')).toBeNull()
    expect(timesUsed(s, 'bearing')).toBeNull()
    expect(timesUsed(null, 'ec11')).toBeNull()
  })
})

describe('the hole in pieces', () => {
  it('has the word and the numbers apart, to set the numbers in the mono face', () => {
    expect(holeParts(part({ cutout: { side: [], plan: [], size: { d: 7 } } }))).toEqual(['hole Ø', '7'])
    expect(holeParts(part({ cutout: { side: [], plan: [], size: { w: 33.4, h: 18.4 } } }))).toEqual(['window ', '33.4', ' × ', '18.4'])
    expect(holeParts(part())).toEqual([])
  })
})

describe('the drawing of a part', () => {
  it('is its side outlines at 1.25 px a mm, standing on z = 0 at the bottom of its box, +Z up', () => {
    const p = part({
      body: {
        bbox: { min: [-6, -6, -6.5], max: [6, 6, 15] },
        side: [
          { points: [[-6, -6.5], [6, -6.5], [6, 0], [-6, 0]] },
          { points: [[-1, -3], [1, -3], [1, -1]], hole: true }
        ]
      }
    })
    const d = drawingOf(p)!
    expect(d.width).toBeCloseTo(12 * 1.25)
    expect(d.height).toBeCloseTo(21.5 * 1.25)
    // The path is in px with y down: the lowest point (z = -6.5) is at the bottom (y = height).
    expect(d.path.startsWith('M0 ')).toBe(true)
    expect(d.path).toContain('M0 26.875L15 26.875L15 18.75L0 18.75Z')
    expect(d.path.match(/Z/g)).toHaveLength(2)
  })
  it('is nothing for a part with no body', () => {
    expect(drawingOf(part())).toBeNull()
    expect(drawingOf(part({ error: 'boom' }))).toBeNull()
  })
})
