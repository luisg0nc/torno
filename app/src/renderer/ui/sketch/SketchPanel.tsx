import { useEffect, useRef } from 'react'
import { hint, pressed } from '../../../shared/keys'
import { MAX_SKETCH_DIAMETER, MAX_SKETCH_NAME, type SketchTake } from '../../../shared/marks'
import { number } from '../../../shared/format'
import { finishSketch, offsetOf, pickPlane, setDiameter, setLit, setName, setNote, setOffset, setPlane, setSnapping, setTake, setXray, undoStroke, useSketching } from '../../state/sketching'
import { useStore } from '../../state/store'
import { useTool } from '../../state/tools'
import { Field } from '../Field'
import { MAX_NOTE } from '../MarkRow'
import { giveKeysBack } from '../typing'
import { peek } from '../../state/agent'
import { selectStroke } from '../../state/sets'
import { planeRows, planeTagWords, strokeRows, surfaceStrokes, type StrokeRow as StrokeRowOf } from './rows'
import type { Viewport } from '../../viewport/Viewport'
import { onPaneDrawn } from '../../viewport/overlay'
import { Tag } from '../view/Tag'

const TAKES: { take: SketchTake; label: string; title: string }[] = [
  { take: 'exact', label: 'Exact', title: 'Follow these points to the millimetre' },
  { take: 'rough', label: 'Rough', title: 'The shape and the place matter, not the exact points' },
  { take: 'flow', label: 'Flow', title: 'A route: follow its path loosely, keep the diameter clear' }
]

/**
 * The panel of a sketch being drawn, which is the head of the route card while Draw has one open (`card/InHand.tsx`): what it is
 * (its number, "Sketch" and whether it is a draft or sent), its name, how literally it is to be taken (and, of a flow, the diameter
 * to keep clear), the planes strokes can go on with how many are on each, a way to make another plane, the Snap and X-ray switches,
 * a comment, Undo and Done.
 * Every change goes to the sketch's store, which sends it to main (`state/sketching.ts`); nothing here moves with the pointer
 * but the row it is on, which lights that plane's strokes in the view.
 */
