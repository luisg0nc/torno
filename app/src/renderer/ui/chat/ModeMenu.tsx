import { useEffect, useState } from 'react'
import { isMode, MODE_NOTE, MODES } from '../../../shared/chat'
import { chosen, pointerChoice } from '../typing'

/** How a mode is named to the person: what happens to an edit. */
const LABEL: Readonly<Record<string, string>> = { default: 'Ask before edits', acceptEdits: 'Accept edits', plan: 'Plan first' }

/**
 * How Claude Code asks about edits in a chat session. A choice is sent to the CLI for this session only
 * (`set_permission_mode`): the person's own settings are not written. The mode shown is the one the CLI last said;
 * one torno does not offer (the person's own default may be one) stands as the CLI names it. A choice stays shown
 * once the CLI has taken it, and is taken back when it refuses it.
 */
export function ModeMenu({ sessionId, mode, live }: { sessionId: string; mode: string | undefined; live: boolean }) {
  const [problem, setProblem] = useState<string | null>(null)
  const [picked, setPicked] = useState<string | undefined>(undefined)
  useEffect(() => setPicked(undefined), [mode])
  const shown = picked ?? mode
  if (shown === undefined) return null
  return (
    <div className="dock-menu-row">
      <span className="dock-menu-name" aria-hidden="true">Edits</span>
      <select
        className="dock-menu-select"
        aria-label="Edits"
        title="How Claude asks before it changes something. A choice here does not change your settings"
        value={shown}
        disabled={!live}
        onPointerDown={pointerChoice.onPointerDown}
        onKeyDown={pointerChoice.onKeyDown}
        onChange={(e) => {
          const next = e.target.value
          if (!isMode(next)) return
          setProblem(null)
          setPicked(next)
          window.torno.chat.setMode(sessionId, next).catch((err: unknown) => {
            setPicked(undefined)
            setProblem((err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']*': (Error: )?/, ''))
          })
          chosen(e.currentTarget)
        }}
      >
        {!isMode(shown) && <option value={shown}>{MODE_NOTE[shown] ?? shown}</option>}
        {MODES.map((m) => (
          <option key={m} value={m}>
            {LABEL[m]}
          </option>
        ))}
      </select>
      {problem !== null && (
        <span className="chat-problem selectable" role="alert">
          {problem}
        </span>
      )}
    </div>
  )
}
