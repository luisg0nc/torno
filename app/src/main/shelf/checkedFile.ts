import { constants } from 'node:fs'
import { lstat, open } from 'node:fs/promises'

/** The largest `.torno/checked.json` that is read: a record of a few sizes, never more than this. */
export const CHECKED_BYTES = 64 * 1024

/**
 * The text of a part's `checked.json`, or null when there is no such file. A link, a pipe or anything that is not a plain file, and a file over
 * 64 KB, throw a plain reason: a cloned repo could put a link there to a file the person keeps secret, which torno would then merge and write into a
 * tracked file. The file is opened without following a link and without waiting (a pipe would never answer), and what was checked is read through
 * the same handle. The one reader of the file, for the store and for `recordMeasured`.
 */
export async function readCheckedText(path: string): Promise<string | null> {
  const stat = await lstat(path).catch((e: NodeJS.ErrnoException) => {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return null
    throw new Error(`${path} could not be looked at: ${e.message}`)
  })
  if (stat === null) return null
  if (!stat.isFile()) throw new Error(`${path} is ${stat.isSymbolicLink() ? 'a link' : 'not a plain file'}: torno reads only a plain checked.json.`)
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch(() => {
    throw new Error(`${path} cannot be opened as a plain file.`)
  })
  try {
    const opened = await handle.stat()
    if (!opened.isFile()) throw new Error(`${path} is not a plain file: torno reads only a plain checked.json.`)
    if (opened.size > CHECKED_BYTES) throw new Error(`${path} is over ${CHECKED_BYTES / 1024} KB.`)
    // One byte more than the cap: a file that grew since is caught, not read whole.
    const bytes = Buffer.alloc(CHECKED_BYTES + 1)
    let got = 0
    while (got < bytes.length) {
      const { bytesRead } = await handle.read(bytes, got, bytes.length - got, got)
      if (bytesRead === 0) break
      got += bytesRead
    }
    if (got > CHECKED_BYTES) throw new Error(`${path} is over ${CHECKED_BYTES / 1024} KB.`)
    return bytes.toString('utf8', 0, got)
  } finally {
    await handle.close()
  }
}
