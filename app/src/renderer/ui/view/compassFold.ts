import type { SavedView } from '../../../shared/views'
import type { ToolName } from '../../state/tools'

// What the compass at the top right of the view decides, apart from drawing it: whether the saved views stand as a stack,
// fold to one pill, or are put away; which of them are the stack; and how far down the stack would reach.

/** What the saved views of the compass do: stand one under the other, fold to the one pill "Saved views 5", or are not there. */
export type Fold = 'stack' | 'pill' | 'none'

/**
 * Whether the saved views stand as a stack, as one pill, or not at all. Not at all while Align or Region is in hand
 * (their card stands in that corner's neighbourhood); a pill while a tool with tags is in hand, while explode is open,
 * or where the stack, drawn out, would reach a tag; the stack otherwise. `stackBottom` is where the stack would end, in
 * px from the top of the view, and `topTag` the top of the tag nearest the compass, or null with none.
 */
export function foldSavedViews(s: { toolHasTags: boolean; explodeOpen: boolean; procedure: boolean; stackBottom: number; topTag: number | null }): Fold {
  if (s.procedure) return 'none'
  if (s.toolHasTags || s.explodeOpen) return 'pill'
  if (s.topTag !== null && s.stackBottom >= s.topTag) return 'pill'
  return 'stack'
}

/**
 * The tools that put a tag in the view (spec 2026-11-18, section 2): Section's plane, Measure's reading, and the sketch's
 * plane under Draw. Few tools have their tags yet (tasks 22 to 24 bring them); the compass folds for these now, so that it
 * is already out of the way when they do. Explode is not a tool: its tag is told by `explodeOpen`.
 */
const TAG_TOOLS: readonly ToolName[] = ['section', 'measure', 'draw']
/** The tools whose card is a procedure card at the bottom right: Align and Region. */
const PROCEDURE_TOOLS: readonly ToolName[] = ['align', 'region']

export const hasTags = (tool: ToolName): boolean => TAG_TOOLS.includes(tool)
export const hasProcedure = (tool: ToolName): boolean => PROCEDURE_TOOLS.includes(tool)

/**
 * The saved views the stack shows: the one that is on and the first proposal of the agent's (neither twice), in the
 * order they were saved; and how many there are besides, which "N more" opens as a list.
 */
export function compassViews(views: readonly SavedView[], active: string | null): { shown: SavedView[]; more: number } {
  const on = views.find((view) => view.name === active)
  const proposal = views.find((view) => view.proposed && view !== on)
  const chosen = new Set([on, proposal].filter((view): view is SavedView => view !== undefined))
  return { shown: views.filter((view) => chosen.has(view)), more: views.length - chosen.size }
}

/** The compass's measures, in px: from the top of the view, as `compass.css` has them. */
const TOP = 14
const TILE_H = 112
const GAP = 7
const ROW = 28
/** A saved view's pill, and the gap between two. */
const PILL = 26
const PILL_GAP = 4

/** Where the bottom of the stack of saved views is, in px from the top of the view, with this many pills in it (the "+ Save view" pill is one). */
export function stackBottomOf(pills: number): number {
  return TOP + TILE_H + 2 * (GAP + ROW) + GAP + pills * PILL + (pills - 1) * PILL_GAP
}
