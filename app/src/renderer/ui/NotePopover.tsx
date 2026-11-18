import { hint, pressed } from '../../shared/keys'
import { dimensionText, measuredValue } from '../../shared/dimension'
import { count, number } from '../../shared/format'
import { countsText, sketchName, takeText } from '../../shared/sketchText'
import { offsetWords } from '../../shared/tracings'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { AnchorState, Mark } from '../../shared/marks'
import { actions, store, useStore } from '../state/store'
import { labelText } from '../viewport/marks/labels'
import type { Viewport } from '../viewport/Viewport'
import { keyGlyph } from './keyGlyph'
import { ANCHOR_BADGE, MAX_NOTE } from './MarkRow'
import { placeBeside } from './notePlacement'

/** What the note may not cover: the tools at the left edge, the view bar at the top, and a margin elsewhere. */
const KEEP_CLEAR = { left: 60, top: 54, right: 12, bottom: 12 }

/**
 * What a mark is on, in a few words: its ref and the kernel's line about it,
 * an arrow's length, or the plane and the size of a profile. A mark the last
 * build moved off its surface, or left without its part, keeps the ref it was
 * placed on, while the kernel's line is of what is under its point now: the
 * two do not agree, so the line is left out and the note says what happened.
 */
export function subject(mark: Mark, revision = 0): { ref: string; detail: string; state: AnchorState } {
  const state = mark.anchorState
  // A dimension: its value, how it was taken, and that an end moved.
  if (mark.kind === 'dimension') return { ref: dimensionText(mark, revision), detail: [measuredValue(mark, revision) === undefined ? '' : (mark.how ?? ''), state === 'ok' ? '' : ANCHOR_BADGE[state]].filter(Boolean).join(', '), state }
  // A region: the scan it is on, and how much of it.
  if (mark.kind === 'region') return { ref: `${mark.scan}, ${count(mark.triangles)} ${mark.triangles === 1 ? 'triangle' : 'triangles'}`, detail: state === 'orphaned' ? 'its scan is gone or was read again' : `≈ ${number(mark.area)} mm²`, state }
  // A 3D sketch: what it is called, how it is to be taken, and what it holds.
  if (mark.kind === 'sketch') return { ref: sketchName(mark), detail: [takeText(mark), countsText(mark), state === 'ok' ? '' : ANCHOR_BADGE[state]].filter(Boolean).join(', '), state }
  // A measure on a tracing: its value, and how it was found. A "should be here": the shape and how far it moved. Neither is on a part.
  if (mark.kind === 'span') return { ref: `${mark.exact ? '' : '≈ '}${number(mark.value)} mm`, detail: mark.how, state }
  if (mark.kind === 'offset') return { ref: mark.shape.name === '' ? `shape ${mark.shape.index + 1} of ${mark.layer.name}` : mark.shape.name, detail: offsetWords(mark.by), state }
  const anchor = mark.kind === 'arrow' ? mark.from : mark.anchor
  const moved = state === 'ok' ? '' : ANCHOR_BADGE[state]
  const from = anchor?.ref ? `from ${anchor.ref}` : ''
  const said = (...parts: string[]): string => parts.filter(Boolean).join(', ')
  if (mark.kind === 'arrow') {
    const length = Math.hypot(mark.to[0] - mark.from.point[0], mark.to[1] - mark.from.point[1], mark.to[2] - mark.from.point[2])
    return { ref: `${length.toFixed(1)} mm`, detail: said(from, moved), state }
  }
  if (mark.kind === 'stroke' && mark.space === 'plane' && mark.plane) {
    // A profile: the plane it is on, and how large it is there.
    const us = (mark.points2d ?? []).map((p) => p[0])
    const vs = (mark.points2d ?? []).map((p) => p[1])
    const size = us.length > 0 ? `${(Math.max(...us) - Math.min(...us)).toFixed(1)} × ${(Math.max(...vs) - Math.min(...vs)).toFixed(1)} mm` : ''
    return { ref: mark.plane.label, detail: said(size, from, moved), state }
  }
  return { ref: anchor?.ref ?? anchor?.part ?? '', detail: moved || (anchor?.descriptor ?? ''), state }
}

