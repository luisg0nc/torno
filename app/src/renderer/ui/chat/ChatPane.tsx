import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChatItem, PromptRow } from '../../../shared/chat'
import { chatActions, useChat } from '../../state/chat'
import { actions, useStore } from '../../state/store'
import { ChatItems } from './Items'
import { QuestionCard } from '../QuestionCard'
import { AskCard, AskSession } from './AskCard'
import { openRequest } from './ask'
import { Composer } from './Composer'
import { ChatEarlier, ChatPlace } from './place'
import { ChatOffer, type ChatOffers } from './offers'
import { ChatIdle, UndoableTurn } from './turnContext'
import { useHistory } from '../useHistory'
import { numbersOf } from './historyJoin'
import { PromptsOnly } from './PromptsOnly'
import { usePrompts } from './usePrompts'
import { ago } from './ago'

/** Within this many pixels of its end, a transcript is at its end. */
const AT_END_PX = 24

/** A beat once a second while something is under way, to toggle the still dots by: no animation runs on. */
function useBeat(active: boolean): boolean {
  const [beat, setBeat] = useState(true)
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setBeat((b) => !b), 1000)
    return () => clearInterval(timer)
  }, [active])
  return beat
}

/**
 * The conversation of a chat session, in the session pane: the transcript, which reads as a document, and the
 * box a prompt is written in. It follows the end of the transcript while it is at its end; a person who has
 * scrolled up is left where they are, and a button brings them down.
 *
 * What the agent asks takes the foot (`AskCard` with `where` "foot", which answers to this session) and leaves a line in the transcript, where the card stays once answered; "Attach view", the
 * commands offered while a `/` is typed and the rate line are in the foot, with the box (`Composer`). When the CLI said
 * torno's skills did not load, a line above the box offers the session again on the whole prompt (`onWholePrompt`). A note
 * of this session's that the chat could not use the login has a button that runs the object's sessions in the terminal
 * (`onUseTerminal`; `terminalDisabled` while the pane asks or switches). `foot` is a line the dock puts above the box (the `agent.json` note).
 */
