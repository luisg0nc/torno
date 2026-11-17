import { createHash, randomBytes } from 'node:crypto'
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from '../atomic'
import { checkedImage } from '../images'
import { ownTorno } from '../own'
import { Refusal } from '../refusal'
import { PHOTOS_FOLDER, isPhotoName } from './dropped'

// The photos of the tracings of a project: `<project>/.torno/tracings/photos/`. Main names every file in it, `p-<12 hex>.jpg|png`
// (the photo as the person kept it) and `s-<12 hex>.jpg|png` (the copy straightened through the line-up). A tracing names its
// files; `tracings.json` never holds their bytes. A photo may show the real world, so the folder ignores itself for git, and the
// photos are swept only through its `dropped.json` (`dropped.ts`, `sweep.ts`).

/** The long edge of a photo that is kept, and its size: the person's own picture, which Claude is not sent (it sees the tracing's picture). */
export const MAX_PHOTO_EDGE = 4000
export const MAX_PHOTO_BYTES = 25_000_000

export interface KeptPhoto {
  mediaType: 'image/png' | 'image/jpeg'
  width: number
  height: number
  bytes: Uint8Array
}

/**
 * A PNG or a JPEG of at most 25 MB whose long edge is at most 4000 px, read from its own header; null for anything else (a
 * WebP, a picture with no size, one that is too big, bytes that are not bytes). Nothing is decoded.
 */
export const checkedPhoto = (bytes: unknown): KeptPhoto | null => checkedImage(bytes, { edge: MAX_PHOTO_EDGE, bytes: MAX_PHOTO_BYTES })

export const sha256Of = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

/**
 * Keeps a photo (`p`) or a straightened copy (`s`) under a name of main's own, and returns the name with what is known of the
 * bytes. The bytes are checked here (`checkedPhoto`). Throws a `Refusal` for anything else, or where a link stands in the
 * folder's place; the folder and its `.gitignore` of `*` are made by whoever first writes into it.
 */
export async function savePhoto(dir: string, bytes: unknown, stem: 'p' | 's' = 'p'): Promise<{ file: string; sha256: string; width: number; height: number }> {
  const image = checkedPhoto(bytes)
  if (!image) throw new Refusal('That is not a picture torno can keep: it takes a PNG or JPEG of at most 25 MB and 4000 px.')
  // Before anything is made or written: a `photos` that is a link holds someone else's files.
  const folder = await ownTorno(dir, ...PHOTOS_FOLDER)
  await mkdir(folder, { recursive: true })
  await writeFile(join(folder, '.gitignore'), '*\n', { flag: 'wx' }).catch((e: NodeJS.ErrnoException) => {
    if (e.code !== 'EEXIST') throw e
  })
  const file = `${stem}-${randomBytes(6).toString('hex')}.${image.mediaType === 'image/png' ? 'png' : 'jpg'}`
  await writeFileAtomic(join(folder, file), image.bytes)
  return { file, sha256: sha256Of(image.bytes), width: image.width, height: image.height }
}

/** The bytes of a photo or a straightened copy, or null when there is none of that name (or the name is not main's, or a link or folder stands in its place). */
export async function readPhoto(dir: string, name: string): Promise<Uint8Array | null> {
  if (!isPhotoName(name)) return null
  try {
    const path = join(await ownTorno(dir, ...PHOTOS_FOLDER), name)
    if (!(await lstat(path)).isFile()) return null
    return new Uint8Array(await readFile(path))
  } catch {
    return null
  }
}

/**
 * Whether a tracing's photo is on this computer: its file is in the photos folder and is the file the tracing names (its hash), which
 * is what `tracings:photoBytes` serves. What the agent is told of the photo is this check, never an assumption.
 */
export async function photoHere(dir: string, photo: { file: string; sha256: string }): Promise<boolean> {
  const bytes = await readPhoto(dir, photo.file)
  return bytes !== null && sha256Of(bytes) === photo.sha256
}
