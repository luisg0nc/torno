import { watch } from 'chokidar'

/**
 * Whether a path is a part's own record, `common/parts/<id>/.torno` or the `checked.json` in it: what `watchFolder` is told to watch though it
 * ignores `.torno`, so that a `git pull` that changes only a part's checks is seen. Nothing else under `.torno` is.
 */
export const keepChecked = (path: string): boolean => /[\\/]common[\\/]parts[\\/][^\\/]+[\\/]\.torno([\\/]checked\.json)?$/.test(path)

/** Whether a path is a part's `checked.json`. */
export const isCheckedFile = (path: string): boolean => /[\\/]\.torno[\\/]checked\.json$/.test(path)

/**
 * Watch the direct children of a folder, and nothing deeper: `onChange` is called, after a quiet 100 ms, when one is added or
 * removed. It is how the shelf waits for a workspace's `common/` to be made, which a watch on `common/` itself cannot see.
 * Returns the stop.
 */
export function watchTop(dir: string, onChange: () => void): () => void {
  let timer: NodeJS.Timeout | undefined
  const watcher = watch(dir, { depth: 0, ignoreInitial: true, ignored: (path) => /(^|[\\/])\.[^\\/]+$/.test(path) })
  watcher.on('all', () => {
    clearTimeout(timer)
    timer = setTimeout(onChange, 100)
  })
  // A watch that fails just reports nothing more.
  watcher.on('error', () => {})
  return () => {
    clearTimeout(timer)
    void watcher.close()
  }
}
