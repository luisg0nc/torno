import { type BoardCounts, type BoardSent, sentLine } from '../../../shared/board'

/** What the board line of a prompt said, for the line under it: "brief: 12 cards, 2 new". Null for a board with nothing on it. */
export function boardCountsSaid(counts: BoardCounts): string | null {
  if (counts.total === 0) return null
  return `brief: ${counts.total} card${counts.total === 1 ? '' : 's'}${counts.new > 0 ? `, ${counts.new} new` : ''}`
}

/** What went with the prompt of the brief, for the line under it: "brief: Latch, 3 cards, 1 arrow", and what was gone by the time it was sent. */
export function boardSentSaid(sent: BoardSent): string {
  const gone = sent.gone && sent.gone.length > 0 ? ` (${sent.gone.join(', ')} ${sent.gone.length === 1 ? 'was' : 'were'} removed before it was sent)` : ''
  return `brief: ${sentLine(sent)}${gone}`
}
