import { randomBytes } from 'node:crypto'
import { link, lstat, mkdir, open, readdir, rename, rm, rmdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { isPartId, MAX_SHELF_FILES, SHELF_DIR, SHELF_FILE_ENDINGS, shelfFileCap, shelfFileKind, shelfFileName, type ShelfAddResult } from '../../shared/shelf'
import { openRegular } from '../objects/create'

// Adding a part by hand (#355): the files a person dropped on the Shelf tab are copied into `common/parts/<id>/` when they send the request
// that names them. This is the fifth exception of `workspace-writes`: the folders `common/`, `common/parts/` and `common/parts/<id>/` when
// missing, and each file whole or not at all, never over a file of that name (any case), never through a link. Nothing else is written: no
// `part.py` (Claude writes that, after asking) and no `.torno`. What the window sends is checked again here.

/** For tests: called when the folders are made, before the first file is copied. */
export interface AddHooks {
  afterFolders?: () => void | Promise<void>
}

const MB = 1024 * 1024
const CHUNK = MB
/** Why a file of no kind the shelf takes is not taken. */
const KINDS = 'a PDF, a picture (png, jpg, webp) or a STEP file'

/** The folders of the way to a part, from the workspace: `common`, `common/parts`, `common/parts/<id>`. */
const levelsOf = (root: string, id: string): string[] => {
  const steps = [...SHELF_DIR.split('/'), id]
  return steps.map((_, n) => join(root, ...steps.slice(0, n + 1)))
}

/** Which of the folders are there already: a link or a file in the place of one is refused, so nothing is written through it. Returns how many levels are there. */
async function existingLevels(levels: string[]): Promise<number> {
  for (const [n, path] of levels.entries()) {
    const what = await lstat(path).catch(() => null)
    if (what === null) return n
    if (what.isSymbolicLink()) throw new Error(`${path} is a link, not a folder of the shelf: torno copies nothing through it. Take the link away.`)
    if (!what.isDirectory()) throw new Error(`${path} is not a folder.`)
  }
  return levels.length
}

/** Looks at a file as a copy would, without reading it: a plain file of a kind the shelf takes, within its cap. Throws the reason, with the file's name for its path. */
async function looked(path: string, name: string): Promise<void> {
  const kind = shelfFileKind(path)
  if (kind === null) throw new Error(`${name} is not ${KINDS}.`)
  const { handle } = await openRegular(path, shelfFileCap(kind), 'file', SHELF_FILE_ENDINGS).catch((e: Error) => {
    throw new Error(e.message.split(path).join(name))
  })
  await handle.close()
}

/** Copies `path` to `dest` through a temp file beside it: whole or not there, and never over anything. Returns false when the name is taken. */
async function copyWhole(path: string, name: string, dest: string): Promise<boolean> {
  const kind = shelfFileKind(path)
  if (kind === null) throw new Error(`${name} is not ${KINDS}.`)
  const { handle, size } = await openRegular(path, shelfFileCap(kind), 'file', SHELF_FILE_ENDINGS).catch((e: Error) => {
    throw new Error(e.message.split(path).join(name))
  })
  const temp = join(dirname(dest), `.${name}.${randomBytes(6).toString('hex')}.tmp`)
  try {
    // Opened `wx`: a link or file at a name of this copy's own is never written through.
    const out = await open(temp, 'wx')
    try {
      const buffer = Buffer.alloc(Math.min(CHUNK, size + 1))
      let at = 0
      for (;;) {
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, at)
        if (bytesRead === 0) break
        at += bytesRead
        // One byte more than the size said: a file that grew since is caught, not copied whole.
        if (at > size) throw new Error(`${name} changed while it was copied.`)
        await out.write(buffer, 0, bytesRead)
      }
      if (at < size) throw new Error(`${name} changed while it was copied.`)
      await out.sync()
    } finally {
      await out.close()
    }
    try {
      // A hard link does not replace what is at the name: the name is taken, or it is ours, whole.
      await link(temp, dest)
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (code === 'EEXIST') return false
      // A disk with no hard links: look again, and rename only onto nothing.
      if (code !== 'EPERM' && code !== 'ENOSYS' && code !== 'ENOTSUP' && code !== 'EXDEV' && code !== 'EMLINK') throw e
      if (await lstat(dest).catch(() => null)) return false
      await rename(temp, dest)
    }
    return true
  } finally {
    await handle.close()
    await rm(temp, { force: true }).catch(() => {})
  }
}

/**
 * Copies the files the person dropped into `<workspace>/common/parts/<id>/`, as the request they sent names them. Main checks all of it, never
 * trusting the window: the id is a part id (so the folder is inside `common/parts/`), at most 8 absolute paths, and each is a plain file (no link,
 * folder or pipe) of a kind the shelf takes, within the cap a new project uses for that kind. Folders are made when missing, never through a link
 * (each one there is looked at). A file whose name is taken in the folder (compared without regard to case), or that has the name of another
 * in the same go, is refused by name and the rest are copied. Rejects with a plain reason, writing nothing, for the whole request.
 */
export async function addFiles(root: string | null, id: unknown, paths: unknown, hooks: AddHooks = {}): Promise<ShelfAddResult> {
  if (root === null) throw new Error('There is no workspace open.')
  if (typeof id !== 'string' || !isPartId(id)) throw new Error(`"${String(id)}" is not a part of the shelf: a part's name is a lower-case identifier.`)
  if (!Array.isArray(paths)) throw new Error('The files are given as a list of files.')
  if (paths.length === 0) throw new Error('Give at least one file.')
  if (paths.length > MAX_SHELF_FILES) throw new Error(`A part takes at most ${MAX_SHELF_FILES} files at a time.`)
  if (!paths.every((p) => typeof p === 'string')) throw new Error('A file is given by its path: this is not one.')
  const levels = levelsOf(root, id)
  const dir = levels[levels.length - 1]
  const there = await existingLevels(levels)

  const refused: ShelfAddResult['refused'] = []
  const ready: Array<{ path: string; name: string }> = []
  const named = new Set<string>()
  for (const path of paths as string[]) {
    // The name a file will have, once it is of a kind the shelf takes; the name it was dropped with until then.
    const kind = shelfFileKind(path)
    const name = kind === null ? (path.split(/[\\/]/).pop() ?? path) : shelfFileName(path)
    try {
      await looked(path, name)
      if (named.has(name.toLowerCase())) throw new Error(`Two files are called ${name}: only the first is copied.`)
      named.add(name.toLowerCase())
      ready.push({ path, name })
    } catch (e) {
      refused.push({ name, why: (e as Error).message })
    }
  }
  if (ready.length === 0) return { copied: [], refused }

  const made: string[] = []
  const copied: string[] = []
  try {
    for (const path of levels.slice(there)) {
      await mkdir(path)
      made.push(path)
    }
    await hooks.afterFolders?.()
    const taken = new Set((await readdir(dir)).map((n) => n.toLowerCase()))
    for (const { path, name } of ready) {
      try {
        if (taken.has(name.toLowerCase())) {
          refused.push({ name, why: `${name} is already there: torno never copies over a file.` })
          continue
        }
        if (await copyWhole(path, name, join(dir, name))) {
          taken.add(name.toLowerCase())
          copied.push(name)
        } else refused.push({ name, why: `${name} is already there: torno never copies over a file.` })
      } catch (e) {
        refused.push({ name, why: (e as Error).message })
      }
    }
  } finally {
    // Folders this made are not left empty when nothing went in.
    if (copied.length === 0) for (const path of made.reverse()) await rmdir(path).catch(() => {})
  }
  return { copied, refused }
}
