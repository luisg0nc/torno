import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { hint, pressed } from '../../../shared/keys'
import type { Stroke } from '../../state/onboard'
import { Confirm } from '../Confirm'
import { ERASER_WIDTH, GRID_STEP, PEN_WIDTHS, addPoint, paintBackground, paintStroke, paintStrokes, straighten, type Backdrop, type InkLook } from './strokes'

type Tool = 'thin' | 'thick' | 'eraser'

const TOOLS: ReadonlyArray<{ id: Tool; label: string }> = [
  { id: 'thin', label: 'Thin pen' },
  { id: 'thick', label: 'Thick pen' },
  { id: 'eraser', label: 'Eraser' }
]

/** What can take the focus in the board, in order. */
const FOCUSABLE = 'button:not(:disabled), select:not(:disabled), [tabindex="0"]'

export interface InkPadProps {
  /** The heading, the name a reader of the screen hears for the sheet, and the line beside the heading. */
  title: string
  label: string
  hint: string
  /** The board's own pixels: what is drawn is this size, whatever room the board has on screen. */
  size: { width: number; height: number }
  /** A picture of the board's size under the ink (an object URL): the eraser takes away ink, never it. */
  ground?: string
  /** A photo under the ink, fitted whole to the board on a white ground (a sketch drawn over a photo): there is no grid under it. The eraser takes away ink, never it. */
  background?: Backdrop
  /** A light grid under the ink, one square every 40 board pixels (a doodle's; not a drawing on a picture, and not over a `background`). */
  grid?: boolean
  /** What else the row of tools holds, after the pens. */
  tools?: ReactNode
  /** The line beside Done. */
  foot?: string
  /** How the strokes are drawn on the board: asked whenever they are painted, so that an ink of the theme follows it. */
  look: () => InkLook
  /** What the board is opened with. */
  initial: Stroke[]
  /** The question asked before strokes drawn since it was opened are thrown away: its name and its words. */
  discard: { label: string; text: string }
  /** "Done": what is kept is made of the strokes, while the board waits. When this rejects the board stays as it was, and says why. */
  onDone: (strokes: Stroke[]) => Promise<void>
  onCancel: () => void
}

/**
 * A board to draw on: a sheet over the window with a canvas of `size` board pixels, scaled to fit, on the panel's
 * ground or on a picture (`ground`). The pen has two widths, the eraser takes away ink; undo takes the last stroke
 * back, clear all of them. The strokes are kept as vectors (`initial` is what it is opened with again), and "Done"
 * hands them over. A stroke is drawn as the pointer moves, in the canvas and never through React.
 */
