import { pressed } from '../../shared/keys'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { exactText, shownDimension } from '../../shared/dimension'
import { EXPLODED_TOOLS } from '../../shared/explode'
import { type Mark, type MarkKind, type MarkPatch, type NoteMark, type SketchMark, awaitsAcknowledgement, isUnchecked } from '../../shared/marks'
import { isHeld } from '../../shared/reviews'
import { count, number } from '../../shared/format'
import { countsText, sketchName, takeText } from '../../shared/sketchText'
import { reviewActions, useReview } from '../state/review'
import { actions, explodeNow, partsInLayout, runningSession, store, useStore } from '../state/store'
import { endReplace, startReplace, useReplacing } from '../state/tools'
import { editSketch } from '../state/sketching'
import { editRegion } from '../tools/regionPainting'
import { rowLabel } from '../viewport/marks/labels'
import { spanningMarks } from '../viewport/marks/apart'
import type { ReviewStep } from './ResolvedSummary'
import { DimensionFields, VerdictIcon, Words } from './DimensionFields'
import { hoverMark, unhoverMark } from './markHover'
import { Confirm } from './Confirm'
import { IntentMenu } from './IntentMenu'
import { ShapeFields } from './ShapeFields'
import { useNotePicture } from './chat/useNotePicture'
import { openNote } from './drawing/make'
import { insertIntoSession } from './insertIntoSession'
import { ICONS, SHAPE_ICONS } from './ToolPalette'

/** The longest note a mark keeps (main cuts there); the field stops at it, so nothing is cut unseen. */
export const MAX_NOTE = 2000

const KIND_ICON: Record<MarkKind, ReactNode> = { pin: ICONS.pin, pick: ICONS.select, arrow: ICONS.arrow, stroke: ICONS.draw, shape: ICONS.shape, dimension: ICONS.measure, region: ICONS.region, note: ICONS.draw, sketch: ICONS.draw, span: ICONS.measure, offset: ICONS.arrow }
const KIND_NAME: Record<MarkKind, string> = { pin: 'Pin', pick: 'Pick', arrow: 'Arrow', stroke: 'Stroke', shape: 'Shape', dimension: 'Dimension', region: 'Region', note: 'View note', sketch: 'Sketch', span: 'Measure', offset: 'Should be here' }
/** What the row says of a dimension the agent has been given: it stays, with its value, until it is resolved. */
export const PINNED = 'pinned'
/** What the row of a check the agent has not been given says: it is under Checks, not under To send. */
export const TO_SEND = 'to send'
const ANCHOR_NOTE = {
  ok: '',
  drifted: 'The surface it was on has moved since it was placed',
  orphaned: 'The part it was on is gone'
} as const
/** What the row says of a mark the last build left off its surface, or without its part. */
export const ANCHOR_BADGE = { drifted: 'moved: check it', orphaned: 'its part is gone' } as const
/** What the row says of a region whose scan is gone, or is no longer the mesh it was painted on, and why. */
export const SCAN_GONE = 'its scan is gone'
export const SCAN_READ_AGAIN = 'its scan was read again'
const REGION_NOTE = {
  [SCAN_GONE]: 'The scan it was painted on was removed: it has no triangles any more. Its note is kept',
  [SCAN_READ_AGAIN]: 'The scan it was painted on was imported again from a changed source: it is not of that mesh. Paint it again'
} as const
/** What the row says of a region whose scan is switched off: it is not drawn either. */
export const SCAN_HIDDEN = 'its scan is hidden'
/** What the row says of a mark whose layout the build no longer has: it cannot be shown, and going to it does nothing. */
export const LAYOUT_GONE = 'its layout is gone'
/** What the row says of a dimension or an arrow whose ends are on parts that are drawn apart from each other: its line is drawn dashed between them, as long as they are apart. A dimension's value is the kernel's, of the parts as built. */
export const PARTS_APART = 'spans parts drawn apart'
/** What the row says of a mark on a part that is switched off: it is not drawn either. */
export const PART_HIDDEN = 'its part is hidden'
/**
 * How long a mark may go unchecked against a new build before its row says
 * so: every build leaves every mark unchecked for the moment the check takes,
 * and a row that flickered each time would say nothing.
 */
