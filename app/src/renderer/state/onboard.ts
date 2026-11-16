import { useStore as useZustand } from 'zustand'
import { createStore } from 'zustand/vanilla'
import type { AgentChoice } from '../../shared/chat'
import { MAX_LINK_NOTE, MAX_LINKS, linkProblem, MOST_REFERENCES } from '../../shared/objectName'
import { MAX_TEXT_CHARS } from '../../shared/board'
import { MAX_SIZES, checkSize, type SizeFact } from '../../shared/size'
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
  /** The `uid` of the photo it is drawn over (the photo is under the ink in `png`). Cleared when that photo is removed: the picture keeps it. */
  over?: string
}

export interface ScanDraft extends Item {
  path: string
  file: string
  /** In bytes, when the window knows it (a dropped file); a scan chosen in the dialog is known by its path alone. */
  size?: number
}

/** A vendor's STEP file of a bought part: `path` is where it is on the disk (main copies it from there into `reference/`). */
export interface StepDraft extends Item {
  path: string
  file: string
  /** In bytes, when the window knows it (a dropped file). */
  size?: number
}

export interface ObjectRef extends Item {
  id: string
}

/**
 * A size the person knows, as a row of the draft: the fields are those of a `SizeFact`, typed as they are (a row that is
 * not whole yet is kept, and `sizeProblem` says what is missing); `note` is `''` for none.
 */
export interface SizeDraft extends Item, Omit<SizeFact, 'note'> {}

/** A link: `http` or `https`, kept as text and never opened by the window; `note` is on one line. */
export interface LinkDraft extends Item {
  url: string
}

/** A PDF: `path` is where it is on the disk (main copies it from there into `reference/`). */
export interface PdfDraft extends Item {
  path: string
  file: string
  /** In bytes, when the window knows it (a dropped file). */
  size?: number
}

export interface Draft {
  name: string
  description: string
  photos: PhotoDraft[]
  doodles: DoodleDraft[]
  steps: StepDraft[]
  scans: ScanDraft[]
  objects: ObjectRef[]
  sizes: SizeDraft[]
  /** Free text: the printer, the material, the least wall. */
  rules: string
  links: LinkDraft[]
  pdfs: PdfDraft[]
}

export type Kind = 'photos' | 'doodles' | 'steps' | 'scans' | 'objects' | 'sizes' | 'links' | 'pdfs'

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
  /** The model and effort the next new object's session starts on: the person's, kept from one draft to the next in this window; empty for their defaults. */
  choice: AgentChoice
}

const empty = (): Draft => ({ name: '', description: '', photos: [], doodles: [], steps: [], scans: [], objects: [], sizes: [], rules: '', links: [], pdfs: [] })

export const onboard = createStore<OnboardState>(() => ({ draft: empty(), from: 'objects', held: {}, choice: {} }))

export function useOnboard<T>(selector: (s: OnboardState) => T): T {
  return useZustand(onboard, selector)
}

/** Whether the person has put anything into the draft: a close or a discard would lose it. */
export function draftHas(draft: Draft): boolean {
  return (
    draft.name.trim() !== '' ||
    draft.description.trim() !== '' ||
    draft.rules.trim() !== '' ||
    draft.photos.length + draft.doodles.length + draft.steps.length + draft.scans.length + draft.objects.length + draft.sizes.length + draft.links.length + draft.pdfs.length > 0
  )
}

/** Why a size row cannot be sent yet (what it measures, a value, its length), or null when it can. */
export function sizeProblem(size: SizeDraft): string | null {
  const checked = checkSize({ what: size.what, value: size.value, unit: size.unit, source: size.source, ...(size.note === '' ? {} : { note: size.note }) }, 'person')
  return typeof checked === 'string' ? checked : null
}

