/**
 * How the person likes the left of the window: which sections of the route card are folded and how wide the card is.
 * It is the window's, kept in its own storage (`localStorage`), never in the workspace: it is not part of an object. A
 * storage that is not there or refuses leaves the defaults, and a write that fails is let go. A value of the old shape
 * (`{ open, width }`) is read as the default folding, at the width it had.
 */

/** The sections that stand under the bench, in the order they are read. Parameters and Parts are the bench's two tabs, not sections. */
export type SectionId = 'checks' | 'marks' | 'scans' | 'tracings'

export const SECTION_IDS: readonly SectionId[] = ['checks', 'marks', 'scans', 'tracings']

export interface ColumnPrefs {
  /** The sections that are folded to their heads. Every other is open. */
  folded: SectionId[]
  /** Pixels: the width of the card, from `CARD_NARROW` to `CARD_MAX`. The window gives it at least `leftDefault` of its own width. */
  width: number
}

/** The card's width unless the person gave it more. The same as `--card-w` in `styles/tokens.css`. */
export const CARD_DEFAULT = 296

/**
 * Its width in a window narrower than 1360 px (`--card-w` there), and the least that is kept. What is kept is a wish
 * for at least this: a window that is wide shows `CARD_DEFAULT` for anything below it, so that a width asked for
 * "the default" is the default of whichever window it is shown in.
 */
export const CARD_NARROW = 264

/** The window width below which the narrow defaults of the card and the dock apply (`state/dock.ts` says the dock's). */
export const NARROW_WINDOW = 1360

/** The sections under the bench are all folded to their heads: the bench has the column. */
export const COLUMN_DEFAULT: ColumnPrefs = { folded: ['checks', 'marks', 'scans', 'tracings'], width: CARD_DEFAULT }

/** The card's default in a window of this width. */
export function leftDefault(windowWidth: number): number {
  return windowWidth < NARROW_WINDOW ? CARD_NARROW : CARD_DEFAULT
}

/** The most a card is kept at: what a window wider than any in use could still give. */
export const CARD_MAX = 800

/** The free viewport width the card and the dock always leave between them. */
export const VIEWPORT_MIN = 420

/**
 * The width the card may be given: from the default of this window up to what leaves the viewport its room beside the dock. The default width itself (`CARD_DEFAULT`, which is what is kept for "no wish") stands for the default of
 * the window, so a narrow window shows its own, 264.
 */
export function clampLeft(width: number, inner: number, dock: number): number {
  const floor = leftDefault(inner)
  const max = Math.max(floor, inner - dock - VIEWPORT_MIN)
  const wished = width === CARD_DEFAULT ? floor : width
  return Math.round(Math.min(Math.max(wished, floor), max))
}

/** A width as it is kept: a whole number of pixels from the narrow default to the most; the default for anything else. */
export function keptWidth(width: unknown): number {
  return typeof width === 'number' && Number.isFinite(width) ? Math.round(Math.min(Math.max(width, CARD_NARROW), CARD_MAX)) : CARD_DEFAULT
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

/** What the storage holds under `COLUMN_KEY`, or null: a storage that refuses is no storage. */
export function storedColumn(storage: Pick<Storage, 'getItem'> | null): string | null {
  try {
    return storage?.getItem(COLUMN_KEY) ?? null
  } catch {
    return null
  }
}

/** The preferences as stored (`raw`, JSON or nothing): what can be read of them, the default for the rest. */
export function readColumn(raw: string | null): ColumnPrefs {
  let kept: unknown
  try {
    kept = JSON.parse(raw ?? 'null')
  } catch {
    return COLUMN_DEFAULT
  }
  if (typeof kept !== 'object' || kept === null || Array.isArray(kept)) return COLUMN_DEFAULT
  const { folded, width } = kept as { folded?: unknown; width?: unknown }
  return {
    // An array of section ids is the new shape; anything else (the old `open`, or the older folded sections of a column) is the default folding.
    folded: Array.isArray(folded) ? SECTION_IDS.filter((id) => folded.includes(id)) : COLUMN_DEFAULT.folded,
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
 * The sections of the card: all seven for an open project; none on the page of projects (the sections act on a
 * view that is not on screen), with a new project being made (no tool works there) or with none open.
 */
export function sectionsFor(s: { page: 'object' | 'objects' | 'new'; objectId: string | null }): readonly SectionId[] {
  return s.page === 'object' && s.objectId !== null ? SECTION_IDS : []
}

/** The two tabs of the bench: the model's Params and its parts. */
export type BenchTab = 'params' | 'parts'

/** Which tabs a project has: Parameters when the model has Params, Parts when it has more than one part (or no Params to show instead). A one-part model shows Parameters alone, a model with no Params Parts alone. */
export function benchTabs(parts: number, params: number): BenchTab[] {
  if (params === 0) return ['parts']
  return parts > 1 ? ['params', 'parts'] : ['params']
}

/** The tab to draw: the one kept for the project if it has it, else the first of its tabs (Parameters). */
export function tabShown(kept: BenchTab | undefined, tabs: readonly BenchTab[]): BenchTab {
  return kept !== undefined && tabs.includes(kept) ? kept : tabs[0]
}

/** The open tab of each project, as the window keeps it (`localStorage`, never the workspace's): by the project's id. */
export type BenchKept = Record<string, BenchTab>

export const BENCH_KEY = 'torno.bench'

/** What the storage holds under `BENCH_KEY`: the entries that are a project id and a tab, nothing for the rest. */
export function readBench(raw: string | null): BenchKept {
  let kept: unknown
  try {
    kept = JSON.parse(raw ?? 'null')
  } catch {
    return {}
  }
  if (typeof kept !== 'object' || kept === null || Array.isArray(kept)) return {}
  const out: BenchKept = {}
  for (const [id, tab] of Object.entries(kept)) if (tab === 'params' || tab === 'parts') out[id] = tab
  return out
}

export function storedBench(storage: Pick<Storage, 'getItem'> | null): string | null {
  try {
    return storage?.getItem(BENCH_KEY) ?? null
  } catch {
    return null
  }
}

export function writeBench(storage: Pick<Storage, 'setItem'> | null, kept: BenchKept): void {
  try {
    storage?.setItem(BENCH_KEY, JSON.stringify(kept))
  } catch {
    // A storage that refuses: the window goes on as it is.
  }
}
