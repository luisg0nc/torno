import { useEffect, useMemo, useRef, useState } from 'react'
import { hint, pressed } from '../../../shared/keys'
import type { NoteLabel, NoteMark } from '../../../shared/marks'
import { type Board, drawingActions, useDrawing } from '../../state/drawing'
import { Confirm } from '../Confirm'
import { InkPad } from '../ink/InkPad'
import { changeOf } from './change'
import { Labels } from './Labels'
import { References } from './References'
import { type RefItem, MAX_NOTE_COMMENT, itemsOf } from './referenceImages'
import { finishDrawing, finishNoteText, worksOut } from './make'

/** The face of the window's text, which the labels of a picture are set in as the sheet sets them. */
const family = (): string => getComputedStyle(document.documentElement).getPropertyValue('--font-ui').trim() || 'sans-serif'

/**
 * The sheet of a view note, over the whole window as the export sheet is: the agent's own picture of the view (or the
 * plain picture of a note being edited) under the ink, with a label tool, a comment and the reference pictures. A note
 * whose plain picture is not on this computer opens as a reduced sheet, of its comment and its references alone.
 */
export function ViewBoard() {
  const board = useDrawing((s) => s.board)
  if (!board) return null
  // A sheet of its own for each picture, so that nothing of one is held by the next.
  return board.picture ? <NoteSheet key={board.picture.url} board={board} /> : <TextSheet board={board} />
}

/** Whether what the ink lies over can be worked out as it stands: asked as the sheet is drawn and again while it is open, for the view may move under it. */
function useWorksOut(board: Board): boolean {
  const [ok, setOk] = useState(() => board.note === null && worksOut(board.picture!))
  useEffect(() => {
    if (board.note !== null) return
    const id = window.setInterval(() => setOk(worksOut(board.picture!)), 400)
    return () => window.clearInterval(id)
  }, [board])
  return ok
}

/** The comment of a note: one line, and how much of it is left. */
function CommentField({ value, onChange, busy }: { value: string; onChange: (text: string) => void; busy: boolean }) {
  return (
    <label className="note-comment">
      <span>Comment</span>
      <input
        className="note-field"
        data-board-field=""
        aria-label="Comment"
        placeholder="What you want done, or what this is"
        maxLength={MAX_NOTE_COMMENT}
        value={value}
        disabled={busy}
        onChange={(e) => onChange(e.target.value.replace(/[\r\n]+/g, ' '))}
      />
      <span className="note-count num">
        {value.length}/{MAX_NOTE_COMMENT}
      </span>
    </label>
  )
}

function NoteSheet({ board }: { board: Board }) {
  const picture = board.picture!
  const note = board.note
  const [labels, setLabels] = useState<NoteLabel[]>(() => (note?.labels ?? []).map((l) => ({ ...l, ...(l.to ? { to: { ...l.to } } : {}) })))
  const [comment, setComment] = useState(note?.note ?? '')
  const [references, setReferences] = useState<RefItem[]>(() => itemsOf(note))
  const [busy, setBusy] = useState(false)
  const worked = useWorksOut(board)
  const size = useMemo(() => ({ width: picture.width, height: picture.height }), [picture])
  const look = useMemo(() => ({ ink: picture.ink, casing: picture.casing }), [picture])
  const face = useMemo(family, [])
  const content = labels.length > 0 || comment !== '' || references.length > 0
  const edited = note ? changeOf(note, { strokes: note.strokes, labels, comment, references }) : null
  // What is not worked out is said before Done, not after: a new note's ink was drawn over a view that moved, or an edit's ink will be.
  const warning = note ? 'If you change the ink or an arrow, what it lies over is not worked out again.' : worked ? null : 'The view changed while you were drawing: what the ink lies over could not be worked out. The ink is kept.'

  return (
    <InkPad
      title={note ? `Edit view note ${note.id}` : 'Draw on view'}
      label="Drawing on the view"
      hint="Ring it, point at it, sketch beside it, or label it with an arrow. Claude gets this picture with your ink, and what the ink lies over."
      size={size}
      ground={picture.url}
      look={() => look}
      initial={board.strokes}
      labels={({ labelling, busy: saving }) => <Labels size={size} labels={labels} onChange={setLabels} labelling={labelling && !saving} look={look} family={face} />}
      aside={
        <div className="note-aside">
          <CommentField value={comment} onChange={setComment} busy={busy} />
          <References objectId={board.objectId} noteId={note?.id ?? null} items={references} onChange={setReferences} busy={busy} />
          {warning !== null && (
            <p className="note-warn" role="note">
              {warning}
            </p>
          )}
        </div>
      }
      ready={note !== null || content}
      changed={note ? edited!.any : content}
      discard={note ? { label: 'Discard these changes?', text: 'Discard these changes? The note stays as it was.' } : { label: 'Discard this drawing?', text: 'Discard this drawing? What was drawn since it was opened is not kept.' }}
      onDone={async (strokes) => {
        setBusy(true)
        try {
          await finishDrawing(strokes, { labels, comment, references, family: face })
        } finally {
          setBusy(false)
        }
      }}
      onCancel={() => drawingActions.cancel()}
    />
  )
}

