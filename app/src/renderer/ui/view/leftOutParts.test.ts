import { describe, expect, it } from 'vitest'
import type { Part } from '../../../shared/scene'
import { MOST_TAGGED, leftOutParts } from './leftOutParts'

const part = (name: string, min: [number, number, number], max: [number, number, number]): Part => ({ name, bbox: { min, max } }) as Part

describe('leftOutParts', () => {
  it('tags a part that is switched off at the middle of its box, and none that is on', () => {
    const parts = [part('tub', [0, 0, 0], [10, 10, 10]), part('lid', [0, 0, 10], [10, 10, 12])]
    expect(leftOutParts(parts, { lid: { visible: false }, tub: { visible: true } })).toEqual({ shown: [{ name: 'lid', at: [5, 5, 11] }], more: 0 })
    expect(leftOutParts(parts, {})).toEqual({ shown: [], more: 0 })
  })

  it('tags the first few and counts the rest', () => {
    const parts = Array.from({ length: MOST_TAGGED + 3 }, (_, n) => part(`p${n}`, [0, 0, 0], [1, 1, 1]))
    const layers = Object.fromEntries(parts.map((p) => [p.name, { visible: false }]))
    const left = leftOutParts(parts, layers)
    expect(left.shown).toHaveLength(MOST_TAGGED)
    expect(left.more).toBe(3)
  })
})
