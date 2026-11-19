import { relative, sep } from 'node:path'
import { watch as chokidarWatch } from 'chokidar'
import { realPathOrNearest } from '../sessions/inside'

/** What changed of what the brief follows: `reference/` and `brief.md` (`files`), and `.torno/board/board.json` (`board`). */
export interface BriefChange {
  files: boolean
  board: boolean
}

const DEBOUNCE_MS = 300

/**
 * Watches the three things of a project the brief follows, and calls `onChange` once per burst, 300 ms after the last
 * change: a photo, a STEP file or a PDF added to or taken from `reference/`, `brief.md` made or removed (the cards that
 * appear by themselves), and `board.json` changed from outside (a pull). Nothing else of the folder is watched: the walk
 * goes into no other folder. The folders need not exist yet. Returns a function that stops the watch.
 */
export function watchBrief(dir: string, onChange: (what: BriefChange) => void, debounceMs: number = DEBOUNCE_MS): () => void {
  const realDir = realPathOrNearest(dir)
  let timer: NodeJS.Timeout | undefined
  let what: BriefChange = { files: false, board: false }
  /** The path under the project's folder, by whichever of its two spellings it is under (macOS reaches `/var` as `/private/var`). */
  const parts = (path: string): string[] => {
    let from = relative(dir, path)
    if (from.startsWith('..')) from = relative(realDir, path)
    return from === '' ? [] : from.split(sep)
  }
  const kind = (path: string): 'files' | 'board' | 'way' | null => {
    const [a, b, c, ...more] = parts(path)
    if (a === undefined) return 'way'
    if (a === 'brief.md' && b === undefined) return 'files'
    if (a === 'reference') return 'files'
    if (a === '.torno' && (b === undefined || (b === 'board' && (c === undefined || (c === 'board.json' && more.length === 0))))) return c === 'board.json' ? 'board' : 'way'
    return null
  }
  const watcher = chokidarWatch(dir, { ignoreInitial: true, ignored: (path) => kind(path) === null })
  watcher.on('all', (event, path) => {
    const of = kind(path)
    if (of === null || of === 'way') return
    // The folder itself is a change of its parent's listing, which is not one of its files.
    if (event === 'change' && of === 'files' && parts(path).length === 1 && parts(path)[0] === 'reference') return
    what = { files: what.files || of === 'files', board: what.board || of === 'board' }
    clearTimeout(timer)
    timer = setTimeout(() => {
      const told = what
      what = { files: false, board: false }
      onChange(told)
    }, debounceMs)
  })
  // A watch that fails (the folder became unreadable) just reports nothing more.
  watcher.on('error', () => {})
  return () => {
    clearTimeout(timer)
    void watcher.close()
  }
}
