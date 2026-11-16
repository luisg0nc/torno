import { useStore as useZustand } from 'zustand'
import { createStore } from 'zustand/vanilla'
import type { Card } from '../../shared/board'

// The pictures of a board's cards, as object URLs: each file is asked of main once and kept for as long as the project
// is open. A file main has none of is `missing` (the card says "picture not on this computer"). Nothing of it is on disk
// but what main already keeps.

export interface PictureFile {
  from: 'board' | 'reference'
  file: string
}

/** What the card shows of a file: the one of its picture, or the image of a reference. */
export function pictureOf(card: Card): PictureFile | null {
  if ((card.kind === 'picture' || card.kind === 'sketch' || card.kind === 'build') && card.picture) return { from: 'board', file: card.picture }
  if (card.kind === 'reference' && card.source && /\.(?:png|jpe?g|webp)$/i.test(card.source)) return { from: 'reference', file: card.source }
  return null
}

export const keyOf = (p: PictureFile): string => `${p.from}:${p.file}`

/** An object URL by file key; `null` for a file that is not on this computer; absent while it is being read. */
interface PictureState {
  objectId: string | null
  urls: Record<string, string | null>
}

export const pictureStore = createStore<PictureState>(() => ({ objectId: null, urls: {} }))

const asked = new Set<string>()

/** A project is open (or none): every URL of the one before is let go. */
export function resetPictures(objectId: string | null): void {
  if (pictureStore.getState().objectId === objectId) return
  for (const url of Object.values(pictureStore.getState().urls)) if (url) URL.revokeObjectURL(url)
  asked.clear()
  pictureStore.setState({ objectId, urls: {} }, true)
}

const mediaOf = (bytes: Uint8Array): string => (bytes[0] === 0x89 ? 'image/png' : 'image/jpeg')

/** Asks main for a file once; what comes is put in the store for the cards that show it. */
export function ensurePicture(objectId: string, p: PictureFile): void {
  const key = keyOf(p)
  if (asked.has(key)) return
  asked.add(key)
  const settle = (url: string | null): void => {
    const s = pictureStore.getState()
    if (s.objectId !== objectId) return void (url && URL.revokeObjectURL(url))
    pictureStore.setState({ urls: { ...s.urls, [key]: url } })
  }
  const read = p.from === 'board' ? window.torno.board.picture(objectId, p.file).then((bytes) => (bytes ? { bytes, type: mediaOf(bytes) } : null)) : window.torno.board.reference(objectId, p.file).then((r) => (r ? { bytes: r.bytes, type: r.mediaType } : null))
  read.then(
    (got) => settle(got ? URL.createObjectURL(new Blob([got.bytes as BlobPart], { type: got.type })) : null),
    () => settle(null)
  )
}

/** The state of a file for the card that shows it: its URL, `null` when it is not there, `undefined` while it is read. */
export function usePictureUrl(p: PictureFile | null): string | null | undefined {
  return useZustand(pictureStore, (s) => (p === null ? undefined : s.urls[keyOf(p)]))
}
