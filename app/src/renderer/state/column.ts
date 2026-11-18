/**
 * How the person likes the left of the window: which panel of the rail is open (null: none) and how wide it is. It is
 * the window's, kept in its own storage (`localStorage`), never in the workspace: it is not part of an object. A
 * storage that is not there or refuses leaves the defaults, and a write that fails is let go. A value of the old
 * shape (the column's folded sections and the marks' height) is read as the marks open, at the width it had.
 */

/** The panels of the rail, in the order of its buttons. */
export type RailPanel = 'projects' | 'layers' | 'params' | 'scans' | 'marks'

export const RAIL_PANELS: readonly RailPanel[] = ['projects', 'layers', 'params', 'scans', 'marks']

export interface ColumnPrefs {
  /** The panel docked beside the rail, or null for none. */
  open: RailPanel | null
  /** Pixels: the width of the panel, from `LEFT_MIN` to `PANEL_MAX`. The window gives it at least `leftDefault` of its own width. */
  width: number
}

/** The card's width unless the person gave it more. The same as `--card-w` in `styles/tokens.css`. */
export const LEFT_DEFAULT = 296

/**
 * Its width in a window narrower than 1360 px (`--card-w` there), and the least that is kept. What is kept is a wish
 * for at least this: a window that is wide shows `LEFT_DEFAULT` for anything below it, so that a width asked for
 * "the default" is the default of whichever window it is shown in.
 */
export const LEFT_MIN = 264

/** The window width below which the narrow defaults of the card and the dock apply (`state/dock.ts` says the dock's). */
export const NARROW_WINDOW = 1360

export const COLUMN_DEFAULT: ColumnPrefs = { open: 'marks', width: LEFT_MIN }

/** The card's default in a window of this width. */
export function leftDefault(windowWidth: number): number {
  return windowWidth < NARROW_WINDOW ? LEFT_MIN : LEFT_DEFAULT
}

/** The most a panel is kept at: what a window wider than any in use could still give. */
export const PANEL_MAX = 800

/** The width of the rail. The same as `--rail-w` in `styles/tokens.css`. */
export const RAIL_W = 52

/** The free viewport width the rail, the panel and the dock always leave between them. */
export const VIEWPORT_MIN = 420

/** The width the card may be given: from the default of this window up to what leaves the viewport its room beside the rail and the dock. */
export function clampLeft(width: number, inner: number, dock: number): number {
  const floor = leftDefault(inner)
  const max = Math.max(floor, inner - dock - RAIL_W - VIEWPORT_MIN)
  return Math.round(Math.min(Math.max(width, floor), max))
}

/** A width as it is kept: a whole number of pixels from the default to the most; the default for anything else. */
export function keptWidth(width: unknown): number {
  return typeof width === 'number' && Number.isFinite(width) ? Math.round(Math.min(Math.max(width, LEFT_MIN), PANEL_MAX)) : LEFT_MIN
}

export const COLUMN_KEY = 'torno.column'

/** The window's storage, or null where there is none to be had. */
export function windowStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

export function readColumn(storage: Pick<Storage, 'getItem'> | null): ColumnPrefs {
  let kept: unknown
  try {
    kept = JSON.parse(storage?.getItem(COLUMN_KEY) ?? 'null')
  } catch {
    return COLUMN_DEFAULT
  }
  if (typeof kept !== 'object' || kept === null || Array.isArray(kept)) return COLUMN_DEFAULT
  const { open, width } = kept as { open?: unknown; width?: unknown }
  return {
    open: open === null ? null : (RAIL_PANELS.find((panel) => panel === open) ?? COLUMN_DEFAULT.open),
    width: keptWidth(width)
  }
}

export function writeColumn(storage: Pick<Storage, 'setItem'> | null, prefs: ColumnPrefs): void {
  try {
    storage?.setItem(COLUMN_KEY, JSON.stringify(prefs))
  } catch {
    // A storage that refuses (a private window, blocked site data): the window goes on as it is.
  }
}

/**
 * The panels the rail offers: all five for an open project; Projects and Marks on the page of projects (the layers,
 * the parameters and the scans act on a view that is not on screen); Projects alone while a new project is being
 * made (no tool works there) or with none open (the marks are a project's).
 */
export function panelsFor(s: { page: 'object' | 'objects' | 'new'; objectId: string | null }): readonly RailPanel[] {
  if (s.page === 'new' || s.objectId === null) return ['projects']
  return s.page === 'objects' ? ['projects', 'marks'] : RAIL_PANELS
}

/**
 * The panel on show: the one kept when the rail offers it, none when it does not, but where the rail offers one panel
 * only (no project open, or a new one being made: nothing else to look at) and the person has not closed the panel,
 * that one, the list of projects.
 */
export function shownPanel(open: RailPanel | null, offered: readonly RailPanel[]): RailPanel | null {
  if (open === null) return null
  if (offered.includes(open)) return open
  return offered.length === 1 ? offered[0] : null
}
