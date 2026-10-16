import { useStore as useZustand } from 'zustand'
import { createStore } from 'zustand/vanilla'
import { MOST_REFERENCES } from '../../shared/objectName'
import { store as main } from './store'

// The draft of a new object (the page `ui/onboard/NewObject.tsx`): what the person has said and given so far. It
// lives in the window, for the workspace it was begun in, until the object is made or the draft is thrown away
// (asked about first). Nothing of it is on disk. Photos and doodles are kept as the pictures that will be
// handed to main; a doodle also as its strokes, so that it can be opened again and changed.

/** A stroke of the doodle board, in the board's own 1200 x 800 pixels. */
export interface Stroke {
  tool: 'pen' | 'eraser'
  width: number
  points: Array<[number, number]>
}

interface Item {
  /** Names it for as long as the draft lives: the list keeps its place when another is removed. */
  uid: string
  note: string
}

/** A photo: `path` is where the file is on the disk (main copies it from there); `image` is the picture for the prompt, scaled to 1280 px. */
export interface PhotoDraft extends Item {
  path: string
  file: string
  image: Uint8Array
  /** The picture as an object URL for a thumbnail; let go when the item goes. */
  url: string
  /** What is said under the file name: its size in pixels, and the size it is sent at. */
  detail?: string
}

export interface DoodleDraft extends Item {
  strokes: Stroke[]
  png: Uint8Array
  url: string
}

export interface ScanDraft extends Item {
  path: string
  file: string
  /** In bytes, when the window knows it (a dropped file); a scan chosen in the dialog is known by its path alone. */
  size?: number
}

export interface ObjectRef extends Item {
  id: string
}

export interface Draft {
  name: string
  description: string
  photos: PhotoDraft[]
  doodles: DoodleDraft[]
  scans: ScanDraft[]
  objects: ObjectRef[]
}

export type Kind = 'photos' | 'doodles' | 'scans' | 'objects'

/** A first prompt that was not sent, kept for the object until a chat can hold it. */
export interface Held {
  text: string
  reason: string
  /** The text was put in a chat's box: the reason stays to be read, the text is no longer held. */
  taken?: true
}

interface OnboardState {
  draft: Draft
  /** Where Cancel goes back to: the page the draft was begun from. */
  from: 'object' | 'objects'
  held: Record<string, Held>
}

const empty = (): Draft => ({ name: '', description: '', photos: [], doodles: [], scans: [], objects: [] })

export const onboard = createStore<OnboardState>(() => ({ draft: empty(), from: 'objects', held: {} }))

export function useOnboard<T>(selector: (s: OnboardState) => T): T {
  return useZustand(onboard, selector)
}

/** Whether the person has put anything into the draft: a close or a discard would lose it. */
export function draftHas(draft: Draft): boolean {
  return draft.name.trim() !== '' || draft.description.trim() !== '' || draft.photos.length + draft.doodles.length + draft.scans.length + draft.objects.length > 0
}

/** What Claude Code will start with, as the session pane says it while the draft is made. */
export interface DraftSummary {
  name: string | null
  described: boolean
  given: Array<[number, string]>
}

export function draftSummary(d: Draft): DraftSummary {
  const words: Array<[Kind, string, string]> = [
    ['photos', 'photo', 'photos'],
    ['doodles', 'doodle', 'doodles'],
    ['scans', 'scan', 'scans'],
    ['objects', 'object', 'objects']
  ]
  return {
    name: d.name.trim() || null,
    described: d.description.trim() !== '',
    given: words.filter(([k]) => d[k].length > 0).map(([k, one, many]): [number, string] => [d[k].length, d[k].length === 1 ? one : many])
  }
}

let counter = 0
let epoch = 0
const newKey = (): string => `r${++counter}`

const revoke = (url: string): void => {
  try {
    URL.revokeObjectURL(url)
  } catch {
    // Not a URL made here: nothing to let go.
  }
}

const change = (patch: (draft: Draft) => Draft): void => onboard.setState((s) => ({ draft: patch(s.draft) }))

