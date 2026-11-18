import { describe, expect, it } from 'vitest'
import type { Mark } from '../../shared/marks'
import { groupMarks, splitMarkGroups } from './markGroups'

const mark = (id: string, status: Mark['status'], extra: Partial<Mark> = {}): Mark =>
  ({ id, kind: 'pin', author: 'user', status, note: '', layout: 'default', anchorState: 'ok', ...extra }) as Mark
const ids = (marks: readonly Mark[]) => marks.map((m) => m.id)

describe('groupMarks', () => {
  it('groups marks by what is to be done with them', () => {
    const g = groupMarks([
      mark('M1', 'draft'),
      mark('M2', 'sent'),
      mark('M3', 'resolved', { resolvedBy: 'agent' }),
      mark('M4', 'resolved', { resolvedBy: 'agent', acknowledged: true }),
      mark('M5', 'resolved', { resolvedBy: 'user' })
    ])
    expect(ids(g.toSend)).toEqual(['M1'])
    expect(ids(g.withAgent)).toEqual(['M2'])
    expect(ids(g.toReview)).toEqual(['M3'])
    expect(ids(g.resolved)).toEqual(['M4', 'M5'])
  })

  it("puts the agent's open marks in their own group, and its resolved ones with the rest", () => {
    const g = groupMarks([
      mark('M1', 'sent'),
      mark('M2', 'sent', { author: 'agent' }),
      mark('M3', 'resolved', { author: 'agent', resolvedBy: 'user' }),
      mark('M4', 'draft', { author: 'agent' })
    ])
    expect(ids(g.fromAgent)).toEqual(['M2'])
    expect(ids(g.withAgent)).toEqual(['M1'])
    expect(ids(g.resolved)).toEqual(['M3'])
    expect(ids(g.toSend)).toEqual(['M4'])
  })

  const check = (id: string, extra: Partial<Mark> = {}): Mark =>
    mark(id, 'sent', { kind: 'dimension', measure: 'distance', value: 40, expected: 40, verdict: 'pass', measuredRevision: 5, ...extra } as Partial<Mark>)

  it('puts the dimensions that have something expected in Checks: failing first, then not measured, then passing, whatever their status', () => {
    const g = groupMarks(
      [
        check('M1'),
        check('M2', { verdict: 'fail', value: 38 } as Partial<Mark>),
        check('M3', { status: 'draft' }),
        check('M4', { measuredRevision: 4 } as Partial<Mark>),
        check('M5', { verdict: 'fail', value: 38 } as Partial<Mark>),
        check('M6', { status: 'resolved' }),
        check('M7', { expected: undefined, verdict: undefined } as Partial<Mark>),
        mark('M8', 'draft')
      ],
      5
    )
    expect(ids(g.checks)).toEqual(['M2', 'M5', 'M4', 'M1', 'M3'])
    expect(ids(g.withAgent)).toEqual(['M7'])
    expect(ids(g.toSend)).toEqual(['M8'])
    expect(ids(g.resolved)).toEqual(['M6'])
  })
})

describe('splitMarkGroups', () => {
  const dimension = (id: string, extra: Partial<Mark> = {}): Mark =>
    mark(id, 'sent', { kind: 'dimension', measure: 'distance', value: 40, expected: 40, verdict: 'pass', measuredRevision: 5, ...extra } as Partial<Mark>)

  const fixture = (): Mark[] => [
    mark('M1', 'draft'),
    mark('M2', 'sent'),
    mark('M3', 'sent', { author: 'agent' }),
    mark('M4', 'resolved', { resolvedBy: 'agent' }),
    mark('M5', 'resolved', { resolvedBy: 'user' }),
    dimension('M6', { verdict: 'fail', value: 38 } as Partial<Mark>),
    dimension('M7'),
    dimension('M8', { measuredRevision: 4 } as Partial<Mark>)
  ]

  it('puts what waits on the person in Needs you and what is theirs to send or the agent\'s to do in Marks', () => {
    const split = splitMarkGroups(groupMarks(fixture(), 5))
    expect(ids(split.needs.toReview)).toEqual(['M4'])
    expect(ids(split.needs.fromAgent)).toEqual(['M3'])
    expect(ids(split.marks.toSend)).toEqual(['M1'])
    expect(ids(split.marks.withAgent)).toEqual(['M2'])
    expect(ids(split.marks.resolved)).toEqual(['M5'])
  })

  it('holds only the dimensions that fail in Needs you: the rest of the checks are Checks\'', () => {
    const split = splitMarkGroups(groupMarks(fixture(), 5))
    expect(ids(split.needs.failingChecks)).toEqual(['M6'])
    // Each mark is in one place only: no check is among the marks of Marks.
    const all = [...split.needs.toReview, ...split.needs.fromAgent, ...split.needs.failingChecks, ...split.marks.toSend, ...split.marks.withAgent, ...split.marks.resolved]
    expect(new Set(ids(all)).size).toBe(all.length)
  })

  it('does not count a check that fails on an older build', () => {
    const split = splitMarkGroups(groupMarks([dimension('M1', { verdict: 'fail', value: 38, measuredRevision: 4 } as Partial<Mark>)], 5))
    expect(split.needs.failingChecks).toEqual([])
  })
})