export function SketchPanel() {
  const inHand = useTool() === 'draw'
  const open = useSketching((s) => s.open)
  const plane = useSketching((s) => s.plane)
  const picking = useSketching((s) => s.picking)
  const undoable = useSketching((s) => s.undoable)
  const snapping = useSketching((s) => s.snapping)
  const xray = useSketching((s) => s.xray)
  const problem = useSketching((s) => s.problem)
  const asked = useSketching((s) => s.offsetAsked)
  const selection = useStore((s) => s.selection)
  const status = useStore((s) => (open?.id === undefined ? null : (s.marks.find((m) => m.id === open.id)?.status ?? null)))
  const offsetBox = useRef<HTMLDivElement>(null)
  // Tab asks for the offset: the field takes the keys, as the pointer's hint once would.
  useEffect(() => {
    if (asked > 0) offsetBox.current?.querySelector('input')?.focus()
  }, [asked])
  if (!inHand || !open) return null
  const { draft } = open
  const rows = planeRows(draft)
  const strokes = strokeRows(draft, open.id)
  const surface = surfaceStrokes(draft)
  const offset = offsetOf(plane === 'surface' ? null : (draft.planes.find((p) => p.id === plane) ?? null))
  const word = status === null ? 'not kept yet' : status === 'sent' ? 'sent' : status === 'resolved' ? 'resolved' : 'draft, goes with your next prompt'

  return (
    <aside className="sketchpanel" aria-label="Sketch" data-head="sketch" data-sent={status === 'sent' ? '' : undefined}>
      <header className="sketchpanel-head">
        <span className="mark-chip num" data-author="user">
          {open.id ?? 'new'}
        </span>
        <h3 className="sketchpanel-title">Sketch</h3>
        <span className="sketchpanel-status" title={status === 'sent' ? 'Claude has it: changing it makes it a draft again, for your next prompt' : 'Not sent: it goes to Claude with your next prompt, once you press Done'}>
          {word}
        </span>
      </header>

      <label className="sketchpanel-label">
        <span>Name</span>
        <input
          className="sketchpanel-name"
          type="text"
          value={draft.name}
          maxLength={MAX_SKETCH_NAME}
          placeholder={open.id ? `Sketch ${open.id}` : 'Name it'}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => leaveField(e)}
        />
      </label>

      <div className="sketchpanel-group">
        <span className="sketchpanel-label-text" id="sketch-take">
          Take it
        </span>
        <div className="segmented" role="radiogroup" aria-labelledby="sketch-take" aria-keyshortcuts={hint('sketch.take')}>
          {TAKES.map((t) => (
            <button key={t.take} type="button" role="radio" title={`${t.title} (${hint('sketch.take')} goes to the next)`} aria-checked={draft.take === t.take} aria-pressed={draft.take === t.take} onClick={() => setTake(t.take)}>
              {t.label}
            </button>
          ))}
        </div>
        {draft.take === 'flow' && (
          <div className="sketchpanel-diameter">
            <span className="sketchpanel-label-text" title="How wide the route is: the room to keep clear along it">
              Diameter
            </span>
            <Field
              label="Diameter"
              sign="⌀"
              unit="mm"
              value={draft.diameter === undefined ? '' : number(draft.diameter)}
              commit={(value, input) => {
                if (value <= 0) setDiameter(null)
                else if (value <= MAX_SKETCH_DIAMETER) setDiameter(value)
                else input.value = draft.diameter === undefined ? '' : number(draft.diameter)
              }}
            />
          </div>
        )}
      </div>

      <div className="sketchpanel-group">
        <span className="sketchpanel-label-text" id="sketch-planes">
          Planes and strokes
        </span>
        <ul className="sketchpanel-planes" aria-labelledby="sketch-planes">
          {rows.map((row) => (
            <PlaneRowView key={row.id} name={row.name} strokes={row.strokes} active={plane === row.id} on={row.id} listed={strokes.filter((stroke) => stroke.plane === row.id)} selection={selection} />
          ))}
          <PlaneRowView name="On surfaces" strokes={surface} active={plane === 'surface'} on="surface" listed={strokes.filter((stroke) => stroke.plane === 'surface')} selection={selection} />
        </ul>
        {offset !== null && (
          <div className="sketchpanel-offset" ref={offsetBox} aria-keyshortcuts={hint('sketch.offset')}>
            <span className="sketchpanel-label-text" title={`How far the plane is from where it was made, along its normal. ${hint('sketch.offset')} types it. Where strokes are on it, a plane of its own is made at the new offset`}>
              Offset
            </span>
            <Field label="Plane offset" unit="mm" value={number(offset)} commit={(value) => setOffset(value, { typed: true })} />
          </div>
        )}
        <div className="sketchpanel-switches" role="group" aria-label="Drawing aids">
          <button type="button" className="sketchpanel-switch" role="switch" aria-checked={snapping} aria-keyshortcuts={hint('sketch.snap')} title={`Snap to a vertex, a hole's centre or an edge. Hold ${hint('sketch.snap')} while drawing to turn it off for a moment`} onClick={() => setSnapping(!snapping)}>
            <span>Snap</span>
            <kbd>{hint('sketch.snap')}</kbd>
          </button>
          <button type="button" className="sketchpanel-switch" role="switch" aria-checked={xray} aria-keyshortcuts={hint('sketch.xray')} title={`Draw the parts see-through, to draw on what is hidden (${hint('sketch.xray')})`} onClick={() => setXray(!xray)}>
            <span>X-ray</span>
            <kbd>{hint('sketch.xray')}</kbd>
          </button>
        </div>
        <p className="sketchpanel-new">
          <span>+ New plane: pick</span>
          <button type="button" className="link-button" aria-pressed={picking === 'face'} title={`Click a flat face: strokes go on its plane (${hint('sketch.face')})`} onClick={() => pickPlane(picking === 'face' ? null : 'face')}>
            a face
          </button>
          <span>or</span>
          <button type="button" className="link-button" aria-pressed={picking === 'point'} title="Click a point on a part: a plane through it, across the face there or along an axis" onClick={() => pickPlane(picking === 'point' ? null : 'point')}>
            a point
          </button>
        </p>
      </div>

      <label className="sketchpanel-label">
        <span>Comment</span>
        <textarea
          className="note-field"
          rows={2}
          value={draft.note}
          maxLength={MAX_NOTE}
          placeholder="What is it for?"
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => leaveField(e)}
        />
      </label>

      {problem !== null && (
        <p className="sketchpanel-problem" role="alert">
          {problem}
        </p>
      )}

      <footer className="sketchpanel-foot">
        <button type="button" className="button" disabled={undoable === 0} aria-keyshortcuts={hint('sketch.undo')} title={`Take back the last stroke, or the last erase (${hint('sketch.undo')})`} onClick={() => void undoStroke()}>
          Undo
        </button>
        <button type="button" className="button button-primary" title={`Keep the sketch and leave it (${hint('sketch.leave')})`} onClick={() => void finishSketch()}>
          Done
        </button>
      </footer>
    </aside>
  )
}

/** Enter (Shift+Enter in the comment is a new line) or Esc in a field ends the writing: the keys are the view's again, and the sketch stays open. */
function leaveField(e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>): void {
  if (e.nativeEvent.isComposing) return
  if (!pressed(e, 'field.keep') && !pressed(e, 'field.leave')) return
  e.preventDefault()
  e.stopPropagation()
  giveKeysBack(e.currentTarget)
}

