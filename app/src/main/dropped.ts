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
//
// A folder whose files are shared by the branches of a project (the photos of the tracings: git does not hold them, so a branch
// switched to still has them on disk) may date its list: each name is written with the day it was listed (`at`), and its file is
// taken only a time after that (`listedFor`), never on the strength of what this branch alone names.

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

interface List {
  names: string[]
  /** When each name was listed (an ISO time), for the folders that date their lists; none for a name listed without one. */
  at: Record<string, string>
}

/** The names a list holds, as far as it can be read: one that cannot (no file, a link, not JSON) holds none. */
async function readList(path: string, valid: (name: string) => boolean): Promise<List> {
  try {
    if (!(await lstat(path)).isFile()) return { names: [], at: {} }
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const buffer = Buffer.alloc(READ_LIMIT)
      const { bytesRead } = await handle.read(buffer, 0, READ_LIMIT, 0)
      const parsed: unknown = JSON.parse(buffer.toString('utf8', 0, bytesRead))
      const given = typeof parsed === 'object' && parsed !== null ? (parsed as { dropped?: unknown; at?: unknown }) : {}
      const names = Array.isArray(given.dropped) ? [...new Set(given.dropped.filter((n): n is string => typeof n === 'string' && valid(n)))].slice(0, MOST_DROPPED) : []
      const at: Record<string, string> = {}
      if (typeof given.at === 'object' && given.at !== null && !Array.isArray(given.at)) {
        for (const name of names) {
          const when = (given.at as Record<string, unknown>)[name]
          if (typeof when === 'string' && !Number.isNaN(Date.parse(when))) at[name] = when
        }
      }
      return { names, at }
    } finally {
      await handle.close()
    }
  } catch {
    return { names: [], at: {} }
  }
}

/** Written whole: the names, and the dates of those that have one (none at all for a folder that does not date its list). */
const writeList = (path: string, names: readonly string[], at: Readonly<Record<string, string>> = {}): Promise<void> => {
  const dated = Object.fromEntries(names.filter((n) => at[n] !== undefined).map((n) => [n, at[n]]))
  return writeFileAtomic(path, `${JSON.stringify({ dropped: names, ...(Object.keys(dated).length > 0 ? { at: dated } : {}) }, null, 2)}\n`)
}

/**
 * Adds the names to the list of the folder `inside` the project's `.torno`: only names `valid` says are files of that
 * folder's, and only where the folder is there (nothing is made for them) and is torno's own. Never rejects: a name not
 * listed is a file left on the disk, which is the safe way to fail. With `dated`, each name newly listed is written with the time it was
 * listed; a name that is listed already keeps the time it had.
 */
export async function recordDropped(dir: string, inside: readonly string[], names: Iterable<string>, valid: (name: string) => boolean, opts: { dated?: boolean } = {}): Promise<void> {
  const added = [...new Set(names)].filter(valid)
  if (added.length === 0) return
  try {
    const folder = await ownTorno(dir, ...inside)
    if (!(await lstat(folder).then((s) => s.isDirectory(), () => false))) return
    const path = join(folder, DROPPED_FILE)
    await exclusive(path, async () => {
      const list = await readList(path, valid)
      const fresh = added.filter((n) => !list.names.includes(n))
      const grown = [...list.names, ...fresh].slice(-MOST_DROPPED)
      const at = { ...list.at, ...(opts.dated ? Object.fromEntries(fresh.map((n) => [n, new Date().toISOString()])) : {}) }
      if (grown.length !== list.names.length) await writeList(path, grown, at)
    })
  } catch (e) {
    console.error(`cannot list ${added.join(', ')} as dropped in ${join(dir, '.torno', ...inside)}: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/** The names the folder's list holds (`recordDropped`), for a test or a check. */
export async function droppedNames(dir: string, inside: readonly string[], valid: (name: string) => boolean): Promise<string[]> {
  return (await readList(join(dir, '.torno', ...inside, DROPPED_FILE), valid)).names
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
 * listed for the next run. A link in the place of the folder is refused (`ownTorno`); no folder is no sweep. With `listedFor` (ms), a
 * file is also left until its name has been on the list that long, by the date the list holds (`recordDropped` with `dated`): a
 * name with no date is dated by this sweep, and its file goes that long after.
 */
export async function sweepDropped(dir: string, inside: readonly string[], valid: (name: string) => boolean, held: Held, grace = 0, listedFor = 0): Promise<void> {
  const folder = await ownTorno(dir, ...inside)
  const path = join(folder, DROPPED_FILE)
  await exclusive(path, async () => {
    // Read inside the turn: a name recorded meanwhile is on the list read next, and its file is in this listing.
    const there = await readdir(folder).catch((e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT') return null
      throw e
    })
    if (there === null) return
    const { names: list, at } = await readList(path, valid)
    if (list.length === 0) return
    const now = Date.now()
    const remaining: string[] = []
    const dates: Record<string, string> = {}
    const stay = (name: string): void => {
      remaining.push(name)
      if (at[name] !== undefined) dates[name] = at[name]
    }
    for (const name of list) {
      if (held.live.has(name) || !there.includes(name)) continue
      if (held.kept.has(name)) {
        stay(name)
        continue
      }
      const stat = await lstat(join(folder, name)).catch(() => null)
      if (!stat || !stat.isFile()) continue
      if (grace > 0 && now - stat.mtimeMs < grace) {
        stay(name)
        continue
      }
      if (listedFor > 0) {
        const since = Date.parse(at[name] ?? '')
        if (Number.isNaN(since)) {
          remaining.push(name)
          dates[name] = new Date(now).toISOString()
          continue
        }
        if (now - since < listedFor) {
          stay(name)
          continue
        }
      }
      await rm(join(folder, name), { force: true })
    }
    const changed = remaining.length !== list.length || remaining.some((n) => dates[n] !== at[n])
    if (changed) await (remaining.length === 0 ? rm(path, { force: true }) : writeList(path, remaining, dates))
  })
}
