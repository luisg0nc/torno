import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { hint } from '../../shared/keys'
import { type SectionId, sectionsFor } from '../state/column'
import { actions, useStore } from '../state/store'
import { SECTIONS, useBadgeData, useSectionFacts } from './card/sections'
import { showKeys } from './KeySheet'
import { badgeSaid, badgeText } from './railBadges'
import { RailTip } from './RailTip'
import { SessionDot } from './SessionDot'
import { switcherSign } from './sessionSign'
import { giveKeysBack } from './typing'

const PROJECTS_ICON = (
  <>
    <rect x="2.25" y="2.25" width="5.5" height="5.5" rx="1.25" />
    <rect x="10.25" y="2.25" width="5.5" height="5.5" rx="1.25" />
    <rect x="2.25" y="10.25" width="5.5" height="5.5" rx="1.25" />
    <rect x="10.25" y="10.25" width="5.5" height="5.5" rx="1.25" />
  </>
)

/** One icon each for the sections of the card, at 19 px, stroked 1.35 as the rest of the window's, in the colour of the quiet text. */
const ICON: Record<SectionId, ReactNode> = {
  needs: <path d="M2.25 10.25h3.5l1.25 2h4l1.25-2h3.5M2.25 10.25 4.5 3.25h9l2.25 7v5.5H2.25Z" />,
  parts: <path d="M9 2.25 15.75 6 9 9.75 2.25 6ZM2.25 9.5 9 13.25 15.75 9.5M2.25 13 9 16.75 15.75 13" />,
  params: (
    <>
      <path d="M5 2.25v2.5M5 9.25v6.5M13 2.25v7M13 13.25v2.5M9 2.25v1M9 7.25v8.5" />
      <circle cx="5" cy="7" r="2" />
      <circle cx="13" cy="11.25" r="2" />
      <circle cx="9" cy="5.25" r="2" />
    </>
  ),
  checks: (
    <>
      <path d="M2.75 13.5a6.25 6.25 0 0 1 12.5 0" />
      <path d="M9 13.5 12 8.5" />
    </>
  ),
  marks: <path d="M9 16.25s4.75-4.75 4.75-8.5a4.75 4.75 0 0 0-9.5 0c0 3.75 4.75 8.5 4.75 8.5Z" />,
  scans: (
    <>
      <path d="M2.75 13c1.9-5.75 10.6-5.75 12.5 0" />
      <circle cx="9" cy="8.25" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  tracings: (
    <>
      <rect x="2.25" y="3.25" width="13.5" height="11.5" rx="1.5" />
      <path d="M5 11.5 8 7l2.5 3 1.5-2 1.5 3.5" strokeDasharray="1.6 1.4" />
      <path d="M2.25 6h2M2.25 9h2M2.25 12h2" />
    </>
  ),
  profile: (
    <>
      <rect x="2.75" y="7.25" width="12.5" height="6" rx="1" />
      <path d="M5.25 7.25v-4h7.5v4M5.75 13.25v2.5h6.5v-2.5" />
    </>
  )
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

/**
 * The rail: a thin column of icons, and Keys at the foot. No word is drawn under an icon: the name is the button's accessible
 * name and, on hover and keyboard focus, a tip (`RailTip`). Projects stands at the top: pressed, it shows the page of projects
 * (pressed again, back to the project that is open), and while that page is up it is the dyed tile (`data-dyed`,
 * `aria-pressed`). It does not count: it says instead, as the folder's list did, that a session of any project works or waits
 * for the person. Then a hairline, and the index of the route card, one icon for each section (`SECTIONS`), only while a
 * project is open: a press brings the section into sight, unfolded (`actions.showSection`); the one in sight has the accent's
 * wash (`aria-current`). What the sections' folded heads said (what waits, parts switched off, checks that fail, scans not
 * aligned, marks to review) is a badge on its icon, in the monospace face, and in words as the button's description. Pressed
 * with the pointer, the next letter is the view's.
 */
export function Rail() {
  const page = useStore((s) => s.page)
  const objectId = useStore((s) => s.objectId)
  const here = useStore((s) => s.sectionHere)
  const badges = useBadgeData()
  const facts = useSectionFacts()
  const objects = useStore((s) => s.workspace?.objects)
  const creating = useStore((s) => s.page === 'new')
  const onPage = page === 'objects'
  const sessions = useStore((s) => s.sessions)
  const { sign, said: sessionSaid } = switcherSign(creating ? null : objectId, objects ?? [], sessions)
  const offered = sectionsFor({ page, objectId })
  return (
    <div className="rail">
      <RailButton
        label="Projects"
        data-rail="projects"
        data-dyed={onPage ? 'true' : undefined}
        data-session={sign ?? undefined}
        aria-description={sessionSaid}
        aria-pressed={onPage}
        onClick={(e) => {
          actions.showPage(onPage ? 'object' : 'objects')
          // A press of the pointer (Enter or Space has no count): the next letter is the view's.
          if (e.detail > 0) giveKeysBack(e.currentTarget)
        }}
      >
        <RailIcon>{PROJECTS_ICON}</RailIcon>
        {sign !== null && <SessionDot sign={sign} />}
      </RailButton>
      {offered.length > 0 && <span className="rail-sep" aria-hidden="true" />}
      {SECTIONS.filter((section) => offered.includes(section.id)).map((section) => {
        const text = badgeText(section.id, badges)
        return (
          <RailButton
            key={section.id}
            label={section.title}
            data-section={section.id}
            data-empty={facts[section.id].empty ? 'true' : undefined}
            aria-description={badgeSaid(section.id, badges)}
            aria-current={here === section.id ? 'true' : undefined}
            onClick={(e) => {
              actions.showSection(section.id)
              if (e.detail > 0) giveKeysBack(e.currentTarget)
            }}
          >
            <RailIcon>{ICON[section.icon]}</RailIcon>
            {text !== '' && (
              <span className="rail-badge num" data-section={section.id} aria-hidden="true">
                {text}
              </span>
            )}
          </RailButton>
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
