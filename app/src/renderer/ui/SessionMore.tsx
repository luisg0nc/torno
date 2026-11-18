import { useCallback, useState } from 'react'
import { type InstructionFile, READS_TITLE, named, weighed } from '../../shared/instructions'
import { actions } from '../state/store'
import { Popover } from './Popover'
import { useMenu } from './useMenu'

/** What the header's "More" menu offers, and what it does when asked: the session pane owns every one of them. */
export interface SessionMoreProps {
  /** Whether there is a session of the project to speak of (`End` and `New session` are of it). */
  session: boolean
  ended: boolean
  resumable: boolean
  /** Starting, or a question is up: what starts or ends a session waits. */
  disabled: boolean
  /** The instruction files Claude Code reads, and why the choice of `agent.json` was not followed, if it was not. */
  reads: readonly InstructionFile[]
  note: string | undefined
  onEnd: () => void
  onResume: () => void
  onNew: () => void
  onShowRead: (index: number) => void
  /** Told the button, so that a question that End or New session asks stands from it (the menu is gone by then). */
  onButton?: (button: HTMLButtonElement | null) => void
}

/**
 * The header's "More": End, Resume, New session, Prompts only, What Claude Code reads, Hide session. A popover from its button
 * (`Popover`, `useMenu`: arrows, Home and End, Escape, a press outside). "What Claude Code reads" unfolds in the menu: the
 * instruction files, as paths and sizes (the text is never read), and the note of an `agent.json` that was not followed.
 */
export function SessionMore({ session, ended, resumable, disabled, reads, note, onEnd, onResume, onNew, onShowRead, onButton }: SessionMoreProps) {
  const { shown, setShown, button, menu, onKeyDown } = useMenu()
  const [readsOpen, setReadsOpen] = useState(false)
  const setButton = useCallback(
    (el: HTMLButtonElement | null) => {
      button.current = el
      onButton?.(el)
    },
    [button, onButton]
  )
  const toggle = (): void => {
    setReadsOpen(false)
    setShown(!shown)
  }
  /** An item is chosen: the menu goes, and the act is made. */
  const choose = (act: () => void) => (): void => {
    setShown(false)
    setReadsOpen(false)
    act()
  }
  return (
    <>
      <button ref={setButton} type="button" className="button button-quiet session-more" aria-label="More" title="More" aria-haspopup="menu" aria-expanded={shown} onClick={toggle}>
        <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
          <circle cx="3.5" cy="8" r="1.25" />
          <circle cx="8" cy="8" r="1.25" />
          <circle cx="12.5" cy="8" r="1.25" />
        </svg>
      </button>
      {shown && (
        <Popover anchor={button.current} width={256} role="presentation" className="session-more-card" onClose={() => setShown(false)}>
          <div ref={menu} className="session-more-menu" role="menu" aria-label="More" onKeyDown={onKeyDown}>
            {session && !ended && (
              <button type="button" role="menuitem" className="menu-item" disabled={disabled} title="End this session. Its conversation can be resumed" onClick={choose(onEnd)}>
                End
              </button>
            )}
            {session && ended && resumable && (
              <button type="button" role="menuitem" className="menu-item" disabled={disabled} onClick={choose(onResume)}>
                Resume
              </button>
            )}
            {session && (
              <button type="button" role="menuitem" className="menu-item" disabled={disabled} onClick={choose(onNew)}>
                New session
              </button>
            )}
            <button type="button" role="menuitem" className="menu-item" title="One row for each prompt of this project, across its conversations" onClick={choose(() => actions.setPromptsOpen(true))}>
              Prompts only
            </button>
            <button type="button" role="menuitem" className="menu-item" aria-expanded={readsOpen} onClick={() => setReadsOpen(!readsOpen)}>
              What Claude Code reads
            </button>
            {readsOpen && (
              <div className="session-reads" role="note" title={READS_TITLE}>
                {note !== undefined && <p className="session-reads-note">{note}</p>}
                <span>{reads.length > 0 ? 'Claude Code also reads, by default' : 'No instruction file is read by default.'}</span>
                {reads.map((file, i) => (
                  <span key={file.path} className="session-read">
                    <button type="button" role="menuitem" className="session-read-open" aria-description="Show in its folder" onClick={() => onShowRead(i)}>
                      {named(file)}
                    </button>
                    <span className="session-read-size">{weighed(file)}</span>
                  </span>
                ))}
              </div>
            )}
            <hr className="menu-rule" />
            <button type="button" role="menuitem" className="menu-item" onClick={choose(() => actions.setDockOpen(false))}>
              Hide session
            </button>
          </div>
        </Popover>
      )}
    </>
  )
}
