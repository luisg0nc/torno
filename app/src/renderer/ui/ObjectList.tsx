import { actions, useStore } from '../state/store'
import { openNewObject } from './onboard/NewObject'
import { PAGE_KEY } from './ShowPage'
import { SessionDot } from './SessionDot'
import { rowSaid, signOf } from './sessionSign'

/**
 * The objects of the workspace, the Projects panel's list. One that cannot be built is muted, with the reason as its
 * tooltip; one whose session works or waits says so on its row. While an object is open (or a new one is being made)
 * in a workspace of several, the way to the page of objects is beside the title; with none open it is the first row.
 */
export function ObjectList({ onOpen }: { onOpen: (id: string) => void }) {
  const objects = useStore((s) => s.workspace?.objects ?? NONE)
  const openId = useStore((s) => s.objectId)
  const paged = useStore((s) => s.page === 'objects')
  const creating = useStore((s) => s.page === 'new')
  const sessions = useStore((s) => s.sessions)
  // The panel is of an object (one open, or a new one being made, in a workspace of several): the way to the page of
  // objects is beside the title, the one control it is, so that the focus it had comes back to it when the page goes.
  const ofObject = objects.length > 1 && (creating || openId !== null)

  return (
    <nav className="section objects" aria-label="Projects">
      {ofObject ? (
        <div className="section-head">
          <h2 className="section-title">Projects</h2>
          {/* The page of the workspace's objects, over the view; pressed again, back to the object that is open. */}
          <button type="button" className="button button-quiet page-button" aria-pressed={paged} title={`All projects (${PAGE_KEY})`} onClick={() => actions.showPage(paged ? 'object' : 'objects')}>
            <PageIcon />
            All projects
            <kbd aria-hidden="true">{PAGE_KEY}</kbd>
          </button>
        </div>
      ) : (
        <h2 className="section-title">Projects</h2>
      )}
      {objects.length === 0 ? (
        // The page of objects says it in full beside this: it is said once.
        !paged && <p className="section-note">No projects here yet. A project is a folder with a Python model in it.</p>
      ) : (
        <ul className="rows">
          {!ofObject && (
            <li>
              {/* The page of the workspace's objects, over the view. */}
              <button type="button" className="row page-row" aria-pressed={paged} title={`All projects (${PAGE_KEY})`} onClick={() => actions.showPage(paged ? 'object' : 'objects')}>
                <PageIcon />
                <span className="row-name">All projects</span>
                <kbd aria-hidden="true">{PAGE_KEY}</kbd>
              </button>
            </li>
          )}
          {objects.map((o) => {
            // The session of an object that is not the one open still asks for the person, or works: said where the eye is.
            const sign = signOf(sessions[o.id]?.status)
            const said = rowSaid(sign)
            return (
              <li key={o.id}>
                <button
                  type="button"
                  className="row object-row"
                  aria-current={o.id === openId && !creating ? 'true' : undefined}
                  aria-description={said}
                  data-problem={o.problem ? '' : undefined}
                  data-session={sign ?? undefined}
                  title={o.problem ?? (said && `${o.name}, ${said}`)}
                  onClick={() => onOpen(o.id)}
                >
                  <span className="row-name">{o.name}</span>
                  {sign !== null && <SessionDot sign={sign} word />}
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {/* The way to a new object: a page for what it is and what there is to give, then Claude Code starts with it. */}
      <button type="button" className="button button-quiet new-object-button" aria-pressed={creating} onClick={openNewObject}>
        <PlusIcon />
        New project
      </button>
    </nav>
  )
}

function PageIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" aria-hidden="true">
      <rect x="2.25" y="2.75" width="4.75" height="4.25" rx="1" />
      <rect x="9" y="2.75" width="4.75" height="4.25" rx="1" />
      <rect x="2.25" y="9" width="4.75" height="4.25" rx="1" />
      <rect x="9" y="9" width="4.75" height="4.25" rx="1" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" aria-hidden="true">
      <path d="M8 3.5v9M3.5 8h9" />
    </svg>
  )
}

const NONE: never[] = []
