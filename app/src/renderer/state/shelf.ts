import { useStore as useZustand } from 'zustand'
import { createStore } from 'zustand/vanilla'
import { number } from '../../shared/format'
import { isSize, sourceOf } from '../../shared/params'
import type { Param, Scene } from '../../shared/scene'
import { SHELF_DIR, type Outline, type ShelfPart } from '../../shared/shelf'
import { boardActions } from './board'
import { store } from './store'

// The parts shelf as the window has it (#351): the workspace's parts from main, and the pure rules the Shelf tab draws from: which
// parts a project used, the rule of each size, the picture of a part at the one scale.

export const shelfStore = createStore<{ parts: ShelfPart[] }>(() => ({ parts: [] }))
export const useShelf = <T,>(select: (s: { parts: ShelfPart[] }) => T): T => useZustand(shelfStore, select)

/** Reads the workspace's shelf from main and follows it; returns what stops it. A workspace left is told as an empty shelf. */
export function connectShelf(): () => void {
  let live = true
  void window.torno.shelf.list().then(
    (parts) => {
      if (live) shelfStore.setState({ parts })
    },
    () => {} // no workspace yet
  )
  const off = window.torno.shelf.onChanged((parts) => {
    live = false // the push is newer than a read that is still on its way
    shelfStore.setState({ parts })
  })
  // A part's page is closed when the part is no longer on the shelf (its folder was deleted, or the workspace left).
  const offGone = shelfStore.subscribe((s, prev) => {
    if (partGone(store.getState().shelfOpen, prev.parts, s.parts)) boardActions.closePart()
  })
  return () => {
    live = false
    off()
    offGone()
  }
}

/**
 * Whether the open part has left the shelf: it was in the list before and is not in this one, or it is not in a list that has parts (a part the
 * window kept open that is gone). A list that is empty and had not the part says nothing: the shelf may not have been read yet.
 */
export function partGone(open: string | null, before: readonly ShelfPart[], after: readonly ShelfPart[]): boolean {
  if (open === null || after.some((p) => p.id === open)) return false
  return before.some((p) => p.id === open) || after.length > 0
}

/** How sure a size is, as the rule drawn for it says: checked on the part, assumed, worked out from the others, or given a source. */
export type RuleKind = 'ck' | 'as' | 'mo' | 'so'

/**
 * The rule of each size of a part, in the part's order (a flag or a text has none): `ck` when the person checked it (an entry of
 * `.torno/checked.json`) or its comment says `measured`, else `as` for `assumed`, `mo` for `derived`, `so` for any other.
 */
export function ruleKinds(part: Pick<ShelfPart, 'params' | 'checked'>): RuleKind[] {
  return part.params.filter(isSize).map((p) => ruleKindOf(part, p))
}

/** The rule of one size of a part: the same as `ruleKinds` says of it. */
export function ruleKindOf(part: Pick<ShelfPart, 'checked'>, p: Pick<Param, 'name' | 'doc'>): RuleKind {
  const source = sourceOf(p.doc)
  if (part.checked[p.name] !== undefined || source === 'measured') return 'ck'
  if (source === 'assumed') return 'as'
  return source === 'derived' ? 'mo' : 'so'
}

/** What the rules say, for a title: `4 sizes: 2 with a source, 2 assumed, 1 checked on the part`. */
export function rulesTitle(part: Pick<ShelfPart, 'params' | 'checked'>): string {
  const kinds = ruleKinds(part)
  if (kinds.length === 0) return 'No sizes'
  const assumed = kinds.filter((k) => k === 'as').length
  const checked = kinds.filter((k) => k === 'ck').length
  return `${kinds.length} ${kinds.length === 1 ? 'size' : 'sizes'}: ${kinds.length - assumed} with a source, ${assumed} assumed, ${checked} checked on the part`
}

/** Whether a part has a size that is still assumed (one the person checked is not). */
export const hasAssumed = (part: Pick<ShelfPart, 'params' | 'checked'>): boolean => ruleKinds(part).includes('as')

/** Whether the build's scene used the part: it counted it (`scene.shelf`) or read its file (`scene.uses`). */
export function usesPart(scene: Pick<Scene, 'shelf' | 'uses'> | null | undefined, id: string): boolean {
  if (!scene) return false
  return (scene.shelf !== undefined && id in scene.shelf) || (scene.uses ?? []).includes(`${SHELF_DIR}/${id}/part.py`)
}

/** How many times the project used the part (`× 9`); null when it did not, or when that could not be counted. */
export function timesUsed(scene: Pick<Scene, 'shelf'> | null | undefined, id: string): number | null {
  const n = scene?.shelf?.[id]
  return typeof n === 'number' ? n : null
}

const byName = (a: ShelfPart, b: ShelfPart): number => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1)

/** The parts cut in two for the open project: those it used and the rest, each sorted by name. */
export function partGroups(parts: readonly ShelfPart[], scene: Pick<Scene, 'shelf' | 'uses'> | null | undefined): { here: ShelfPart[]; other: ShelfPart[] } {
  const here = parts.filter((p) => usesPart(scene, p.id)).sort(byName)
  const other = parts.filter((p) => !usesPart(scene, p.id)).sort(byName)
  return { here, other }
}

/** What a part cuts as pieces, the numbers apart from the words (`['hole Ø', '7']`), to set them in the face of numbers; [] for none. */
export function holeParts(part: Pick<ShelfPart, 'cutout'>): string[] {
  const size = part.cutout?.size
  if (!size) return []
  return 'd' in size ? ['hole Ø', number(size.d)] : ['window ', number(size.w), ' × ', number(size.h)]
}

/** The scale of every part's picture: pixels a millimetre. */
export const SHELF_SCALE = 1.25

export interface PartDrawing {
  /** Pixels. */
  width: number
  height: number
  /** The outlines as one path in pixels, y down, its holes among the subpaths (drawn with `fill-rule: evenodd`). */
  path: string
}

const px = (v: number): string => String(Math.round(v * 1000) / 1000)

const subpath = (o: Outline, at: (x: number, z: number) => string): string => `M${o.points.map(([x, z]) => at(x, z)).join('L')}Z`

/**
 * The part's side outline at `SHELF_SCALE`, the box of its body the picture's box: its lowest point at the bottom, +Z up (the
 * outline's y is Z). Null for a part that has no body (it did not build).
 */
export function drawingOf(part: Pick<ShelfPart, 'body'>): PartDrawing | null {
  const body = part.body
  if (!body || body.side.length === 0) return null
  const [x0, , z0] = body.bbox.min
  const [x1, , z1] = body.bbox.max
  const at = (x: number, z: number): string => `${px((x - x0) * SHELF_SCALE)} ${px((z1 - z) * SHELF_SCALE)}`
  return { width: (x1 - x0) * SHELF_SCALE, height: (z1 - z0) * SHELF_SCALE, path: body.side.filter((o) => o.points.length > 2).map((o) => subpath(o, at)).join('') }
}