/** The sheet of a note whose picture is not on this computer: its comment and its references, and nothing of the ink. */
function TextSheet({ board }: { board: Board }) {
  const note = board.note as NoteMark
  const sheet = useRef<HTMLElement>(null)
  const [comment, setComment] = useState(note.note)
  const [references, setReferences] = useState<RefItem[]>(() => itemsOf(note))
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
  const changed = changeOf(note, { strokes: note.strokes, labels: note.labels, comment, references }).any

  const leave = (): void => (changed ? setAsking(true) : drawingActions.cancel())
  const act = useRef(leave)
  act.current = leave
  useEffect(() => {
    const before = document.activeElement
    sheet.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (!pressed(e, 'sheet.close') || document.querySelector('[role="alertdialog"]')) return
      e.preventDefault()
      e.stopPropagation()
      if (e.target instanceof HTMLElement && e.target.closest('[data-board-field]')) {
        // Esc in a field is the field's: the keys are the sheet's again; the next Esc leaves.
        e.target.blur()
        sheet.current?.focus({ preventScroll: true })
        return
      }
      act.current()
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      if (before instanceof HTMLElement && before.isConnected) before.focus()
    }
  }, [])

  const done = async (): Promise<void> => {
    setBusy(true)
    setProblem(null)
    try {
      await finishNoteText({ comment, references })
    } catch (e) {
      setBusy(false)
      setProblem(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="board-layer">
      <section ref={sheet} className="board-sheet board-sheet-text" role="dialog" aria-modal="true" aria-label="Editing the view note" tabIndex={-1} onKeyDown={(e) => e.stopPropagation()}>
        <header className="board-head">
          <h2>Edit view note {note.id}</h2>
          <p className="board-hint">The picture of this note is not on this computer: its comment and its references can be changed, its ink cannot.</p>
        </header>
        <div className="note-aside">
          <CommentField value={comment} onChange={setComment} busy={busy} />
          <References objectId={board.objectId} noteId={note.id} items={references} onChange={setReferences} busy={busy} />
        </div>
        {asking && (
          <Confirm label="Discard these changes?" accept="Discard" cancel="Keep editing" onCancel={() => setAsking(false)} onAccept={() => drawingActions.cancel()}>
            Discard these changes? The note stays as it was.
          </Confirm>
        )}
        <footer className="board-foot">
          {problem !== null ? (
            <p className="board-problem" role="alert">
              {problem}
            </p>
          ) : (
            <p className="board-size" />
          )}
          <button type="button" className="button" disabled={busy} title={`Put the sheet away without keeping this (${hint('sheet.close')})`} onClick={leave}>
            Cancel
          </button>
          <button type="button" className="button button-primary" disabled={busy || !changed} onClick={() => void done()}>
            Done
          </button>
        </footer>
      </section>
    </div>
  )
}
