export type HeadKind = 'empty' | 'selection' | 'sketch' | 'review' | 'makeSet'

/** The head grows to fit, up to this share of the card's height (`.route-hand` in card.css), and scrolls inside itself beyond it. */
export const HEAD_MAX_SHARE = 0.6

/** The most the head is high, of a card `cardHeight` px high: `.route-hand` says it as 60 % (card.css), and the head scrolls inside itself beyond it. */
export function headMaxHeight(cardHeight: number): number {
  return Math.round(cardHeight * HEAD_MAX_SHARE)
}

/** How many of the picked refs the head lists; the rest are counted. */
export const SHOWN_REFS = 4

/** What the head holds: a sketch in hand, then a review round, then a set being named, then a selection, then nothing. */
export function headKind(state: { refs: number; sketchOpen: boolean; roundOpen: boolean; makingSet: boolean }): HeadKind {
  if (state.sketchOpen) return 'sketch'
  if (state.roundOpen) return 'review'
  if (state.makingSet) return 'makeSet'
  return state.refs > 0 ? 'selection' : 'empty'
}

/** How many refs are picked beyond the ones the head lists. */
export function moreRefs(refs: number): number {
  return Math.max(0, refs - SHOWN_REFS)
}

/** The line beside "In hand": `2 picked, shift-click adds`. */
export function pickedSaid(refs: number): string {
  return `${refs} picked, shift-click adds`
}
