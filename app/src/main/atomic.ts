import { mkdir, open, rename, rm } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { dirname } from 'node:path'

/** The last write to each file, so that writes of one file land in the order they were made. */
const writes = new Map<string, Promise<void>>()

/**
 * Writes a file through a temp file beside it, creating its folder. Readers
 * see the old file or the new one, never half of one: the temp file is on
 * the disk before it is renamed. A write that fails
 * leaves the old file and no temp file, and does not hold up the next.
 */
export function writeFileAtomic(path: string, data: string | Uint8Array): Promise<void> {
  const write = (writes.get(path) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      await mkdir(dirname(path), { recursive: true })
      // A name of this write alone, opened `wx` (O_EXCL): a link or file planted at a name is never written through.
      const temp = `${path}.${randomBytes(6).toString('hex')}.tmp`
      try {
        // On the disk before it takes the place of the old file: a crash or a power cut must not leave
        // a name that points at nothing, where hours of marks were.
        const file = await open(temp, 'wx')
        try {
          await file.writeFile(data)
          await file.sync()
        } finally {
          await file.close()
        }
        await rename(temp, path)
      } catch (e) {
        await rm(temp, { force: true }).catch(() => {})
        throw e
      }
    })
    .finally(() => {
      if (writes.get(path) === write) writes.delete(path)
    })
  writes.set(path, write)
  return write
}
