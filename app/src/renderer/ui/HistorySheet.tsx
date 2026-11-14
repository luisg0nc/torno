import { useEffect, useRef, useState } from 'react'
import { hint, pressed } from '../../shared/keys'
import type { HistoryEntry, HistoryList } from '../../shared/history'
import { actions, explodeNow, runningSession, useStore } from '../state/store'
import { ago } from './chat/ago'
import { NO_COPY, goBackPrompt, marksOf, nameOf } from './historyBits'
import { insertIntoSession } from './insertIntoSession'
import { numbered } from './numbered'
import { useHistory } from './useHistory'

/** The picture kept with a build, or an empty frame while it comes or when there is none. */
function Thumb({ objectId, entry }: { objectId: string; entry: HistoryEntry }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!entry.thumb) return setUrl(null)
    let current = true
    let made: string | null = null
    window.torno.history.thumbnail(objectId, entry.id).then(
      (png) => {
        if (!current || !png) return
        made = URL.createObjectURL(new Blob([png], { type: 'image/png' }))
        setUrl(made)
      },
      () => {}
    )
    return () => {
      current = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [objectId, entry.id, entry.thumb])
  return <span className="history-thumb">{url ? <img src={url} alt="" /> : <span className="history-nothumb">No picture</span>}</span>
}

/** The text of one copied file of a build, read only, in the monospace face. */
function Source({ objectId, entry }: { objectId: string; entry: HistoryEntry }) {
  const [file, setFile] = useState(entry.files[0] ?? '')
  const [text, setText] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    setFile(entry.files[0] ?? '')
  }, [entry.id, entry.files])
  useEffect(() => {
    if (file === '') return setText(null)
    let current = true
    setText(undefined)
    window.torno.history.source(objectId, entry.id, file).then(
      (found) => current && setText(found),
      () => current && setText(null)
    )
    return () => {
      current = false
    }
  }, [objectId, entry.id, file])
  return (
    <div className="history-source" data-part="source">
      {entry.files.length > 1 && (
        <div className="history-files" role="group" aria-label="Files of this build">
          {entry.files.map((f) => (
            <button key={f} type="button" className="button button-quiet" aria-pressed={f === file} onClick={() => setFile(f)}>
              {f}
            </button>
          ))}
        </div>
      )}
      {entry.files.length === 1 && <p className="history-file">{file}</p>}
      {text === undefined && <p className="muted">Reading…</p>}
      {text === null && <p className="muted">{NO_COPY}</p>}
      {typeof text === 'string' && (
        <pre className="sheet-pre" tabIndex={0} aria-label={`${file}, read only`}>
          {text}
        </pre>
      )}
    </div>
  )
}

/**
 * The builds kept of the open project (`main/history.ts`), newest first in a strip: a picture, which build, how long ago
 * and what changed from the one before it. The chosen build can be starred (a starred one is not let go), its Python
 * source read, as it was, and the agent asked to go back to it. torno writes no file of the project for it: the request
 * is put in the message box of the session and not sent, the copies are named to the agent, and the agent edits.
 */
