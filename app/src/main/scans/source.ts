import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { SCAN_FORMATS } from '../../shared/scans'
import { FOLDER } from '../own'
import { realPathOrNearest } from '../sessions/inside'

// The one path main is given for a scan: the file it is read from. It is checked here, and only ever read.

/** Whether `path` is `folder` or under it. */
function isWithin(folder: string, path: string): boolean {
  const from = relative(folder, path)
  return from === '' || (from !== '..' && !from.startsWith(`..${sep}`) && !isAbsolute(from))
}

/**
 * A file that may be read as a scan of the object in `dir`, as a whole path:
 * what the person gave, or what a record says its source is. Throws saying
 * why it is none.
 */
export async function sourceOf(dir: string, given: unknown): Promise<string> {
  if (typeof given !== 'string' || !isAbsolute(given)) throw new Error('give the whole path of the file')
  const source = resolve(given)
  const formats: readonly string[] = SCAN_FORMATS
  if (!formats.includes(extname(source).toLowerCase())) throw new Error(`${basename(source)} is not a scan torno reads: ${formats.slice(0, -1).join(', ')} or ${formats.at(-1)}`)
  // By where the file is, whatever name led to it.
  if (isWithin(await real(join(dir, FOLDER)), await real(source))) throw new Error(`${basename(source)} is in this object's .torno folder, where torno keeps its own files: import it from somewhere else`)
  return source
}

/** Where a path leads, through whatever links (of its nearest folder that exists, for a file not there). */
const real = (path: string): Promise<string> => Promise.resolve(realPathOrNearest(path))
