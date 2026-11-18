import { actions, useStore } from '../state/store'
import { Chevron } from './Chevron'
import { FolderMenu, type FolderChoice } from './FolderMenu'
import { Logo } from './Logo'
import { PAGE_KEY } from './ShowPage'
import { SessionDot } from './SessionDot'
import { dockToggleName, dockToggleSaid, focusAsk, rowSaid, signOf, SIGN_SAID } from './sessionSign'
import { titleSigns } from './titleSigns'
import { useMenu } from './useMenu'
import { WindowControls } from './WindowControls'

/**
 * The window's title bar, across the top (a drag region; every control in it is no-drag): the vise, the folder as a crumb
 * with its menu, `/`, the project as a crumb with the menu of the folder's projects, and at the right the session signs of
 * the other projects, the dock's toggle, and the window controls where the window draws them. On the page of projects and
 * with no project open only the folder shows; on the page of a new project the second crumb reads "New project".
 */
export function TitleBar({ folder, disabled, onChoose, onOpen }: { folder: string; disabled: boolean; onChoose: (choice: FolderChoice) => void; onOpen: (id: string) => void }) {
  const objects = useStore((s) => s.workspace?.objects)
  const openId = useStore((s) => s.objectId)
  const page = useStore((s) => s.page)
  const sessions = useStore((s) => s.sessions)
  const list = objects ?? []
  const open = list.find((o) => o.id === openId)
  const { shown, more } = titleSigns(list, sessions, openId)
  return (
    <header className="title-row">
      <span className="title-vise" aria-hidden="true">
        <Logo small />
      </span>
      <FolderMenu open={folder} disabled={disabled} onChoose={onChoose} />
      {page === 'new' ? (
        <>
          <span className="crumb-slash" aria-hidden="true">
            /
          </span>
          <span className="crumb crumb-project" aria-current="page">
            New project
          </span>
        </>
      ) : (
        page === 'object' &&
        open && (
          <>
            <span className="crumb-slash" aria-hidden="true">
              /
            </span>
            <ProjectMenu name={open.name} openId={open.id} onOpen={onOpen} />
          </>
        )
      )}
      <span className="title-grow" />
      {shown.length > 0 && (
        <div className="title-signs">
          {shown.map((one) => (
            <button
              key={one.id}
              type="button"
              className="title-sign"
              data-sign={one.state}
              aria-label={one.name}
              aria-description={rowSaid(one.state)}
              title={`${one.name} ${SIGN_SAID[one.state]}`}
              onClick={() => {
                onOpen(one.id)
                if (one.state === 'needs_input') {
                  actions.setDockOpen(true)
                  focusAsk(one.id)
                }
              }}
            >
              <SessionDot sign={one.state} />
              <span>
                {one.name} {SIGN_SAID[one.state]}
              </span>
            </button>
          ))}
          {more > 0 && <span className="title-more num">+{more}</span>}
        </div>
      )}
      <DockToggle />
      <WindowControls />
    </header>
  )
}

/** The project crumb (`intake ▾`) and its menu: All projects at its head, then the folder's projects, a session that works or waits said on its row. */
function ProjectMenu({ name, openId, onOpen }: { name: string; openId: string; onOpen: (id: string) => void }) {
  const objects = useStore((s) => s.workspace?.objects ?? [])
  const sessions = useStore((s) => s.sessions)
  const { shown, setShown, button, menu, onKeyDown } = useMenu()
  return (
    <div className="folder-menu-host">
      <button ref={button} type="button" className="crumb crumb-project" aria-label={`Project ${name}`} aria-haspopup="menu" aria-expanded={shown} onClick={() => setShown(!shown)}>
        <span className="crumb-name">{name}</span>
        <Chevron />
      </button>
      {shown && (
        <div ref={menu} className="menu project-menu" role="menu" aria-label="Projects" onKeyDown={onKeyDown}>
          <button
            type="button"
            role="menuitem"
            className="menu-item project-item"
            title={`All projects (${PAGE_KEY})`}
            onClick={() => {
              setShown(false)
              actions.showPage('objects')
            }}
          >
            <span className="project-name">All projects</span>
            <kbd aria-hidden="true">{PAGE_KEY}</kbd>
          </button>
          <hr className="menu-rule" />
          {objects.map((o) => {
            const sign = signOf(sessions[o.id]?.status)
            const said = rowSaid(sign)
            return (
              <button
                key={o.id}
                type="button"
                role="menuitem"
                className="menu-item project-item"
                aria-current={o.id === openId ? 'true' : undefined}
                aria-description={said}
                data-problem={o.problem ? '' : undefined}
                title={o.problem ?? (said && `${o.name}, ${said}`)}
                onClick={() => {
                  setShown(false)
                  onOpen(o.id)
                }}
              >
                <span className="project-name">{o.name}</span>
                {sign !== null && <SessionDot sign={sign} word />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** Shows and hides the session dock; hidden, the open project's session that works or waits shows on it. */
function DockToggle() {
  const dockOpen = useStore((s) => s.dockOpen)
  const sign = useStore((s) => signOf(s.objectId === null ? undefined : s.sessions[s.objectId]?.status))
  const said = dockToggleSaid(dockOpen, sign)
  return (
    <button
      type="button"
      className="dock-toggle"
      aria-label={dockToggleName(dockOpen)}
      aria-description={said}
      aria-expanded={dockOpen}
      title={said ? `${dockToggleName(dockOpen)}: ${said}` : dockToggleName(dockOpen)}
      data-session={!dockOpen && sign !== null ? sign : undefined}
      onClick={() => actions.setDockOpen(!dockOpen)}
    >
      <DockIcon />
      {/* Hidden, the session of the open object still shows that it works, or waits for the answer. */}
      {!dockOpen && sign !== null && <SessionDot sign={sign} />}
    </button>
  )
}

function DockIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" aria-hidden="true">
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.75" />
      <path d="M10 2.75v10.5" />
    </svg>
  )
}

/** Only the window controls, over the first screen, which has no title bar of its own (drawn where the platform gives none). */
export function BareControls() {
  return (
    <div className="title-bare">
      <WindowControls />
    </div>
  )
}
