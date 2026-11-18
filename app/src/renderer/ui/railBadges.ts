import type { SectionId } from '../state/column'

/** What the window knows that a badge of the rail counts. */
export interface BadgeData {
  /** What waits on the person: the marks to review, those the agent left, and the checks that fail. */
  waiting: number
  /** The parts switched off in the layout shown. */
  hidden: number
  /** The model's own checks that fail. */
  modelFailing: number
  /** The person's dimension checks that fail. */
  dimensionsFailing: number
  /** The scans not aligned in the layout shown. */
  unaligned: number
  /** The marks the agent resolved that the person has not judged. */
  toReview: number
}

export const NO_BADGES: BadgeData = { waiting: 0, hidden: 0, modelFailing: 0, dimensionsFailing: 0, unaligned: 0, toReview: 0 }

/** What a section's badge counts: Parameters, Tracings and Print profile have none. */
export function badgeCount(section: SectionId, data: BadgeData): number {
  switch (section) {
    case 'needs':
      return data.waiting
    case 'parts':
      return data.hidden
    case 'checks':
      return data.modelFailing + data.dimensionsFailing
    case 'scans':
      return data.unaligned
    case 'marks':
      return data.toReview
    default:
      return 0
  }
}

/** The text of a badge on the rail: the count, nothing for none, and `99+` for more than two figures hold. */
export function badgeText(section: SectionId, data: BadgeData): string {
  const count = badgeCount(section, data)
  return count <= 0 ? '' : count > 99 ? '99+' : `${count}`
}

/**
 * What a badge counts, in words (the button's description, so the count is not colour or a bare number alone): what waits
 * on the person, the parts switched off, the checks that fail (the model's and the person's), the scans not aligned here,
 * the marks the agent resolved that are waiting for the person. Nothing for none, and nothing for a section that has no badge.
 */
export function badgeSaid(section: SectionId, data: BadgeData): string | undefined {
  const count = badgeCount(section, data)
  if (count <= 0) return undefined
  switch (section) {
    case 'needs':
      return `${count} waiting for you`
    case 'parts':
      return `${count} hidden`
    case 'checks':
      return count === 1 ? '1 check fails' : `${count} checks fail`
    case 'scans':
      return `${count} unaligned`
    case 'marks':
      return `${count} to review`
    default:
      return undefined
  }
}