export const onboarding = {
  /** Begins a draft (or goes on with the one there is) from this page. */
  begin(from: 'object' | 'objects'): void {
    onboard.setState({ from })
  },

  setName: (name: string): void => change((d) => ({ ...d, name })),
  setDescription: (description: string): void => change((d) => ({ ...d, description })),

  /** Adds photos that are ready; those beyond the most, and those already there (by path), are counted and left out. */
  addPhotos(items: Array<Omit<PhotoDraft, 'uid' | 'note'>>): { added: number; left: number; same: number } {
    const now = onboard.getState().draft.photos
    const kept: PhotoDraft[] = []
    let left = 0
    let same = 0
    for (const item of items) {
      if ([...now, ...kept].some((p) => p.path === item.path)) {
        same += 1
        revoke(item.url)
      } else if (now.length + kept.length >= MOST_REFERENCES.photos) {
        left += 1
        revoke(item.url)
      } else kept.push({ ...item, uid: newKey(), note: '' })
    }
    if (kept.length > 0) change((d) => ({ ...d, photos: [...d.photos, ...kept] }))
    return { added: kept.length, left, same }
  },

  addDoodle(item: Omit<DoodleDraft, 'uid' | 'note'>): boolean {
    if (onboard.getState().draft.doodles.length >= MOST_REFERENCES.doodles) {
      revoke(item.url)
      return false
    }
    change((d) => ({ ...d, doodles: [...d.doodles, { ...item, uid: newKey(), note: '' }] }))
    return true
  },

  /** The doodle drawn again: its note and its place stay. */
  replaceDoodle(uid: string, item: Omit<DoodleDraft, 'uid' | 'note'>): void {
    const old = onboard.getState().draft.doodles.find((d) => d.uid === uid)
    if (!old) return revoke(item.url)
    revoke(old.url)
    change((d) => ({ ...d, doodles: d.doodles.map((x) => (x.uid === uid ? { ...item, uid, note: x.note } : x)) }))
  },

  addScan(item: Omit<ScanDraft, 'uid' | 'note'>): boolean {
    const now = onboard.getState().draft.scans
    if (now.length >= MOST_REFERENCES.scans || now.some((s) => s.path === item.path)) return false
    change((d) => ({ ...d, scans: [...d.scans, { ...item, uid: newKey(), note: '' }] }))
    return true
  },

  addObject(id: string): boolean {
    const now = onboard.getState().draft.objects
    if (now.length >= MOST_REFERENCES.objects || now.some((o) => o.id === id)) return false
    change((d) => ({ ...d, objects: [...d.objects, { id, uid: newKey(), note: '' }] }))
    return true
  },

  setNote(kind: Kind, uid: string, note: string): void {
    change((d) => ({ ...d, [kind]: (d[kind] as Item[]).map((x) => (x.uid === uid ? { ...x, note } : x)) }))
  },

  remove(kind: Kind, uid: string): void {
    const gone = (onboard.getState().draft[kind] as Array<Item & { url?: string }>).find((x) => x.uid === uid)
    if (gone?.url) revoke(gone.url)
    change((d) => ({ ...d, [kind]: (d[kind] as Item[]).filter((x) => x.uid !== uid) }))
  },

  /** Counts the times the draft was thrown away: a photo that began to be read before one is not added after it. */
  epoch: (): number => epoch,

  /** How many held prompts have not been taken by a chat: they would be lost. */
  heldUnsent: (): number => Object.values(onboard.getState().held).filter((h) => h.text !== '' && !h.taken).length,

  /** Throws the draft away. */
  discard(): void {
    epoch += 1
    const d = onboard.getState().draft
    for (const item of [...d.photos, ...d.doodles]) revoke(item.url)
    onboard.setState({ draft: empty() })
  },

  /** The first prompt of an object that could not be sent, kept with the reason, for the chat to hold when it opens. */
  hold(objectId: string, held: Held): void {
    onboard.setState((s) => ({ held: { ...s.held, [objectId]: held } }))
  },
  held: (objectId: string | null): Held | undefined => (objectId === null ? undefined : onboard.getState().held[objectId]),
  /** The held prompt's text, for the box that will hold it; the reason stays (`taken`) until it is dismissed. */
  take(objectId: string | null): string {
    const held = onboarding.held(objectId)
    if (!held || objectId === null || held.taken || held.text === '') return ''
    onboard.setState((s) => ({ held: { ...s.held, [objectId]: { text: '', reason: held.reason, taken: true } } }))
    return held.text
  },
  /** The reason has been read. */
  dismiss(objectId: string): void {
    onboard.setState((s) => {
      const { [objectId]: _gone, ...rest } = s.held
      return { held: rest }
    })
  }
}

// A draft is written for a folder: once the workspace is another, it is not offered. (The window asked before it left.)
main.subscribe((s, prev) => {
  if (s.workspace?.root === prev.workspace?.root) return
  onboarding.discard()
  onboard.setState({ held: {} })
})
