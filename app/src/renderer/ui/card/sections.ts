import { useMemo } from 'react'
import type { SectionId } from '../../state/column'
import { useStore } from '../../state/store'
import { useTracings } from '../../state/tracings'
import { scanState } from '../scanState'

export type { SectionId }

/** The sections under the bench in the order they are read, with the name each has in its head. */
export const SECTIONS: Array<{ id: SectionId; title: string }> = [
  { id: 'scans', title: 'Scans' },
  { id: 'tracings', title: 'Tracings' }
]

/** What a section says of what it holds in its head, in a line. */
export interface SectionFacts {
  /** The words, numbers and refs in them to be set in the monospace face: `10, 2 hidden`. */
  said: string
  /** What of it fails or waits, in the colour of a failure, after `said`: `1 defect`. */
  bad: string | null
  /** Something in it fails or waits on the person: its dot on the route is ringed in the failure's colour. */
  needs: boolean
  /** Nothing in it: its head says "none" and it does not unfold. */
  empty: boolean
  /** `said` is names and not a count: nothing in it is set in the face of numbers (`Bambu X1C, PETG`). */
  plain?: boolean
}


/** The head of every section, as the window's state says it now. */
export function useSectionFacts(): Record<SectionId, SectionFacts> {
  return useFacts()
}

function useFacts(): Record<SectionId, SectionFacts> {
  const layout = useStore((s) => s.layout)
  const revision = useStore((s) => (s.scene ? s.revision : 0))
  const scans = useStore((s) => s.scans)
  const tracings = useTracings((s) => s.file?.tracings)
  const openTracing = useTracings((s) => (s.open === null ? undefined : s.file?.tracings.find((t) => t.id === s.open)))
  return useMemo(() => {
    const unaligned = scans.filter((scan) => scanState(scan, layout, revision).word === 'unaligned').length
    const said = (...pieces: Array<string | false>): string => pieces.filter((p): p is string => p !== false).join(', ')
    const sections: Record<SectionId, SectionFacts> = {
      // Import and the first tracing are made in the section's body: a scan or a tracing's section is never shut for being empty.
      scans: { said: scans.length === 0 ? 'none' : said(`${scans.length}`, unaligned > 0 && `${unaligned} unaligned`), bad: null, needs: false, empty: false },
      tracings: { said: (tracings?.length ?? 0) === 0 ? 'none' : said(`${tracings!.length}`, openTracing !== undefined && `${openTracing.id}${openTracing.name === '' ? '' : ` ${openTracing.name}`}`), bad: null, needs: false, empty: false }
    }
    return sections
  }, [layout, revision, scans, tracings, openTracing])
}

/** Where the card's reading line stands, as a share of the scroll's height from its top: the section whose head has passed it is in sight. */
export const READING_LINE = 0.4

/**
 * Which section is in sight: the last whose head has reached the reading line (the top `READING_LINE` of the scroll), the first
 * while none has, and the last once the card is scrolled to its end. `tops` are the heads' distances from the scroll's top, in
 * the order of the card; `height` is the scroll's.
 */
export function inSight(tops: ReadonlyArray<{ id: SectionId; top: number }>, height: number, atEnd: boolean): SectionId | null {
  if (tops.length === 0) return null
  if (atEnd) return tops[tops.length - 1].id
  let here = tops[0].id
  for (const { id, top } of tops) if (top <= height * READING_LINE) here = id
  return here
}
