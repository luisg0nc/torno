import { useEffect, useState } from 'react'
import { hint } from '../../shared/keys'
import type { RecentFolder, WorkspaceInfo } from '../../shared/workspace'
import { Logo } from './Logo'
import { nameOf, openProblem } from './welcome'

/**
 * The first screen, while no folder is open: what torno is, what an object is, and what to do, in a sentence
 * each. Then the ways in: the folder dialog, the folders opened lately (one that is gone is struck, and can be
 * taken off the list), and, where torno runs from its repository, a copy of its example.
 */
export function Welcome({ onPick, onOpened }: { onPick: () => void; onOpened: (info: WorkspaceInfo) => void }) {
  const [recent, setRecent] = useState<RecentFolder[]>([])
  const [example, setExample] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void window.torno.workspace.recent().then(
      (list) => live && setRecent(list),
      () => {}
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

  return (
    <div className="welcome-page">
      <header className="welcome-head">
        <Logo />
        <h1 className="wordmark">torno</h1>
      </header>
      <div className="welcome-says">
        <p>torno is a workbench for CAD parts: an AI coding agent writes each part as Python (build123d), and you point at the result.</p>
        <p>
          An object is a folder with one Python model in it, for example <span className="num">bracket/bracket.py</span>, inside the folder that holds your objects.
        </p>
        <p>Open the folder that holds them, or the example, to begin.</p>
      </div>
      <div className="welcome-ways">
        <button type="button" className="button button-primary" disabled={busy} onClick={onPick}>
          Open folder
        </button>
        {example && (
          <button type="button" className="button" disabled={busy} title="Four small objects of torno's own, copied to a temporary folder: nothing of the repository is opened or written" onClick={() => open(() => window.torno.workspace.openExample(), 'The example')}>
            Open the example
          </button>
        )}
      </div>
      {example && <p className="welcome-note">The example opens as a temporary copy: it is removed when torno quits.</p>}
      {problem !== null && (
        <p className="welcome-problem" role="alert">
          {problem}
        </p>
      )}
      {recent.length > 0 && (
        <nav className="welcome-recent" aria-label="Recent folders">
          <h2 className="section-title">Recent folders</h2>
          <ul>
            {recent.map((folder) => (
              <li key={folder.root} data-missing={folder.missing ? '' : undefined}>
                <button type="button" className="recent-row" disabled={busy || folder.missing} title={folder.missing ? `${folder.root} was not found` : folder.root} onClick={() => open(() => window.torno.workspace.open(folder.root), nameOf(folder.root))}>
                  <span className="recent-name">{nameOf(folder.root)}</span>
                  <span className="recent-path num">
                    <bdi>{folder.root}</bdi>
                  </span>
                </button>
                {folder.missing && (
                  <>
                    <span className="recent-gone">Not found</span>
                    <button type="button" className="button button-quiet" aria-label={`Remove ${nameOf(folder.root)} from the list`} onClick={() => void window.torno.workspace.forget(folder.root).then(setRecent, () => {})}>
                      Remove
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </nav>
      )}
      <p className="welcome-foot">
        torno writes only into a <span className="num">.torno</span> folder inside each object.
      </p>
      <p className="welcome-foot">
        Press <kbd>{hint('keys')}</kbd> at any time for the keys.
      </p>
    </div>
  )
}
