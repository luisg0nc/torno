import { constants } from 'node:fs'
import { lstat, open, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { type Held, sweepDropped } from '../dropped'
import { FOLDER } from '../own'
import { PHOTOS_FOLDER, isPhotoName } from './dropped'
import type { TracingStore } from './store'

// The photos of the tracings of a project (`.torno/tracings/photos/`) that torno dropped are swept when the project is first
// opened in a run, as the pictures of the board are (`board/pictures.ts`): the photo a swap replaced, the straightened copy a new
// line-up made out of date, what a removed photo or tracing left, what a failed save wrote. Only those: main lists each file when
// it drops it (`dropped.json`, `dropped.ts`), and a file that is not on the list is never deleted, whatever the tracings name (a
// branch switched to has other tracings, and its photos are the person's, and are in no git).

/**
 * Deletes the files of `.torno/tracings/photos/` torno dropped (the list of `dropped.json`) that no tracing holds (`held`): only
 * files with a photo's name, never the folder's `.gitignore` nor anything the person put there, no link, and none changed in the
 * last `grace` ms. Nothing when there is no folder; a `Refusal` for a link in the place of `.torno`, `tracings` or `photos`.
 */
export const sweepPhotos = (dir: string, held: Held, grace = 0): Promise<void> => sweepDropped(dir, PHOTOS_FOLDER, isPhotoName, held, grace)

/** How long a photo file is left alone, as made: a photo is kept before the tracing that names it is changed. */
const GRACE_MS = 60_000

/** The most of a file kept aside that is read for the photos it names. */
const ASIDE_READ = 8_000_000

/** The files `tracings.json` was copied to when it could not be read, or had tracings left out (`tracings.json.corrupt-<time>`, `tracings.json.dropped-<time>`). */
const ASIDE = /^tracings\.json\.(?:corrupt|dropped)-/
const NAMED = /\b[ps]-[0-9a-f]{12}\.(?:jpg|png)\b/g

/**
 * The photos named anywhere in the files kept aside beside `tracings.json`: they are the person's photos, git ignores them, and the
 * file kept aside is the one place that still says which they are, so the sweep must not take them even when the list that was
 * started afresh has none. Read as text, capped, and never through a link.
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
 * The sweep of the photos torno dropped, made once for each project in a run, when it is first opened: before the window has
 * anything of it to undo, so that no undo points at a file that is gone (the window forgets its undo when the workspace changes,
 * and so does this, `forget`). It is made in the turn of the project's tracings, and what was taken off in this run is kept. A photo a
 * file kept aside names is never swept (`namedAside`), and a tracings file that could not be read whole is not swept at all that run.
 */
export class PhotoSweep {
  private done = new Set<string>()

  constructor(
    private tracings: Pick<TracingStore, 'withPhotos'>,
    private grace = GRACE_MS
  ) {}

  /** Never rejects: a project is no less open for a sweep that failed. */
  async once(objectId: string, dir: string): Promise<void> {
    if (this.done.has(dir)) return
    this.done.add(dir)
    try {
      await this.tracings.withPhotos(objectId, async (held, _dir, problem) => {
        if (problem !== null) return
        for (const name of await namedAside(dir)) held.kept.add(name)
        await sweepPhotos(dir, held, this.grace)
      })
    } catch (e) {
      console.error(`cannot sweep the photos of the tracings of ${objectId}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  forget(): void {
    this.done.clear()
  }
}
