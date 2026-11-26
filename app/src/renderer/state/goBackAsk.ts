import { useStore as useZustand } from 'zustand'
import { createStore } from 'zustand/vanilla'

// What a Go back that is being asked would undo, while it asks (spec 2026-11-18, "Go back"): the builds after the one it goes back
// to and the prompts of the conversation they came from. The confirmation says it (`useGoBack`); the builds timeline and the
// conversation draw those struck through and muted. One question at a time: the one that set it is the one that lets it go.

interface Struck {
  owner: string | null
  /** The ids of the builds (`h41`) the plan undoes. */
  nodes: ReadonlySet<string>
  /** The ids of the prompts (the `user` items) the plan undoes. */
  prompts: ReadonlySet<string>
}

const NOTHING: Struck = { owner: null, nodes: new Set(), prompts: new Set() }

export const goBackAskStore = createStore<Struck>(() => NOTHING)

/** `owner` asks, and would undo these. */
export function strike(owner: string, nodes: readonly string[], prompts: readonly string[]): void {
  goBackAskStore.setState({ owner, nodes: new Set(nodes), prompts: new Set(prompts) })
}

/** `owner` is done asking; what another one struck stays. */
export function unstrike(owner: string): void {
  if (goBackAskStore.getState().owner === owner) goBackAskStore.setState(NOTHING)
}

export const useStruckNodes = (): ReadonlySet<string> => useZustand(goBackAskStore, (s) => s.nodes)
export const useStruckPrompts = (): ReadonlySet<string> => useZustand(goBackAskStore, (s) => s.prompts)
