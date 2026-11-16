import { randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BOARD_PICTURE_EDGE, PICTURE_NAME } from '../../shared/board'
import type { BoardStore } from './store'
import type { BoardPicture } from './text'
import { checkedImage } from '../images'
import { listReferences, readReference } from '../sessions/reference'
import { FOLDER, ownTorno } from '../own'
import { writeFileAtomic } from '../atomic'
import { Refusal } from '../refusal'

// The picture and sketch files of a board: `<project>/.torno/board/pictures/p-<12 hex>.png|jpg`. A card names its
// file; a file no card names is swept when the project is opened (so that undo brings a removed card back whole).
// A picture may show the real world, so the folder ignores itself for git.

const INSIDE = ['board', 'pictures'] as const

/**
 * Keeps a picture the person gave (a PNG or a JPEG within the size `checkedImage` takes) and returns the name
 * it was kept under. Throws a `Refusal` for anything else.
 */
export async function savePicture(dir: string, bytes: Uint8Array): Promise<string> {
  const image = checkedImage(bytes)
  if (!image) throw new Refusal('That is not a picture torno can keep: it takes a PNG or JPEG of at most 3.75 MB and 2000 px.')
  // Before anything is made or written: a `pictures` that is a link holds someone else's files.
  const folder = await ownTorno(dir, ...INSIDE)
  await mkdir(folder, { recursive: true })
  await writeFile(join(folder, '.gitignore'), '*\n', { flag: 'wx' }).catch((e: NodeJS.ErrnoException) => {
    if (e.code !== 'EEXIST') throw e
  })
  const name = `p-${randomBytes(6).toString('hex')}.${image.mediaType === 'image/png' ? 'png' : 'jpg'}`
  await writeFileAtomic(join(folder, name), image.bytes)
  return name
}

/** The bytes of a picture of the board, or null when there is none of that name (or the name is not a picture's, or a link stands in its place). */
export async function readPicture(dir: string, name: string): Promise<Uint8Array | null> {
  if (!PICTURE_NAME.test(name)) return null
  try {
    const path = join(await ownTorno(dir, ...INSIDE), name)
    if (!(await lstat(path)).isFile()) return null
    return new Uint8Array(await readFile(path))
  } catch {
    return null
  }
}

/**
 * Removes the pictures no card names (`kept`): only files with a picture's name, never the folder's `.gitignore` nor
 * anything the person put there, and none made in the last `grace` ms (a picture kept just now has no card yet).
 */
export async function sweepPictures(dir: string, kept: ReadonlySet<string>, grace = 0): Promise<void> {
  const folder = join(dir, FOLDER, ...INSIDE)
  const names = await readdir(folder).catch((e: NodeJS.ErrnoException) => {
    if (e.code === 'ENOENT') return null
    throw e
  })
  if (names === null) return
  await ownTorno(dir, ...INSIDE)
  const now = Date.now()
  for (const name of names) {
    if (!PICTURE_NAME.test(name) || kept.has(name)) continue
    const made = grace > 0 ? await lstat(join(folder, name)).then((s) => s.mtimeMs, () => 0) : 0
    if (now - made >= grace) await rm(join(folder, name), { force: true })
  }
}

/** How long a picture file is left alone, as made: a person's picture is kept before the card that names it is made. */
const GRACE_MS = 60_000

/** The most of a file kept aside that is read for the pictures it names. */
const ASIDE_READ = 8_000_000

/** The files `board.json` was copied to when it could not be read, or had cards left out (`board.json.corrupt-<time>`, `board.json.dropped-<time>`). */
const ASIDE = /^board\.json\.(?:corrupt|dropped)-/

/**
 * The pictures named anywhere in the files kept aside beside `board.json`: they are the person's pictures, git ignores
 * them, and the file kept aside is the one place that still says which they are, so the sweep must not take them even
 * when the board that was started afresh has none. Read as text, capped, and never through a link.
 */
