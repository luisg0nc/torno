import { Fragment, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { hint } from '../../shared/keys'
import { checksCount } from '../../shared/modelChecks'
import { type RailPanel, panelsFor, shownPanel } from '../state/column'
import { actions, layerOf, useStore } from '../state/store'
import { showKeys } from './KeySheet'
import { groupMarks } from './markGroups'
import { badgeSaid, badgeText } from './railBadges'
import { RailTip } from './RailTip'
import { scanState } from './scanState'
import { SessionDot } from './SessionDot'
import { switcherSign } from './sessionSign'
import { giveKeysBack } from './typing'

/** What the rail offers now, and which of it is open: the page, the open project and what the person last chose (`state/column.ts`). */
export function useRail(): { offered: readonly RailPanel[]; shown: RailPanel | null } {
  const page = useStore((s) => s.page)
  const objectId = useStore((s) => s.objectId)
  const open = useStore((s) => s.column.open)
  // The offer only changes with these two: the array is the same one between renders.
  const offered = panelsFor({ page, objectId })
  return { offered, shown: shownPanel(open, offered) }
}

const LABEL: Record<RailPanel, string> = { projects: 'Projects', layers: 'Layers', params: 'Params', scans: 'Scans', marks: 'Marks' }

/** One icon each, at 19 px, stroked 1.35 as the rest of the window's, in the colour of the quiet text. */
const ICON: Record<RailPanel, ReactNode> = {
  projects: (
    <>
      <rect x="2.25" y="2.25" width="5.5" height="5.5" rx="1.25" />
      <rect x="10.25" y="2.25" width="5.5" height="5.5" rx="1.25" />
      <rect x="2.25" y="10.25" width="5.5" height="5.5" rx="1.25" />
      <rect x="10.25" y="10.25" width="5.5" height="5.5" rx="1.25" />
    </>
  ),
  layers: <path d="M9 2.25 15.75 6 9 9.75 2.25 6ZM2.25 9.5 9 13.25 15.75 9.5M2.25 13 9 16.75 15.75 13" />,
  params: (
    <>
      <path d="M5 2.25v2.5M5 9.25v6.5M13 2.25v7M13 13.25v2.5M9 2.25v1M9 7.25v8.5" />
      <circle cx="5" cy="7" r="2" />
      <circle cx="13" cy="11.25" r="2" />
      <circle cx="9" cy="5.25" r="2" />
    </>
  ),
  scans: (
    <>
      <path d="M2.75 13c1.9-5.75 10.6-5.75 12.5 0" />
      <circle cx="9" cy="8.25" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  marks: <path d="M9 16.25s4.75-4.75 4.75-8.5a4.75 4.75 0 0 0-9.5 0c0 3.75 4.75 8.5 4.75 8.5Z" />
}

const KEYS_ICON = (
  <>
    <rect x="1.75" y="4.25" width="14.5" height="9.5" rx="2" />
    <path d="M4.5 7.25h1M8.5 7.25h1M12.5 7.25h1M5.5 10.75h7" />
  </>
)

function RailIcon({ children }: { children: ReactNode }) {
  return (
    <svg className="rail-icon" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

/** A button of the rail with its tip: the tip is told which element it is for, once the button is in the page. */
function RailButton({ label, children, ...props }: { label: string; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement> & { [data: `data-${string}`]: string | undefined }) {
  const [button, setButton] = useState<HTMLButtonElement | null>(null)
  return (
    <>
      <button ref={setButton} type="button" className="rail-button" {...props} aria-label={label}>
        {children}
      </button>
      <RailTip label={label} for={button} />
    </>
  )
}

/** The numbers the closed panels say on their icons: as the folded titles said them, now the rail's. */
function useCounts(): Record<RailPanel, number> {
  const hidden = useStore((s) => (s.scene ? s.scene.parts.filter((p) => p.layout === s.layout && layerOf(s.layers, p.name)?.visible === false).length : 0))
  const failing = useStore((s) => checksCount(s.scene?.checks ?? []).fail)
  const unaligned = useStore((s) => {
    const revision = s.scene ? s.revision : 0
    return s.scans.filter((scan) => scanState(scan, s.layout, revision).word === 'unaligned').length
  })
  const toReview = useStore((s) => groupMarks(s.marks, s.scene ? s.revision : 0).toReview.length)
  return { projects: 0, layers: hidden, params: failing, scans: unaligned, marks: toReview }
}

/**
 * The rail: a thin column of icons, one for each panel of the left (`RailPanel`), and Keys at the foot. No word is
 * drawn under an icon: the name is the button's accessible name and, on hover and keyboard focus, a tip (`RailTip`).
 * A press opens that panel beside it, which pushes the view over; a press on the open one closes it; another switches.
 * What the folded titles said of a panel (parts switched off, checks that fail, scans not aligned, marks to review) is a
 * badge on its icon, in the monospace face and in words as the button's description. Projects has no count: it says
 * instead, as the folder's list did folded, that a session of any project works or waits for the person. Projects
 * pressed on the page of projects is the dyed tile (`data-dyed`); any other open panel has the accent's wash. Pressed
 * with the pointer, the next letter is the view's.
 */
export function Rail({ offered, shown }: { offered: readonly RailPanel[]; shown: RailPanel | null }) {
  const counts = useCounts()
  const objects = useStore((s) => s.workspace?.objects)
  const openId = useStore((s) => s.objectId)
  const creating = useStore((s) => s.page === 'new')
  const onPage = useStore((s) => s.page === 'objects')
  const sessions = useStore((s) => s.sessions)
  const { sign, said: sessionSaid } = switcherSign(creating ? null : openId, objects ?? [], sessions)
  return (
    <div className="rail">
      {offered.map((panel, i) => {
        const count = counts[panel]
        const text = badgeText(count)
        const said = panel === 'projects' ? sessionSaid : badgeSaid(panel, count)
        return (
          <Fragment key={panel}>
            <RailButton
              label={LABEL[panel]}
              data-panel={panel}
              data-dyed={panel === 'projects' && onPage && shown === 'projects' ? 'true' : undefined}
              data-session={panel === 'projects' ? (sign ?? undefined) : undefined}
              aria-description={said}
              aria-pressed={shown === panel}
              onClick={(e) => {
                actions.openPanel(shown === panel ? null : panel)
                // A press of the pointer (Enter or Space has no count): the next letter is the view's.
                if (e.detail > 0) giveKeysBack(e.currentTarget)
              }}
            >
              <RailIcon>{ICON[panel]}</RailIcon>
              {text !== '' && (
                <span className="rail-badge num" data-panel={panel} aria-hidden="true">
                  {text}
                </span>
              )}
              {panel === 'projects' && sign !== null && <SessionDot sign={sign} />}
            </RailButton>
            {i === 0 && offered.length > 1 && <span className="rail-sep" aria-hidden="true" />}
          </Fragment>
        )
      })}
      <span className="rail-grow" aria-hidden="true" />
      <RailButton label="Keys" data-rail="keys" aria-keyshortcuts={hint('keys')} aria-description={KEYS_SAY} onClick={() => showKeys()}>
        <RailIcon>{KEYS_ICON}</RailIcon>
      </RailButton>
    </div>
  )
}

const KEYS_SAY = 'Every key, and how the pointer turns, pans and zooms the view'