/**
 * What to keep of a note when its card goes away without the person having
 * ended the writing (the layout was changed under it by the agent, another
 * mark took its place): the text as it was typed, when it is not what the mark
 * already says. Null when there is nothing to keep, or the writing was ended:
 * saved, left for later with Escape, or the mark deleted.
 */
export function unsavedNote(typed: string, kept: string, ended: boolean): string | null {
  const note = typed.trim()
  return ended || note === kept ? null : note
}

/**
 * Whether a note that was being typed when its card went may still be saved
 * to its mark: while the workspace it was typed in (`opened`, its root) is
 * the one open now, whichever of its objects is shown. Main knows every
 * object of the open workspace by its name. Once another folder is open, an
 * object there may bear the same name, with a mark of the same number.
 */
export function noteStillBelongs(opened: string | undefined, now: string | undefined): boolean {
  return opened !== undefined && opened === now
}

/**
 * The note of the mark just made, as a small card beside it over the
 * viewport. It appears when a tool has placed a mark and goes when the note
 * is saved or left, when the mark is deleted, and when another object or
 * layout is shown.
 */
export function NotePopover({ viewport }: { viewport: Viewport }) {
  const objectId = useStore((s) => s.objectId)
  // Not there for a moment after it is made: main tells of it in its own time.
  const mark = useStore((s) => (s.noting === null ? undefined : s.marks.find((m) => m.id === s.noting)))
  // A resolved mark is not drawn: there is nothing to put its note beside.
  if (!objectId || !mark || mark.status === 'resolved') return null
  return <NoteCard key={mark.id} viewport={viewport} objectId={objectId} mark={mark} />
}

