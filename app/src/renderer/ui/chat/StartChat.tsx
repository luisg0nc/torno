import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChatItem } from '../../../shared/chat'
import { hint, pressed } from '../../../shared/keys'
import { AGENT_LABEL } from '../../../shared/agents'
import { giveKeysBack } from '../typing'
import { ago } from './ago'
import { ChatItems } from './Items'
import { ChatPlace } from './place'
import { useStore } from '../../state/store'

/**
 * The pane of an object with no session, for the chat: the end of the conversation it would go on with (read from
 * the log, nothing made), and the box to write in. A send starts the session and sends the prompt to it (`onStart`
 * with `send`), "Continue" resuming the conversation and "New conversation" beginning another. "New session" and
 * "Resume" start one without a prompt; what is written then waits, unsent, in the box of the chat. Nothing starts
 * until the person acts. There is no "Attach view" or "Draw on view" here: those belong to a session.
 */
export function StartChat({
  objectId,
  objectName,
  dir,
  resumable,
  starting,
  onStart
}: {
  objectId: string
  objectName: string
  dir?: string
  resumable: boolean
  starting: boolean
  onStart: (resume: boolean, text: string, send: boolean) => void
}) {
  const [text, setText] = useState('')
  const [resume, setResume] = useState(true)
  const [last, setLast] = useState<{ items: ChatItem[]; at: string | null } | null>(null)
  const place = useMemo(() => ({ dir, home: window.torno.home || undefined }), [dir])

  // The end of the last conversation, asked of main when there is one to go on with.
  useEffect(() => {
    setLast(null)
    if (!resumable) return
    let live = true
    window.torno.chat.lastConversation(objectId).then(
      (found) => live && setLast(found),
      () => {}
    )
    return () => {
      live = false
    }
  }, [objectId, resumable])

  // A prompt the Brief asked to see ("Show prompt 11 in the chat"): brought into view and lit for a moment when the last conversation holds it.
  const scroll = useRef<HTMLDivElement>(null)
  const shown = useStore((s) => s.promptShown)
  useEffect(() => {
    if (!shown || last === null) return
    const el = scroll.current?.querySelector<HTMLElement>(`.chat-group[data-id="${CSS.escape(shown.id)}"]`)
    if (!el) return
    el.scrollIntoView({ block: 'center' })
    el.dataset.shown = ''
    const timer = setTimeout(() => delete el.dataset.shown, 4000)
    return () => {
      clearTimeout(timer)
      delete el.dataset.shown
    }
  }, [shown?.seq, last]) // eslint-disable-line react-hooks/exhaustive-deps

  const going = resumable && resume
  const when = ago(last?.at ?? null)
  const send = (): void => {
    const prompt = text.trim()
    if (prompt === '' || starting) return
    onStart(going, prompt, true)
  }

  return (
    <div className="chat-start" data-object={objectId}>
      <div className="chat-start-scroll" ref={scroll}>
        {resumable && (
          <section className="chat-earlier" aria-label="Last conversation">
            <h3 className="chat-earlier-head">{when !== '' ? `Last conversation, ${when}` : 'Last conversation'}</h3>
            {last !== null && last.items.length > 0 ? (
              <ChatPlace.Provider value={place}>
                <ChatItems items={last.items} beat={false} />
              </ChatPlace.Provider>
            ) : (
              last !== null && <p className="chat-note chat-quiet">Its turns are not shown here: it was begun in a terminal.</p>
            )}
          </section>
        )}
        <p className="chat-empty">
          {AGENT_LABEL} runs here, in the folder of {objectName}, and works on it with you. Write below and it starts with your prompt.
        </p>
        <div className="session-actions">
          <button type="button" className="button" disabled={starting} onClick={() => onStart(false, text.trim(), false)}>
            New session
          </button>
          {resumable && (
            <button type="button" className="button session-resume" disabled={starting} onClick={() => onStart(true, text.trim(), false)}>
              Resume
            </button>
          )}
        </div>
      </div>
      <div className="chat-foot">
        <div className="chat-composer">
          <textarea
            className="chat-input"
            data-start-composer=""
            rows={2}
            value={text}
            aria-label="Message to Claude Code"
            placeholder={going ? 'Message Claude Code to go on with the last conversation' : 'Message Claude Code to start'}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return
              if (pressed(e, 'chat.newline')) return
              if (pressed(e, 'chat.send')) {
                e.preventDefault()
                send()
              } else if (pressed(e, 'field.leave')) {
                e.preventDefault()
                giveKeysBack(e.currentTarget)
              }
            }}
          />
          <div className="chat-actions">
            {resumable && (
              <span className="view-switch" role="group" aria-label="Conversation">
                <button type="button" className="button button-quiet" aria-pressed={resume} title="Go on with the last conversation" onClick={() => setResume(true)}>
                  Continue
                </button>
                <button type="button" className="button button-quiet" aria-pressed={!resume} title="Begin another conversation; the last one stays on file" onClick={() => setResume(false)}>
                  New conversation
                </button>
              </span>
            )}
            <span className="spacer" />
            <button type="button" className="button button-primary" disabled={starting || text.trim() === ''} title={`Start ${AGENT_LABEL} with this (${hint('chat.send')})`} onClick={send}>
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