export async function namedAside(dir: string): Promise<Set<string>> {
  const folder = join(dir, FOLDER, 'board')
  const names = await readdir(folder).catch(() => [] as string[])
  const found = new Set<string>()
  for (const name of names.filter((n) => ASIDE.test(n))) {
    try {
      const path = join(folder, name)
      if (!(await lstat(path)).isFile()) continue
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
      try {
        const buffer = Buffer.alloc(ASIDE_READ)
        const { bytesRead } = await handle.read(buffer, 0, ASIDE_READ, 0)
        for (const match of buffer.toString('utf8', 0, bytesRead).matchAll(/p-[0-9a-f]{12}\.(?:png|jpg)/g)) found.add(match[0])
      } finally {
        await handle.close()
      }
    } catch {
      // A file that cannot be read names nothing.
    }
  }
  return found
}

/**
 * The sweep of the pictures no card names, made once for each project in a run, when it is first opened: before the
 * window has anything of it to undo, so that no undo points at a file that is gone (the window forgets its undo when the
 * workspace changes, and so does this, `forget`). It is made in the turn of the board, and what was taken off the board in
 * this run counts as named. A picture a file kept aside names is never swept (`namedAside`), and a board that could not be
 * read whole is not swept at all that run.
 */
export class PictureSweep {
  private done = new Set<string>()

  constructor(
    private board: Pick<BoardStore, 'withPictures'>,
    private grace = GRACE_MS
  ) {}

  /** Never rejects: a project is no less open for a sweep that failed. */
  async once(objectId: string, dir: string): Promise<void> {
    if (this.done.has(dir)) return
    this.done.add(dir)
    try {
      await this.board.withPictures(objectId, async (named, _dir, problem) => {
        if (problem !== null) return
        for (const name of await namedAside(dir)) named.add(name)
        await sweepPictures(dir, named, this.grace)
      })
    } catch (e) {
      console.error(`cannot sweep the pictures of the board of ${objectId}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  forget(): void {
    this.done.clear()
  }
}

/**
 * What a picture of a card goes as to the agent: its bytes read (a file of `pictures/`, or a photo of `reference/`),
 * scaled to the edge a board picture is sent at, and checked as an image once scaled (a PNG or JPEG of at most 3.75 MB
 * and 2000 px). A string says why it is not sent: the card is named instead.
 */
export async function pictureToSend(dir: string, picture: BoardPicture, scale?: (bytes: Uint8Array, edge: number) => Promise<Uint8Array>): Promise<{ bytes: Uint8Array; mediaType: 'image/png' | 'image/jpeg' } | string> {
  const read = picture.reference === true ? await readReference(dir, picture.file) : await readPicture(dir, picture.file).then((bytes) => (bytes === null ? null : { bytes, mediaType: mediaOf(bytes) }))
  if (read === null) return 'the picture is not on this computer'
  let sent: Uint8Array
  try {
    sent = scale ? await scale(read.bytes, BOARD_PICTURE_EDGE) : read.bytes
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
  const image = checkedImage(sent)
  return image ? { bytes: image.bytes, mediaType: image.mediaType } : 'the picture cannot be sent: it is not a PNG or JPEG, or it is over 3.75 MB or 2000 px even scaled'
}

/** Whether a file a card shows is on this computer: a file of `pictures/`, or a photo of `reference/` (`reference/photo-1.jpg`). */
export async function filesOf(dir: string): Promise<(file: string) => boolean> {
  const [pictures, references] = await Promise.all([pictureFiles(dir), Promise.resolve(new Set(listReferences(dir).map((name) => `reference/${name}`)))])
  return (file) => pictures.has(file) || references.has(file)
}

/** The names of the files in a project's `pictures/`: none when there is no folder. The files themselves are not looked at. */
export async function pictureFiles(dir: string): Promise<Set<string>> {
  return new Set(await readdir(join(dir, FOLDER, ...INSIDE)).catch(() => [] as string[]))
}

/** The media type of a picture of the board, from its first bytes: it is a PNG or a JPEG. */
export const mediaOf = (bytes: Uint8Array): 'image/png' | 'image/jpeg' => (bytes[0] === 0x89 && bytes[1] === 0x50 ? 'image/png' : 'image/jpeg')
