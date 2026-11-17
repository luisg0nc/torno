import type { NoteMark } from '../../shared/marks'
import { checkedImage } from '../images'
import { readNoteFile } from './files'

// The pictures of view notes as they go to the agent: the picture with the ink on it, then the references, in the
// order of the notes, scaled to what the agent is sent and no more of them than one answer may carry.

/** The most pictures one answer or one prompt carries, and the long edge each is sent at. */
export const MOST_NOTE_PICTURES = 6
export const NOTE_PICTURE_EDGE = 1280
/** Why a picture of a note that is not in the folder could not be sent, as `failed` says it. */
export const NOT_HERE = 'the picture is not on this computer'

export interface NotePicture {
  /** What it is, as the text names it: `M5` for the picture of a note, `M5 reference 2` for a reference. */
  what: string
  bytes: Uint8Array
  mediaType: 'image/png' | 'image/jpeg'
}

export interface NotePictures {
  /** The pictures to attach, in order, at most `most`. */
  sent: NotePicture[]
  /** Those that were past the cap, by what they are: named, not attached. */
  left: string[]
  /** Those that could not be sent, with why (the file is not on this computer, it is not a picture the agent may be given). */
  failed: string[]
}

/**
 * The pictures of `notes` (the one with the ink on it, then each reference) that fit within `most`, scaled down to
 * `NOTE_PICTURE_EDGE` by `scale` when one is given and checked as an image for the agent once scaled. A picture past
 * `most` is named in `left`, and one that is not on this computer or cannot be sent in `failed`; neither counts
 * toward the cap.
 */
export async function notePictures(dir: string, notes: readonly NoteMark[], scale?: (bytes: Uint8Array, edge: number) => Promise<Uint8Array>, most = MOST_NOTE_PICTURES): Promise<NotePictures> {
  const out: NotePictures = { sent: [], left: [], failed: [] }
  const wanted = notes.flatMap((note) => [{ what: note.id, file: note.ink }, ...note.references.map((reference, i) => ({ what: `${note.id} reference ${i + 1}`, file: reference.file }))])
  for (const { what, file } of wanted) {
    if (out.sent.length >= most) {
      out.left.push(what)
      continue
    }
    const bytes = await readNoteFile(dir, file)
    if (bytes === null) {
      out.failed.push(`${what}: ${NOT_HERE}`)
      continue
    }
    let scaled: Uint8Array = bytes
    try {
      if (scale) scaled = await scale(bytes, NOTE_PICTURE_EDGE)
    } catch (e) {
      out.failed.push(`${what}: ${e instanceof Error ? e.message : String(e)}`)
      continue
    }
    const image = checkedImage(scaled)
    if (!image) out.failed.push(`${what}: the picture cannot be sent: it is not a PNG or JPEG, or it is over 3.75 MB or 2000 px even scaled`)
    else out.sent.push({ what, bytes: image.bytes, mediaType: image.mediaType })
  }
  return out
}
