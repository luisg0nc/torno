import { describe, expect, it } from 'vitest'
import type { Mark } from '../../shared/marks'
import { groupMarks } from './markGroups'

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
})
