/**
 * How wide the person likes the session dock. It is the window's, like the column's: kept in its own storage
 * (`localStorage`, `torno.dock`), never in the workspace. A storage that is not there or refuses leaves the default,
 * and a write that fails is let go.
 */
import { NARROW_WINDOW, VIEWPORT_MIN } from './column'

export { NARROW_WINDOW }

/** The dock's width unless the person gave it another. The same as `--dock-w` in `styles/tokens.css`. */
export const DOCK_DEFAULT = 420

/** Its default in a window narrower than `NARROW_WINDOW`. The same as `--dock-w` there. */
export const DOCK_NARROW = 384

/** The least the dock is dragged to. */
export const DOCK_MIN = 320

export const DOCK_KEY = 'torno.dock'

export function dockDefault(windowWidth: number): number {
  return windowWidth < NARROW_WINDOW ? DOCK_NARROW : DOCK_DEFAULT
}

/** The width kept, or null where nothing usable is: no storage, one that refuses, or a value that is no width. */
export function readDock(storage: Pick<Storage, 'getItem'> | null): number | null {
  try {
    const raw = storage?.getItem(DOCK_KEY)
    if (raw === null || raw === undefined) return null
    const width = Number(raw)
    return Number.isFinite(width) && width > 0 ? Math.round(width) : null
  } catch {
    return null
  }
}

export function writeDock(storage: Pick<Storage, 'setItem'> | null, width: number): void {
  try {
    storage?.setItem(DOCK_KEY, String(Math.round(width)))
  } catch {
    // A storage that refuses (a private window, blocked site data): the window goes on as it is.
  }
}

/** The width the dock may be given: from its minimum up to what leaves the view `VIEWPORT_MIN` beside the left (the rail and the card). */
export function clampDock(width: number, windowWidth: number, leftWidth: number): number {
  const max = Math.max(DOCK_MIN, windowWidth - leftWidth - VIEWPORT_MIN)
  return Math.round(Math.min(Math.max(width, DOCK_MIN), max))
}
