import { drawable, type HistoryEntry } from '../../../shared/history'
import type { StripNode } from './strip'

// What a click on a node of the builds strip offers (spec 2026-11-18, section 2), pure: which acts the menu holds, in its order,
// and the prompt that Go back would be to before. `NodePopover` draws and does them.

/** One thing the menu of a node does. */
export type NodeAct = 'compare' | 'star' | 'unstar' | 'pin' | 'review' | 'goback'

/** The words of each act in the menu. */
export const NODE_ACT_WORDS: Record<NodeAct, string> = {
  compare: 'Compare with live',
  star: 'Star',
  unstar: 'Unstar',
  pin: 'Pin to board',
  review: 'Review this build',
  goback: 'Go back to here'
}

/**
 * The acts of the node's menu, in order. A build that failed has none: its menu is its error. Nothing to compare the build on
 * show with; `review` only where the caller says a round can start (it is of the build on show); `goback` only where the
 * prompt that came after the build is named (`goBackTarget`).
 */
export function nodeMenu(node: StripNode, s: { canReview: boolean; goBackTo: string | null }): NodeAct[] {
  if (node.kind !== 'built') return []
  const acts: NodeAct[] = []
  if (!node.onShow) acts.push('compare')
  acts.push(node.starred ? 'unstar' : 'star', 'pin')
  if (s.canReview) acts.push('review')
  if (s.goBackTo !== null) acts.push('goback')
  return acts
}

/**
 * The prompt a Go back from the build `id` is to before, by its id: the first prompt of the history after that build, with
 * only builds that failed between them (main goes back to "the newest build that drew before the prompt's first", `entryBefore`,
 * which is `id` then). A save of the person's after it, or no build after it, is no prompt: null. So is a prompt whose builds
 * are all undone already.
 */
export function goBackTarget(entries: readonly HistoryEntry[], id: string): string | null {
  const at = entries.findIndex((e) => e.id === id)
  if (at < 0) return null
  for (const e of entries.slice(at + 1)) {
    if (e.turn) {
      const prompt = e.turn.prompt
      return entries.filter((x) => x.turn?.prompt === prompt).every((x) => x.undone) ? null : prompt
    }
    if (drawable(e)) return null
  }
  return null
}
