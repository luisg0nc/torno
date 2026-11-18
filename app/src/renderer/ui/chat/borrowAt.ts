import { type Box, type Pt, crossesBoxes, leaderPath } from '../../../shared/leader'

const within = (p: Pt, b: Box): boolean => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h

/**
 * What a pointed ref borrows of the leader (`borrowLeader`), all in window pixels: its subject, its chip and the pane its leg may not
 * leave. Null when there is no subject on screen in the view, or when the line would run through text (`avoid`, the boxes of the
 * tags and the bands of the view): the chip is ringed all the same, and the view lights the subject.
 */
export function borrowedAt(subject: Pt | null, chip: Box, pane: Box, avoid: Box[]): { subject: Pt; chip: Box; clip: Box } | null {
  if (!subject || !within(subject, pane)) return null
  const path = leaderPath(subject, chip, pane)
  if (!path || crossesBoxes(path, avoid)) return null
  return { subject, chip, clip: pane }
}
