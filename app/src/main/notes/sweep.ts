import { constants } from 'node:fs'
import { lstat, open, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { type Held, sweepDropped } from '../dropped'
import type { MarkStore } from '../marks/store'
import { FOLDER } from '../own'
import { NOTES_FOLDER } from './dropped'
import { isNoteFile } from './files'

// The pictures of the view notes of a project (`.torno/notes/`) that torno dropped are swept when the project is first
// opened in a run, as piece 2 sweeps the pictures of the board (`board/pictures.ts`): the ink an edit replaced, the
// references it took away, the files of a note removed in an earlier run, what a failed save wrote. Only those: main
// lists each file when it drops it (`dropped.json`, `dropped.ts`), and a file that is not on the list is never deleted,
// whatever the marks name (a branch switched to has other marks, and its pictures are the person's).

/**
 * Deletes the files of `.torno/notes/` torno dropped (the list of `dropped.json`) that no note holds (`held`): only
 * files with a note picture's name, never the folder's `.gitignore` nor anything the person put there, and none changed
 * in the last `grace` ms. Nothing when there is no folder; a `Refusal` for a link in the place of `.torno` or `notes`.
 */
export const sweepNotes = (dir: string, held: Held, grace = 0): Promise<void> => sweepDropped(dir, NOTES_FOLDER, isNoteFile, held, grace)

/** How long a picture file is left alone, as made: a picture is kept before the note that names it is. */
const GRACE_MS = 60_000

/** The most of a file kept aside that is read for the pictures it names. */
const ASIDE_READ = 8_000_000

/** The files `marks.json` was copied to when it could not be read, or had marks left out (`marks.json.corrupt-<time>`, `marks.json.dropped-<time>`). */
const ASIDE = /^marks\.json\.(?:corrupt|dropped)-/
const NAMED = /\b(?:n-[0-9a-f]{12}(?:\.ink)?\.png|r-[0-9a-f]{12}\.(?:png|jpg))\b/g

/**
 * The note pictures named anywhere in the files kept aside beside `marks.json`: they are the person's pictures, git
 * ignores them, and the file kept aside is the one place that still says which they are, so the sweep must not take
 * them even when the list that was started afresh has none. Read as text, capped, and never through a link.
 */
export async function namedAside(dir: string): Promise<Set<string>> {
  const folder = join(dir, FOLDER)
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
        for (const match of buffer.toString('utf8', 0, bytesRead).matchAll(NAMED)) found.add(match[0])
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
 * The sweep of the pictures torno dropped, made once for each project in a run, when it is first opened: before the
 * window has anything of it to undo, so that no undo points at a file that is gone (the window forgets its undo when the
 * workspace changes, and so does this, `forget`). It is made in the turn of the project's marks, and what was taken off
 * in this run is kept. A picture a file kept aside names is never swept (`namedAside`), and a marks file that could not
 * be read whole is not swept at all that run.
 */
export class NoteSweep {
  private done = new Set<string>()

  constructor(
    private marks: Pick<MarkStore, 'withNoteFiles'>,
    private grace = GRACE_MS
  ) {}

  /** Never rejects: a project is no less open for a sweep that failed. */
  async once(objectId: string, dir: string): Promise<void> {
    if (this.done.has(dir)) return
    this.done.add(dir)
    try {
      await this.marks.withNoteFiles(objectId, async (held, _dir, problem) => {
        if (problem !== null) return
        for (const name of await namedAside(dir)) held.kept.add(name)
        await sweepNotes(dir, held, this.grace)
      })
    } catch (e) {
      console.error(`cannot sweep the pictures of the notes of ${objectId}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  forget(): void {
    this.done.clear()
  }
}
