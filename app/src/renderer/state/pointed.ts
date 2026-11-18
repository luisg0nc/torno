import { createStore } from 'zustand/vanilla'

/**
 * The part the pointer is on in the view, as the Select tool finds it (the part of the face or edge under the pointer, whatever the
 * scope). The route card reads it to light the rows of that part (`ui/card/useLit.ts`). Nothing of it is kept, and it is no highlight:
 * the view lights what is under the pointer itself.
 */
export const pointedStore = createStore<{ part: string | null }>(() => ({ part: null }))

/** The pointer is on `part` in the view; null for none. */
export function pointPart(part: string | null): void {
  if (pointedStore.getState().part !== part) pointedStore.setState({ part })
}
