import { realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

/** The real path of `path`, or of its nearest folder that exists with the rest put back (a file not written yet). */
export function realPathOrNearest(path: string): string {
  let rest = ''
  let at = resolve(path)
  for (;;) {
    try {
      return rest === '' ? realpathSync(at) : join(realpathSync(at), rest)
    } catch {
      const up = dirname(at)
      if (up === at) return resolve(path)
      rest = rest === '' ? basename(at) : join(basename(at), rest)
      at = up
    }
  }
}

/**
 * Whether `file` (as an agent reports it, relative to `dir` or absolute) is inside the folder `dir`, by real
 * paths: a process started in a folder reached through a link (`/var` on macOS) sees its real path.
 */
export function isInsideFolder(dir: string, file: string): boolean {
  const inside = relative(realPathOrNearest(dir), realPathOrNearest(resolve(dir, file)))
  return inside !== '' && !inside.startsWith('..') && !isAbsolute(inside)
}
