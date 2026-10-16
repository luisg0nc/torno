import { lstatSync, readdirSync } from 'node:fs'
import { lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { MAX_PHOTO, readRegular } from '../objects/create'

// A picture of the person's in `<object>/reference/`, read again for the window: a resumed chat shows the pictures of
// its first prompt from their files (the log keeps only the name). Only a name of the form `create.ts` gives, only a
// plain file (no link, not through a `reference` that is one), at most `MAX_PHOTO` bytes; anything else is nothing.

/** The names `create.ts` gives the photos and doodles it copies. */
export const REFERENCE_FILE = /^reference\/(?:photo|doodle)-\d+\.(?:png|jpe?g|webp)$/

const TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }

export async function readReference(dir: string, file: string): Promise<{ mediaType: string; bytes: Uint8Array } | null> {
  if (typeof file !== 'string' || !REFERENCE_FILE.test(file)) return null
  try {
    const folder = await lstat(join(dir, 'reference'))
    if (!folder.isDirectory()) return null
    const { bytes, ext } = await readRegular(join(dir, file), MAX_PHOTO, 'reference')
    const mediaType = TYPES[ext]
    return mediaType ? { mediaType, bytes: new Uint8Array(bytes) } : null
  } catch {
    return null
  }
}

/**
 * The files of `<dir>/reference/` of the names `create.ts` gives, plain files only, photos then doodles, each by its
 * number (`photo-1.jpg`): what a new conversation is told it can read. None on any error, or when `reference` is a link.
 */
export function listReferences(dir: string): string[] {
  try {
    const folder = join(dir, 'reference')
    if (!lstatSync(folder).isDirectory()) return []
    const order = (name: string): [number, number] => [name.startsWith('photo') ? 0 : 1, Number(/-(\d+)\./.exec(name)?.[1])]
    return readdirSync(folder)
      .filter((name) => REFERENCE_FILE.test(`reference/${name}`) && lstatSync(join(folder, name)).isFile())
      .sort((a, b) => {
        const [x, y] = [order(a), order(b)]
        return x[0] - y[0] || x[1] - y[1] || a.localeCompare(b)
      })
  } catch {
    return []
  }
}
