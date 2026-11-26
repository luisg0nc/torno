import type { CompareState } from '../../state/compare'

// The pure rules of the band at the top left of the view (`Band.tsx`): which mode of the whole view wears it, and what it says.

/** The modes that put a sentence at the top left of the view. */
export type BandKind = 'export' | 'review' | 'failed' | 'sketch' | 'compare' | 'lineup' | 'facePick' | 'place'

/** What the view is doing, as each mode says whether it is on. */
export interface BandState {
  exportOpen: boolean
  roundOpen: boolean
  lineup: boolean
  facePick: boolean
  /** A part of the shelf is being placed on the model (#353). */
  placing: boolean
  comparing: boolean
  sketching: boolean
  failedOnShow: boolean
}

/**
 * The band the view wears: one at most, the first mode on in this order. A review that is open keeps its band while a sketch
 * opens inside it (the sketch's words go to the card's head).
 */
export function bandOf(s: BandState): BandKind | null {
  if (s.exportOpen) return 'export'
  if (s.lineup) return 'lineup'
  if (s.facePick) return 'facePick'
  if (s.placing) return 'place'
  if (s.roundOpen) return 'review'
  if (s.comparing) return 'compare'
  if (s.sketching) return 'sketch'
  if (s.failedOnShow) return 'failed'
  return null
}

/** The tone of each band: the ones that ask something of the person are the accent's, the ones that only inform are quiet. */
export const BAND_TONE: Record<BandKind, 'accent' | 'quiet'> = {
  export: 'accent',
  review: 'accent',
  lineup: 'accent',
  place: 'accent',
  failed: 'quiet',
  sketch: 'quiet',
  compare: 'quiet',
  facePick: 'quiet'
}

/** A plane as the band says it: `XZ, y = 40` for a main plane, the face it goes through otherwise, the surface for none. */
export function planeSaid(label: string | null): string {
  if (label === null) return 'the surface'
  return label.replace(/\s*\(u = .*\)\s*$/, '').replace(/^([XYZ]{2}) at /, '$1, ')
}

/** The sentence of the band of a placing: `Placing ec11 from the shelf, 2 placed`. */
export function placeWords(part: string, placed: number): { lead: string; part: string; mid: string; placed: string } {
  return { lead: 'Placing ', part, mid: ' from the shelf, ', placed: `${placed} placed` }
}

/** The sentence of a sketch's band: the lead, the sketch's ref (none until its first stroke gives it a number) and its plane. */
export function sketchWords(id: string | undefined, planeLabel: string | null): { lead: string; ref: string | null; on: string } {
  return { lead: 'Sketching', ref: id ?? null, on: planeSaid(planeLabel) }
}

/** The sentence of the band of a failed build: the build on show (null when it is not among the kept ones) and what failed after it. */
export function failedWords(shown: string | null): { before: string; ref: string | null; after: string } {
  return { before: 'On show: ', ref: shown, after: '. The build after it failed.' }
}

/** The sentence of the compare band, `Comparing h40 with live h41`: `live` says the later build is the one on show. */
export function compareWords(c: CompareState, live: boolean): { lead: string; from: string; mid: string; to: string } {
  if (c.building) return { lead: 'Building ', from: c.building, mid: ' to compare with ', to: c.to }
  return { lead: 'Comparing ', from: c.from, mid: live ? ' with live ' : ' with ', to: c.to }
}