export const UNCHECKED_AFTER_MS = 1500

/** True once `on` has been so for `ms` without a break. */
export function useLasting(on: boolean, ms: number): boolean {
  const [lasting, setLasting] = useState(false)
  useEffect(() => {
    if (!on) return setLasting(false)
    const timer = setTimeout(() => setLasting(true), ms)
    return () => clearTimeout(timer)
  }, [on, ms])
  return on && lasting
}

/**
 * One mark in the panel: its number, what kind it is, its note (click to
 * write it), whether the last build moved the surface it is on or dropped its
 * part, whether anything has checked it against the build on show, and what can be done with it. A shape that is
 * the active mark opens out below into its numbers (`ShapeFields`). A
 * dimension shows its value beside its number, with a tick or a cross when
 * something is expected of it, says `pinned` once the agent has it, and opens
 * out into what it should be (`DimensionFields`). A mark
 * the agent resolved, and the person has not yet confirmed, says so on a
 * line of its own, with the agent's note and the two things to do about it.
 * `change` and `remove` are the panel's, which says so when main refuses.
 */
export function MarkRow({
  mark,
  active,
  elsewhere,
  gone = false,
  partHidden = false,
  revision = 0,
  change,
  remove,
  review,
  source,
  lit = false
}: {
  mark: Mark
  active: boolean
  /** The mark is of a layout that is not the one shown. */
  elsewhere: boolean
  /** The mark is of a layout the build no longer has. */
  gone?: boolean
  /** The mark is on a part that is switched off, and so not drawn. */
  partHidden?: boolean
  /** The revision of the build on show; 0 for none. */
  revision?: number
  /** Resolves when main has made the change; rejects when it refuses. */
  change: (patch: MarkPatch) => Promise<unknown>
  remove: () => void
  /** The row is the one being walked in "To review": what it does with the mark goes on to the next. */
  review?: ReviewStep
  /** The row is one of Needs you's: what it says at the right, muted ("to review", "from Claude"). */
  source?: string
  /** The pointer is on a part the mark is on: the row is washed and barred in the accent (`data-lit`). */
  lit?: boolean
}) {
  // The note as it is being written; null while it is only shown.
  const [draft, setDraft] = useState<string | null>(null)
  const field = useRef<HTMLInputElement>(null)
  // The note is being written as the reason for reopening a mark the agent resolved: it becomes a draft when the field is left.
  const [reopening, setReopening] = useState(false)
  const resolved = mark.status === 'resolved'
  const label = rowLabel(mark)
  const replacing = useReplacing() === mark.id
  // Offered where it can be done: a pin, a pick or an arrow of the person's that the last build left off its
  // surface or without its part, in the layout shown, where the next click on a part ties it again. Not on
  // a mark of the agent's: where that is, is what the agent said.
  const replaceable =
    !resolved && !elsewhere && mark.author === 'user' && mark.anchorState !== 'ok' && (mark.kind === 'pin' || mark.kind === 'pick' || mark.kind === 'arrow')
  // Why it cannot be put somewhere else, or painted again, now: the parts are drawn apart.
  const exploded = useStore((s) => (explodeNow(s) ? EXPLODED_TOOLS : null))
  // Its ends are on parts drawn apart from each other: it is drawn dashed between them until they are together.
  const split = useStore((s) => (mark.kind === 'dimension' || mark.kind === 'arrow') && mark.layout === s.layout && spanningMarks([mark], s.layout, partsInLayout(s), explodeNow(s)).length > 0)
  // The agent resolved it and the person has not said they have seen that.
  const awaiting = awaitsAcknowledgement(mark)
  // Nothing has checked it against the build on show: its ref is of an older one.
  const unchecked = useLasting(isUnchecked(mark, revision), UNCHECKED_AFTER_MS)

  // A draft of a round that has not been sent goes with no prompt: it is held until Send review, and the row says so.
  const rounds = useReview((s) => s.rounds)
  const sending = useReview((s) => s.sending)
  const held = isHeld(mark, { rounds, sending })
  // A mark of a round that has not gone can be taken out of it, where it is the person's own and a draft.
  const takeable = mark.author === 'user' && mark.round !== undefined && rounds.some((round) => round.id === mark.round && round.sentAt === undefined)

  // The agent's own open mark: for the person to read or answer, and to put in the prompt while a session runs.
  const fromAgent = mark.author === 'agent' && mark.status === 'sent'
  const sessionLive = useStore((s) => runningSession(s) !== undefined)

  // Resolving a check that has an expected value stops it being measured: asked in the row before it is done.
  const [stopping, setStopping] = useState(false)
  const checks = mark.kind === 'dimension' && mark.expected !== undefined && !resolved
  useEffect(() => setStopping(false), [mark.id, mark.status])

  const writing = draft !== null
  useEffect(() => {
    if (!writing) return
    // A reason is added to the note: the cursor goes to its end. Any other note is taken up selected.
    if (reopening) field.current?.setSelectionRange(field.current.value.length, field.current.value.length)
    else field.current?.select()
  }, [writing, reopening])

  // The pointer on the row, or the focus in it, points at its mark in the view: its chip is ringed and the faces it
  // is on are lit. The keys reach a mark by its row's buttons, and see it so.
  const pointed = useStore((s) => s.hoveredMark === mark.id)
  // A row that goes while it is pointed at takes its light with it.
  useEffect(
    () => () => {
      unhoverMark(mark.id, 'pointer')
      unhoverMark(mark.id, 'focus')
    },
    [mark.id]
  )

  const save = () => {
    if (draft === null) return
    if (reopening) {
      // Note and status in one change, so that the agent is told both at once.
      void change({ note: draft, status: 'draft' }).then(() => review?.step('reopened'), () => {})
    } else if (draft !== mark.note) void change({ note: draft }).catch(() => {})
    setDraft(null)
    setReopening(false)
  }
  // A shape is edited where it can be seen: in its own layout, while it is the one being worked on.
  const fields = mark.kind === 'shape' && active && !resolved && !elsewhere
  // A dimension's numbers need no view of it: they open wherever it is the one being worked on.
  const expects = mark.kind === 'dimension' && active && !resolved

  const what = [
    KIND_NAME[mark.kind],
    mark.kind === 'shape' ? `${mark.shape}, ${mark.intent}` : mark.kind === 'dimension' ? mark.measure : mark.kind === 'region' ? `${mark.scan} · ${count(mark.triangles)} ${mark.triangles === 1 ? 'triangle' : 'triangles'}` : '',
    elsewhere ? `in layout ${mark.layout}` : ''
  ]
    .filter(Boolean)
    .join(' · ')
  // A region goes with its scan: of one that is no longer there, or is another mesh, it says which.
  const scanThere = useStore((s) => mark.kind === 'region' && s.scans.some((scan) => scan.id === mark.scan))
  const lost = mark.kind === 'region' && mark.anchorState === 'orphaned' ? (scanThere ? SCAN_READ_AGAIN : SCAN_GONE) : null
  const anchorNote = lost ? REGION_NOTE[lost] : ANCHOR_NOTE[mark.anchorState]

  return (
    <li
      className="mark-row"
      data-mark={mark.id}
      data-author={mark.author}
      data-status={mark.status}
      data-active={active ? '' : undefined}
      data-elsewhere={elsewhere ? '' : undefined}
      data-hidden={partHidden ? '' : undefined}
      data-awaiting={awaiting ? '' : undefined}
      data-expanded={fields || expects || awaiting || (stopping && checks) ? '' : undefined}
      data-replacing={replacing ? '' : undefined}
      data-hovered={pointed ? '' : undefined}
      data-lit={lit ? '' : undefined}
      aria-current={active ? 'true' : undefined}
      onPointerEnter={() => hoverMark(mark.id, 'pointer')}
      onPointerLeave={() => unhoverMark(mark.id, 'pointer')}
      // Only the keys' focus on one of its buttons: a click on a button focuses it too, and its light would outstay
      // the pointer; and a note being typed is the row's own business, its mark already the active one.
      onFocus={(e) => {
        if (e.target.matches('button:focus-visible')) hoverMark(mark.id, 'focus')
      }}
      onBlur={(e) => {
        // Not while the focus goes from one of its buttons to another.
        if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) unhoverMark(mark.id, 'focus')
      }}
      onClick={() => actions.selectMark(mark.id)}
    >
      <div className="mark-line">
        <span className="mark-chip num" data-author={mark.author} title={[mark.author === 'user' ? 'Your mark' : "The agent's mark", resolved ? '' : anchorNote].filter(Boolean).join('. ')}>
          {label}
        </span>
        {mark.kind === 'note' && <NoteThumb note={mark} />}
        {mark.kind === 'sketch' && <SketchSummary mark={mark} />}
        {draft === null ? (
          <button
            type="button"
            className="mark-note"
            data-empty={mark.note === '' ? '' : undefined}
            // The active row shows its note whole: the tooltip says only what the row does not.
            title={[active ? '' : mark.note, mark.resolvedNote ? `Resolved: ${mark.resolvedNote}` : ''].filter(Boolean).join('\n') || (active ? undefined : 'Write a note')}
            aria-label={`Note of ${mark.id}: ${mark.note || 'none'}. Edit`}
            onClick={(e) => {
              // Writing a note is not asking to go anywhere: the camera stays.
              e.stopPropagation()
              actions.setActiveMark(mark.id)
              setDraft(mark.note)
            }}
          >
            {mark.note || 'Add a note'}
          </button>
        ) : (
          <input
            ref={field}
            className="mark-note-input"
            value={draft}
            maxLength={MAX_NOTE}
            aria-label={`Note of ${mark.id}`}
            autoFocus
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => {
              if (pressed(e, 'field.keep')) save()
              else if (pressed(e, 'field.leave')) {
                setDraft(null)
                setReopening(false)
              }
              else return
              e.preventDefault()
              e.stopPropagation()
            }}
          />
        )}
        {mark.kind === 'dimension' && <DimensionValue mark={mark} revision={revision} />}
        {mark.kind === 'region' && (
          <span className="mark-value num" title={`${count(mark.triangles)} ${mark.triangles === 1 ? 'triangle' : 'triangles'} of ${mark.scan}, ≈ ${number(mark.area)} mm² of its mesh`}>
            {mark.scan}
          </span>
        )}
        {source !== undefined && <span className="mark-source">{source}</span>}
      </div>
      <div className="mark-meta">
        <span className="mark-kind" title={what} aria-label={what} role="img">
          {mark.kind === 'shape' ? SHAPE_ICONS[mark.shape] : KIND_ICON[mark.kind]}
          <span aria-hidden="true">{what}</span>
        </span>
        {!resolved && gone ? (
          <span className="mark-anchor" data-state="orphaned" title={`The build no longer has the layout ${mark.layout}, so this mark cannot be shown`}>
            {LAYOUT_GONE}
          </span>
        ) : unchecked ? (
          <span
            className="mark-anchor"
            data-state="unchecked"
            title={`Nothing has checked this mark against the build on show: what it says it is on is of an older one${mark.anchorState === 'ok' ? '' : `. ${ANCHOR_NOTE[mark.anchorState]}`}`}
          >
            not checked against <span className="num">r{revision}</span>
          </span>
        ) : (
          !resolved &&
          mark.anchorState !== 'ok' && (
            <span className="mark-anchor" data-state={mark.anchorState} title={anchorNote}>
              {lost ?? ANCHOR_BADGE[mark.anchorState]}
            </span>
          )
        )}
        {partHidden && (
          <span className="mark-layout" title={mark.kind === 'region' ? 'A region is drawn on its scan: switch the scan on to see it' : 'Marks on a part that is switched off are not drawn. Switch the part on to see it'}>
            {mark.kind === 'region' ? SCAN_HIDDEN : PART_HIDDEN}
          </span>
        )}
        {split && (
          <span className="mark-layout row-note" title="Its ends are on parts that are drawn apart from each other: it is drawn dashed between them, as long as they are apart, which measures nothing. What it says is of the parts as assembled">
            {PARTS_APART}
          </span>
        )}
        {held && (
          <span className="mark-layout" title={`${mark.round} is a round that has not been sent: this mark waits for Send review, and goes with no prompt before it`}>
            in review, not sent
          </span>
        )}
        {takeable && (
          <button type="button" className="link-button mark-round" title={`Take it out of ${mark.round}: it stays, as a plain draft that goes with your next prompt`} onClick={(e) => (e.stopPropagation(), void reviewActions.takeOut(mark.id))}>
            Take out of <span className="num">{mark.round}</span>
          </button>
        )}
        {elsewhere && <span className="mark-layout num">{mark.layout}</span>}
        {/* The heading of its group says the status; a dimension the agent has says it is pinned. */}
        {mark.kind === 'dimension' && mark.status === 'sent' && (
          <span className="mark-status" data-status={mark.status} title="The agent has it. It stays here with its value until it is resolved">
            {PINNED}
          </span>
        )}
        {mark.kind === 'dimension' && mark.status === 'draft' && mark.expected !== undefined && (
          <span className="mark-status" data-status="draft" title="Not sent yet: it goes to the agent with your next prompt">
            {TO_SEND}
          </span>
        )}
      </div>
      <span className="mark-actions" onClick={(e) => e.stopPropagation()}>
        {replaceable && (
          <button
            type="button"
            className="icon-button"
            aria-label={`Re-place ${mark.id}`}
            aria-pressed={replacing}
            title={exploded ?? (replacing ? 'Click the part where it should be. Esc leaves it where it is' : 'Re-place: put it somewhere else on the part with a click')}
            disabled={exploded !== null}
            onClick={() => {
              const objectId = store.getState().objectId
              if (replacing) endReplace()
              else if (objectId) {
                actions.setActiveMark(mark.id)
                startReplace(objectId, mark.id)
              }
            }}
          >
            <ReplaceIcon />
            <Word>Re-place</Word>
          </button>
        )}
        {mark.kind === 'region' && !resolved && mark.anchorState === 'ok' && mark.author === 'user' && (
          <button type="button" className="icon-button" aria-label={`Edit ${mark.id}`} title={exploded ?? 'Edit: take its triangles in hand and paint it again'} disabled={exploded !== null} onClick={() => void editRegion(mark)}>
            <BrushIcon />
            <Word>Edit</Word>
          </button>
        )}
        {mark.kind === 'sketch' && !resolved && mark.author === 'user' && (
          <button
            type="button"
            className="icon-button"
            aria-label={`Edit ${mark.id}`}
            title={exploded ?? (elsewhere ? `Edit: show the layout ${mark.layout} first` : 'Edit: open the sketch again in the Draw tool')}
            disabled={exploded !== null || elsewhere}
            onClick={() => {
              actions.focusMark(mark.id)
              void editSketch(mark)
            }}
          >
            <BrushIcon />
            <Word>Edit</Word>
          </button>
        )}
        {mark.kind === 'note' && (
          <button
            type="button"
            className="icon-button"
            aria-label={`Edit ${mark.id}`}
            title="Edit: open the drawing again to change its ink, labels, comment or references"
            onClick={() => {
              const objectId = store.getState().objectId
              // Why not (a drawing already open, another project) is not said here: the sheet simply does not open.
              if (objectId) void openNote(objectId, mark.id).catch(() => {})
            }}
          >
            <BrushIcon />
            <Word>Edit</Word>
          </button>
        )}
        <button type="button" className="icon-button" aria-label={`Go to ${mark.id}`} title={gone ? LAYOUT_GONE : 'Go to its view'} disabled={gone} onClick={() => actions.focusMark(mark.id)}>
          <FocusIcon />
          <Word>Go to view</Word>
        </button>
        {fromAgent && (
          <button
            type="button"
            className="icon-button"
            aria-label={`Answer ${mark.id} in chat`}
            title={sessionLive ? "Answer in chat: put this mark's id in the prompt" : 'Start a session to answer in chat'}
            disabled={!sessionLive}
            onClick={() => {
              // The dock may be away: the box takes no focus in a hidden one, so it is given the keys a frame after it is shown.
              const hidden = !store.getState().dockOpen
              actions.setDockOpen(true)
              insertIntoSession(mark.id, { later: hidden })
            }}
          >
            <AnswerIcon />
            <Word>Answer in chat</Word>
          </button>
        )}
        {resolved ? (
          <button type="button" className="icon-button" aria-label={`Reopen ${mark.id}`} title="Reopen as a draft" onClick={() => void change({ status: 'draft' }).catch(() => {})}>
            <ReopenIcon />
            <Word>Reopen</Word>
          </button>
        ) : (
          <button
            type="button"
            className="icon-button"
            aria-label={`Resolve ${mark.id}`}
            title={checks ? 'Resolve: it is no longer measured' : fromAgent ? 'Seen: resolve it' : 'Resolve: done with it'}
            onClick={() => (checks ? setStopping(true) : void change({ status: 'resolved' }).catch(() => {}))}
          >
            <ResolveIcon />
            <Word>Resolve</Word>
          </button>
        )}
        <button type="button" className="icon-button" aria-label={`Delete ${mark.id}`} title="Delete" onClick={remove}>
          <BinIcon />
          <Word>Delete</Word>
        </button>
        {/* Last: the keys' way along a row, from its note to Delete, is as it was. */}
        {mark.author === 'user' && !resolved && mark.kind !== 'span' && mark.kind !== 'offset' && <IntentMenu mark={mark} />}
      </span>
      {stopping && checks && (
        <div className="mark-stop" onClick={(e) => e.stopPropagation()}>
          <Confirm
            label={`Stop checking ${mark.id}`}
            accept="Resolve"
            cancel="Keep checking"
            onAccept={() => {
              setStopping(false)
              void change({ status: 'resolved' }).catch(() => {})
            }}
            onCancel={() => setStopping(false)}
          >
            Stop checking {mark.id}? It is no longer measured.
          </Confirm>
        </div>
      )}
      {fields && <ShapeFields mark={mark} change={change} />}
      {expects && <DimensionFields mark={mark} revision={revision} change={change} />}
      {awaiting && (
        <div className="mark-resolution" onClick={(e) => e.stopPropagation()}>
          <p className="mark-resolution-note selectable">
            <span className="mark-resolution-by">Resolved by Claude</span>
            {mark.resolvedNote ? `: ${mark.resolvedNote}` : ''}
          </p>
          <button type="button" className="button" title="Seen: move it to the resolved marks" onClick={() => void change({ acknowledged: true }).then(() => review?.step('ok'), () => {})}>
            OK
          </button>
          <button
            type="button"
            className="button"
            title="Not done: say why, and it is a draft again, for the next prompt"
            onClick={() => {
              actions.setActiveMark(mark.id)
              setReopening(true)
              setDraft(mark.note)
            }}
          >
            Reopen…
          </button>
          {review && (
            <button type="button" className="button" title="Leave it to review" onClick={() => review.step('skipped')}>
              Skip
            </button>
          )}
        </div>
      )}
    </li>
  )
}

