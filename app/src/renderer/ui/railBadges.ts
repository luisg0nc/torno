import type { RailPanel } from '../state/column'

/** The text of a badge on the rail: the count, nothing for none, and `99+` for more than two figures hold. */
export function badgeText(count: number): string {
  return count <= 0 ? '' : count > 99 ? '99+' : `${count}`
}

/**
 * What a badge counts, in words (the button's description, so the count is not colour or a bare number alone): the
 * parts switched off, the model's checks that fail, the scans not aligned here, the marks the agent resolved that are
 * waiting for the person. Nothing for none, and nothing for a panel that has no badge.
 */
export function badgeSaid(panel: RailPanel, count: number): string | undefined {
  if (count <= 0) return undefined
  switch (panel) {
    case 'layers':
      return `${count} hidden`
    case 'params':
      return count === 1 ? '1 check fails' : `${count} checks fail`
    case 'scans':
      return `${count} unaligned`
    case 'marks':
      return `${count} to review`
    default:
      return undefined
  }
}
