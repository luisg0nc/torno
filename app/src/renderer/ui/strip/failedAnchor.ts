import { useStore as useZustand } from 'zustand'
import { createStore } from 'zustand/vanilla'

// The element of the builds strip that stands for the build that failed now (its node, or its tick when the strip is folded): the
// error of that build stands from it (`BuildErrorSheet` in `BuildStatus`). Null when the strip is not drawn (the dock is put away).

const store = createStore<{ el: HTMLElement | null }>(() => ({ el: null }))

/** The strip says which element is the failure's (a ref's callback: the element, then null when it goes). */
export function setFailedAnchor(el: HTMLElement | null): void {
  if (store.getState().el !== el) store.setState({ el })
}

export const useFailedAnchor = (): HTMLElement | null => useZustand(store, (s) => s.el)
