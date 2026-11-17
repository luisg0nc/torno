import { useStore as useZustand } from 'zustand'
import { createStore } from 'zustand/vanilla'
import { type NamedSet, makeTagText, memberRef } from '../../shared/sets'
import { describeWhole, descriptorOf } from './descriptors'
import { setsStore } from './sets'
import { onWorkspaceSet, store } from './store'

// "Make it a tag": a request to Claude, written from a named set, that goes after what the person writes in the next prompt.
// In a chat it waits as a chip in the composer (here); torno never sends it by itself and never writes the model.

/** The set whose tag Claude is asked for with the next prompt, and the project it is of. */
export interface SetTagState {
  objectId: string | null
  setId: string | null
}

export const setTagStore = createStore<SetTagState>(() => ({ objectId: null, setId: null }))

export function useSetTag<T>(select: (s: SetTagState) => T): T {
  return useZustand(setTagStore, select)
}

/** The most members whose lines (what each is) the request carries: the rest are named by ref alone. */
export const MOST_DESCRIBED = 20

/** The faces and edges of a set that the build found: what a tag can name. */
function taggable(set: Pick<NamedSet, 'members'>): string[] {
  return set.members.filter((m) => ('face' in m || 'edge' in m) && m.state !== 'lost').map(memberRef)
}

/** The parts a set's faces and edges are of, once each, in the order met. */
function spanned(set: Pick<NamedSet, 'members'>): string[] {
  return [...new Set(taggable(set).map((ref) => ref.split('/')[0]))]
}

/** Whether "Make it a tag" has anything to ask for: a person's set with a face or an edge the build found. */
export function canTag(set: Pick<NamedSet, 'members' | 'proposed'>): boolean {
  return set.proposed !== true && taggable(set).length > 0
}

/** The request for a set, with what each face or edge is as far as the window knows it (`warm` asks for what it does not). */
export function tagTextOf(set: NamedSet): string {
  const { objectId, revision } = store.getState()
  const descriptors: Record<string, string> = {}
  if (objectId) for (const ref of taggable(set).slice(0, MOST_DESCRIBED)) {
    const said = descriptorOf(objectId, revision, set.layout, ref)
    if (said) descriptors[ref] = said
  }
  return makeTagText(set, spanned(set), descriptors)
}

/** Asks the kernel what each of the first faces and edges of a set is, so that the request names them. Resolves when all answered or failed. */
export async function warm(set: NamedSet): Promise<void> {
  const { objectId, revision } = store.getState()
  if (!objectId) return
  await Promise.all(taggable(set).slice(0, MOST_DESCRIBED).map((ref) => describeWhole(objectId, revision, set.layout, ref)))
}

export const setTagActions = {
  /** The request for this set goes with the next prompt; one for another set before it is let go. */
  attach(objectId: string, setId: string): void {
    setTagStore.setState({ objectId, setId })
    const set = setsStore.getState().sets.find((s) => s.id === setId)
    if (set) void warm(set)
  },
  detach(): void {
    setTagStore.setState({ objectId: null, setId: null })
  },
  /**
   * What the prompt now sent carries after its words, and lets the chip go; null with none, or when the set is gone, was
   * proposed only, or has nothing to tag. `chip` is what `giveBack` puts back when the prompt was not sent.
   */
  take(): { chip: SetTagState; text: string } | null {
    const chip = setTagStore.getState()
    if (chip.setId === null || chip.objectId !== store.getState().objectId) return null
    const set = setsStore.getState().sets.find((s) => s.id === chip.setId)
    setTagStore.setState({ objectId: null, setId: null })
    return set && canTag(set) ? { chip, text: tagTextOf(set) } : null
  },
  giveBack(chip: SetTagState): void {
    if (setTagStore.getState().setId === null) setTagStore.setState(chip)
  }
}

// A workspace opened or left takes the request with it: its set is not in the next one.
onWorkspaceSet(() => setTagActions.detach())
