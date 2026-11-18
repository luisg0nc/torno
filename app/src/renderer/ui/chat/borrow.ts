import { borrowLeader } from '../../state/leaders'
import { onPaneDrawn, paneRect, refInPane } from '../../viewport/overlay'
import { borrowedAt } from './borrowAt'

/** What is pointed at now: the refs and the chips that name them. */
let held: Array<{ ref: string; chip: HTMLElement }> = []
let off: (() => void) | null = null

const boxOf = (el: Element): { x: number; y: number; w: number; h: number } => {
  const r = el.getBoundingClientRect()
  return { x: r.left, y: r.top, w: r.width, h: r.height }
}

/** Borrows the one leader from the first of the refs that is on screen in the view to its chip; every chip is ringed meanwhile. */
function draw(): void {
  const pane = paneRect()
  if (!pane || held.length === 0) return borrowLeader(null)
  const at = { x: pane.left, y: pane.top, w: pane.width, h: pane.height }
  // What a leader may not cross: the text of the view (its tags and bands).
  const avoid = [...document.querySelectorAll('[data-tag], [data-tag-avoid]')].filter((el) => !(el as HTMLElement).hidden).map(boxOf)
  for (const { ref, chip } of held) {
    const p = refInPane(ref)
    const found = p && borrowedAt({ x: p.x + pane.left, y: p.y + pane.top }, boxOf(chip), at, avoid)
    if (found) return borrowLeader(found)
  }
  borrowLeader(null)
}

/**
 * The pointer (or the keys' focus) is on refs outside the view (a ref chip of the chat, the refs of an option of an ask): their
 * chips are ringed (`data-hot`) and, where one of the refs is drawn in the view and a leg to it crosses no text, the one borrowed leader
 * is drawn to it (spec 2026-11-18, "The leader rule", 3). It follows the camera while it is held.
 */
export function pointAt(targets: ReadonlyArray<{ ref: string; chip: HTMLElement }>): void {
  pointAway()
  held = [...targets]
  for (const { chip } of held) chip.dataset.hot = ''
  off = onPaneDrawn(draw)
  draw()
}

/** Lets go of the chips and of the leader. */
export function pointAway(): void {
  for (const { chip } of held) delete chip.dataset.hot
  held = []
  off?.()
  off = null
  borrowLeader(null)
}
