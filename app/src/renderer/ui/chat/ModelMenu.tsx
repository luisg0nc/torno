import { useEffect, useRef, useState } from 'react'
import { modelShown } from './modelWords'
import { type ChatModel, type Effort, effortsOf } from '../../../shared/chat'
import { Chevron } from '../Chevron'
import { Popover } from '../Popover'
import { chosen, pointerChoice } from '../typing'
import { EffortMenu } from './EffortMenu'
import { ModeMenu } from './ModeMenu'

/**
 * The model of a chat session, and the ones the CLI said it offers. A choice is sent to the CLI for this session
 * only (`set_model`): the person's own settings are not written. The model shown is the one the CLI last said it
 * runs; one that is none of the list (the full name of a model the list names by an alias) stands as it is. A choice
 * stays shown until the CLI says which model it runs next (it does at its next prompt).
 */
export function ModelMenu({ sessionId, model, models, live }: { sessionId: string; model: string | undefined; models: readonly ChatModel[]; live: boolean }) {
  const [problem, setProblem] = useState<string | null>(null)
  const [picked, setPicked] = useState<string | undefined>(undefined)
  useEffect(() => setPicked(undefined), [model])
  const shown = picked ?? model
  const listed = shown !== undefined && models.some((m) => m.value === shown)
  return (
    <div className="dock-menu-row">
      <span className="dock-menu-name" aria-hidden="true">Model</span>
      <select
        className="dock-menu-select num"
        aria-label="Model"
        title="The model of this session. A choice here does not change your settings"
        value={shown ?? ''}
        disabled={!live}
        onPointerDown={pointerChoice.onPointerDown}
        onKeyDown={pointerChoice.onKeyDown}
        onChange={(e) => {
          setProblem(null)
          setPicked(e.target.value)
          window.torno.chat.setModel(sessionId, e.target.value).catch((err: unknown) => {
            setPicked(undefined)
            setProblem((err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']*': (Error: )?/, ''))
          })
          chosen(e.currentTarget)
        }}
      >
        {shown === undefined && (
          <option value="" disabled>
            Model
          </option>
        )}
        {shown !== undefined && !listed && <option value={shown}>{shown}</option>}
        {models.map((m) => (
          <option key={m.value} value={m.value}>
            {m.displayName}
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

/**
 * The header's one mono button with the model (`opus-5-5 ▾`). Its menu, a popover from it, holds the model, the edits and the
 * effort of the session (`ModelMenu`, `ModeMenu`, `EffortMenu`): each is a choice for this session only. A press outside
 * puts it away, and Escape (the focus goes back to the button).
 */
export function ModelButton({ sessionId, model, models, mode, effort, live }: { sessionId: string; model: string | undefined; models: readonly ChatModel[]; mode: string | undefined; effort: Effort | undefined; live: boolean }) {
  const [shown, setShown] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const card = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!shown) return
    // Into the menu once it is there.
    card.current?.querySelector<HTMLElement>('select:not(:disabled)')?.focus({ preventScroll: true })
    const away = (e: PointerEvent): void => {
      if (!card.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setShown(false)
    }
    window.addEventListener('pointerdown', away)
    return () => window.removeEventListener('pointerdown', away)
  }, [shown])
  return (
    <>
      <button ref={button} type="button" className="button button-quiet session-model num" aria-haspopup="dialog" aria-expanded={shown} aria-label={model} title={`${model ? `${model}: the model of this session` : 'The model of this session'}, how Claude asks before it edits, and how hard it thinks`} onClick={() => setShown(!shown)}>
        {model ? <span className="session-model-id">{modelShown(model)}</span> : 'Model'}
        <Chevron />
      </button>
      {shown && (
        <Popover anchor={button.current} width={264} aria-label="Model, edits and effort" className="session-model-card" onClose={() => setShown(false)}>
          <div ref={card} className="dock-menu">
            <ModelMenu sessionId={sessionId} model={model} models={models} live={live} />
            <ModeMenu sessionId={sessionId} mode={mode} live={live} />
            <EffortMenu sessionId={sessionId} effort={effort} efforts={effortsOf(models, model)} live={live} />
          </div>
        </Popover>
      )}
    </>
  )
}
