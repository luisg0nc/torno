import { useStore as useZustand } from 'zustand'
import { createStore } from 'zustand/vanilla'

// The element of the builds timeline that stands for the build that failed now (its node or its group's pile in the open drawer,
// its group's chip in the bar): the error of that build stands from it (`BuildErrorSheet` in `BuildStatus`). Null when the timeline
// is not drawn (another page, the board in place of the view).

const store = createStore<{ el: HTMLElement | null }>(() => ({ el: null }))

/** The timeline says which element is the failure's (a ref's callback: the element, then null when it goes). */
export function setFailedAnchor(el: HTMLElement | null): void {
  if (store.getState().el !== el) store.setState({ el })
}

export const useFailedAnchor = (): HTMLElement | null => useZustand(store, (s) => s.el)
