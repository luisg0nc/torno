import { describe, expect, it } from 'vitest'
import { badgeSaid, badgeText } from './railBadges'

describe('what the rail says on a closed panel\'s icon', () => {
  it('shows a count, nothing for none, and 99+ past two figures', () => {
    expect(badgeText(0)).toBe('')
    expect(badgeText(3)).toBe('3')
    expect(badgeText(99)).toBe('99')
    expect(badgeText(100)).toBe('99+')
  })

  it('says in words what the count counts, for the button\'s description', () => {
    expect(badgeSaid('layers', 3)).toBe('3 hidden')
    expect(badgeSaid('params', 1)).toBe('1 check fails')
    expect(badgeSaid('params', 2)).toBe('2 checks fail')
    expect(badgeSaid('scans', 2)).toBe('2 unaligned')
    expect(badgeSaid('marks', 4)).toBe('4 to review')
    expect(badgeSaid('marks', 0)).toBeUndefined()
    expect(badgeSaid('projects', 5)).toBeUndefined()
  })
})
