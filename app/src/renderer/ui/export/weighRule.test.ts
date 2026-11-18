import { describe, expect, it } from 'vitest'
import { weighRule, weighed } from './weighRule'

const MB = 1024 * 1024
const kB = 1024

describe('weighRule', () => {
  it('gives each line its share of the budget, and the ticks at 0, half and the whole budget', () => {
    const items = [
      { kind: 'page' as const, bytes: 413 * kB, on: true },
      { kind: 'marks' as const, bytes: 2 * kB, on: true },
      { kind: 'scan' as const, bytes: 1.1 * MB, on: true }
    ]
    const rule = weighRule(items, 12 * MB)
    expect(rule.segments.map((s) => s.kind)).toEqual(['page', 'marks', 'scan'])
    const total = 413 * kB + 2 * kB + 1.1 * MB
    expect(rule.segments.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(total / (12 * MB), 10)
    expect(rule.segments[0].share).toBeCloseTo((413 * kB) / (12 * MB), 10)
    expect(rule.over).toBe(0)
    expect(rule.ticks).toEqual([0, 6 * MB, 12 * MB])
  })

  it('counts only the lines that are on, and leaves out those that weigh nothing', () => {
    const items = [
      { kind: 'page' as const, bytes: 3 * MB, on: true },
      { kind: 'object' as const, bytes: 5 * MB, on: false },
      { kind: 'scan' as const, bytes: 0, on: true }
    ]
    expect(weighed(items)).toEqual([items[0]])
    expect(weighRule(items, 12 * MB).segments).toEqual([{ kind: 'page', share: 0.25 }])
  })

  it('runs the segments to the budget and gives the overflow its own share', () => {
    const items = [
      { kind: 'page' as const, bytes: 4 * MB, on: true },
      { kind: 'scan' as const, bytes: 11 * MB, on: true }
    ]
    const rule = weighRule(items, 12 * MB)
    expect(rule.over).toBeCloseTo(3 / 12, 10)
    // Never more than the budget in the segments: the rest is the overflow's.
    expect(rule.segments.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(1, 10)
    expect(rule.segments[0].share).toBeCloseTo(4 / 12, 10)
    expect(rule.segments[1].share).toBeCloseTo(8 / 12, 10)
  })

  it('shows nothing of a line that begins past the budget, and an empty rule for nothing', () => {
    const rule = weighRule(
      [
        { kind: 'page' as const, bytes: 13 * MB, on: true },
        { kind: 'scan' as const, bytes: 2 * MB, on: true }
      ],
      12 * MB
    )
    expect(rule.segments).toEqual([{ kind: 'page', share: 1 }])
    expect(rule.over).toBeCloseTo(3 / 12, 10)
    expect(weighRule([], 12 * MB)).toEqual({ segments: [], over: 0, ticks: [0, 6 * MB, 12 * MB] })
  })
})
