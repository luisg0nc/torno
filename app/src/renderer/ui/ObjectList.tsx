import { actions, useStore } from '../state/store'
import { openNewObject } from './onboard/NewObject'
import { PAGE_KEY } from './ShowPage'

/** The objects of the workspace. One that cannot be built is muted, with the reason as its tooltip. */
export function ObjectList({ onOpen }: { onOpen: (id: string) => void }) {
  const objects = useStore((s) => s.workspace?.objects ?? NONE)
  const openId = useStore((s) => s.objectId)
  const paged = useStore((s) => s.page === 'objects')
  const creating = useStore((s) => s.page === 'new')

  return (
    <nav className="section objects" aria-label="Objects">
      <h2 className="section-title">Objects</h2>
      {objects.length === 0 ? (
        // The page of objects says it in full beside this: it is said once.
        !paged && <p className="section-note">No objects here yet. An object is a folder with a Python model in it.</p>
      ) : (
        <ul className="rows">
          <li>
            {/* The page of the workspace's objects, over the view; pressed again, back to the object that is open. */}
            <button type="button" className="row page-row" aria-pressed={paged} title={`All objects (${PAGE_KEY})`} onClick={() => actions.showPage(paged ? 'object' : 'objects')}>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" aria-hidden="true">
                <rect x="2.25" y="2.75" width="4.75" height="4.25" rx="1" />
                <rect x="9" y="2.75" width="4.75" height="4.25" rx="1" />
                <rect x="2.25" y="9" width="4.75" height="4.25" rx="1" />
                <rect x="9" y="9" width="4.75" height="4.25" rx="1" />
              </svg>
              <span className="row-name">All objects</span>
              <kbd aria-hidden="true">{PAGE_KEY}</kbd>
            </button>
          </li>
          {objects.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                className="row object-row"
                aria-current={o.id === openId && !creating ? 'true' : undefined}
                data-problem={o.problem ? '' : undefined}
                title={o.problem}
                onClick={() => onOpen(o.id)}
              >
                <span className="row-name">{o.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {/* The way to a new object: a page for what it is and what there is to give, then Claude Code starts with it. */}
      <button type="button" className="button button-quiet new-object-button" aria-pressed={creating} onClick={openNewObject}>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" aria-hidden="true">
          <path d="M8 3.5v9M3.5 8h9" />
        </svg>
        New object
      </button>
    </nav>
  )
}

const NONE: never[] = []