function NoteCard({ viewport, objectId, mark }: { viewport: Viewport; objectId: string; mark: Mark }) {
  const card = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLTextAreaElement>(null)
  const [text, setText] = useState(mark.note)
  const { id } = mark
  const revision = useStore((s) => (s.scene ? s.revision : 0))

  const refused = (e: unknown): void => actions.setMarksProblem({ objectId, message: e instanceof Error ? e.message : String(e) })
  /** What is typed and what the mark says, as of the last render; and whether the person ended the writing. */
  const latest = useRef({ text, kept: mark.note, ended: false })
  latest.current.text = text
  latest.current.kept = mark.note
  /** The note as last handed to main, so that the same text is handed over once. */
  const sent = useRef(mark.note)
  /** Has main keep what is typed, when it is not what the mark says or what main was last given. */
  const keep = (): void => {
    const note = latest.current.text.trim()
    if (note === latest.current.kept || note === sent.current) return
    sent.current = note
    window.torno.marks.update(objectId, id, { note }).catch(refused)
  }
  const save = (): void => {
    latest.current.ended = true
    keep()
    actions.closeNote()
  }
  /** The workspace the card was opened in. */
  const opened = useRef(store.getState().workspace?.root)
  // The card can go without a press or a key: the agent shows another layout, another mark's note opens.
  // What was typed is not lost with it.
  useEffect(
    () => () => {
      const { text: typed, kept, ended } = latest.current
      const note = unsavedNote(typed, kept, ended)
      // Also when another object of the same workspace is shown by now: main knows this one by its name
      // still. Not once another folder is open (`noteStillBelongs`).
      if (note === null || note === sent.current || !noteStillBelongs(opened.current, store.getState().workspace?.root)) return
      window.torno.marks.update(objectId, id, { note }).catch(() => {}) // the mark may be gone: that is why the card went
    },
    [objectId, id]
  )
  // What a press outside saves: the text as it is then, not as it was when the listener was made.
  const saveRef = useRef(save)
  saveRef.current = save

  // The window can go with the focus still in the card: closed, or reloaded. Nothing blurs then, and
  // nothing is unmounted. What is typed is handed to main while the page can still say it.
  const keepRef = useRef(keep)
  keepRef.current = keep
  useEffect(() => {
    const onHide = (): void => keepRef.current()
    window.addEventListener('pagehide', onHide)
    return () => window.removeEventListener('pagehide', onHide)
  }, [])

  // Beside the mark, and there again after every frame: it follows the camera
  // without anything of that passing through React.
  useLayoutEffect(() => {
    const element = card.current!
    const place = (): void => {
      const pane = element.offsetParent?.getBoundingClientRect()
      const box = viewport.markBox(id)
      if (!pane || !box) {
        element.style.visibility = 'hidden'
        return
      }
      const within = { left: KEEP_CLEAR.left, top: KEEP_CLEAR.top, right: pane.width - KEEP_CLEAR.right, bottom: pane.height - KEEP_CLEAR.bottom }
      const covered = { left: box.left - pane.left, top: box.top - pane.top, right: box.right - pane.left, bottom: box.bottom - pane.top }
      const at: [number, number] = [box.at[0] - pane.left, box.at[1] - pane.top]
      const placed = placeBeside(covered, at, { w: element.offsetWidth, h: element.offsetHeight }, within)
      element.style.transform = `translate(${Math.round(placed.x)}px, ${Math.round(placed.y)}px)`
      element.dataset.side = placed.side
      element.style.visibility = ''
    }
    place()
    const offDrawn = viewport.onDrawn(place)
    // The card grows with what is written in it.
    const sized = new ResizeObserver(place)
    sized.observe(element)
    return () => {
      offDrawn()
      sized.disconnect()
    }
  }, [viewport, id])

  useEffect(() => {
    field.current?.focus({ preventScroll: true })
    // A press anywhere else is the end of writing: what was written is kept.
    const onPress = (e: PointerEvent): void => {
      if (e.target instanceof Node && card.current?.contains(e.target)) return
      saveRef.current()
    }
    document.addEventListener('pointerdown', onPress, true)
    return () => document.removeEventListener('pointerdown', onPress, true)
  }, [])

  const on = subject(mark, revision)
  const label = labelText(mark)

  return (
    <div ref={card} className="note-card" role="group" aria-label={`Mark ${label}`} data-author={mark.author} data-mark={id} style={{ visibility: 'hidden' }}>
      <div className="note-head">
        <span className="mark-chip num" data-author={mark.author}>
          {label}
        </span>
        <span className="note-ref num">{on.ref}</span>
        <button
          type="button"
          className="icon-button"
          aria-label={`Delete mark ${id}`}
          title="Delete this mark"
          onClick={() => {
            latest.current.ended = true
            window.torno.marks.remove(objectId, id).catch(refused)
            actions.closeNote()
          }}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2.75 4.5h10.5M6.25 4.5V2.75h3.5V4.5M4.25 4.5l.6 8.75h6.3l.6-8.75M6.75 7v3.75M9.25 7v3.75" />
          </svg>
        </button>
      </div>
      {on.detail !== '' && (
        <p className="note-detail num" data-state={on.state === 'ok' ? undefined : on.state} title={on.detail}>
          {on.detail}
        </p>
      )}
      <textarea
        ref={field}
        className="note-field"
        rows={1}
        value={text}
        maxLength={MAX_NOTE}
        placeholder="What should change here?"
        aria-label={`Note on ${id}`}
        onChange={(e) => setText(e.target.value)}
        // The focus can leave without a press or a key that ends the writing: Ctrl+` goes to the terminal,
        // and the prompt typed there must carry the note. Kept, and the card stays for more.
        onBlur={keep}
        onKeyDown={(e) => {
          if (pressed(e, 'field.keep') && !e.nativeEvent.isComposing) save()
          else if (pressed(e, 'field.leave')) {
            latest.current.ended = true
            actions.closeNote()
          } else return
          e.preventDefault()
          e.stopPropagation()
        }}
      />
      <p className="note-keys">
        <kbd>{keyGlyph(hint('field.keep'))}</kbd> save <span aria-hidden="true">·</span> <kbd>{hint('field.leave')}</kbd> leave it for later
      </p>
    </div>
  )
}