/**
 * One plane: a 28 px row with a small skewed plane glyph, the plane in mono and, at the right, how many strokes are on it. The
 * strokes by id are folded under their plane: they are listed while it is the one drawn on, or while one of them is selected.
 */
function PlaneRowView({ name, strokes, active, on, listed, selection }: { name: string; strokes: number; active: boolean; on: number | 'surface'; listed: StrokeRowOf[]; selection: readonly string[] }) {
  const open = listed.length > 0 && (active || listed.some((stroke) => selection.includes(stroke.ref)))
  return (
    <li className="sketchpanel-plane-item">
      <button
        type="button"
        className="sketchpanel-plane"
        data-active={active ? '' : undefined}
        aria-pressed={active}
        title={on === 'surface' ? 'Draw on the surface of the parts' : 'Draw on this plane'}
        onClick={() => setPlane(on)}
        onPointerEnter={() => setLit(on)}
        onPointerLeave={() => setLit(null)}
        onFocus={(e) => {
          if (e.currentTarget.matches(':focus-visible')) setLit(on)
        }}
        onBlur={() => setLit(null)}
      >
        <svg className="sketchpanel-plane-glyph" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" aria-hidden="true">
          <path d="M2.5 12 5 4.5h8.5L11 12Z" />
        </svg>
        <span className="sketchpanel-plane-name num">{name}</span>
        <span className="sketchpanel-plane-count num" title={`${strokes} ${strokes === 1 ? 'stroke' : 'strokes'}`}>
          {strokes}
        </span>
      </button>
      {open && (
        <ul className="sketchpanel-strokes" aria-label={`Strokes on ${name}`} title={`Select a stroke to put it in a named set (${hint('set.make')}); Shift adds to the selection`}>
          {listed.map((stroke) => (
            <li key={stroke.id}>
              <StrokeButton ref_={stroke.ref} id={stroke.id} where={stroke.where} on={selection.includes(stroke.ref)} />
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

/** A stroke by its id: it selects the stroke, and the pointer on it lights that stroke in the view. */
function StrokeButton({ ref_, id, where, on }: { ref_: string; id: string; where: string; on: boolean }) {
  return (
    <button
      type="button"
      className="sketchpanel-stroke"
      aria-pressed={on}
      aria-label={`Stroke ${id}, ${where}`}
      title={`${ref_}, ${where}. Click selects it, Shift adds it to the selection`}
      onClick={(e) => selectStroke(ref_, e.shiftKey)}
      onPointerEnter={() => peek([ref_])}
      onPointerLeave={() => peek([])}
      onFocus={(e) => {
        if (e.currentTarget.matches(':focus-visible')) peek([ref_])
      }}
      onBlur={() => peek([])}
    >
      {id}
    </button>
  )
}

/**
 * The tag on the handle of the sketch's plane (spec 2026-11-18, section 3): "XZ plane `y 40.0 mm` `Tab`", tied to the handle by a leader.
 * The value is read where it is typed (the panel's field, in the card's head) and where the handle is dragged: the tag follows the handle
 * and takes the value of the sheet as it is laid, every frame, straight on the elements and not through React.
 */
export function SketchPlaneTag({ viewport }: { viewport: Viewport }) {
  const inHand = useTool() === 'draw'
  const open = useSketching((s) => s.open)
  const plane = useSketching((s) => s.plane)
  const value = useRef<HTMLSpanElement>(null)
  const active = inHand && open && plane !== 'surface' ? open.draft.planes.find((p) => p.id === plane) : undefined
  const offset = active ? offsetOf(active) : null
  const words = active && offset !== null ? planeTagWords(active, offset) : null
  // A drag of the handle moves the sheet before the offset is kept: what is written follows the sheet.
  useEffect(() => {
    if (!words) return
    return onPaneDrawn(() => {
      const now = viewport.sketchOffset()
      if (now === null || !value.current) return
      const text = (Math.round(now * 10) / 10).toFixed(1)
      if (value.current.textContent !== text) value.current.textContent = text
    })
  }, [viewport, words?.name])
  if (!words || !active) return null
  return (
    <Tag id="sketch-plane" subject={null} subjectAt={() => viewport.sketchHandle()} prefer="right">
      <span className="sketch-plane-tag" data-part="sketch-plane-tag">
        <span className="sketch-plane-name">{words.name}</span>
        <span className="tag-value">
          {words.axis && (
            <span className="tag-axis-letter" data-axis={words.axis}>
              {words.axis}
            </span>
          )}
          <span ref={value} className="sketch-plane-value" data-axis={words.axis}>
            {words.value}
          </span>
          <span className="tag-unit">mm</span>
        </span>
        <kbd aria-hidden="true">{hint('sketch.offset')}</kbd>
      </span>
    </Tag>
  )
}
