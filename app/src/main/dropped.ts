import { lstat, open, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { constants } from 'node:fs'
import { writeFileAtomic } from './atomic'
import { ownTorno } from './own'

// What torno dropped from a folder of pictures of its own (`.torno/notes/`, `.torno/board/pictures/`): the file an edit
// replaced, a reference taken away, a note or a card removed, what a failed save wrote. Main writes each name to
// `dropped.json` in that folder when it lets go of the file, and the sweep of the next run takes the files on that list
// and no others. A file that is not on it is never deleted, whatever the marks or the board name: a branch switched to
// has other marks, and its pictures are the person's. The folder ignores itself for git, and so does its list.

export const DROPPED_FILE = 'dropped.json'

/** The most names the list holds, and the most of it that is read. */
const MOST_DROPPED = 5000
const READ_LIMIT = 1_000_000

/** One change of a list at a time, by its path: a name added while a sweep reads it is not lost. */
const turns = new Map<string, Promise<unknown>>()

function exclusive<T>(path: string, task: () => Promise<T>): Promise<T> {
  const turn = (turns.get(path) ?? Promise.resolve()).catch(() => {}).then(task)
  const tail = turn.catch(() => {})
  turns.set(path, tail)
  void tail.then(() => {
    if (turns.get(path) === tail) turns.delete(path)
  })
  return turn
}

/** The names a list holds, as far as it can be read: one that cannot (no file, a link, not JSON) holds none. */
async function readList(path: string, valid: (name: string) => boolean): Promise<string[]> {
  try {
    if (!(await lstat(path)).isFile()) return []
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const buffer = Buffer.alloc(READ_LIMIT)
      const { bytesRead } = await handle.read(buffer, 0, READ_LIMIT, 0)
      const parsed: unknown = JSON.parse(buffer.toString('utf8', 0, bytesRead))
      const list = typeof parsed === 'object' && parsed !== null ? (parsed as { dropped?: unknown }).dropped : undefined
      return Array.isArray(list) ? [...new Set(list.filter((n): n is string => typeof n === 'string' && valid(n)))].slice(0, MOST_DROPPED) : []
    } finally {
      await handle.close()
    }
  } catch {
    return []
  }
}

const writeList = (path: string, names: readonly string[]): Promise<void> => writeFileAtomic(path, `${JSON.stringify({ dropped: names }, null, 2)}\n`)

/**
 * Adds the names to the list of the folder `inside` the project's `.torno`: only names `valid` says are files of that
 * folder's, and only where the folder is there (nothing is made for them) and is torno's own. Never rejects: a name not
 * listed is a file left on the disk, which is the safe way to fail.
 */
export async function recordDropped(dir: string, inside: readonly string[], names: Iterable<string>, valid: (name: string) => boolean): Promise<void> {
  const added = [...new Set(names)].filter(valid)
  if (added.length === 0) return
  try {
    const folder = await ownTorno(dir, ...inside)
    if (!(await lstat(folder).then((s) => s.isDirectory(), () => false))) return
    const path = join(folder, DROPPED_FILE)
    await exclusive(path, async () => {
      const list = await readList(path, valid)
      const grown = [...list, ...added.filter((n) => !list.includes(n))].slice(-MOST_DROPPED)
      if (grown.length !== list.length) await writeList(path, grown)
    })
  } catch (e) {
    console.error(`cannot list ${added.join(', ')} as dropped in ${join(dir, '.torno', ...inside)}: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/** The names the folder's list holds (`recordDropped`), for a test or a check. */
export async function droppedNames(dir: string, inside: readonly string[], valid: (name: string) => boolean): Promise<string[]> {
  return readList(join(dir, '.torno', ...inside, DROPPED_FILE), valid)
}

/** What the sweep of a folder is told is in use or may come back. */
export interface Held {
  /** Named by a mark or a card now: such a file is not dropped, and comes off the list. */
  live: ReadonlySet<string>
  /** Named by what was removed in this run (an undo may bring it back), or by a file kept aside: not deleted yet, and stays on the list. */
  kept: ReadonlySet<string>
}

/**
 * Deletes the files of the list that nothing holds, and no others: a listed file is deleted when it is no `live` and no
 * `kept` name, is a plain file, and was last changed at least `grace` ms ago. Then it is off the list, as is a name that
 * is `live`, a name whose file is gone and a name that is not a file's of that folder. What is held, or too young, stays
 * listed for the next run. A link in the place of the folder is refused (`ownTorno`); no folder is no sweep.
 */
export async function sweepDropped(dir: string, inside: readonly string[], valid: (name: string) => boolean, held: Held, grace = 0): Promise<void> {
  const folder = await ownTorno(dir, ...inside)
  const path = join(folder, DROPPED_FILE)
  await exclusive(path, async () => {
    // Read inside the turn: a name recorded meanwhile is on the list read next, and its file is in this listing.
    const there = await readdir(folder).catch((e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT') return null
      throw e
    })
    if (there === null) return
    const list = await readList(path, valid)
    if (list.length === 0) return
    const now = Date.now()
    const remaining: string[] = []
    for (const name of list) {
      if (held.live.has(name) || !there.includes(name)) continue
      if (held.kept.has(name)) {
        remaining.push(name)
        continue
      }
      const stat = await lstat(join(folder, name)).catch(() => null)
      if (!stat || !stat.isFile()) continue
      if (grace > 0 && now - stat.mtimeMs < grace) {
        remaining.push(name)
        continue
      }
      await rm(join(folder, name), { force: true })
    }
    if (remaining.length !== list.length) await (remaining.length === 0 ? rm(path, { force: true }) : writeList(path, remaining))
  })
}
