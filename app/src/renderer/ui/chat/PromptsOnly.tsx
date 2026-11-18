import { memo, useMemo, useState, type ReactNode } from 'react'
import type { PromptRow } from '../../../shared/chat'
import type { HistoryEntry } from '../../../shared/history'
import { actions, explodeNow, useStore } from '../../state/store'
import { useHistory } from '../useHistory'
import { GoBack } from './GoBack'
import { ago } from './ago'
import { SaveLine } from './SaveLine'
import { PromptNumbers, ChatIdle } from './turnContext'
import { promptLines, resultWord, type PromptItem, type PromptLine } from './promptsView'
import { usePrompts } from './usePrompts'
import { useThumb } from './useThumb'

const NO_ENTRIES: HistoryEntry[] = []

/** The picture of a prompt's last build; an empty frame while it comes, for a prompt that built nothing and for a build that failed. */
function Thumb({ objectId, entry }: { objectId: string; entry: HistoryEntry | undefined }) {
  const url = useThumb(objectId, entry)
  return <span className="prompt-thumb">{url ? <img src={url} alt="" /> : null}</span>
}

/** One word of what the prompt came to, in the tone it is: a failure is told as one. */
const toneOf = (word: string): 'fail' | 'warn' | 'ok' | undefined => (word.includes('fail') ? 'fail' : word === 'passes' || word === 'starred' ? 'ok' : word === 'gone back from' ? 'warn' : undefined)

/**
 * One row: the number, the picture of the last build, what was said cut to one line, and under it where the builds went
 * (`h40 → h41`), what they came to in a word, and when. A click compares the prompt (its last build over the one it started
 * from); a double click, or "Open in chat", opens it in the chat.
 */
const PromptRowView = memo(function PromptRowView({ objectId, item, onOpen, goBack, blocked, now }: { objectId: string; item: PromptItem; onOpen?: (row: PromptRow) => void; goBack?: boolean; blocked: string | null; now: number }) {
  const { row, from, to } = item
  // A terminal's prompt is in no chat: there is nothing to open.
  const open = row.id.startsWith('t-') ? undefined : onOpen
  const comparing = useStore((s) => from !== undefined && to !== undefined && s.compare !== null && s.compare.from === from.id && s.compare.to === to.id)
  const comparable = from !== undefined && to !== undefined && from.id !== to.id
  const word = resultWord(item)
  const tone = toneOf(word)
  const why = !comparable ? (item.entries.length === 0 ? 'This prompt built nothing' : 'There is no build before it to compare with') : blocked !== null && !comparing ? blocked : undefined
  return (
    <li className="prompt" data-prompt={row.id} data-number={row.number} data-gone={item.gone ? '' : undefined}>
      <button
        type="button"
        className="prompt-row"
        aria-pressed={comparing}
        aria-disabled={why !== undefined ? true : undefined}
        title={why ?? (comparing ? 'Back to the live build' : `Draw ${to!.id} over ${from!.id} in the view`)}
        onClick={() => {
          if (why !== undefined) return
          if (comparing) actions.endCompare()
          else actions.compare(from!.id, to!.id, row.number)
        }}
        onDoubleClick={() => open?.(row)}
      >
        <span className="prompt-number num">{row.number}</span>
        <Thumb objectId={objectId} entry={to} />
        <span className="prompt-body">
          <span className="prompt-text">{row.text.replace(/\s+/g, ' ').trim() || 'No words: only a picture or a mark'}</span>
          <span className="prompt-facts">
            {item.entries.length > 0 && (
              <span className="num">
                {from ? `${from.id} → ` : ''}
                {to?.id ?? item.entries.at(-1)!.id}
              </span>
            )}
            {item.starred && (
              <span className="prompt-star" aria-label="starred" title="A build of it is starred">
                ★
              </span>
            )}
            {word !== '' && (
              <span className="prompt-result" data-tone={tone}>
                {/^\d/.test(word) ? (
                  <>
                    <span className="num">{word.split(' ')[0]}</span> {word.slice(word.indexOf(' ') + 1)}
                  </>
                ) : (
                  word
                )}
              </span>
            )}
            <span>{ago(new Date(row.at).toISOString(), now)}</span>
          </span>
        </span>
      </button>
      {open && (
        <button type="button" className="button button-quiet prompt-open" title="Read it in the chat, where it was said" onClick={() => open(row)}>
          Open in chat
        </button>
      )}
      {goBack && item.entries.length > 0 && !item.gone && (
        <span className="prompt-goback">
          <GoBack turnId={row.id} joined={{ promptId: row.id, number: row.number, entries: item.entries, ...(from ? { from } : {}) }} undoable={false} />
        </span>
      )}
    </li>
  )
})

/** Prompts a Go back undid, faded and folded into one row; "Show" opens them as they were. */
function GoneRow({ line, children }: { line: Extract<PromptLine, { kind: 'gone' }>; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <li className="prompt-gone" data-open={open ? '' : undefined}>
      <p className="prompt-gone-head">
        {line.first === line.last ? (
          <>
            Prompt <span className="num">{line.first}</span> · you went back from this
          </>
        ) : (
          <>
            Prompts <span className="num">{line.first}</span> to <span className="num">{line.last}</span> · you went back from these
          </>
        )}
        <button type="button" className="chat-more" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Hide' : 'Show'}
        </button>
      </p>
      {open && <ol className="prompt-gone-body">{children}</ol>}
    </li>
  )
}

