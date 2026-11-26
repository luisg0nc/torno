import { watch } from 'chokidar'

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