/** The size row as the fact main takes (a note only when there is one), or null when it is not whole. */
export function sizeFact(size: SizeDraft): SizeFact | null {
  const checked = checkSize({ what: size.what, value: size.value, unit: size.unit, source: size.source, ...(size.note === '' ? {} : { note: size.note }) }, 'person')
  return typeof checked === 'string' ? null : checked
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

  /** The model or effort to start on; an empty value is the person's default. A draft thrown away keeps it. */
  setChoice(choice: AgentChoice): void {
    onboard.setState({ choice: { ...(choice.model ? { model: choice.model } : {}), ...(choice.effort ? { effort: choice.effort } : {}) } })
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

  /** The doodle drawn again: its note and its place stay; what it is drawn over is the new item's. */
  replaceDoodle(uid: string, item: Omit<DoodleDraft, 'uid' | 'note'>): void {
    const old = onboard.getState().draft.doodles.find((d) => d.uid === uid)
    if (!old) return revoke(item.url)
    revoke(old.url)
    change((d) => ({ ...d, doodles: d.doodles.map((x) => (x.uid === uid ? { ...item, uid, note: x.note } : x)) }))
  },

  addStep(item: Omit<StepDraft, 'uid' | 'note'>): boolean {
    const now = onboard.getState().draft.steps
    if (now.length >= MOST_REFERENCES.steps || now.some((s) => s.path === item.path)) return false
    change((d) => ({ ...d, steps: [...d.steps, { ...item, uid: newKey(), note: '' }] }))
    return true
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

  /** Adds a row of sizes (blank unless given); the reason it was not added, or null. */
  addSize(size: Partial<Omit<SizeDraft, 'uid'>> = {}): string | null {
    if (onboard.getState().draft.sizes.length >= MAX_SIZES) return `At most ${MAX_SIZES} sizes.`
    change((d) => ({ ...d, sizes: [...d.sizes, { what: '', value: '', unit: 'mm', source: 'measured', note: '', ...size, uid: newKey() }] }))
    return null
  },

  setSize(uid: string, patch: Partial<Pick<SizeDraft, 'what' | 'value' | 'unit' | 'source' | 'note'>>): void {
    change((d) => ({ ...d, sizes: d.sizes.map((x) => (x.uid === uid ? { ...x, ...patch } : x)) }))
  },

  /** The rules, as typed; text over the most a text card holds is not kept, and the reason is given. */
  setRules(rules: string): string | null {
    if (rules.length > MAX_TEXT_CHARS) return `The rules are at most ${MAX_TEXT_CHARS} characters.`
    change((d) => ({ ...d, rules }))
    return null
  },

  /** Adds a link; the reason it was not, or null. */
  addLink(url: string, note = ''): string | null {
    const now = onboard.getState().draft.links
    if (now.length >= MAX_LINKS) return `At most ${MAX_LINKS} links.`
    const trimmed = url.trim()
    const wrong = linkProblem(trimmed)
    if (wrong !== null) return wrong
    if (now.some((l) => l.url === trimmed)) return 'That link is there already.'
    const said = note.replace(/\s+/g, ' ').trim()
    if (said.length > MAX_LINK_NOTE) return `The note of a link is at most ${MAX_LINK_NOTE} characters.`
    change((d) => ({ ...d, links: [...d.links, { url: trimmed, uid: newKey(), note: said }] }))
    return null
  },

  /** Adds a PDF by its path; the reason it was not, or null. */
  addPdf(item: Omit<PdfDraft, 'uid' | 'note'>): string | null {
    const now = onboard.getState().draft.pdfs
    if (now.length >= MOST_REFERENCES.pdfs) return `At most ${MOST_REFERENCES.pdfs} PDFs.`
    if (now.some((p) => p.path === item.path)) return `${item.file} is there already.`
    change((d) => ({ ...d, pdfs: [...d.pdfs, { ...item, uid: newKey(), note: '' }] }))
    return null
  },

  setNote(kind: Kind, uid: string, note: string): void {
    change((d) => ({ ...d, [kind]: (d[kind] as Item[]).map((x) => (x.uid === uid ? { ...x, note } : x)) }))
  },

  remove(kind: Kind, uid: string): void {
    const gone = (onboard.getState().draft[kind] as Array<Item & { url?: string }>).find((x) => x.uid === uid)
    if (gone?.url) revoke(gone.url)
    change((d) => ({
      ...d,
      [kind]: (d[kind] as Item[]).filter((x) => x.uid !== uid),
      // A doodle drawn over this photo keeps its picture, and no longer says which photo it was.
      ...(kind === 'photos' ? { doodles: d.doodles.map((x) => (x.over === uid ? { ...x, over: undefined } : x)) } : {})
    }))
  },

  /** Counts the times the draft was thrown away: a photo that began to be read before one is not added after it. */
  epoch: (): number => epoch,

  /** The objects whose held prompt has not been taken by a chat: it would be lost. */
  heldObjects: (): string[] => Object.entries(onboard.getState().held).filter(([, h]) => h.text !== '' && !h.taken).map(([objectId]) => objectId),
  /** How many held prompts have not been taken by a chat. */
  heldUnsent: (): number => onboarding.heldObjects().length,

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
