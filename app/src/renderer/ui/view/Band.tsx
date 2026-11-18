import type { ComponentProps, ReactNode } from 'react'
import { useBoard } from '../../state/board'
import { openRoundNow, useReview } from '../../state/review'
import { activePlane, useSketching } from '../../state/sketching'
import { isLive } from '../../state/compare'
import { useStore } from '../../state/store'
import { useTracings } from '../../state/tracings'
import { useHistory } from '../useHistory'
import { BAND_TONE, bandOf, failedWords, sketchWords, type BandKind } from './bandKind'

/**
 * The band at the top left of the view: one sentence for a mode of the whole view (spec 2026-11-18, "A band"). It is a pill 34 px
 * high, the accent's when the mode asks something of the person and quiet (`--raise`, ink) when it only informs. What it holds
 * is its mode's: the words, and the buttons inside as 26 px pills (`BandButton`). It drops in 8 px over 0.3 s. Tags stand clear of
 * it (`data-tag-avoid`). Each mode draws its own band (`ReviewBar`, `CompareBar`, `FailedBand`, `SketchBand`, `FacePickBar`, the
 * line-up) and asks `useBand` whether it is the one that shows.
 */
export function Band({ kind, label, part, controls = true, children }: { kind: BandKind; label: string; part?: string; controls?: boolean; children: ReactNode }) {
  return (
    <div className="band" role={controls ? 'toolbar' : 'status'} aria-label={label} data-band={kind} data-tone={BAND_TONE[kind]} data-part={part} data-tag-avoid="">
      {children}
    </div>
  )
}

/** A button inside a band: a 26 px pill, `--on-accent` ground with accent text when primary, transparent otherwise. */
export function BandButton({ primary = false, ...rest }: ComponentProps<'button'> & { primary?: boolean }) {
  return <button type="button" {...rest} className={`band-button${rest.className ? ` ${rest.className}` : ''}`} data-primary={primary ? '' : undefined} />
}

/**
 * Which band the view wears now, or none. The modes of the model's view count while the model is shown, the line-up while a
 * tracing is; the board and the pages over the view have none. Export is not in the dock yet: nothing opens it (the sheet is a sheet).
 */
export function useBand(): BandKind | null {
  const shown = useBoard((s) => s.shown)
  const onPage = useStore((s) => s.page === 'object')
  const comparing = useStore((s) => s.compare !== null)
  const failedOnShow = useStore((s) => s.build?.status === 'failed' && s.scene !== null)
  const roundOpen = useReview((s) => openRoundNow(s) !== undefined)
  const sketching = useSketching((s) => s.open !== null)
  const facePick = useTracings((s) => s.facing)
  const lining = useTracings((s) => s.lining !== null)
  if (!onPage) return null
  if (shown === 'tracing') return bandOf({ exportOpen: false, roundOpen: false, lineup: lining, facePick: false, comparing: false, sketching: false, failedOnShow: false })
  if (shown !== 'model') return null
  return bandOf({ exportOpen: false, roundOpen, lineup: false, facePick, comparing, sketching, failedOnShow })
}

/** The id of the kept build that is on show (`h40`), or null when none of the kept ones is. */
function useShownBuild(active: boolean): string | null {
  const list = useHistory(active)
  const revision = useStore((s) => s.revision)
  if (!list) return null
  return list.entries.find((e) => isLive(e, list.run, revision))?.id ?? null
}

/** A build that failed while the one before it is on show: said quietly, with a `--fail` dot. */
export function FailedBand() {
  const here = useBand() === 'failed'
  const shown = useShownBuild(here)
  if (!here) return null
  const words = failedWords(shown)
  return (
    <Band kind="failed" label="Build failed" part="failed-band" controls={false}>
      <span className="band-dot" aria-hidden="true" />
      <span>
        {words.before}
        {words.ref !== null ? <span className="num">{words.ref}</span> : 'the build before'}
        {words.after}
      </span>
    </Band>
  )
}

/** A sketch open: what is sketched and on which plane. The sketch's own panel is in the card's head. */
export function SketchBand() {
  const here = useBand() === 'sketch'
  const id = useSketching((s) => s.open?.id)
  const plane = useSketching((s) => activePlane(s)?.label ?? null)
  if (!here) return null
  const words = sketchWords(id, plane)
  return (
    <Band kind="sketch" label="Sketch" part="sketch-band" controls={false}>
      <span>
        {words.lead} {words.ref !== null ? <span className="num">{words.ref}</span> : 'a new sketch'} on {plane === null ? words.on : <span className="num">{words.on}</span>}
      </span>
    </Band>
  )
}
