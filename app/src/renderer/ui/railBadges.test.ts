import { describe, expect, it } from 'vitest'
import { badgeCount, badgeSaid, badgeText, NO_BADGES, type BadgeData } from './railBadges'

const data = (some: Partial<BadgeData>): BadgeData => ({ ...NO_BADGES, ...some })

describe('what the rail says on a section\'s icon', () => {
  it('shows a count, nothing for none, and 99+ past two figures', () => {
    expect(badgeText('needs', data({ waiting: 0 }))).toBe('')
    expect(badgeText('needs', data({ waiting: 3 }))).toBe('3')
    expect(badgeText('parts', data({ hidden: 99 }))).toBe('99')
    expect(badgeText('parts', data({ hidden: 100 }))).toBe('99+')
  })

  it('counts, for Needs you, what waits on the person, and for Checks the model\'s checks that fail plus the failing dimensions', () => {
    expect(badgeText('needs', data({ waiting: 3 }))).toBe('3')
    expect(badgeCount('checks', data({ modelFailing: 1, dimensionsFailing: 2 }))).toBe(3)
    expect(badgeText('checks', data({ modelFailing: 1, dimensionsFailing: 2 }))).toBe('3')
    expect(badgeCount('scans', data({ unaligned: 2 }))).toBe(2)
    expect(badgeCount('marks', data({ toReview: 4 }))).toBe(4)
  })

  it('has none for Parameters, Tracings and Print profile', () => {
    const all = data({ waiting: 1, hidden: 1, modelFailing: 1, dimensionsFailing: 1, unaligned: 1, toReview: 1 })
    for (const section of ['params', 'tracings', 'profile'] as const) {
      expect(badgeText(section, all)).toBe('')
      expect(badgeSaid(section, all)).toBeUndefined()
    }
  })

  it('says in words what the count counts, for the button\'s description', () => {
    expect(badgeSaid('needs', data({ waiting: 3 }))).toBe('3 waiting for you')
    expect(badgeSaid('parts', data({ hidden: 3 }))).toBe('3 hidden')
    expect(badgeSaid('checks', data({ modelFailing: 1 }))).toBe('1 check fails')
    expect(badgeSaid('checks', data({ modelFailing: 1, dimensionsFailing: 1 }))).toBe('2 checks fail')
    expect(badgeSaid('scans', data({ unaligned: 2 }))).toBe('2 unaligned')
    expect(badgeSaid('marks', data({ toReview: 4 }))).toBe('4 to review')
    expect(badgeSaid('marks', data({ toReview: 0 }))).toBeUndefined()
  })
})
