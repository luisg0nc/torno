import { lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from './atomic'

// `<object>/.torno/`: the one folder of a workspace torno writes into. Its name is said here and nowhere else,
// and so is the rule every write there is held to: it is a real folder inside the object. A link in its place
// (a workspace cloned or copied from elsewhere may hold one) would have torno write wherever it leads, outside
// the object; a file in its place is nothing to write into. Either is refused before anything is written, with
// a sentence the person can act on, and the window is told of it once for each folder.
//
// The folders torno keeps under it (`views`, `exports`, `scans` and each scan's own, `agent`) are held to the
// same rule by the same function: whoever writes or deletes there names the folder, and a link in its place is
// refused before anything is written or deleted, and told once.

/** The name of torno's own folder in an object's folder. */
export const FOLDER = '.torno'

/**
 * Who hears of a folder that is not torno's own: the object's folder, the refusal, and which folder under
 * `.torno` it is of (`views`, `scans/S1`); null for `.torno` itself, where nothing of the object is kept.
 */
export type NotOwnListener = (dir: string, message: string, inside: string | null) => void

/** The folders the window was told of, by their paths. */
const told = new Set<string>()
let listener: NotOwnListener | null = null

/** Who is told, once for each folder, that it is not torno's own to write into. Null for no one, and whoever is named next is told anew. */
export function onNotOwn(cb: NotOwnListener | null): void {
  listener = cb
  told.clear()
}

function refused(dir: string, path: string, inside: string | null, message: string): Error {
  if (!told.has(path)) {
    told.add(path)
    try {
      listener?.(dir, message, inside)
    } catch {
      // Whoever listens is not a reason to say something else of the folder.
    }
  }
  return new Error(message)
}

/**
 * `<dir>/.torno`, when torno may write there: it is a real folder, or not there yet (whoever writes makes it).
 * Rejects, with a plain reason, when a link or a file is in its place. Asked before every write under it.
 *
 * With names after the folder (`ownTorno(dir, 'scans', 'S1')`), the folder of that name under it, held to the
 * same at every step down: asked before every write into it and before every delete in it.
 */
export async function ownTorno(dir: string, ...inside: string[]): Promise<string> {
  let path = join(dir, FOLDER)
  for (let depth = 0; ; depth++) {
    const what = await lstat(path).catch((e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT') return null
      throw e
    })
    // Not there: nothing under it is either, and whoever writes makes real folders.
    if (what === null) return join(dir, FOLDER, ...inside)
    const name = depth === 0 ? null : inside.slice(0, depth).join('/')
    if (what.isSymbolicLink()) {
      throw refused(
        dir,
        path,
        name,
        name === null
          ? `${path} is a link, not a folder of torno's own inside the project: torno writes nothing there. Put a real folder in its place.`
          : `${path} is a link, not a folder of torno's own inside the project: torno writes nothing there and deletes nothing through it. Take the link away.`
      )
    }
    if (!what.isDirectory()) throw refused(dir, path, name, `${path} is a file, not a folder: torno writes nothing there. Remove it.`)
    if (depth === inside.length) return path
    path = join(path, inside[depth])
  }
}

/** The last `writeOwn` of each file: the folder check is awaited before `writeFileAtomic` has the path, so the line is kept here, taken before any await. */
const saves = new Map<string, Promise<void>>()

/**
 * Writes `<dir>/.torno/<name>` whole or not at all (`writeFileAtomic`), once the folder is known to be torno's own.
 * Writes of one file land in the order `writeOwn` was called, however long each folder check takes.
 */
export function writeOwn(dir: string, name: string, data: string | Uint8Array): Promise<void> {
  const key = join(dir, FOLDER, name)
  const save = (saves.get(key) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => writeFileAtomic(join(await ownTorno(dir), name), data))
    .finally(() => {
      if (saves.get(key) === save) saves.delete(key)
    })
  saves.set(key, save)
  return save
}
