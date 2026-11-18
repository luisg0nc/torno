import { useStore as useZustand } from 'zustand'
import { createStore } from 'zustand/vanilla'

// The prompts of the conversation that show in the transcript now, by number: the chat says (it is the one that scrolls), the
// builds strip draws its bracket from them. Empty when no chat is shown.

export const inSightStore = createStore<{ prompts: number[] }>(() => ({ prompts: [] }))

/** Tells which prompts are in sight; the same list again changes nothing. */
export function setPromptsInSight(prompts: number[]): void {
  const now = inSightStore.getState().prompts
  if (now.length === prompts.length && now.every((n, i) => n === prompts[i])) return
  inSightStore.setState({ prompts })
}

export function usePromptsInSight(): number[] {
  return useZustand(inSightStore, (s) => s.prompts)
}
