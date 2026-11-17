import { useEffect, useRef, useState } from 'react'
import { type NoteMark, penStrokes } from '../../../shared/marks'
import { noteDrawnOver } from '../../../shared/drawing'
import { unheldNotes } from '../../../shared/reviews'
import { roundsViewOf, useReview } from '../../state/review'
import { useStore } from '../../state/store'
import { openNote } from '../drawing/make'
import { DrawnOverLine } from './DrawnOver'
import { RefChip } from './RefChip'
import { useNotePicture } from './useNotePicture'

/** How long "Undo" is offered after a note is removed. */
const UNDO_MS = 10_000

/** What an IPC call failed with, without Electron's wrapping. */
const reason = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']*': (Error: )?/, '')

function Waiting({ note, objectId, revision, onEdit, onRemove }: { note: NoteMark; objectId: string; revision: number; onEdit: () => void; onRemove: () => void }) {
  const picture = useNotePicture(objectId, note.id, note.ink)
  const inked = penStrokes(note.strokes).length > 0
  return (
    <div className="chat-note-wait" role="group" aria-label={`View note ${note.id}`} data-note={note.id}>
      {picture.url !== null ? (
        <img src={picture.url} alt="" draggable={false} />
      ) : (
        <span className="chat-attached-wait" data-picture={picture.state} aria-hidden="true" />
      )}
      <span className="chat-with-what">
        <span className="chat-note-title">
          <RefChip value={note.id} /> goes with your next prompt
        </span>
        {note.note !== '' && <span className="chat-note-comment">{note.note}</span>}
        {picture.state === 'missing' && <span className="over-warn">picture not on this computer</span>}
        {inked && <DrawnOverLine drawn={noteDrawnOver(note, revision > 0 ? revision : undefined)} />}
      </span>
      <button type="button" className="button button-quiet" onClick={onEdit}>
        Edit
      </button>
      <button type="button" className="button button-quiet" onClick={onRemove}>
        Remove
      </button>
    </div>
  )
}

/**
 * The view notes of the open project that wait for the next prompt (drafts), a row each: its picture with the ink, what
 * its ink lies over (refs that are live chips, or that it was not worked out), "Edit" (the sheet over it again) and
 * "Remove" (the mark is deleted; "Undo" puts it back for ten seconds). A note whose pictures are not on this computer
 * says so. `onProblem` is told why an Edit or a Remove was refused.
 */
export function WaitingNotes({ onProblem }: { onProblem: (message: string | null) => void }) {
  const objectId = useStore((s) => s.objectId)
  const marks = useStore((s) => s.marks)
  const revision = useStore((s) => (s.scene ? s.revision : 0))
  const reviewOf = useReview((s) => s.objectId)
  const rounds = useReview((s) => s.rounds)
  const sending = useReview((s) => s.sending)
  const [removed, setRemoved] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const offer = (id: string | null): void => {
    clearTimeout(timer.current)
    setRemoved(id)
    if (id !== null) timer.current = setTimeout(() => setRemoved(null), UNDO_MS)
  }
  useEffect(() => () => clearTimeout(timer.current), [])
  useEffect(() => offer(null), [objectId])
  if (objectId === null) return null
  // A note of a round that is not sent is held with it: it goes with Send review, not with the next prompt.
  const waiting = unheldNotes(marks, roundsViewOf({ objectId: reviewOf, rounds, sending }, objectId))
  if (waiting.length === 0 && removed === null) return null
  return (
    <div className="chat-with chat-notes">
      {waiting.map((note) => (
        <Waiting
          key={note.id}
          note={note}
          objectId={objectId}
          revision={revision}
          onEdit={() => {
            onProblem(null)
            openNote(objectId, note.id).catch((e: unknown) => onProblem(reason(e)))
          }}
          onRemove={() => {
            onProblem(null)
            window.torno.marks.remove(objectId, note.id).then(
              () => offer(note.id),
              (e: unknown) => onProblem(reason(e))
            )
          }}
        />
      ))}
      {removed !== null && (
        <p className="chat-note-undo" role="status">
          Removed <span className="num">{removed}</span> ·{' '}
          <button
            type="button"
            className="link-button"
            onClick={() => {
              const id = removed
              offer(null)
              window.torno.marks.restore(objectId, id).catch((e: unknown) => onProblem(reason(e)))
            }}
          >
            Undo
          </button>
        </p>
      )}
    </div>
  )
}