/**
 * A 3D sketch's name, how it is taken (and the diameter of a flow) and what it holds, in the place a dimension has its value:
 * its comment is the row's own note. The numbers are in the monospace face.
 */
export function SketchSummary({ mark }: { mark: SketchMark }) {
  const says = `${sketchName(mark)}, ${takeText(mark)}, ${countsText(mark)}`
  return (
    <span className="mark-sketch" title={says}>
      <span className="mark-sketch-name">{sketchName(mark)}</span>
      <span className="mark-sketch-take num">{takeText(mark)}</span>
      <span className="mark-sketch-counts num">{countsText(mark)}</span>
    </span>
  )
}

/**
 * A view note's picture with its ink, small, in the place a dimension has its value. A note whose picture is not on this
 * computer (the pictures are not in git) shows an empty frame that says so; its comment is the row's own note.
 */
function NoteThumb({ note }: { note: NoteMark }) {
  const objectId = useStore((s) => s.objectId)
  const picture = useNotePicture(objectId ?? '', objectId === null ? null : note.id, note.ink)
  if (picture.url !== null) return <img className="mark-thumb" src={picture.url} alt="" draggable={false} title="The view as it was drawn on" />
  return <span className="mark-thumb" data-picture={picture.state} title={picture.state === 'missing' ? 'The picture is not on this computer' : undefined} aria-hidden="true" />
}

