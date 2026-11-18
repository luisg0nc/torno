import type { Box, Pt } from '../../shared/leader'

// The leaders in the view (spec 2026-11-18, section 1, "The leader rule"): those of the tool in hand, and the one borrowed
// by a pointer resting on a ref outside the view. Plain stores, not React state: the view sets the tool's leaders each
// time the camera moves, and `LeaderLayer` draws from the subscription.

export interface LeaderEntry {
  id: string
  /** In window pixels. */
  subject: Pt
  tag: Box
  /** Set on a borrowed leader: the pane whose edge the leg stops at. */
  clip?: Box
}

let tool: LeaderEntry[] = []
let borrowed: LeaderEntry | null = null
const listeners = new Set<(list: LeaderEntry[]) => void>()

/** The id of the borrowed leader: there is only ever one. */
export const BORROWED = 'borrowed'

/** The leaders now, the tool's first. */
export function getLeaders(): LeaderEntry[] {
  return borrowed ? [...tool, borrowed] : tool
}

function tell(): void {
  const list = getLeaders()
  for (const fn of [...listeners]) fn(list)
}

const sameBox = (a: Box, b: Box): boolean => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h
const samePt = (a: Pt, b: Pt): boolean => a.x === b.x && a.y === b.y
const same = (a: LeaderEntry, b: LeaderEntry): boolean =>
  a.id === b.id && samePt(a.subject, b.subject) && sameBox(a.tag, b.tag) && (a.clip === b.clip || (!!a.clip && !!b.clip && sameBox(a.clip, b.clip)))

/** What the tool in hand owns: all its leaders at once, each with a subject and the box of its tag. */
export function setToolLeaders(list: Array<{ id: string; subject: Pt; tag: Box }>): void {
  if (list.length === tool.length && list.every((l, i) => same(l, tool[i]))) return
  tool = list.map((l) => ({ id: l.id, subject: l.subject, tag: l.tag }))
  tell()
}

/** The one borrowed leader, or none: a ref outside the view, pointed at, with the pane its leg may not leave. */
export function borrowLeader(l: { subject: Pt; chip: Box; clip: Box } | null): void {
  const next: LeaderEntry | null = l ? { id: BORROWED, subject: l.subject, tag: l.chip, clip: l.clip } : null
  if (next === null ? borrowed === null : borrowed !== null && same(next, borrowed)) return
  borrowed = next
  tell()
}

export function subscribeLeaders(fn: (list: LeaderEntry[]) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
