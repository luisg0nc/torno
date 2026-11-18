import { useEffect, useState } from 'react'
import type { Effort } from '../../../shared/chat'
import { chosen, pointerChoice } from '../typing'

/** How an effort is named to the person: Claude Code's words, in sentence case. */
export const EFFORT_LABEL: Readonly<Record<Effort, string>> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' }

/**
 * The effort of a chat session, and the ones its model takes. A choice is sent to the CLI for this session only
 * (`apply_flag_settings`, held in its memory as `--effort` is): the person's own settings are not written. Until one
 * is chosen the CLI goes by the person's default, which it does not say: the list says "Default effort". A choice
 * stays shown once the CLI has taken it, and is taken back when it refuses it.
 */
export function EffortMenu({ sessionId, effort, efforts, live }: { sessionId: string; effort: Effort | undefined; efforts: readonly Effort[]; live: boolean }) {
  const [problem, setProblem] = useState<string | null>(null)
  const [picked, setPicked] = useState<Effort | undefined>(undefined)
  useEffect(() => setPicked(undefined), [effort])
  const shown = picked ?? effort
  // A model that takes no effort has none to choose; one kept from another model stays shown as it is.
  const listed = shown === undefined || efforts.includes(shown)
  if (efforts.length === 0 && shown === undefined) return null
  return (
    <div className="dock-menu-row">
      <span className="dock-menu-name" aria-hidden="true">Effort</span>
      <select
        className="dock-menu-select"
        aria-label="Effort"
        title="How hard Claude thinks in this session. A choice here does not change your settings"
        value={shown ?? ''}
        disabled={!live}
        onPointerDown={pointerChoice.onPointerDown}
        onKeyDown={pointerChoice.onKeyDown}
        onChange={(e) => {
          const next = e.target.value as Effort
          setProblem(null)
          setPicked(next)
          window.torno.chat.setEffort(sessionId, next).catch((err: unknown) => {
            setPicked(undefined)
            setProblem((err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']*': (Error: )?/, ''))
          })
          chosen(e.currentTarget)
        }}
      >
        {shown === undefined && (
          <option value="" disabled>
            Default effort
          </option>
        )}
        {!listed && <option value={shown}>{EFFORT_LABEL[shown]}</option>}
        {efforts.map((one) => (
          <option key={one} value={one}>
            {EFFORT_LABEL[one]}
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