/**
 * A dimension's value beside its number, as of the build on show
 * (`shownDimension`): with a tick or a cross when something is expected of
 * it. A value of another build is greyed, has no tick or cross, and says
 * which build it is of: what an open dimension was, or what a resolved one,
 * which is no longer measured, was last measured as.
 */
export function DimensionValue({ mark, revision }: { mark: Extract<Mark, { kind: 'dimension' }>; revision: number }) {
  const shown = shownDimension(mark, revision)
  const { value, verdict } = shown
  const title =
    value === undefined ? shown.note : [exactText(mark.measure, value), mark.how, verdict === 'pass' ? 'as expected' : verdict === 'fail' ? 'not what was expected' : ''].filter(Boolean).join(', ')
  return (
    <span className="mark-value num" data-none={shown.none ? '' : undefined} data-stale={shown.stale ? '' : undefined} data-verdict={verdict} title={title}>
      {shown.none ? <Words text={shown.text} /> : shown.text}
      {verdict && <VerdictIcon pass={verdict === 'pass'} />}
    </span>
  )
}

/** What a button of the row says in words, on the active row; elsewhere the button is its icon (`marks.css`). */
function Word({ children }: { children: ReactNode }) {
  return (
    <span className="mark-act-word" aria-hidden="true">
      {children}
    </span>
  )
}

