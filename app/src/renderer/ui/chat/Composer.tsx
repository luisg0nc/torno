import { useEffect, useRef, useState } from 'react'
import { attachLabel, attachSummary } from '../../../shared/board'
import { hint, pressed, which } from '../../../shared/keys'
import { unmetDimensions } from '../../../shared/dimension'
import { boardActions, useBoard } from '../../state/board'
import { useChat } from '../../state/chat'
import { drawingActions, useDrawing } from '../../state/drawing'
import { picture } from '../../state/agent'
import { onboarding } from '../../state/onboard'
import { store, useStore } from '../../state/store'
import { numbered } from '../numbered'
import { giveKeysBack } from '../typing'
import { openDrawing } from '../drawing/make'
import { commandsFor, rateLine } from './foot'
import { RefChip } from './RefChip'
import { type Suggestion, suggest } from './suggest'
import { Suggestions } from './Suggestions'
import { WaitingNotes } from './WaitingNotes'

/** What an IPC call failed with, without Electron's wrapping. */
const reason = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']*': (Error: )?/, '')

/** A prompt not yet sent, kept for a session while its pane is not shown (another object's, say). */
const drafts = new Map<string, string>()

/** Which of these sessions have a prompt written in their box and not sent: closing the window would lose it. */
export function unsentSessions(sessionIds: Iterable<string>): string[] {
  return [...sessionIds].filter((id) => (drafts.get(id) ?? '').trim() !== '')
}

/** The drafts of the prompts not sent, and the board over the view, are let go when the workspace they were made in is closed. */
export function clearDrafts(): void {
  drafts.clear()
  drawingActions.clear()
}

/** Leaves text in the box of a session whose composer is not drawn yet; the box shows it when it is. */
export function holdDraft(sessionId: string, text: string): void {
  drafts.set(sessionId, text)
}

/** The composer in the pane now, for what is inserted from outside (the selection's "Insert"). */
let current: { insert(text: string): void } | null = null

/** Puts text at the cursor of the composer of the chat shown, and gives it the keys. False when there is none. */
export function insertIntoComposer(text: string): boolean {
  if (!current) return false
  current.insert(text)
  return true
}

/** The most marks named in the line above the box; the rest are counted. */
const MOST_CHIPS = 8

/** What goes with the next prompt, as chips of the marks themselves: the drafts, and the dimensions that fail or have no value. */
function Next() {
  const marks = useStore((s) => s.marks)
  const revision = useStore((s) => s.revision)
  const { failing, unmeasured } = unmetDimensions(
    marks.filter((m) => m.status === 'sent'),
    revision > 0 ? revision : undefined
  )
  // The failed build goes too: the next prompt carries its error, so the person need not paste it.
  const buildFailed = useStore((s) => s.build?.status === 'failed')
  const things = [
    ...marks.filter((m) => m.status === 'draft').map((m) => ({ id: m.id, word: '' })),
    ...failing.map((m) => ({ id: m.id, word: 'fails' })),
    ...unmeasured.map((m) => ({ id: m.id, word: 'no value' }))
  ]
  if (things.length === 0 && !buildFailed) return null
  return (
    <p className="chat-next" role="status">
      <span>Goes with your next prompt:</span>
      {buildFailed && (
        <span className="chat-next-one" data-part="build-failed">
          <span className="chat-next-word">build failed</span>
        </span>
      )}
      {things.slice(0, MOST_CHIPS).map((one) => (
        <span key={`${one.id}${one.word}`} className="chat-next-one">
          <RefChip value={one.id} />
          {one.word !== '' && <span className="chat-next-word">{one.word}</span>}
        </span>
      ))}
      {things.length > MOST_CHIPS && <span>{numbered(`and ${things.length - MOST_CHIPS} more`)}</span>}
    </p>
  )
}

