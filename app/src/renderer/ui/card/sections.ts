import { useMemo } from 'react'
import { checksOf } from '../../../shared/dimension'
import { checksCount } from '../../../shared/modelChecks'
import { sourceCount } from '../../../shared/params'
import type { SectionId } from '../../state/column'
import { profileSaid, useProfile } from '../../state/profile'
import { layerOf, useStore } from '../../state/store'
import { useTracings } from '../../state/tracings'
import { type BadgeData, NO_BADGES } from '../railBadges'
import { groupMarks } from '../markGroups'
import { tried } from '../paramRows'
import { scanState } from '../scanState'
import { useRowsSaid } from '../rowsSaid'

export type { SectionId }

/** The name of an icon of the rail's index: one for each section. */
export type IconName = SectionId

/** The sections of the route card in the order they are read, with the name each has in its head and in the rail's tip. */
export const SECTIONS: Array<{ id: SectionId; title: string; icon: IconName }> = [
  { id: 'needs', title: 'Needs you', icon: 'needs' },
  { id: 'parts', title: 'Parts', icon: 'parts' },
  { id: 'params', title: 'Parameters', icon: 'params' },
  { id: 'checks', title: 'Checks', icon: 'checks' },
  { id: 'marks', title: 'Marks', icon: 'marks' },
  { id: 'scans', title: 'Scans', icon: 'scans' },
  { id: 'tracings', title: 'Tracings', icon: 'tracings' },
  { id: 'profile', title: 'Print profile', icon: 'profile' }
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

const NONE: SectionFacts = { said: 'none', bad: null, needs: false, empty: true }

/** What the badges of the rail count, from the window's state. */
export function useBadgeData(): BadgeData {
  const facts = useFacts()
  return facts.badges
}

/** The head of every section, as the window's state says it now. */
export function useSectionFacts(): Record<SectionId, SectionFacts> {
  return useFacts().sections
}

function useFacts(): { sections: Record<SectionId, SectionFacts>; badges: BadgeData } {
  const scene = useStore((s) => s.scene)
  const layout = useStore((s) => s.layout)
  const layers = useStore((s) => s.layers)
  const marks = useStore((s) => s.marks)
  const revision = useStore((s) => (s.scene ? s.revision : 0))
  const scans = useStore((s) => s.scans)
  const tracings = useTracings((s) => s.file?.tracings)
  const openTracing = useTracings((s) => (s.open === null ? undefined : s.file?.tracings.find((t) => t.id === s.open)))
  const profile = useProfile(useStore((s) => s.objectId))
  // The line that says how a walk through the marks to review went keeps Needs you open for its ten seconds.
  const reviewed = useRowsSaid((s) => s.reviewed !== null)
  return useMemo(() => {
    const parts = (scene?.parts ?? []).filter((p) => p.layout === layout)
    const hidden = parts.filter((p) => layerOf(layers, p.name)?.visible === false).length
    const params = scene?.params ?? []
    const model = scene?.checks ?? []
    const modelFailing = checksCount(model).fail
    const dims = checksOf(marks, revision)
    const dimensionsFailing = dims.failing.length
    const dimensions = dims.failing.length + dims.unmeasured.length + dims.passing.length
    const grouped = groupMarks(marks, revision)
    const unaligned = scans.filter((scan) => scanState(scan, layout, revision).word === 'unaligned').length
    const open = marks.filter((m) => m.status !== 'resolved').length
    const sketches = marks.filter((m) => m.kind === 'sketch' && m.status !== 'resolved').length
    const failing = modelFailing + dimensionsFailing
    const waiting = grouped.toReview.length + grouped.fromAgent.length + failing
    const badges: BadgeData = { ...NO_BADGES, waiting, hidden, modelFailing, dimensionsFailing, unaligned, toReview: grouped.toReview.length }

    const changed = params.filter(tried).length
    const assumed = sourceCount(params).assumed.length
    const checksTotal = model.length + dimensions
    const said = (...pieces: Array<string | false>): string => pieces.filter((p): p is string => p !== false).join(', ')

    const sections: Record<SectionId, SectionFacts> = {
      needs: waiting > 0 ? { said: `${waiting} waiting`, bad: null, needs: true, empty: false } : reviewed ? { said: '0 waiting', bad: null, needs: false, empty: false } : NONE,
      parts: parts.length === 0 ? NONE : { said: said(`${parts.length}`, hidden > 0 && `${hidden} hidden`), bad: null, needs: false, empty: false },
      params: params.length === 0 ? NONE : { said: said(`${params.length}`, changed > 0 && `${changed} tried`, assumed > 0 && `${assumed} assumed`), bad: null, needs: false, empty: false },
      checks: checksTotal === 0 ? NONE : { said: `${checksTotal}`, bad: failing > 0 ? `${failing} fail${failing === 1 ? 's' : ''}` : null, needs: failing > 0, empty: false },
      // Review this build is in its body, so it is never shut for being empty.
      marks: marks.length === 0 ? { ...NONE, empty: false } : { said: said(`${open} open`, sketches > 0 && `${sketches} sketch${sketches === 1 ? '' : 'es'}`, grouped.toSend.length > 0 && `${grouped.toSend.length} to send`), bad: null, needs: false, empty: false },
      // Import and the first tracing are made in the section's body: a scan or a tracing's section is never shut for being empty.
      scans: { said: scans.length === 0 ? 'none' : said(`${scans.length}`, unaligned > 0 && `${unaligned} unaligned`), bad: null, needs: false, empty: false },
      tracings: { said: (tracings?.length ?? 0) === 0 ? 'none' : said(`${tracings!.length}`, openTracing !== undefined && `${openTracing.id}${openTracing.name === '' ? '' : ` ${openTracing.name}`}`), bad: null, needs: false, empty: false },
      // The printer and the material the project is made for; its choosers are in the body, so it is never shut for being empty.
      profile: { said: profileSaid(profile), bad: null, needs: false, empty: false, plain: true }
    }
    return { sections, badges }
  }, [scene, layout, layers, marks, revision, scans, tracings, openTracing, profile, reviewed])
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
