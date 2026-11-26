import { useStore as useZustand } from 'zustand'
import { createStore } from 'zustand/vanilla'
import { actions, store } from './store'

// Renaming a part by hand (#359): which part's name is a field, what main said when it would not, and the ask itself. Main
// writes the model (`object.renamePart`); the window only asks, and on its answer moves what it keeps by the part's name.

interface Renaming {
  /** The project and the part whose name is a field, or null. */
  objectId: string | null
  part: string | null
  /** The rename is on its way to main. */
  going: boolean
  /** Why main would not, in its words, until the field is changed or put away. */
  refused: string | null
}

const NONE: Renaming = { objectId: null, part: null, going: false, refused: null }

export const renameStore = createStore<Renaming>(() => NONE)

export const useRenaming = <T>(pick: (s: Renaming) => T): T => useZustand(renameStore, pick)

export const renameActions = {
  /** The name of `part` of the open project becomes a field. */
  start(part: string): void {
    const objectId = store.getState().objectId
    if (objectId) renameStore.setState({ objectId, part, going: false, refused: null })
  },
  /** The field is put away, with nothing asked. */
  cancel(): void {
    if (!renameStore.getState().going) renameStore.setState(NONE)
  },
  /** What is typed changed: what main said of the name before is no longer of it. */
  edited(): void {
    if (renameStore.getState().refused !== null) renameStore.setState({ refused: null })
  },
  /** Enter: main renames the part, or says why not. True when it did. */
  async apply(to: string): Promise<boolean> {
    const { objectId, part, going } = renameStore.getState()
    if (!objectId || !part || going) return false
    renameStore.setState({ going: true, refused: null })
    try {
      const result = await window.torno.object.renamePart(objectId, part, to)
      if (!result.done) {
        renameStore.setState({ going: false, refused: result.refused })
        return false
      }
      if (store.getState().objectId === objectId) actions.partRenamed(part, result.to)
      renameStore.setState(NONE)
      return true
    } catch (e) {
      renameStore.setState({ going: false, refused: e instanceof Error ? e.message : String(e) })
      return false
    }
  }
}
