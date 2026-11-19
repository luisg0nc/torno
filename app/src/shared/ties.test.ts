import { describe, expect, it } from 'vitest'
import type { DimensionMark } from './marks'
import type { SizeFact } from './size'
import { briefChip, sizesTold, tallyReadings, tieNumber, tieReading, tieRefusal, tieToleranceFor, wouldSay } from './ties'

const A = { point: [0, 0, 0] as [number, number, number] }
const dim = (more: Partial<DimensionMark> = {}): DimensionMark => ({ id: 'M9', kind: 'dimension', measure: 'distance', a: A, b: A, author: 'user', note: '', status: 'draft', anchorState: 'ok', createdAt: '', layout: 'a', revision: 1, camera: {} as never, value: 96.1, measuredRevision: 12, ...more }) as DimensionMark
const size = (more: Partial<SizeFact> = {}): SizeFact => ({ what: 'tray', value: '96.5', unit: 'mm', source: 'measured', ...more })

describe('what a size sets', () => {
  it('has a tolerance from where it came from', () => {
    expect([tieToleranceFor({ source: 'measured' }), tieToleranceFor({ source: 'from a manual or datasheet' }), tieToleranceFor({ source: 'a guess' })]).toEqual([0.5, 0.2, 2])
  })
  it('is one number, or says why not', () => {
    expect(tieNumber(size({ value: '62,5' }))).toBe(62.5)
    expect(tieNumber(size({ value: 'Ø6.6' }))).toBe(6.6)
    expect(tieNumber(size({ value: '186 × 128' }))).toContain('2 numbers')
    expect(tieNumber(size({ value: 'about 60' }))).toContain('not a number')
  })
  it('refuses a dimension that cannot check it', () => {
    expect(tieRefusal(size(), dim())).toBeNull()
    expect(tieRefusal(size({ unit: '°', value: '45' }), dim())).toContain('mm')
    expect(tieRefusal(size({ value: 'Ø6' }), dim())).toContain('diameter')
    expect(tieRefusal(size({ value: 'R6' }), dim({ measure: 'radius' }))).toBeNull()
    expect(tieRefusal(size(), dim({ status: 'resolved' }))).toContain('resolved')
  })
  it('says what a dimension would say', () => {
    expect(wouldSay(size(), dim(), 0.5, 12)).toBe('would hold')
    expect(wouldSay(size(), dim(), 0.2, 12)).toBe('would fail')
    expect(wouldSay(size(), dim(), 0.5, 13)).toBe('not measured on this build')
  })
})

describe('what a tied size reads', () => {
  const tied = (more: Partial<SizeFact> = {}): SizeFact => size({ tie: { mark: 'M9', tolerance: 0.5 }, ...more })
  it('is nothing when there is no tie, and gone when the dimension is not there', () => {
    expect(tieReading(size(), dim(), 12)).toEqual({ state: 'none' })
    expect(tieReading(tied(), undefined, 12)).toEqual({ state: 'none', gone: 'M9' })
  })
  it("takes the dimension's verdict on the build on show", () => {
    expect(tieReading(tied(), dim({ expected: 96.5, tolerance: 0.5, verdict: 'pass' }), 12)).toMatchObject({ state: 'holds', mark: 'M9', value: 96.1, lo: 96, hi: 97 })
    const fails = tieReading(tied(), dim({ expected: 96.5, tolerance: 0.2, value: 96.1, verdict: 'fail' }), 12)
    expect(fails).toMatchObject({ state: 'fails' })
    expect((fails as { reading: string }).reading).toContain('0.4 under')
    expect(tieReading(tied(), dim({ expected: 96.5, tolerance: 0.5, verdict: 'pass' }), 13)).toMatchObject({ state: 'unmeasured', value: null })
  })
  it('counts for the head of the ledger, leaving out what is zero', () => {
    const tally = tallyReadings([{ state: 'none' }, { state: 'none' }, { state: 'holds' } as never, { state: 'fails' } as never])
    expect(tally).toEqual({ holds: 1, fails: 1, unmeasured: 0, unchecked: 2 })
    expect(sizesTold(4, tally)).toBe('4 sizes, 1 hold, 1 fails, 2 not checked')
    expect(sizesTold(1, { holds: 1, fails: 0, unmeasured: 0, unchecked: 0 })).toBe('1 size, 1 hold')
    expect(sizesTold(0, tally)).toBe('none yet')
  })
  it("gives a tied dimension's chip the brief's value", () => {
    expect(briefChip({ expected: 96.5, expectedFrom: 'C7' })).toBe('brief 96.5')
    expect(briefChip({ expected: 96.5 })).toBeUndefined()
  })
})
