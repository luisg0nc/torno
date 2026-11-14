import type { HistoryEntry } from '../../shared/history'

/** How a kept build is shown against the live one: the earlier alone, over it, the live one alone, or the two side by side. */
export type CompareMode = 'before' | 'overlay' | 'after' | 'side'

/**
 * Two kept builds compared in the view (`from` the earlier, `to` the later, history ids). The live build stays on show
 * underneath and keeps landing: the earlier build is drawn against it. `prompt` is the turn the pair came from, when it came
 * from one. `building` is the id of an old build while it is made again from its copy to be drawn; `refused` is main's sentence when
 * it could not be drawn at all. Display only: nothing here is written anywhere.
 */
export interface CompareState {
  from: string
  to: string
  mode: CompareMode
  prompt?: number
  building?: string
  refused?: string
}

export const COMPARE_MODES: ReadonlyArray<{ mode: CompareMode; label: string }> = [
  { mode: 'before', label: 'Before' },
  { mode: 'overlay', label: 'Overlay' },
  { mode: 'after', label: 'After' },
  { mode: 'side', label: 'Side by side' }
]

/** What the status line says while comparing: `comparing prompt 14 · h40 → h41`, or that the old build is being made again. */
export function compareStatus(c: CompareState): string {
  if (c.building) return `Building ${c.building} to compare…`
  return `comparing ${c.prompt === undefined ? '' : `prompt ${c.prompt} · `}${c.from} → ${c.to}`
}

/** One row of the box that says how a check or a dimension moved. */
export interface MovedRow {
  label: string
  before: string
  after: string
  /** For the better, or not; a count of dimensions not measured is neither. */
  better?: boolean
}

/** The counts of the person's dimensions that moved, and the model's own checks that began or stopped to pass. */
export function checksMoved(from: HistoryEntry | undefined, to: HistoryEntry | undefined): MovedRow[] {
  if (!from || !to) return []
  const rows: MovedRow[] = []
  if (from.dimensions && to.dimensions) {
    const counts = [
      { key: 'pass', label: 'dimensions that pass', good: 1 },
      { key: 'fail', label: 'dimensions that fail', good: -1 },
      { key: 'none', label: 'dimensions not measured', good: 0 }
    ] as const
    for (const { key, label, good } of counts) {
      const [a, b] = [from.dimensions[key], to.dimensions[key]]
      if (a === b) continue
      rows.push({ label, before: String(a), after: String(b), ...(good === 0 ? {} : { better: (b - a) * good > 0 }) })
    }
  }
  const [was, now] = [new Set(from.failing ?? []), new Set(to.failing ?? [])]
  for (const name of was) if (!now.has(name)) rows.push({ label: name, before: 'fails', after: 'passes', better: true })
  for (const name of now) if (!was.has(name)) rows.push({ label: name, before: 'passes', after: 'fails', better: false })
  return rows
}

/** What the two boxes over the view hold: the rows of what changed (null for no box) and how the checks and dimensions moved. */
export function compareBoxes(from: HistoryEntry | undefined, to: HistoryEntry | undefined): { changed: string[] | null; moved: MovedRow[] } {
  return { changed: to ? to.line.split('; ') : null, moved: checksMoved(from, to) }
}

/**
 * Whether a kept build is the build on show: made in this run (`run` is the run of the history list) and its revision is the one the
 * window shows. A build of an earlier run is never taken for it: its revision is of that run. The same sources kept as one entry
 * make the live build read as not it, which draws that build again for nothing worse than a copy of the same shape.
 */
export function isLive(entry: Pick<HistoryEntry, 'run' | 'revision'> | undefined, run: string, shownRevision: number): boolean {
  return entry !== undefined && entry.run === run && entry.revision === shownRevision
}
