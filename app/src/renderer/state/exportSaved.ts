import { useStore as useZustand } from 'zustand'
import { createStore } from 'zustand/vanilla'
import type { ExportSaved, ShareKind } from '../../shared/exportdata'

// The file an export just wrote, kept for the status line (spec 2026-11-18, "Export, on the bench"): it lands where Export… was, with
// the read-back in a popover above it, until the next build or a minute. The path is main's alone (`savedHere`): the window keeps what
// it was told, and "Show in folder" and "Open in browser" go through main, which still has the file as long as `export:done` is not sent.
// That is sent here, when the file is let go, and not when the sheet is put away.

/** How long the status line keeps the file, in ms. */
export const KEPT_MS = 60_000

export interface KeptFile {
  /** The project it is of, by its folder name. */
  objectId: string | null
  saved: ExportSaved
  /** A picture or a drawing of the view: no "Open in browser" for it. */
  kept?: ShareKind
  /** Counted up for each file, so that the popover that tells it opens for each. */
  n: number
}

export const keptStore = createStore<{ file: KeptFile | null }>(() => ({ file: null }))

export function useKept<T>(select: (s: { file: KeptFile | null }) => T): T {
  return useZustand(keptStore, select)
}

let timer: ReturnType<typeof setTimeout> | undefined
let count = 0

/** The file the sheet wrote: held for the status line, for a minute. A file held already is let go first. */
export function keepFile(objectId: string | null, saved: ExportSaved, kept?: ShareKind): void {
  clearTimeout(timer)
  keptStore.setState({ file: { objectId, saved, ...(kept ? { kept } : {}), n: ++count } })
  timer = setTimeout(letGo, KEPT_MS)
}

/** The status line is done with the file: the next build, a minute, a new export, or the person. Main lets go of the path with it. */
export function letGo(): void {
  clearTimeout(timer)
  if (keptStore.getState().file === null) return
  keptStore.setState({ file: null })
  try {
    window.torno.export.done()
  } catch {
    // No bridge (a test): nothing is held in main either.
  }
}