export function InkPad({ title, label, hint: words, size, ground, background, grid, tools, foot, look, initial, discard, onDone, onCancel }: InkPadProps) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const sheet = useRef<HTMLElement>(null)
  const strokes = useRef<Stroke[]>(initial.map((s) => ({ ...s, points: [...s.points] })))
  const drawing = useRef<{ stroke: Stroke; pointer: number; painted: number } | null>(null)
  const tool = useRef<Tool>('thin')
  const [chosen, setChosen] = useState<Tool>('thin')
  // How many strokes there are: counted up when one ends, so that the buttons know, not on every pointer move.
  const [count, setCount] = useState(strokes.current.length)
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const saved = useRef(false)
  /** Whether the strokes are other than the board was opened with: leaving then asks first. */
  const dirty = useRef(false)
  const [asking, setAsking] = useState(false)
  const askingNow = useRef(false)
  askingNow.current = asking
  const lookNow = useRef(look)
  lookNow.current = look
  // The photo under the ink, drawn as the PNG will have it and shown as the canvas's background: the canvas itself holds ink alone.
  const [backdrop, setBackdrop] = useState<string | null>(null)
  useEffect(() => {
    setBackdrop(null)
    if (!background) return
    let url: string | null = null
    let gone = false
    const sheet = new OffscreenCanvas(size.width, size.height)
    paintBackground(sheet.getContext('2d')!, background, size.width, size.height)
    void sheet.convertToBlob({ type: 'image/png' }).then((blob) => {
      if (gone) return
      url = URL.createObjectURL(blob)
      setBackdrop(url)
    })
    return () => {
      gone = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [background, size.width, size.height])
  const under = ground ?? backdrop ?? undefined

  const repaint = (): void => {
    const ctx = canvas.current?.getContext('2d')
    if (ctx) paintStrokes(ctx, strokes.current, lookNow.current())
  }

  useEffect(() => {
    repaint()
    // An ink of the theme follows it.
    const scheme = window.matchMedia('(prefers-color-scheme: dark)')
    scheme.addEventListener('change', repaint)
    return () => scheme.removeEventListener('change', repaint)
  }, [])

  const undo = (): void => {
    if (drawing.current || strokes.current.length === 0) return
    strokes.current.pop()
    dirty.current = true
    setCount(strokes.current.length)
    repaint()
  }
  const clear = (): void => {
    if (drawing.current || strokes.current.length === 0) return
    strokes.current = []
    dirty.current = true
    setCount(0)
    repaint()
  }
  const done = async (): Promise<void> => {
    if (saved.current) return
    saved.current = true
    setSaving(true)
    setProblem(null)
    try {
      await onDone(strokes.current)
    } catch (e) {
      saved.current = false
      setSaving(false)
      setProblem(e instanceof Error ? e.message : String(e))
    }
  }

  // The keys are the board's while it is up, wherever the focus is (a click on the canvas may leave it nowhere).
  /** Esc and Cancel: a board with something drawn on it that was not kept asks first. */
  const leave = (): void => {
    if (saved.current) return
    if (dirty.current && strokes.current.length > 0) setAsking(true)
    else onCancel()
  }
  const act = useRef({ undo, leave })
  act.current = { undo, leave }
  useEffect(() => {
    const before = document.activeElement
    sheet.current?.focus()
    // Before anything else hears of the key, so that no tool of the view under the board gets Ctrl+Z. A question
    // asked in the board has its own keys.
    const onKey = (e: KeyboardEvent): void => {
      if (askingNow.current) return
      if (pressed(e, 'sheet.close')) {
        e.preventDefault()
        e.stopPropagation()
        act.current.leave()
      } else if (pressed(e, 'board.undo')) {
        e.preventDefault()
        e.stopPropagation()
        act.current.undo()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      const now = document.activeElement
      if (before instanceof HTMLElement && before.isConnected && (now === null || now === document.body || !now.isConnected)) before.focus()
    }
  }, [])

  /** Where the pointer is on the board, in board pixels. */
  const at = (e: { clientX: number; clientY: number }, box: DOMRect): [number, number] => [((e.clientX - box.left) * size.width) / box.width, ((e.clientY - box.top) * size.height) / box.height]
  const onDown = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (e.button !== 0 || drawing.current || saving) return
    e.currentTarget.setPointerCapture(e.pointerId)
    // The keys stay with the board.
    sheet.current?.focus({ preventScroll: true })
    const [x, y] = at(e, e.currentTarget.getBoundingClientRect())
    const width = tool.current === 'eraser' ? ERASER_WIDTH : PEN_WIDTHS[tool.current]
    const stroke: Stroke = { tool: tool.current === 'eraser' ? 'eraser' : 'pen', width, points: [[Math.round(x * 10) / 10, Math.round(y * 10) / 10]] }
    drawing.current = { stroke, pointer: e.pointerId, painted: 0 }
    const ctx = e.currentTarget.getContext('2d')!
    paintStroke(ctx, stroke, lookNow.current())
    drawing.current.painted = 1
  }
  const onMove = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const d = drawing.current
    if (!d || d.pointer !== e.pointerId) return
    const ctx = e.currentTarget.getContext('2d')!
    const box = e.currentTarget.getBoundingClientRect()
    // The moves the browser folded into this one are in the coalesced events: a quick line stays smooth.
    if (e.shiftKey) {
      // Shift: a straight line from where the stroke began to the pointer; the whole stroke is drawn anew.
      straighten(d.stroke, ...at(e.nativeEvent, box))
      repaint()
      paintStroke(ctx, d.stroke, lookNow.current())
      d.painted = d.stroke.points.length
      return
    }
    for (const one of e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent]) addPoint(d.stroke, ...at(one, box))
    if (d.stroke.points.length > d.painted) {
      paintStroke(ctx, d.stroke, lookNow.current(), d.painted)
      d.painted = d.stroke.points.length
    }
  }
  const onUp = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const d = drawing.current
    if (!d || d.pointer !== e.pointerId) return
    drawing.current = null
    if (e.shiftKey) straighten(d.stroke, ...at(e.nativeEvent, e.currentTarget.getBoundingClientRect()))
    strokes.current.push(d.stroke)
    dirty.current = true
    setCount(strokes.current.length)
  }

  return (
    <div className="board-layer">
      <section
        ref={sheet}
        className="board-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onKeyDown={(e) => {
          // No key of what is under it is handed on.
          e.stopPropagation()
          if (!pressed(e, 'sheet.round')) return
          const stops = [...sheet.current!.querySelectorAll<HTMLElement>(FOCUSABLE)]
          if (stops.length === 0) return e.preventDefault()
          const place = stops.indexOf(document.activeElement as HTMLElement)
          if (e.shiftKey ? place <= 0 : place === stops.length - 1) {
            e.preventDefault()
            stops[e.shiftKey ? stops.length - 1 : 0].focus()
          }
        }}
      >
        <header className="board-head">
          <h2>{title}</h2>
          <p className="board-hint">{words}</p>
        </header>
        <div className="board-tools" role="toolbar" aria-label="Drawing tools">
          <span className="view-switch" role="group" aria-label="Tool">
            {TOOLS.map((t) => (
              <button
                key={t.id}
                type="button"
                className="button button-quiet"
                aria-pressed={chosen === t.id}
                onClick={() => {
                  tool.current = t.id
                  setChosen(t.id)
                }}
              >
                {t.label}
              </button>
            ))}
          </span>
          {tools}
          <span className="spacer" />
          <button type="button" className="button button-quiet" disabled={count === 0 || saving} title={`Take the last stroke back (${hint('board.undo')})`} onClick={undo}>
            Undo
          </button>
          <button type="button" className="button button-quiet" disabled={count === 0 || saving} onClick={clear}>
            Clear
          </button>
        </div>
        <div className="board-stage">
          <canvas
            ref={canvas}
            className="board-canvas"
            width={size.width}
            height={size.height}
            style={{ '--board-aspect': String(size.width / size.height), '--grid-x': String(size.width / GRID_STEP), '--grid-y': String(size.height / GRID_STEP), ...(under ? { backgroundImage: `url("${under}")` } : {}) } as CSSProperties}
            data-ground={under ? '' : undefined}
            data-grid={grid && !ground && !background ? '' : undefined}
            aria-label="Drawing area"
            data-strokes={count}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          />
        </div>
        {asking && (
          <Confirm label={discard.label} accept="Discard" cancel="Keep drawing" onCancel={() => setAsking(false)} onAccept={onCancel}>
            {discard.text}
          </Confirm>
        )}
        <footer className="board-foot">
          {problem !== null ? (
            <p className="board-problem" role="alert">
              {problem}
            </p>
          ) : (
            <p className="board-size">{foot ?? ''}</p>
          )}
          <button type="button" className="button" disabled={saving} title={`Put the board away without keeping this (${hint('sheet.close')})`} onClick={leave}>
            Cancel
          </button>
          <button type="button" className="button button-primary" disabled={saving || count === 0} onClick={() => void done()}>
            Done
          </button>
        </footer>
      </section>
    </div>
  )
}