function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

/** A brush: paint it again. */
function BrushIcon() {
  return (
    <Glyph>
      <path d="m8.750 7.750 4.300-5.200a.9.900 0 0 1 1.400 1.150L10.250 9M8.750 7.750 10.250 9c.3 1.600-.9 3-2.750 2.750-.9-.1-1.500-.6-1.750-1 .9-.1 1.300-.6 1.500-1.500.150-.8.7-1.350 1.500-1.500Z" />
    </Glyph>
  )
}

/** A pin, and under it an arrow both ways: put it somewhere else. */
function ReplaceIcon() {
  return (
    <Glyph>
      <circle cx="8" cy="4.5" r="2.5" />
      <path d="M8 7v3M2.75 12.75h10.5M4.5 11 2.75 12.75 4.5 14.5M11.5 11l1.75 1.75-1.75 1.75" />
    </Glyph>
  )
}

/** A reticle: go and look. */
function FocusIcon() {
  return (
    <Glyph>
      <circle cx="8" cy="8" r="3.25" />
      <path d="M8 1.75v2.5M8 11.75v2.5M1.75 8h2.5M11.75 8h2.5" />
    </Glyph>
  )
}

/** A speech bubble: answer in the chat. */
function AnswerIcon() {
  return (
    <Glyph>
      <path d="M2.75 3.25h10.5v7h-6l-3 2.5v-2.5h-1.5Z" />
    </Glyph>
  )
}

/** A tick in a box: done with it. Not the bare tick of a passing check. */
function ResolveIcon() {
  return (
    <Glyph>
      <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
      <path d="m5.5 8.25 1.9 1.9 3.1-3.9" />
    </Glyph>
  )
}

/** An arrow turning back. */
function ReopenIcon() {
  return (
    <Glyph>
      <path d="M3.25 6.5h6a3.25 3.25 0 0 1 0 6.5H6.5M5.75 3.75 3 6.5l2.75 2.75" />
    </Glyph>
  )
}

function BinIcon() {
  return (
    <Glyph>
      <path d="M2.75 4.5h10.5M6.25 4.5V2.75h3.5V4.5M4.25 4.5l.6 8.75h6.3l.6-8.75M6.75 7v3.75M9.25 7v3.75" />
    </Glyph>
  )
}