/**
 * The part of the board that goes with the next prompt, as a chip: "Latch · 3 cards · 1 arrow". What each card says is read
 * when the prompt is sent, so an edit made since goes too; a card removed meanwhile is left out and the chip says so.
 */
function BoardChip() {
  const attached = useBoard((s) => s.attached)
  const board = useBoard((s) => s.board)
  if (attached === null || board === null) return null
  const sum = attachSummary(board, attached.ids)
  return (
    <div className="chat-board-attached" role="group" aria-label="Board attached">
      <span className="chat-with-what">
        <span>{attached.ids === 'all' ? 'The whole board goes with your next prompt' : 'Part of the board goes with your next prompt'}</span>
        <span className="chat-board-chip num">{attachLabel(sum)}</span>
        {sum.gone.length > 0 && <span className="chat-board-gone">{numbered(`${sum.gone.join(', ')} ${sum.gone.length === 1 ? 'was' : 'were'} removed, so ${sum.gone.length === 1 ? 'it is' : 'they are'} left out`)}</span>}
      </span>
      <button type="button" className="button button-quiet" onClick={() => boardActions.detach()}>
        Remove
      </button>
    </div>
  )
}

/** The `/` commands the CLI named, offered while a single `/word` is typed: the arrows choose, Tab or a click completes. */
function Commands({ offered, at, onChoose }: { offered: ReturnType<typeof commandsFor>; at: number; onChoose: (name: string) => void }) {
  return (
    <ul className="chat-commands" id="chat-commands" role="listbox" aria-label="Commands">
      {offered.map((c, n) => (
        <li
          key={c.name}
          id={`chat-command-${c.name}`}
          role="option"
          aria-selected={n === at}
          // The box keeps the focus: a click chooses without taking it.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onChoose(c.name)}
        >
          <span className="chat-command-name num">/{c.name}</span>
          {c.argumentHint !== '' && <span className="chat-command-hint num">{c.argumentHint}</span>}
          {c.description !== '' && <span className="chat-command-desc">{c.description}</span>}
        </li>
      ))}
    </ul>
  )
}

/**
 * The foot of the chat: what goes with the next prompt, and the box to write it in. Enter sends and Shift+Enter
 * breaks the line; Escape closes the list of commands while one is offered, and else gives the keys back to the view, as a field does. While the agent works, the prompt is
 * queued by the CLI, and "Stop" interrupts it. "Attach view" adds a picture of the viewport to the next prompt only;
 * "Draw on view" opens a board over a picture of the view; Done keeps the drawing as a view note, a draft mark that goes
 * with the next prompt of itself and waits above the box (`WaitingNotes`) until then.
 * While a `/command` is typed the commands of the CLI are offered; and when a window of the rate limit is half
 * used, one quiet line says so.
 */