export function ChatPane({ sessionId, live, working, dir, onWholePrompt, onUseTerminal, terminalDisabled, foot }: { sessionId: string; live: boolean; working: boolean; dir?: string; onWholePrompt: () => void; onUseTerminal: () => void; terminalDisabled: boolean; foot?: ReactNode }) {
  const chat = useChat(sessionId)
  const place = useMemo(() => ({ dir, home: window.torno.home || undefined }), [dir])
  // A new value only when the button is enabled or disabled, so that the notes are not drawn again for a new callback: it calls the latest.
  const toTerminal = useRef(onUseTerminal)
  toTerminal.current = onUseTerminal
  const offers = useMemo<ChatOffers>(() => ({ terminal: { take: () => toTerminal.current(), disabled: terminalDisabled } }), [terminalDisabled])
  useEffect(() => {
    void chatActions.load(sessionId)
    // Once no pane shows it, a session lets go of its pictures: they are asked for again when it is shown.
    return () => chatActions.release(sessionId)
  }, [sessionId])

  const box = useRef<HTMLDivElement>(null)
  const atEnd = useRef(true)
  const [behind, setBehind] = useState(false)
  const items = chat?.items
  const asking = useMemo(() => (items ? openRequest(items) : undefined), [items])
  const earlier = chat?.earlier
  const underWay = (items ?? []).some((item) => (item.kind === 'text' || item.kind === 'thinking' ? item.streaming : item.kind === 'tool' && item.state === 'running'))
  const beat = useBeat(underWay)
  // The project's builds: each turn shows its own, and what the person made between turns is a line there.
  const history = useHistory(true)
  const objectId = useStore((s) => s.objectId)
  const promptsOpen = useStore((s) => s.promptsOpen)
  // The project's prompts, numbered across all its conversations: one number for a prompt wherever it is shown. Asked again when one is sent or a build is kept.
  const sent = (items ?? []).reduce((n, item) => n + (item.kind === 'user' && item.state === 'sent' ? 1 : 0), 0)
  const rows = usePrompts(true, `${sent}:${history?.entries.at(-1)?.id ?? ''}`)
  const numbers = useMemo(() => numbersOf(rows ?? [], [...(earlier ?? []), ...(items ?? [])]), [rows, earlier, items])
  // The conversation this chat shows: the one the prompts it holds were said in (none while it has said nothing and resumed nothing).
  const current = useMemo(() => {
    const ids = new Set([...(earlier ?? []), ...(items ?? [])].map((item) => item.id))
    return rows?.find((row) => ids.has(row.id))?.conversation
  }, [rows, earlier, items])
  // The other conversations of the project that were said in this chat (a terminal's leave no log), oldest first, and, once asked, what they said.
  const others = useMemo(() => {
    const seen = new Map<string, PromptRow>()
    for (const row of rows ?? []) if (row.conversation !== current && !row.id.startsWith('t-') && !seen.has(row.conversation)) seen.set(row.conversation, row)
    return [...seen.values()]
  }, [rows, current])
  const [before, setBefore] = useState<{ of: string; read: Array<{ conversation: string; at: number; items: ChatItem[] }> } | 'loading' | null>(null)
  const earlierRead = before !== null && before !== 'loading' && before.of === objectId ? before.read : undefined
  // A prompt to bring into view once the chat shows it (a double click on its row in Prompts only).
  const [target, setTarget] = useState<string | null>(null)

  function readEarlier(): void {
    if (objectId === null || before === 'loading') return
    setBefore('loading')
    void Promise.all(others.map(async (row) => ({ conversation: row.conversation, at: row.at, items: (await window.torno.chat.conversation(objectId, row.conversation).catch(() => [])).filter((item) => item.kind !== 'thinking') }))).then((read) => setBefore({ of: objectId, read: read.filter((r) => r.items.length > 0) }))
  }

  function openInChat(row: PromptRow): void {
    actions.setPromptsOpen(false)
    if (row.conversation !== current && earlierRead === undefined) readEarlier()
    setTarget(row.id)
  }

  // A prompt another part of the window asked to see (the Brief's "Show prompt 11 in the chat"): read in from its conversation, then lit for a moment.
  const shown = useStore((s) => s.promptShown)
  const [lit, setLit] = useState<string | null>(null)
  // Only an ask made while this pane is up: one made before it mounted (another session, the pane with no session) is not done again.
  const handled = useRef(shown?.seq ?? 0)
  useEffect(() => {
    if (!shown || shown.seq <= handled.current || rows === undefined) return
    handled.current = shown.seq
    if (shown.conversation !== current && earlierRead === undefined) readEarlier()
    setTarget(shown.id)
    setLit(shown.id)
  }, [shown?.seq, rows]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (lit === null) return
    const timer = setTimeout(() => setLit(null), 4000)
    return () => clearTimeout(timer)
  }, [lit, shown?.seq])

  useEffect(() => {
    if (target === null || promptsOpen || before === 'loading') return
    const el = box.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(target)}"]`)
    if (el) {
      atEnd.current = false
      el.scrollIntoView({ block: 'center' })
    }
    setTarget(null)
  }, [target, promptsOpen, before, items, earlier])
  // The lit prompt is said by an attribute on its group, which the stylesheet washes in the accent.
  useEffect(() => {
    const all = box.current?.querySelectorAll<HTMLElement>('.chat-group[data-shown]') ?? []
    for (const el of all) if (el.dataset.id !== lit) delete el.dataset.shown
    if (lit !== null) {
      const el = box.current?.querySelector<HTMLElement>(`.chat-group[data-id="${CSS.escape(lit)}"]`)
      if (el) el.dataset.shown = ''
    }
  }, [lit, items, earlier, before])
  // "Undo" is offered on the last turn only: a live session at rest, with no prompt of the person's after that turn.
  const undoable = useMemo(() => {
    if (!live || working || !items) return undefined
    const at = items.findLastIndex((item) => item.kind === 'turn')
    return at >= 0 && !items.slice(at + 1).some((item) => item.kind === 'user') ? items[at]!.id : undefined
  }, [live, working, items])

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    if (atEnd.current) el.scrollTop = el.scrollHeight
    else setBehind(true)
  }, [items, earlier])

  // What grows without the items changing (a picture, a card opened) keeps the end in view while it was at the end.
  const content = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!content.current || typeof ResizeObserver === 'undefined') return
    const watching = new ResizeObserver(() => {
      const el = box.current
      if (el && atEnd.current) el.scrollTop = el.scrollHeight
    })
    watching.observe(content.current)
    return () => watching.disconnect()
  }, [])

  const toEnd = (): void => {
    atEnd.current = true
    setBehind(false)
    const el = box.current
    if (el) el.scrollTop = el.scrollHeight
  }

  return (
    <AskSession.Provider value={sessionId}>
    <ChatPlace.Provider value={place}>
    <div className="chat" data-session={sessionId}>
      <div className="chat-scroll">
        {/* Over the transcript, which stays as it was scrolled to and is not reachable meanwhile. */}
        {promptsOpen && <PromptsOnly rows={rows} current={current} onOpen={openInChat} onClose={() => actions.setPromptsOpen(false)} />}
        <div
          className="chat-transcript"
          ref={box}
          role="log"
          aria-label="Conversation"
          inert={promptsOpen}
          onScroll={(e) => {
            const el = e.currentTarget
            atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight <= AT_END_PX
            if (atEnd.current) setBehind(false)
          }}
        >
          <div className="chat-content" ref={content}>
          {chat?.loading && <p className="chat-note chat-quiet">Loading the conversation…</p>}
          {chat?.failed !== undefined && (
            <p className="chat-note chat-quiet" role="alert">
              {chat.failed}
            </p>
          )}
          {chat?.trimmed && <p className="chat-note chat-quiet">Earlier items are not shown</p>}
          {others.length > 0 && earlierRead === undefined && (
            <p className="chat-note chat-more-earlier">
              <button type="button" className="button button-quiet" disabled={before === 'loading'} onClick={readEarlier}>
                {before === 'loading' ? 'Reading…' : `Earlier conversations (${others.length})`}
              </button>
            </p>
          )}
          {earlierRead?.map((one) => (
            <section key={one.conversation} className="chat-earlier chat-conversation" aria-label={`Conversation from ${ago(new Date(one.at).toISOString())}`} data-conversation={one.conversation}>
              <h3 className="chat-earlier-head">Conversation that began {ago(new Date(one.at).toISOString())}</h3>
              <ChatEarlier.Provider value={true}>
                <ChatItems items={one.items} beat={false} numbers={numbers} />
              </ChatEarlier.Provider>
            </section>
          ))}
          {earlier && earlier.length > 0 && (
            <section className="chat-earlier" aria-label="Earlier in this conversation">
              <h3 className="chat-earlier-head">Earlier in this conversation</h3>
              <ChatEarlier.Provider value={true}>
                <ChatItems items={earlier} beat={false} numbers={numbers} />
              </ChatEarlier.Provider>
            </section>
          )}
          {items && (
            <ChatOffer.Provider value={offers}>
              <UndoableTurn.Provider value={undoable}>
                <ChatIdle.Provider value={live && !working}>
                  <ChatItems items={items} beat={beat} history={history ?? undefined} numbers={numbers} />
                </ChatIdle.Provider>
              </UndoableTurn.Provider>
            </ChatOffer.Provider>
          )}
          {chat && !chat.loading && items!.length === 0 && (!earlier || earlier.length === 0) && (
            <p className="chat-empty">Say what to change, or ask about the part. The marks you leave go with your prompt.</p>
          )}
          </div>
        </div>
        {behind && (
          <button type="button" className="button chat-behind" onClick={toEnd}>
            New messages below
          </button>
        )}
      </div>
      {live && chat?.meta.pluginLoaded === false && (
        <p className="chat-note chat-restart">
          <span>torno&apos;s skills did not load.</span>
          <button type="button" className="button button-quiet" disabled={working} title={working ? 'Wait for the turn to end' : 'End this session and go on with the same conversation, told in the prompt what the skills would say'} onClick={onWholePrompt}>
            Restart with the whole prompt
          </button>
        </p>
      )}
      {/* An ask takes the foot: the request of the agent's, or torno's own question, over the box. */}
      {asking && <AskCard item={asking} where="foot" />}
      <QuestionCard where="chat" />
      {foot}
      <Composer sessionId={sessionId} live={live} working={working} onSent={toEnd} />
    </div>
    </ChatPlace.Provider>
    </AskSession.Provider>
  )
}
