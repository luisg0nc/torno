import { MOST_NOTE_REFERENCES, type NoteMark } from '../../../shared/marks'
import type { NoteReferenceDraft } from '../../../shared/bridge'

// The reference pictures a person gives a view note, as its sheet holds them: those the note already has (kept by their
// index, their comments as they are) and those added in the sheet (scaled to 1280 px, with a comment of their own).

/** The longest comment of a note and of a reference, in the sheet: one line. */
export const MAX_NOTE_COMMENT = 300

export interface RefItem {
  /** What the list is keyed by. */
  uid: number
  comment: string
  /** The index of the reference of the note this is; null for one added in the sheet. */
  old: number | null
  /** The picture of one added in the sheet; null for one of the note's, which main keeps. */
  image: { bytes: Uint8Array; mediaType: 'image/png' | 'image/jpeg' } | null
  /** Where the picture is shown from, once it is (an object URL the sheet lets go of). */
  url: string | null
}

/** One line: what a person typed with a line break in it is folded. */
export const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim()

/** The references a note has, as the sheet opens with them. */
export function itemsOf(note: NoteMark | null): RefItem[] {
  return (note?.references ?? []).map((r, i) => ({ uid: -1 - i, comment: r.comment, old: i, image: null, url: null }))
}

/** How many more pictures may be added to a note that holds `have`. */
export const addable = (have: number): number => Math.max(0, MOST_NOTE_REFERENCES - have)

const draftOf = (item: RefItem): NoteReferenceDraft => ({ bytes: item.image!.bytes, mediaType: item.image!.mediaType, comment: oneLine(item.comment) })

/** The pictures of a new note. */
export function referenceDrafts(items: readonly RefItem[]): NoteReferenceDraft[] {
  return items.filter((i) => i.image !== null).map(draftOf)
}

/**
 * What the sheet changes of the references of a note being edited (`notes.edit`): which of its own stay, when one was
 * taken away or one is added, and the pictures added. Empty when nothing changed.
 */
export function referenceChange(items: readonly RefItem[], note: NoteMark): { keepReferences?: number[]; addReferences?: NoteReferenceDraft[] } {
  const kept = items.filter((i) => i.old !== null).map((i) => i.old!)
  const added = items.filter((i) => i.image !== null)
  if (kept.length === note.references.length && added.length === 0) return {}
  return { keepReferences: kept, ...(added.length > 0 ? { addReferences: added.map(draftOf) } : {}) }
}
