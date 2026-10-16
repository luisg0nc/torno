import { type ScanInfo, type ScanUnit, TIED_TO_NOTHING, alignmentOf, standingOf, tiedPoints } from '../../shared/scans'

export const UNIT_WORD: Record<ScanUnit, string> = { mm: 'millimetres', cm: 'centimetres', m: 'metres', in: 'inches' }

/**
 * The one thing to know first of a scan in the layout shown, on the build on show. `state` is what styles it,
 * `word` the one word its row says, `tip` the sentence of that word (the row's `title`, and the detail's line of
 * its state). Then what its alignment rests on (`basis`), what there is to say of the state in a sentence
 * (`said`), why its fit is doubtful when the state is another (`rough`), and what else is to be known (`note`).
 * `confirm` when the person can say it still holds: whatever put it in doubt but a check that has not come, which
 * is only to be waited for. Nothing here says a scan is exact: `placed` is an alignment tied to no point of the
 * model, which no build checks, and must never read as `aligned`.
 */
export interface ScanState {
  state: 'mesh-missing' | 'unaligned' | 'unchecked' | 'stale' | 'rough' | 'placed' | 'aligned'
  word: string
  tip: string
  basis: string | null
  said: string | null
  rough: string | null
  note: string | null
  confirm: boolean
}

export function scanState(scan: ScanInfo, layout: string, revision: number): ScanState {
  const standing = standingOf(scan, layout, revision)
  const { basis, note, rough } = standing
  // `by hand`, `by floor only`, `by 4 pairs, RMS 2.1 mm`: what the sentence says it rests on.
  const by = basis === null || basis.startsWith('by ') ? basis : `by ${basis}`
  const none = { basis: null, said: null, rough: null, note: null, confirm: false }
  if (scan.meshState === 'missing') return { state: 'mesh-missing', word: 'missing', tip: 'Its mesh is gone from the disk: it cannot be drawn or checked', ...none }
  if (!standing.aligned) return { state: 'unaligned', word: 'unaligned', tip: `Not aligned in ${layout}: nothing is checked against it here`, ...none }
  const pending = (said: string | null): ScanState => ({ state: 'unchecked', word: 'pending', tip: `Aligned ${by}; not checked against a build yet${said ? `. ${said}` : ''}`, basis, said, rough, note, confirm: false })
  // Nothing is built in this run yet: no check has been made, and none can be until something is.
  if (revision === 0) return pending(null)
  // A check that is on its way, or will be tried again: nothing to look at. One that failed says why; it is tried again every 30 s.
  if (standing.waiting) return pending(standing.failed ? `${standing.stale}. It is tried again every 30 s` : null)
  // One notion of "may no longer hold", with its reasons: what the last build's check found, a source that changed.
  if (standing.stale) return { state: 'stale', word: 'check', tip: standing.stale, basis, said: standing.stale, rough, note, confirm: true }
  if (rough) return { state: 'rough', word: 'rough', tip: `Rough: ${rough}`, basis, said: rough, rough: null, note, confirm: false }
  if (tiedPoints(alignmentOf(scan, layout)!) === 0) {
    // Its sentence says it is tied to nothing; the note keeps only what else there is.
    const rest = note?.split('; ').filter((one) => one !== TIED_TO_NOTHING).join('; ') || null
    return { state: 'placed', word: 'placed', tip: `Placed ${by}: tied to no point of the model, so not checked against builds`, basis, said: null, rough: null, note: rest, confirm: false }
  }
  const confirmed = alignmentOf(scan, layout)?.confirmed !== undefined && note !== null
  const tip = confirmed ? `Aligned ${by}; ${note}` : `Aligned ${by}; checked against r${scan.checks[layout]?.revision ?? revision}`
  return { state: 'aligned', word: 'aligned', tip, basis, said: null, rough: null, note, confirm: false }
}

/** How a scan was read, where that was a guess: `Read as metres, Y up`; null when the person chose both. */
export function guessOf(scan: Pick<ScanInfo, 'imported'>): string | null {
  const { unit, up, assumed } = scan.imported
  const guessed = [...(assumed.unit ? [UNIT_WORD[unit]] : []), ...(assumed.up ? [`${up.toUpperCase()} up`] : [])]
  return guessed.length > 0 ? `Read as ${guessed.join(', ')}` : null
}