/** The counts the line over the list says. */
function summary(rows: readonly PromptRow[], builds: number): ReactNode {
  const conversations = new Set(rows.map((r) => r.conversation)).size
  return (
    <>
      <span className="num">{rows.length}</span> {rows.length === 1 ? 'prompt' : 'prompts'} · <span className="num">{builds}</span> {builds === 1 ? 'build' : 'builds'} · <span className="num">{conversations}</span> {conversations === 1 ? 'conversation' : 'conversations'}
    </>
  )
}

/**
 * The history of the project as one row per prompt, newest first, across every conversation of it, with a quiet line where a
 * conversation began and one for what the person built between two prompts. The rows are the project's prompts (`rows`, from
 * main) joined to its builds (`useHistory`) by what main labelled each build with. Filters: Starred, Hide gone back.
 * `current`: the conversation the chat shows. `onOpen`: where a row is opened in the chat (not in a terminal's pane).
 * `goBack`: each prompt that built something has "Go back to before this prompt" (a terminal's pane has no turn to put it on).
 * `onClose`: over the chat, where the dock's More menu opened it, a "Close" in its head puts it away (the terminal's pane has its own).
 */
export function PromptsOnly({ rows, current, onOpen, goBack, onClose }: { rows: PromptRow[] | undefined; current?: string; onOpen?: (row: PromptRow) => void; goBack?: boolean; onClose?: () => void }) {
  const objectId = useStore((s) => s.objectId)
  const history = useHistory(true)
  const blocked = useStore((s) => (s.section !== null ? 'Take the section away first: an earlier build is not drawn cut.' : explodeNow(s) !== null ? 'Put the parts together first: an earlier build is not drawn apart.' : null))
  const [starred, setStarred] = useState(false)
  const [hideGone, setHideGone] = useState(false)
  const entries = history?.entries ?? NO_ENTRIES
  const lines = useMemo(() => promptLines(rows ?? [], entries, { ...(current !== undefined ? { current } : {}), starred, hideGone }), [rows, entries, current, starred, hideGone])
  // Said as of when the list was made: "4 minutes ago" is not worked out again for every beat of the window.
  const now = useMemo(() => Date.now(), [lines])

  const draw = (line: PromptLine): ReactNode => {
    if (line.kind === 'prompt') return objectId === null ? null : <PromptRowView key={line.row.id} objectId={objectId} item={line} onOpen={onOpen} goBack={goBack} blocked={blocked} now={now} />
    if (line.kind === 'saves')
      return (
        <li key={line.id} className="prompt-between">
          <SaveLine run={line.run} />
        </li>
      )
    if (line.kind === 'began')
      return (
        <li key={line.id} className="prompt-began chat-quiet">
          Conversation began {ago(new Date(line.at).toISOString(), now)}
          {line.current ? ' · the one in the chat' : ''}
        </li>
      )
    return (
      <GoneRow key={line.id} line={line}>
        {line.lines.map(draw)}
      </GoneRow>
    )
  }

  return (
    <div className="prompts" data-part="prompts">
      <div className="prompts-head">
        <span className="prompts-summary">{rows ? summary(rows, entries.length) : 'Reading…'}</span>
        <span className="spacer" />
        <button type="button" className="button button-quiet" aria-pressed={starred} title="Only the prompts with a starred build" onClick={() => setStarred(!starred)}>
          Starred
        </button>
        <button type="button" className="button button-quiet" aria-pressed={hideGone} title="Leave out the prompts you went back from" onClick={() => setHideGone(!hideGone)}>
          Hide gone back
        </button>
        {onClose && (
          <button type="button" className="button button-quiet" onClick={onClose}>
            Close
          </button>
        )}
      </div>
      <div className="prompts-scroll">
        {rows !== undefined && rows.length === 0 && <p className="chat-empty">No prompt has been sent in this project yet.</p>}
        {rows !== undefined && rows.length > 0 && lines.length === 0 && <p className="chat-empty">{starred ? 'No prompt has a starred build.' : 'Nothing to show.'}</p>}
        {lines.length > 0 && <ol className="prompts-list" aria-label="Prompts, newest first">{lines.map(draw)}</ol>}
      </div>
    </div>
  )
}

/**
 * Prompts only as a pane of its own, over the session area, for where the chat is not (a terminal session, or no session
 * started): its rows come from the history's own labels and the project's logs, and a row can be compared but not opened in a
 * chat. Closed by the button, and by `Chat`/`Terminal` below the head of the pane.
 */
export function PromptsPane({ onClose }: { onClose: () => void }) {
  const history = useHistory(true)
  // Asked again when a build is kept: by the newest build's id, which still changes once the history holds as many as it keeps.
  const rows = usePrompts(true, history?.entries.at(-1)?.id ?? '')
  const numbers = useMemo(() => new Map((rows ?? []).map((row) => [row.id, row.number])), [rows])
  return (
    <section className="session-prompts" aria-label="Prompts only">
      <header className="session-prompts-head">
        <h3 className="session-prompts-title">Prompts</h3>
        <span className="spacer" />
        <button type="button" className="button button-quiet" onClick={onClose}>
          Close
        </button>
      </header>
      {/* No chat here to say whether Claude works: main refuses a Go back while a session of the project does. */}
      <ChatIdle.Provider value={true}>
        <PromptNumbers.Provider value={numbers}>
          <PromptsOnly rows={rows} goBack />
        </PromptNumbers.Provider>
      </ChatIdle.Provider>
    </section>
  )
}
