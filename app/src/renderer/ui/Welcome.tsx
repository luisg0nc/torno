import { useEffect, useState, type CSSProperties } from 'react'
import type { RecentFolder, WorkspaceInfo } from '../../shared/workspace'
import { Logo } from './Logo'
import { nameOf, openProblem } from './openFolder'

/** The idea of a folder of objects, drawn: the folder opened, an object in it, and its model. */
const TREE: readonly (readonly [name: string, label: string])[] = [
  ['objects/', 'the folder you open'],
  ['bracket/', 'an object'],
  ['bracket.py', 'its model, in build123d'],
]

function Tree() {
  return (
    <figure className="welcome-tree" aria-label="How a folder of objects is laid out">
      {TREE.map(([name, label], depth) => (
        <div key={name} className="tree-row" style={{ '--depth': depth } as CSSProperties}>
          <span className="num">{name}</span>
          <span className="tree-label">{label}</span>
        </div>
      ))}
    </figure>
  )
}

/**
 * The first screen, while no folder is open, in two states. On a first run (no folder opened lately): what torno
 * is in a line, the folder of objects drawn as a tree, and the ways in: the folder dialog (an empty folder is
 * fine) and, where torno runs from its repository, a copy of its example. Coming back: the folders opened lately
 * first (one that is gone is struck, and can be taken off the list), then the ways in, and no tree. Until the
 * list has answered only the head is shown, so that the first run's words do not flash for someone coming back.
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

  const head = (
    <header className="welcome-head">
      <Logo />
      <h1 className="wordmark">torno</h1>
    </header>
  )
  if (recent === null) return <div className="welcome-page">{head}</div>
  const returning = recent.length > 0

  return (
    <div className="welcome-page">
      {head}
      <p className="welcome-tagline">Make CAD parts with an AI agent: it writes the model, you point at what to change.</p>
      {!returning && <Tree />}
      {returning && (
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
      <div className="welcome-ways">
        <button type="button" className="button button-primary" disabled={busy} onClick={onPick}>
          Open folder
        </button>
        {!returning && <p className="welcome-note">An empty folder is fine: torno helps you make the first object.</p>}
        {example && (
          <div className="welcome-example">
            <button type="button" className="button button-quiet" disabled={busy} title="Four small objects of torno's own, copied to a temporary folder: nothing of the repository is opened or written" onClick={() => open(() => window.torno.workspace.openExample(), 'The example')}>
              Open the example
            </button>
            <span className="welcome-note">A temporary copy, removed when torno quits.</span>
          </div>
        )}
      </div>
      {problem !== null && (
        <p className="welcome-problem" role="alert">
          {problem}
        </p>
      )}
      <p className="welcome-foot">
        torno writes only into a <span className="num">.torno</span> folder inside each object.
      </p>
    </div>
  )
}