export function Composer({ sessionId, live, working, onSent }: { sessionId: string; live: boolean; working: boolean; onSent: () => void }) {
  // A first prompt of a new object that could not be sent (`state/onboard.ts`) is in the box of its first chat.
  const [text, setText] = useState(() => drafts.get(sessionId) ?? onboarding.take(store.getState().objectId))
  const [problem, setProblem] = useState<string | null>(null)
  const [attach, setAttach] = useState(false)
  /** The picture "Attach view" shows (an object URL), once it is made. */
  const [attached, setAttached] = useState<string | null>(null)
  /** Which press of "Attach view" the picture being made is for: an answer for an earlier one is let go. */
  const pressing = useRef(0)
  /** The picture of the view the preview shows (it may still be coming): what goes with the prompt. */
  const shown = useRef<Promise<{ png: Uint8Array; objectId: string }> | null>(null)
  const opening = useDrawing((s) => s.opening === sessionId)
  const drawingHere = useDrawing((s) => s.board?.sessionId === sessionId)
  const [choice, setChoice] = useState(0)
  const chat = useChat(sessionId)
  /** The text for which Escape closed the list of commands: the list stays shut until the text changes. */
  const [shut, setShut] = useState<string | null>(null)
  const offered = shut === text ? [] : commandsFor(text, chat?.commands ?? [])
  const at = Math.min(choice, Math.max(0, offered.length - 1))
  const rate = rateLine(chat?.meta.rate)
  const objectName = useStore((st) => st.workspace?.objects.find((o) => o.id === st.objectId)?.name ?? st.objectId ?? '')
  const openMarks = useStore((st) => st.marks.filter((m) => m.status !== 'resolved').length)
  const layouts = useStore((st) => st.scene?.layouts)
  const buildFailed = useStore((st) => st.build?.status === 'failed')
  const boardAttached = useBoard((st) => st.attached !== null && st.board !== null)
  // A permission or a plan waiting for the person: what is written can be the answer to it.
  const waiting = chat?.items.findLast((i) => i.kind === 'ask' && i.state === 'open' && i.toolName !== 'AskUserQuestion')
  const openAsk = waiting?.kind === 'ask' ? waiting : undefined
  const field = useRef<HTMLTextAreaElement>(null)
  const cursor = useRef<number | null>(null)
  /** Where the cursor goes when the box is next given the keys: after what was inserted while it could not take them. */
  const unfocused = useRef<number | null>(null)
  const latest = useRef(text)
  latest.current = text

  useEffect(() => {
    current = {
      insert(inserted) {
        const box = field.current
        const value = latest.current
        const at = box?.selectionStart ?? value.length
        const end = box?.selectionEnd ?? at
        const before = value.slice(0, at)
        const after = value.slice(end)
        // Set off from the words round it by a space, as a ref in a sentence is.
        const lead = before !== '' && !/\s$/.test(before) ? ' ' : ''
        const tail = after === '' || !/^\s/.test(after) ? ' ' : ''
        cursor.current = (before + lead + inserted + tail).length
        setText(before + lead + inserted + tail + after)
        box?.focus()
        // A box in a hidden dock takes no focus, and the cursor it is given is lost by the time it does.
        unfocused.current = box && document.activeElement !== box ? cursor.current : null
      }
    }
    return () => {
      current = null
    }
  }, [])
  // The cursor goes after what was inserted, once the box has it.
  useEffect(() => {
    if (cursor.current === null) return
    field.current?.setSelectionRange(cursor.current, cursor.current)
    cursor.current = null
  }, [text])
  // The board over the view put away, by Done or by Cancel: the keys are the box's again, for the prompt the note
  // goes with.
  const boardWasHere = useRef(false)
  useEffect(() => {
    if (boardWasHere.current && !drawingHere) field.current?.focus()
    boardWasHere.current = drawingHere
  }, [drawingHere])
  // Kept as it is written, so that what closing the window would lose can be asked of it, and kept when the pane goes.
  useEffect(() => void drafts.set(sessionId, text), [sessionId, text])

  /** Lets go of the preview of "Attach view", and of the picture being made for it. */
  function unattach(): void {
    pressing.current++
    shown.current = null
    setAttach(false)
    setAttached((url) => {
      if (url !== null) URL.revokeObjectURL(url)
      return null
    })
  }

  /** The preview of `made`, for the press `press`; an answer for an earlier press is let go. */
  function preview(press: number, made: Promise<{ png: Uint8Array; objectId: string }>): void {
    shown.current = made
    made.then(
      ({ png }) => {
        if (press !== pressing.current) return
        setAttached(URL.createObjectURL(new Blob([png as BlobPart], { type: 'image/png' })))
      },
      (e: unknown) => {
        if (press !== pressing.current) return
        shown.current = null
        setAttach(false)
        setProblem(reason(e))
      }
    )
  }

  /** "Attach view" pressed: the picture the send would take, made now. It is this picture that is sent, not another. */
  function attachView(): void {
    const press = ++pressing.current
    setProblem(null)
    setAttach(true)
    preview(press, picture({ view: 'current' }).then((look) => ({ png: look.png, objectId: look.objectId })))
  }
  // The preview is let go of with the composer.
  const attachedUrl = useRef<string | null>(null)
  attachedUrl.current = attached
  useEffect(() => () => {
    if (attachedUrl.current !== null) URL.revokeObjectURL(attachedUrl.current)
  }, [])

  async function send(): Promise<void> {
    const prompt = text.trim()
    if (prompt === '' || !live) return
    // The picture shown for "Attach view" is the one that goes; one still coming is waited for.
    const withView = attach ? shown.current : null
    let viewPng: Uint8Array | undefined
    let objectId = ''
    if (withView) {
      try {
        const made = await withView
        // Of the object this chat is of: the window may show another one by now.
        if (store.getState().sessions[made.objectId]?.sessionId !== sessionId) {
          unattach()
          setProblem('The view shown was of another project: attach it again')
          return
        }
        viewPng = made.png
        objectId = made.objectId
      } catch {
        return
      }
    }
    // So is the part of the board the person attached; the same.
    const board = boardActions.takeAttached()
    setText('')
    unattach()
    setProblem(null)
    onSent()
    try {
      await window.torno.chat.send(sessionId, { text: prompt, ...(viewPng ? { attachedView: viewPng } : {}), ...(board ? { board } : {}) })
    } catch (e) {
      // Nothing was sent: what was written is given back, unless more has been written since.
      setText((now) => (now === '' ? prompt : now))
      if (withView && viewPng) {
        // Shown again, as it was.
        const press = ++pressing.current
        setAttach(true)
        preview(press, Promise.resolve({ png: viewPng, objectId }))
      }
      if (board) boardActions.giveBackAttached(board)
      setProblem(reason(e))
    }
  }

  /** The text as the answer to the card that waits: it refuses with it as the reason, and the agent goes on with it. */
  function denyAndSend(): void {
    const message = text.trim()
    if (message === '' || !live || !openAsk) return
    setText('')
    setProblem(null)
    onSent()
    try {
      window.torno.chat.answer(sessionId, openAsk.requestId, { allow: false, message })
    } catch (e) {
      setText((now) => (now === '' ? message : now))
      setProblem(reason(e))
    }
  }

  /** The turn stopped, as the button does. */
  function stop(): void {
    setProblem(null)
    window.torno.chat.interrupt(sessionId).catch((e: unknown) => setProblem(reason(e)))
  }

  /** The words of a chip in the box, the cursor after them, the keys the box's: the person may add to them. Never sent. */
  function suggested(chip: Suggestion): void {
    cursor.current = chip.text.length
    setText(chip.text)
    field.current?.focus()
  }

  /** The command chosen, written in the box with a space after it, for its argument. */
  function complete(name: string): void {
    const done = `/${name} `
    cursor.current = done.length
    setText(done)
    field.current?.focus()
  }

  return (
    <div className="chat-foot">
      <Next />
      {live && text === '' && (
        <Suggestions
          chips={suggest({
            buildFailed,
            objectName,
            openMarks,
            layouts: layouts ?? [],
            items: [...(chat?.earlier ?? []), ...(chat?.items ?? [])],
            tornoDisconnected: chat?.meta.tornoConnected === false
          })}
          onChoose={suggested}
        />
      )}
      {offered.length > 0 && <Commands offered={offered} at={at} onChoose={complete} />}
      <WaitingNotes onProblem={setProblem} />
      {(attach || boardAttached) && (
        <div className="chat-with">
          <BoardChip />
          {attach && (
            <div className="chat-attached" role="group" aria-label="View attached">
              {attached !== null ? <img src={attached} alt="The view as it is now" draggable={false} /> : <span className="chat-attached-wait" aria-hidden="true" />}
              <span className="chat-with-what" title="This is the picture that goes with your prompt">
                <span>The view goes with your next prompt</span>
              </span>
              <button type="button" className="button button-quiet" onClick={unattach}>
                Remove
              </button>
            </div>
          )}
        </div>
      )}
      <div className="chat-composer">
        <textarea
          ref={field}
          className="chat-input"
          data-chat-composer=""
          rows={2}
          value={text}
          disabled={!live}
          aria-label="Message to Claude Code"
          placeholder={live ? (openAsk ? 'Answer the card above, or say what to do instead' : working ? 'Claude Code is working: this goes next' : 'Message Claude Code') : 'The session has ended'}
          aria-controls={offered.length > 0 ? 'chat-commands' : undefined}
          aria-activedescendant={offered.length > 0 ? `chat-command-${offered[at].name}` : undefined}
          onFocus={(e) => {
            // What was inserted while the box could not take the keys (in a hidden dock): the cursor goes after it now.
            if (unfocused.current === null) return
            e.currentTarget.setSelectionRange(unfocused.current, unfocused.current)
            unfocused.current = null
          }}
          onChange={(e) => {
            setText(e.target.value)
            setChoice(0)
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return
            // A new line is the browser's own.
            if (pressed(e, 'chat.newline')) return
            if (offered.length > 0 && which(e, 'chat.command') >= 0) {
              e.preventDefault()
              setChoice((at + (which(e, 'chat.command') === 0 ? offered.length - 1 : 1)) % offered.length)
              return
            }
            if (offered.length > 0 && pressed(e, 'chat.complete')) {
              e.preventDefault()
              complete(offered[at].name)
              return
            }
            if (working && live && pressed(e, 'chat.stop') && e.currentTarget.selectionStart === e.currentTarget.selectionEnd) {
              // Nothing selected: Ctrl+C is not a copy. With a selection it is, and the turn goes on.
              e.preventDefault()
              stop()
            } else if (pressed(e, 'chat.send')) {
              e.preventDefault()
              if (openAsk) denyAndSend()
              else void send()
            } else if (pressed(e, 'field.leave')) {
              e.preventDefault()
              // With the list of commands open, Escape closes it; the keys go back to the view with the next one.
              if (offered.length > 0) setShut(text)
              else giveKeysBack(e.currentTarget)
            }
          }}
        />
        <div className="chat-actions">
          <button
            type="button"
            className="button"
            aria-pressed={attach}
            disabled={!live}
            title="Add a picture of the view as it is now to the next prompt"
            onClick={() => (attach ? unattach() : attachView())}
          >
            Attach view
          </button>
          <button
            type="button"
            className="button"
            disabled={!live || opening}
            title="Draw over a picture of the view as it is now; it is kept as a note that goes with your next prompt"
            onClick={() => {
              setProblem(null)
              openDrawing(sessionId).catch((e: unknown) => setProblem(reason(e)))
            }}
          >
            Draw on view
          </button>
          <span className="spacer" />
          {working && live && (
            <button
              type="button"
              className="button"
              title={`Stop the turn (${hint('chat.stop')} with nothing selected)`}
              onClick={stop}
            >
              Stop
            </button>
          )}
          {openAsk && (
            <button
              type="button"
              className="button button-primary"
              disabled={!live || text.trim() === ''}
              title={`Refuse what the card asks, with this as what to do instead (${hint('chat.send')})`}
              onClick={denyAndSend}
            >
              Deny and send
            </button>
          )}
          <button
            type="button"
            className={openAsk ? 'button' : 'button button-primary'}
            disabled={!live || text.trim() === ''}
            title={openAsk ? 'Leave the card as it is and queue this for after it' : `Send (${hint('chat.send')})`}
            onClick={() => void send()}
          >
            {working ? 'Queue' : 'Send'}
          </button>
        </div>
      </div>
      {rate !== null && (
        <p className="chat-rate" role="status">
          {numbered(rate)}
        </p>
      )}
      {problem !== null && (
        <p className="chat-problem selectable" role="alert">
          {problem}
        </p>
      )}
    </div>
  )
}
