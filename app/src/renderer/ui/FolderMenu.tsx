import { useState } from 'react'
import type { RecentFolder } from '../../shared/workspace'
import { Chevron } from './Chevron'
import { useMenu } from './useMenu'

/** A folder as its row names it: its own name. */
export function folderName(root: string): string {
  return root.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || root
}

/** What the menu asks to be opened: a folder by its path, the one still to be chosen in the dialog, or the example. */
export type FolderChoice = { root: string } | 'pick' | 'example' | 'ready'

/**
 * The folder crumb of the title bar (`parts ▾`), and the menu that hangs from it: the folders opened lately (the open one
 * marked with a check and the word "current"; one that is not found struck, with a way to take it off the list), then the folder dialog, and the
 * example where torno has one. It is the way back to another workspace without the first screen. The list is
 * read when the menu opens, each time (`useMenu`: arrows, Home and End move among the items; Escape and Tab put it away).
 */
export function FolderMenu({ open: current, disabled, onChoose }: { open: string; disabled: boolean; onChoose: (choice: FolderChoice) => void }) {
  const [recent, setRecent] = useState<RecentFolder[]>([])
  const [example, setExample] = useState(false)
  const { shown, setShown, button, menu, onKeyDown } = useMenu(recent.length)

  /** Asks for the list and the example, then shows the menu whole: it does not come up with the dialog alone and fill in after. */
  const show = (): void => {
    void Promise.all([window.torno.workspace.recent().catch(() => [] as RecentFolder[]), window.torno.workspace.hasExample().catch(() => false)]).then(([list, has]) => {
      setRecent(list)
      setExample(has)
      setShown(true)
    })
  }

  const choose = (choice: FolderChoice): void => {
    setShown(false)
    onChoose(choice)
  }

  return (
    <div className="folder-menu-host">
      <button ref={button} type="button" className="crumb crumb-folder" aria-label={`Folder ${folderName(current)}`} title={current} aria-haspopup="menu" aria-expanded={shown} disabled={disabled} onClick={() => (shown ? setShown(false) : show())}>
        <span className="workspace-name">{folderName(current)}</span>
        <Chevron />
      </button>
      {shown && (
        <div ref={menu} className="menu folder-menu" role="menu" aria-label="Folders" onKeyDown={onKeyDown}>
          {recent.length > 0 && (
            <>
              <p className="menu-title">Recent folders</p>
              {recent.map((folder) => (
                <div key={folder.root} className="folder-row" data-missing={folder.missing ? '' : undefined} data-open={folder.root === current ? '' : undefined}>
                  <button type="button" role="menuitem" className="menu-item folder-item" disabled={folder.missing || folder.root === current} title={folder.missing ? `${folder.root} was not found` : folder.root} onClick={() => choose({ root: folder.root })}>
                    <span className="folder-name">{folderName(folder.root)}</span>
                    <span className="folder-path num">
                      <bdi>{folder.root}</bdi>
                    </span>
                  </button>
                  {folder.root === current && (
                    <span className="folder-said">
                      <svg className="folder-check" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="m3.5 8.5 3 3 6-7" />
                      </svg>
                      current
                    </span>
                  )}
                  {folder.missing && (
                    <>
                      <span className="folder-said">Not found</span>
                      <button type="button" role="menuitem" className="menu-item folder-remove" aria-label={`Remove ${folderName(folder.root)} from the list`} onClick={() => void window.torno.workspace.forget(folder.root).then(setRecent, () => {})}>
                        Remove
                      </button>
                    </>
                  )}
                </div>
              ))}
              <hr className="menu-rule" />
            </>
          )}
          <button type="button" role="menuitem" className="menu-item" onClick={() => choose('pick')}>
            Open folder…
          </button>
          {example && (
            <button type="button" role="menuitem" className="menu-item" title="A small project of torno's own, copied to a temporary folder that is removed when torno quits" onClick={() => choose('example')}>
              Open the example
            </button>
          )}
          <hr className="menu-rule" />
          <button type="button" role="menuitem" className="menu-item" title="Whether Claude Code, uv and the kernel's Python environment are there" onClick={() => choose('ready')}>
            Check what torno needs
          </button>
        </div>
      )}
    </div>
  )
}