export function HistorySheet({ objectName, onClose }: { objectName: string; onClose: () => void }) {
  const objectId = useStore((s) => s.objectId)
  const list = useHistory(true)
  const session = useStore(runningSession)
  const comparing = useStore((s) => s.compare?.from ?? null)
  // The earlier build is drawn uncut and together: it cannot be laid over a section or parts drawn apart.
  const blocked = useStore((s) => (s.section !== null ? 'Take the section away first: an earlier build is not drawn cut.' : explodeNow(s) !== null ? 'Put the parts together first: an earlier build is not drawn apart.' : null))
  const [chosen, setChosen] = useState<string | null>(null)
  const [source, setSource] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  const sheet = useRef<HTMLElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (pressed(e, 'sheet.close')) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (said === null) return
    const timer = setTimeout(() => setSaid(null), 4000)
    return () => clearTimeout(timer)
  }, [said])

  const newest = list ? [...list.entries].reverse() : []
  const entry = newest.find((e) => e.id === chosen) ?? newest[0]

  function ask(l: HistoryList, e: HistoryEntry): void {
    const text = goBackPrompt(l, e, objectName)
    actions.setDockOpen(true)
    if (!session) {
      // The session pane starts one and leaves the words in its box.
      actions.setFixRequest(text)
      return setSaid('Starting a session: the request will be in its message box. Read it, then send it.')
    }
    if (!insertIntoSession(text, { later: true })) return setSaid('The message box is not open.')
    setSaid('In the message box: read it, then send it.')
  }

  return (
    <section className="sheet" data-sheet="history" role="dialog" aria-label="History of builds" ref={sheet}>
      <header className="sheet-head">
        <h2 className="sheet-title">Builds of {objectName}</h2>
        <span className="spacer" />
        <button type="button" className="icon-button" aria-label="Close" title={`Close (${hint('sheet.close')})`} onClick={onClose}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" aria-hidden="true">
            <path d="m4 4 8 8M12 4l-8 8" />
          </svg>
        </button>
      </header>
      <div className="sheet-lead">
        <p className="muted">
          Every build that worked is kept with a copy of the Python files it was made from: the latest 100, and the ones you star. What a build had then (checks, defects, dimensions) is as of then. torno never puts a file back; it asks the agent to.
        </p>
      </div>
      <div className="sheet-body">
        {list === undefined && <p className="history-note">Reading…</p>}
        {list === null && <p className="history-note">The history of this project cannot be read now.</p>}
        {list && newest.length === 0 && <p className="history-note">No build has been kept yet.</p>}
        {list && objectId !== null && newest.length > 0 && (
          <>
            <ol className="history-strip" aria-label="Builds kept, newest first">
              {newest.map((e) => (
                <li key={e.id}>
                  <button type="button" className="history-card" data-build={e.id} aria-pressed={e === entry} onClick={() => setChosen(e.id)}>
                    <Thumb objectId={objectId} entry={e} />
                    <span className="history-name">
                      {e.starred && <span aria-label="starred" title="Starred">★ </span>}
                      <span className="num">{nameOf(list, e)}</span>
                    </span>
                    <span className="history-when">{ago(e.at)}</span>
                    <span className="history-line">{numbered(e.line)}</span>
                    {marksOf(e).map((m) => (
                      <span key={m} className="history-mark">
                        {m}
                      </span>
                    ))}
                  </button>
                </li>
              ))}
            </ol>
            {entry && (
              <div className="history-detail" data-build={entry.id}>
                <p className="history-facts">
                  <span className="num">{nameOf(list, entry)}</span> · {new Date(entry.at).toLocaleString()} · <span className="num">{entry.parts}</span> {entry.parts === 1 ? 'part' : 'parts'} · built in <span className="num">{entry.seconds.toFixed(1)}</span> s
                  {entry.head && (
                    <>
                      {' '}
                      · on <span className="num">{entry.head}</span>
                      {entry.dirty ? ' with changes' : ''}
                    </>
                  )}
                </p>
                {entry.failing && <p className="history-warn">Checks of the model that failed then: {entry.failing.join(', ')}</p>}
                {entry.defects && <p className="history-warn">Defects then: {entry.defects.join('; ')}</p>}
                {entry.dimensions && (
                  <p className="muted">
                    Your dimensions then: <span className="num">{entry.dimensions.pass}</span> pass, <span className="num">{entry.dimensions.fail}</span> fail, <span className="num">{entry.dimensions.none}</span> not measured
                  </p>
                )}
                <div className="history-actions">
                  <button
                    type="button"
                    className="button"
                    data-part="compare"
                    aria-pressed={comparing === entry.id}
                    disabled={!list.ghosts.includes(entry.id) || (blocked !== null && comparing !== entry.id)}
                    title={
                      !list.ghosts.includes(entry.id)
                        ? 'Only a build of this run, still held in memory, can be drawn over the current one'
                        : blocked !== null
                          ? blocked
                          : 'Draw this build over the current one, translucent, for looking only; nothing is changed'
                    }
                    onClick={() => (comparing === entry.id ? actions.endCompare() : actions.compare(entry.id, newest[0].id))}
                  >
                    {comparing === entry.id ? 'Stop showing it over the current' : 'Show over the current build'}
                  </button>
                  <button type="button" className="button" aria-pressed={source} disabled={entry.files.length === 0} title={entry.files.length === 0 ? NO_COPY : 'Read the Python files this build was made from, as they were'} onClick={() => setSource(!source)}>
                    {source ? 'Hide the source' : 'Show the source'}
                  </button>
                  <button
                    type="button"
                    className="button button-primary"
                    data-part="go-back"
                    disabled={entry.files.length === 0}
                    title={entry.files.length === 0 ? NO_COPY : 'Puts a request in the message box and sends nothing; the agent edits the files, torno does not'}
                    onClick={() => ask(list, entry)}
                  >
                    Ask the agent to go back to this build
                  </button>
                  <button
                    type="button"
                    className="button button-quiet"
                    aria-pressed={entry.starred === true}
                    title="A starred build is kept past the latest 100"
                    onClick={() => objectId !== null && void window.torno.history.star(objectId, entry.id, entry.starred !== true).catch(() => {})}
                  >
                    {entry.starred ? 'Unstar' : 'Star'}
                  </button>
                  {said !== null && (
                    <span className="history-said" role="status">
                      {said}
                    </span>
                  )}
                </div>
                {source && objectId !== null && <Source objectId={objectId} entry={entry} />}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}
