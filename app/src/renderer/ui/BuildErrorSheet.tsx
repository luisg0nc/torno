import { pressed } from '../../shared/keys'
import { useEffect, useState } from 'react'
import { type BuildError, kindWords, fixPrompt, rebuildHelps, stillLatest } from '../../shared/build'
import { WHY, diagnosisText } from '../../shared/diagnosis'
import { useChat } from '../state/chat'
import { actions, runningSession, useStore } from '../state/store'
import { insertIntoSession } from './insertIntoSession'
import { Popover } from './Popover'

/** Everything the kernel said about a failed build, as one text to paste elsewhere: why a fillet failed after the message. */
export function errorText(error: BuildError): string {
  return [error.message, error.diagnosis && diagnosisText(error.diagnosis), error.traceback, error.output]
    .map((part) => part?.trimEnd())
    .filter(Boolean)
    .join('\n\n')
}

/** How Claude Code gets to know of the failure: after its own edit, with the next prompt, or (no session runs) with the first prompt of the next one. */
export type Told = 'edit' | 'prompt' | 'none'

/** The lead of the sheet: who is told, so that the person need not paste the error into the chat. */
export function toldLine(told: Told): string {
  if (told === 'edit') return 'Claude Code was told after its edit, and your next prompt carries it too.'
  if (told === 'prompt') return 'Claude Code is told this with your next prompt.'
  return 'No session is running. Start one, and it is told with your first prompt.'
}

/** The words on the button that hands the error over, for what it does now. */
export function askLabel(told: Told): string {
  return told === 'none' ? 'Start a session to fix it' : 'Ask Claude Code to fix it'
}

/** The last lines of the error that say what went wrong: the end of its traceback, or its message when it has none (and the message before them when they do not hold it). */
export function errorTail(error: BuildError, lines = 6): string {
  const trace = error.traceback?.trim()
  if (!trace) return error.message.trim()
  const tail = trace.split('\n').slice(-lines)
  return tail.some((line) => line.includes(error.message.trim())) ? tail.join('\n') : [error.message.trim(), ...tail].join('\n')
}

/** What the title of the popover says: the build the failure came after, when there was one. */
export const failedTitle = (after: string | undefined): string => (after ? `The build after ${after} failed` : 'The first build failed')

/**
 * A failed build's error, as a popover from its element in the builds timeline (#332): "The build after h40
 * failed", who is told, the tail of the error in mono on the fail wash, then Copy, Whole error (message, why a fillet failed,
 * traceback and what the model printed, in the card) and Ask Claude Code to fix it. `old` is a failure that a later build
 * mended or came after: only its line is kept, so it is the line and Copy, with nobody told. `anchor` is that element; with none (the
 * timeline is not drawn) the card stands from the element it is drawn in, the status line.
 */
export function BuildErrorSheet({ objectName, error, after, old = false, anchor, onClose }: { objectName: string; error: BuildError; after?: string | undefined; old?: boolean; anchor?: HTMLElement | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  /** What "Ask Claude Code to fix it" did a moment ago: put the words in the box, or asked for a session that will. */
  const [handed, setHanded] = useState<'box' | 'start' | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [whole, setWhole] = useState(false)
  const build = useStore((st) => st.build)
  const objectId = useStore((st) => st.objectId)
  const session = useStore(runningSession)
  const chat = useChat(session?.view === 'chat' ? session.sessionId : undefined)
  const told: Told = !session ? 'none' : chat?.items.some((i) => i.kind === 'context' && i.forTool && stillLatest(build, i)) ? 'edit' : 'prompt'
  const retry = !old && build !== null && rebuildHelps(build)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (pressed(e, 'sheet.close')) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(timer)
  }, [copied])

  useEffect(() => {
    if (handed === null) return
    const timer = setTimeout(() => setHanded(null), 1600)
    return () => clearTimeout(timer)
  }, [handed])

  /** Fills the message box of the object's session with a request to fix the build, and shows it. Never sends it. */
  function ask(): void {
    const text = fixPrompt(objectName)
    setProblem(null)
    actions.setDockOpen(true)
    if (!session) {
      // The session pane starts one and leaves the words in its box.
      actions.setFixRequest(text)
      setHanded('start')
      return
    }
    if (!insertIntoSession(text, { later: true })) return setProblem('The message box is not open.')
    setHanded('box')
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(errorText(error))
    } catch {
      // No clipboard access (the window is not focused): the same text, copied from a field put up for the moment.
      const field = document.createElement('textarea')
      field.value = errorText(error)
      field.setAttribute('readonly', '')
      field.style.position = 'fixed'
      field.style.opacity = '0'
      document.body.append(field)
      field.select()
      document.execCommand('copy')
      field.remove()
    }
    setCopied(true)
  }

  return (
    <Popover anchor={anchor ?? null} width={300} className="build-error" aria-label="Build error" onClose={onClose}>
      <h3 className="build-error-title">{after ? <>The build after <span className="num">{after}</span> failed</> : failedTitle(undefined)}</h3>
      {!old && (
        <p className="muted build-error-kind" data-part="kind">
          {kindWords(error.kind)}
        </p>
      )}
      {!old && (
        <p className="build-error-told" data-part="told">
          {toldLine(told)}
        </p>
      )}
      {problem !== null && <p role="alert">{problem}</p>}
      <pre className="build-error-tail" data-part="tail">{errorTail(error)}</pre>
      <div className="build-error-actions">
        {/* After a failure outside the model building again is what may help; after an error in it, asking for the fix is. */}
        {retry && (
          <button type="button" className="button button-primary" onClick={() => objectId !== null && void window.torno.object.rebuild(objectId).catch(() => {})}>
            Rebuild
          </button>
        )}
        {!old && (
          <button type="button" className={retry ? 'button' : 'button button-primary'} data-part="ask" onClick={ask}>
            {handed === 'box' ? 'In the message box' : handed === 'start' ? 'Starting a session…' : askLabel(told)}
          </button>
        )}
        <button type="button" className="button button-quiet" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
        {!old && (
          <button type="button" className="button button-quiet" aria-expanded={whole} data-part="whole-toggle" onClick={() => setWhole(!whole)}>
            Whole error
          </button>
        )}
      </div>
      {whole && (
        <div className="build-error-body" data-part="whole">
          <p className="build-error-message" data-part="message">{error.message}</p>
          {error.diagnosis && (
            <>
              <h4 className="build-error-section">Why</h4>
              <pre className="build-error-pre" data-part="diagnosis">{diagnosisText(error.diagnosis).slice(WHY.length)}</pre>
            </>
          )}
          {error.traceback?.trim() && (
            <>
              <h4 className="build-error-section">Traceback</h4>
              <pre className="build-error-pre" data-part="traceback">{error.traceback.trimEnd()}</pre>
            </>
          )}
          {error.output?.trim() && (
            <>
              <h4 className="build-error-section">Output</h4>
              <pre className="build-error-pre" data-part="output">{error.output.trimEnd()}</pre>
            </>
          )}
        </div>
      )}
    </Popover>
  )
}
