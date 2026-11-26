import { useStore as useZustand } from 'zustand'
import { createStore } from 'zustand/vanilla'
import { number } from '../../shared/format'
import { isSize } from '../../shared/params'
import type { Scene } from '../../shared/scene'
import type { ShelfPart } from '../../shared/shelf'
import { hasAssumed, usesPart } from './shelf'

// Finding on the Shelf tab: what is typed in the find box and which chip is on. The window's, as the person left them, like the
// Parameters tab's (`state/paramFind.ts`).

/** The chips: every part, those the open project used, those with a size that is still assumed. */
export type ShelfFilter = 'all' | 'here' | 'assumed'

export const SHELF_FILTERS: ReadonlyArray<{ id: ShelfFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'here', label: 'In this project' },
  { id: 'assumed', label: 'Assumed sizes' }
]

export interface ShelfFindState {
  query: string
  filter: ShelfFilter
}

export const shelfFindStore = createStore<ShelfFindState>(() => ({ query: '', filter: 'all' }))
export const useShelfFind = <T,>(select: (s: ShelfFindState) => T): T => useZustand(shelfFindStore, select)
export const shelfFind = {
  setQuery: (query: string): void => shelfFindStore.setState({ query }),
  setFilter: (filter: ShelfFilter): void => shelfFindStore.setState({ filter }),
  clear: (): void => shelfFindStore.setState({ query: '', filter: 'all' })
}

type Used = Pick<Scene, 'shelf' | 'uses'> | null | undefined

function inFilter(part: ShelfPart, scene: Used, filter: ShelfFilter): boolean {
  if (filter === 'all') return true
  return filter === 'here' ? usesPart(scene, part.id) : hasAssumed(part)
}

/** What a find looks in: the id, the name, what it is, and the value of each size as written and as shown. */
function haystack(part: ShelfPart): string {
  const values = part.params.filter(isSize).flatMap((p) => [String(p.default), number(p.default as number)])
  return [part.id, part.name, part.what, ...values].join(' ').toLowerCase()
}

/** The parts of the chosen filter whose id, name, what or a size's value holds every word typed (any case), in the shelf's order. */
export function findShelf(parts: readonly ShelfPart[], scene: Used, query: string, filter: ShelfFilter): ShelfPart[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  return parts.filter((p) => inFilter(p, scene, filter) && (words.length === 0 || words.every((w) => haystack(p).includes(w))))
}

/** How many parts each chip holds. */
export function shelfCounts(parts: readonly ShelfPart[], scene: Used): Record<ShelfFilter, number> {
  return { all: parts.length, here: parts.filter((p) => inFilter(p, scene, 'here')).length, assumed: parts.filter((p) => inFilter(p, scene, 'assumed')).length }
}
