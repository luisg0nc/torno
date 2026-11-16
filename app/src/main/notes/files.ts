import { randomBytes } from 'node:crypto'
import { lstatSync } from 'node:fs'
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type NoteMark, NOTE_INK, NOTE_PICTURE, NOTE_REFERENCE } from '../../shared/marks'
import { writeFileAtomic } from '../atomic'
import { FOLDER, ownTorno } from '../own'
import { Refusal } from '../refusal'

// The pictures of the view notes of a project: `<project>/.torno/notes/`. Main names every file in it:
// `n-<12 hex>.png` (the plain picture of the view), `n-<12 hex>.ink.png` (the picture with the ink on it) and
// `r-<12 hex>.png|jpg` (a reference). A note names its files; marks.json never holds their bytes. The folder ignores
// itself for git: a picture of a view may show the real world.

const INSIDE = 'notes'

export type NoteFileKind = 'plain' | 'ink' | 'reference'

/**
 * Keeps a picture of a note under a name of main's own and returns the name. The picture of the view and the one with
 * the ink are PNGs; a reference is a PNG or a JPEG. The bytes are the caller's to have checked (`checkedImage`).
 * Throws a `Refusal` for a kind of picture that is not kept, or where a link stands in the folder's place.
 */
export async function writeNoteFile(dir: string, kind: NoteFileKind, bytes: Uint8Array, mediaType: string): Promise<string> {
  const stem = kind === 'reference' ? 'r' : 'n'
  let extension: string
  if (kind === 'reference') {
    if (mediaType !== 'image/png' && mediaType !== 'image/jpeg') throw new Refusal('A reference picture is a PNG or JPEG.')
    extension = mediaType === 'image/png' ? 'png' : 'jpg'
  } else {
    if (mediaType !== 'image/png') throw new Refusal('The picture of a note is a PNG.')
    extension = kind === 'ink' ? 'ink.png' : 'png'
  }
  // Before anything is made or written: a `notes` that is a link holds someone else's files.
  const folder = await ownTorno(dir, INSIDE)
  await mkdir(folder, { recursive: true })
  await writeFile(join(folder, '.gitignore'), '*\n', { flag: 'wx' }).catch((e: NodeJS.ErrnoException) => {
    if (e.code !== 'EEXIST') throw e
  })
  const name = `${stem}-${randomBytes(6).toString('hex')}.${extension}`
  await writeFileAtomic(join(folder, name), bytes)
  return name
}

const isNoteFile = (name: string): boolean => NOTE_PICTURE.test(name) || NOTE_INK.test(name) || NOTE_REFERENCE.test(name)

/** The bytes of a file of a note, or null when there is none of that name (or the name is not main's, or a link or folder stands in its place). */
export async function readNoteFile(dir: string, name: string): Promise<Buffer | null> {
  if (!isNoteFile(name)) return null
  try {
    const path = join(await ownTorno(dir, INSIDE), name)
    if (!(await lstat(path)).isFile()) return null
    return await readFile(path)
  } catch {
    return null
  }
}

/**
 * Which of a note's files are on this computer: the pictures are of the computer, and git leaves them out, so a
 * project that came from elsewhere has the note but not its picture. Nothing is made or written, and a link stands for no file.
 */
export function noteFilesExist(dir: string, mark: Pick<NoteMark, 'picture' | 'ink' | 'references'>): { picture: boolean; ink: boolean; references: boolean[] } {
  const folder = join(dir, FOLDER)
  const there = (name: string): boolean => {
    if (!isNoteFile(name)) return false
    try {
      // The folders on the way are held to the same rule: a link in the place of `.torno` or `notes` is no folder of torno's.
      return !lstatSync(folder).isSymbolicLink() && !lstatSync(join(folder, INSIDE)).isSymbolicLink() && lstatSync(join(folder, INSIDE, name)).isFile()
    } catch {
      return false
    }
  }
  return { picture: there(mark.picture), ink: there(mark.ink), references: mark.references.map((reference) => there(reference.file)) }
}
