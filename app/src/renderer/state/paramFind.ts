import { useStore as useZustand } from 'zustand'
import { createStore } from 'zustand/vanilla'
import { isSize, sourceOf } from '../../shared/params'
import type { Param } from '../../shared/scene'

// Finding among the model's Params: what is typed in the find box and which filter chip is on. The window's, as the
// person left them while the project is open: the Parameters tab gives its place to Parts and takes it back with both as they were.

/** The chips over the list: every field, the sizes the model's comments say are assumed, and those it says come from the brief. */
export type ParamFilter = 'all' | 'assumed' | 'brief'

export const PARAM_FILTERS: ReadonlyArray<{ id: ParamFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'assumed', label: 'Assumed' },
  { id: 'brief', label: 'Brief' }
]

export interface ParamFindState {
  query: string
  filter: ParamFilter
}

export const paramFindStore = createStore<ParamFindState>(() => ({ query: '', filter: 'all' }))
export const useParamFind = <T,>(select: (s: ParamFindState) => T): T => useZustand(paramFindStore, select)
export const paramFind = {
  setQuery: (query: string): void => paramFindStore.setState({ query }),
  setFilter: (filter: ParamFilter): void => paramFindStore.setState({ filter }),
  /** A project closed or another opened: nothing typed, every field. */
  clear: (): void => paramFindStore.setState({ query: '', filter: 'all' })
}

/** Whether a field is of the filter: only a size has a source to be assumed or from the brief. */
export function inFilter(param: Param, filter: ParamFilter): boolean {
  if (filter === 'all') return true
  return isSize(param) && sourceOf(param.doc) === filter
}

/** How many fields each chip holds, for its count. */
export function filterCounts(params: readonly Param[]): Record<ParamFilter, number> {
  return { all: params.length, assumed: params.filter((p) => inFilter(p, 'assumed')).length, brief: params.filter((p) => inFilter(p, 'brief')).length }
}

/** The fields whose name or comment holds every word typed (any case), of the chosen filter, in the model's order. */
export function findParams(params: readonly Param[], query: string, filter: ParamFilter): Param[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  return params.filter((p) => inFilter(p, filter) && words.every((w) => `${p.name} ${p.doc ?? ''}`.toLowerCase().includes(w)))
}
