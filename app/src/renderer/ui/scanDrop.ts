import { SCAN_FORMATS } from '../../shared/scans'
import { actions, store } from '../state/store'

/** What torno reads as a scan, as it is said of a file that is none. */
export const NOT_A_SCAN = 'torno reads .glb, .gltf, .obj, .ply and .stl scans'
/** Said of a dropped file the system gives no path for. */
export const NO_PATH = 'That file has no place on the disk'

export function isScan(name: string): boolean {
  const lower = name.toLowerCase()
  return SCAN_FORMATS.some((ending) => lower.endsWith(ending))
}

/**
 * What comes of files dropped on the view: the path of the one to import (the
 * first that is a scan), and what there is to say of the drop, for the Scans
 * panel: why nothing is imported, or which scans were left. `reading` is the
 * name of a file being imported already, or null: one is read at a time.
 */
export function scanDropped<F extends { name: string }>(files: ArrayLike<F>, pathOf: (file: F) => string, reading: string | null): { path: string | null; said: string | null } {
  const all = Array.from(files)
  const scans = all.filter((file) => isScan(file.name))
  if (scans.length === 0) return { path: null, said: `${all.length === 1 ? `${all[0].name} is not a scan` : `None of the ${all.length} files is a scan`}: ${NOT_A_SCAN}` }
  const [first, ...left] = scans
  if (reading !== null) return { path: null, said: stillReading(reading, first.name) }
  const path = pathOf(first)
  if (!path) return { path: null, said: `${first.name}: ${NO_PATH}` }
  const names = left.map((file) => file.name)
  const others = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)} were` : `${names[0]} was`
  return { path, said: left.length > 0 ? `One scan at a time: ${first.name} is being read; ${others} left` : null }
}

const stillReading = (reading: string, wanted: string): string => `${reading} is still being read: import ${wanted} once it is in`

const said = (e: unknown): string => (e instanceof Error ? e.message : String(e))
const basename = (path: string): string => path.split(/[\\/]/).pop() || path

/**
 * Has main read a file, which takes seconds: it is said to be read from now
 * until that is over, and one is read at a time. Why it came to nothing is
 * for the Scans panel to say, while that object is still the open one.
 */
function reading<T>(objectId: string, name: string, start: () => Promise<T>): Promise<T | undefined> {
  const now = store.getState().importing
  if (now !== null) {
    actions.setScansRefused(stillReading(now.name, name))
    return Promise.resolve(undefined)
  }
  actions.setScansRefused(null)
  actions.startImporting(name)
  return start().then(
    (result) => {
      actions.endImporting(name)
      return result
    },
    (e: unknown) => {
      actions.endImporting(name)
      if (store.getState().objectId === objectId) actions.setScansRefused(said(e))
      return undefined
    }
  )
}

/** Has main import a file into an object as a scan. */
export function importScan(objectId: string, path: string): void {
  void reading(objectId, basename(path), () => window.torno.scans.import(objectId, path)).then((scan) => {
    // A guess at its unit or up axis is asked about once, now, while the object is still the open one: a wrong unit is a thousandfold.
    if (scan && (scan.imported.assumed.unit || scan.imported.assumed.up) && store.getState().objectId === objectId) actions.askScanRead(scan.id)
  })
}

/**
 * Has main read a scan's source again, into the scan it is: its id, its name
 * and its alignments stay. A source that is no longer the file that was
 * aligned is said, since the alignments were made on another.
 */
export function reimportScan(objectId: string, id: string, name: string): void {
  void reading(objectId, name, () => window.torno.scans.reimport(objectId, id)).then((done) => {
    if (!done || store.getState().objectId !== objectId) return
    if (done.sourceChanged && Object.keys(done.scan.alignments).length > 0) actions.setScansRefused(`${id}: the source changed since it was aligned: check the alignment`)
  })
}
