import { useEffect, useState } from 'react'
import type { RecentFolder, WorkspaceInfo } from '../../shared/workspace'
import { Logo } from './Logo'
import { Plate } from './plate/Plate'
import { nameOf, openProblem } from './openFolder'
import { Readiness } from './Readiness'

/**
 * The first screen, while no folder is open: the dyed plate at the left (780 of 1440), with the vise scribed on it, and at
 * the right, on the surface, the ways in, in two states. On a first run (no folder opened lately): the folder idea in a
 * sentence, then the folder dialog (an empty folder is fine) and, where torno runs from its repository, a copy of its
 * example. Coming back: the folders opened lately first (one that is gone is struck, and can be taken off the list), then
 * the same two ways. What torno needs is under them. Until the list has answered only the plate is shown, so that the
 * first run's words do not flash for someone coming back. The window has no frame here either, so the top 40 px is its
 * drag strip (`welcome-drag`), with the window controls (`BareControls`) over its right end.
 */
export function Welcome({ onPick, onOpened }: { onPick: () => void; onOpened: (info: WorkspaceInfo) => void }) {
  const [recent, setRecent] = useState<RecentFolder[] | null>(null)
  const [example, setExample] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void window.torno.workspace.recent().then(
      (list) => live && setRecent(list),
      // A list that cannot be read is none: the screen is not left at its head.
      () => live && setRecent((was) => was ?? [])
    )
    void window.torno.workspace.hasExample().then(
      (has) => live && setExample(has),
      () => {}
    )
    // A disk that was not mounted may be there now: the list is read again whenever the window is come back to.
    const again = (): void => void window.torno.workspace.recent().then((list) => live && setRecent(list), () => {})
    window.addEventListener('focus', again)
    return () => {
      live = false
      window.removeEventListener('focus', again)
    }
  }, [])

  /** Opens what `ask` answers with; a folder that cannot be opened is said, and the list is read again: it may have gone. */
  const open = (ask: () => Promise<WorkspaceInfo>, what: string): void => {
    setBusy(true)
    setProblem(null)
    ask().then(onOpened, (e: unknown) => {
      setBusy(false)
      setProblem(openProblem(what, e))
      void window.torno.workspace.recent().then(setRecent, () => {})
    })
  }

  const plate = (
    <Plate
      headline="torno"
      lead={
        <>
          <strong>Make CAD parts with an AI agent.</strong> It writes the model in build123d; you point at what to change.
        </>
      }
    />
  )
  const drag = <div className="welcome-drag" aria-hidden="true" />
  if (recent === null)
    return (
      <div className="welcome-page">
        {drag}
        {plate}
      </div>
    )
  const returning = recent.length > 0

  return (
    <div className="welcome-page">
      {drag}
      {plate}
      <div className="welcome-side">
        {returning ? (
          <nav className="welcome-recent" aria-label="Recent folders">
            <h2 className="welcome-title">Recent folders</h2>
            <ul>
              {recent.map((folder) => (
                <li key={folder.root} data-missing={folder.missing ? '' : undefined}>
                  <span className="recent-thumb" aria-hidden="true">
                    {!folder.missing && <Logo small plain />}
                  </span>
                  <button type="button" className="recent-row" disabled={busy || folder.missing} title={folder.missing ? `${folder.root} was not found` : folder.root} onClick={() => open(() => window.torno.workspace.open(folder.root), nameOf(folder.root))}>
                    <span className="recent-name">{nameOf(folder.root)}</span>
                    <span className="recent-path num">
                      <bdi>{folder.root}</bdi>
                    </span>
                  </button>
                  {folder.missing && (
                    <span className="recent-gone-side">
                      <span className="recent-gone">Not found</span>
                      <button type="button" className="button button-quiet" aria-label={`Remove ${nameOf(folder.root)} from the list`} onClick={() => void window.torno.workspace.forget(folder.root).then(setRecent, () => {})}>
                        Remove
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        ) : (
          <>
            <h2 className="welcome-title">Open a folder to work in</h2>
            <p className="welcome-lead">Each project is a folder inside it, with its model in build123d. An empty folder is fine: torno helps you make the first project.</p>
          </>
        )}
        <div className="welcome-ways">
          <button type="button" className="button button-primary" disabled={busy} onClick={onPick}>
            Open folder
          </button>
          {example && (
            <button type="button" className="button" disabled={busy} title="A small project of torno's own, copied to a temporary folder: nothing of the repository is opened or written" onClick={() => open(() => window.torno.workspace.openExample(), 'The example')}>
              Open the example
            </button>
          )}
        </div>
        {example && <p className="welcome-note">The example is a temporary copy, removed when torno quits.</p>}
        {problem !== null && (
          <p className="welcome-problem" role="alert">
            {problem}
          </p>
        )}
        {/* What is ready and what is missing, before anything fails: folded to a line when all is well. */}
        <Readiness variant="block" />
        <p className="welcome-foot">
          torno writes only into a <span className="num">.torno</span> folder inside each project, and the new folder when you make a project.
        </p>
      </div>
    </div>
  )
}
