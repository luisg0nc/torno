import { describe, expect, it } from 'vitest'
import type { DimensionMark } from '../../../shared/marks'
import type { BuildDigest, DigestPart } from '../../../shared/sanity'
import { slipTable } from './slipTable'

/** A part whose volume went from `before` to `after`; `exact` as the kernel said. */
const part = (name: string, before: number, after: number, exact = true, more: Partial<DigestPart> = {}): DigestPart => ({
  name,
  layout: 'assembly',
  text: `${name}: volume ${before} → ${after} mm³`,
  volume: { before, after, exact, change: after - before, percent: before === 0 ? undefined : ((after - before) / before) * 100 },
  size: { before: [1, 1, 1], after: [1, 1, 1], exact },
  faces: { before: 14, after: 14 },
  edges: { before: 30, after: 30 },
  ...more
})
const digest = (more: Partial<BuildDigest> = {}): BuildDigest => ({ revision: 41, since: 40, changed: true, parts: [], unchanged: 0, flags: [], dimensions: [], ...more })
const line = (more: Partial<BuildDigest> = {}) => ({ digest: digest(more), marks: [] as DimensionMark[] })

// h40 → h41: four parts changed, five did not.
const four = [part('snorkel', 1000, 1010), part('lid', 12000, 12480), part('tub', 28400, 30190), part('snorkel-fwd', 800, 840)]

describe('the table of a build slip', () => {
  it('sorts the changed parts by the size of the change, and counts the ones that did not change', () => {
    const table = slipTable(line({ parts: four, unchanged: 5 }))
    expect(table.rows.map((r) => r.part)).toEqual(['tub', 'lid', 'snorkel-fwd', 'snorkel'])
    expect(table.rows[0]).toMatchObject({ part: 'tub', before: '28400', after: '30190', change: '+6.3 %', exact: true })
    expect(table.unchanged).toBe(5)
    expect(table.hidden).toBe(0)
  })

  it('shows at most six rows and counts the parts left out', () => {
    const eight = Array.from({ length: 8 }, (_, n) => part(`p${n}`, 1000, 1000 + (n + 1) * 10))
    const table = slipTable(line({ parts: eight }))
    expect(table.rows).toHaveLength(6)
    expect(table.hidden).toBe(2)
    // The biggest changes are the ones shown.
    expect(table.rows.map((r) => r.part)).toEqual(['p7', 'p6', 'p5', 'p4', 'p3', 'p2'])
    // Asked for more, it gives them all.
    const all = slipTable(line({ parts: eight }), Infinity)
    expect(all.rows).toHaveLength(8)
    expect(all.hidden).toBe(0)
  })

  it('keeps the ≈ of a volume that is not exact on every number of its row, and goes through the format', () => {
    const table = slipTable(line({ parts: [part('tub', 28400.123, 25560.1107, false)] }))
    expect(table.rows[0]).toMatchObject({ before: '≈ 28400', after: '≈ 25560', change: '≈ -10 %', exact: false })
  })

  it('says a part whose volume stood but whose faces changed by its faces', () => {
    const table = slipTable(line({ parts: [part('lid', 500, 500, true, { faces: { before: 14, after: 22 } })] }))
    expect(table.rows[0].change).toBe('faces 14 → 22')
  })

  it('has no rows for a build that changed nothing', () => {
    expect(slipTable(line({ changed: false, unchanged: 9 }))).toEqual({ flips: [], rows: [], hidden: 0, unchanged: 9 })
  })
})

describe('the dimensions a build flipped', () => {
  const dimension = (more: Partial<DimensionMark> = {}) =>
    ({ id: 'M3', kind: 'dimension', measure: 'thickness', note: 'tub wall', history: [{ revision: 40, value: 2.8 }, { revision: 41, value: 3 }], ...more }) as DimensionMark

  it('gives the id, the name, the value it had and has, and the verdict word', () => {
    const table = slipTable({ digest: digest({ dimensions: [{ id: 'M3', was: 'fail', now: 'pass' }] }), marks: [dimension()] })
    expect(table.flips).toEqual([{ id: 'M3', name: 'tub wall', from: '2.8', to: '3', unit: 'mm', now: 'pass', word: 'now passes' }])
  })

  it('is as short as it can be when the mark is not known or has no samples, and says no longer measured', () => {
    const table = slipTable({ digest: digest({ dimensions: [{ id: 'M3', was: 'fail', now: 'pass' }, { id: 'M5', was: 'pass', now: 'none' }] }), marks: [] })
    expect(table.flips).toEqual([
      { id: 'M3', now: 'pass', word: 'now passes' },
      { id: 'M5', now: 'none', word: 'is no longer measured' }
    ])
  })

  it('writes an angle in degrees', () => {
    const table = slipTable({ digest: digest({ dimensions: [{ id: 'M3', was: 'pass', now: 'fail' }] }), marks: [dimension({ measure: 'angle', history: [{ revision: 40, value: 90 }, { revision: 41, value: 92.5 }] })] })
    expect(table.flips[0]).toMatchObject({ from: '90', to: '92.5', unit: '°', word: 'now fails' })
  })
})
