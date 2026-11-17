import { memo, useEffect, useMemo, useRef, useState, type PointerEvent, type RefObject } from 'react'
import { number } from '../../../shared/format'
import { hint, pressed, viewKey } from '../../../shared/keys'
import type { DimensionMark } from '../../../shared/marks'
import { colorsOfParts } from '../../../shared/palette'
import { MAX_LABEL_TEXT } from '../../../shared/tracings'
import { niceLength, tracingSvg } from '../../../shared/tracingSvg'
import { isExploded } from '../../../shared/explode'
import { memoryEpoch, onBoardForgotten } from '../../state/board'
import { useStore } from '../../state/store'
import { buildName, NO_OWN_LAYER, openTracing, traceTarget, tracingActions, tracingsStore, useTracings } from '../../state/tracings'
import { useHistory } from '../useHistory'
import { chosen, giveKeysBack, pointerChoice, TYPING } from '../typing'
import { NewTracing } from './NewTracing'
import { paintGrid } from './gridPaint'
import { Palette } from './Palette'
import { axisOfDirection, countRender, PX_PER_MM, ratioText, Sheet, type View } from './Sheet'
import { snapAt, type Snapped } from './snap'
import { TraceTool } from './traceTool'
import { TracingPanel } from './TracingPanel'

// A tracing at true scale, in place of the 3D view: a sheet with the kernel's outline on a millimetre grid, which the sheet's
// own transform moves and scales (`Sheet`), a panel of what the tracing is, a picker of which is shown, the scale bar and the
// title block, and a readout of where the pointer is on the plane. The Trace tool puts a line, a circle or a label into the
// person's layer, snapping to the cut's own points; what is under way is drawn on a layer of its own. Panning, zooming, the
// readout, the grid and the draft are made on the elements and never go through React state, so nothing is drawn again for them (`__tornoTracingRenders` counts the layer's draws under
// test). The 3D view stays mounted under it and draws nothing meanwhile.

/** Where each tracing's sheet was left, so that it comes back as it was in this window. */
const left = new Map<string, View>()
onBoardForgotten(() => left.clear())

const underTest = typeof location !== 'undefined' && new URLSearchParams(location.search).has('test')

/** Pixels a wheel notch of each kind is worth. */
const wheelPixels = (e: WheelEvent): number => (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1)

/** The picker's last choice, which makes a tracing rather than showing one. */
const NEW = '__new'

/** How far the pointer may move with a button down for the press still to be a click, in pixels. */
const CLICK_SLOP = 4

/** How long the scale bar is meant to be on screen, in pixels, before it is made a round length. */
const SCALE_BAR_PX = 120

/** The rows of the title block the window shows, in its order: the build is put after the plane, and the scale is the live zoom. */
const BLOCK_ROWS = ['Project', 'Tracing', 'Plane', 'Sheet axes', 'Photo', 'Source']

/** The drawing's layer: its markup is set by the string, and nothing draws it again unless the string changes. */
const SheetLayer = memo(function SheetLayer({ svg }: { svg: string }) {
  countRender()
  return <svg className="tr-drawing" width="1" height="1" aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />
})

/** The millimetre grid, painted from where the sheet stands (`paintGrid`): two tilings of the whole screen and the lines of u = 0 and v = 0. Written on, never drawn again. */
const Grid = memo(function Grid({ gridRef }: { gridRef: RefObject<SVGSVGElement | null> }) {
  return (
    <svg ref={gridRef} className="tr-grid-layer" aria-hidden="true">
      <defs>
        <pattern id="tr-pattern-fine" data-grid="fine" patternUnits="userSpaceOnUse" width="1" height="1">
          <path data-grid="fine-path" className="tr-grid-fine" d="" />
        </pattern>
        <pattern id="tr-pattern-coarse" data-grid="coarse" patternUnits="userSpaceOnUse" width="1" height="1">
          <path data-grid="coarse-path" className="tr-grid" d="" />
        </pattern>
      </defs>
      <rect data-grid="fine-rect" width="100%" height="100%" fill="url(#tr-pattern-fine)" />
      <rect width="100%" height="100%" fill="url(#tr-pattern-coarse)" />
      <line data-grid="axis-v" className="tr-axis tr-axis-v" y1="0" y2="100%" />
      <line data-grid="axis-u" className="tr-axis tr-axis-u" x1="0" x2="100%" />
    </svg>
  )
})

export function TracingView() {
  const objectId = useTracings((s) => s.objectId)
  const open = useTracings((s) => s.open)
  const tracings = useTracings((s) => s.file?.tracings)
  const tracing = useTracings((s) => openTracing(s))
  const cut = useTracings((s) => (s.open === null ? null : (s.cuts[s.open] ?? null)))
  const building = useTracings((s) => s.building)
  const problem = useTracings((s) => s.problem)
  const removed = useTracings((s) => s.removed)
  const tool = useTracings((s) => s.tool)
  const traceMode = useTracings((s) => s.trace)
  const target = useTracings((s) => traceTarget(s))
  const marks = useStore((s) => s.marks)
  const scene = useStore((s) => s.scene)
  const explode = useStore((s) => s.explode)
  const history = useHistory(cut !== null)
  const [making, setMaking] = useState(false)
  const [sheet, setSheet] = useState<Sheet | null>(null)
  /** Where a label waits for its text, in the plane. */
  const [labelAt, setLabelAt] = useState<[number, number] | null>(null)
  const root = useRef<HTMLElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const layerEl = useRef<HTMLDivElement>(null)
  const gridEl = useRef<SVGSVGElement>(null)
  const draftEl = useRef<SVGSVGElement>(null)
  const labelEl = useRef<HTMLInputElement>(null)
  const hintEl = useRef<HTMLSpanElement>(null)
  const readout = useRef<HTMLSpanElement>(null)
  const bar = useRef<HTMLSpanElement>(null)
  const barLabel = useRef<HTMLSpanElement>(null)
  /** A press on the sheet: where it was last moved to, where it began, and whether it is a click that may become a drag. */
  const press = useRef<{ x: number; y: number; from: { x: number; y: number }; click: boolean; moved: boolean } | null>(null)
  /** Where the pointer is on the plane, and what it snapped to: for the draft, never state. */
  const hover = useRef<{ uv: [number, number]; snap?: Snapped } | null>(null)
  const down = useRef(false)
  const paint = useRef<() => void>(() => {})
  /** The sheet that was last fitted or restored: a tracing is fitted the first time its outline is there, and then left where the person put it. */
  const placed = useRef<string | null>(null)
  const built = cut === null ? null : buildName(history, cut.revision)
  const key = objectId !== null && open !== null ? `${objectId}/${open}` : null

  // The Trace tool's own state: what is put down so far. A finished shape goes to main; a label waits for its text.
  const trace = useRef<TraceTool | null>(null)
  if (trace.current === null) {
    trace.current = new TraceTool(
      (shape) => void tracingActions.addShape(shape),
      () => {
        paint.current()
        setLabelAt(trace.current?.draft.label ?? null)
      }
    )
  }

  const drawing = useMemo(() => {
    if (tracing === undefined || cut === null) return null
    return tracingSvg(
      cut.cut,
      {
        object: objectId ?? '',
        layout: tracing.layout,
        revision: cut.revision,
        date: new Date(),
        marks: marks.filter((m): m is DimensionMark => m.kind === 'dimension'),
        spread: isExploded(explode[tracing.layout]),
        tracing: { id: tracing.id, name: tracing.name, plane: tracing.plane.label }
      },
      { forScreen: true, layers: tracing.layers }
    )
  }, [tracing, cut, marks, explode, objectId])
  down.current = drawing?.down ?? false

  // What is under way, drawn on the draft layer: the shapes so far to the pointer, and a ring where the pointer snapped.
  paint.current = () => {
    const el = draftEl.current
    const t = trace.current
    if (!el || !t) return
    const on = tracingsStore.getState().tool === 'trace'
    const k = sheet?.view.k ?? PX_PER_MM
    let out = on ? t.elements(hover.current?.uv ?? null, down.current, k) : ''
    const snap = on ? hover.current?.snap : undefined
    if (snap) {
      const [x, y] = [snap.uv[0], down.current ? snap.uv[1] : -snap.uv[1]]
      out += `<circle class="tr-snap${snap.snap.kind === 'vertex' && snap.snap.projected ? ' tr-snap-projected' : ''}" cx="${Math.round(x * 1000) / 1000 + 0}" cy="${Math.round(y * 1000) / 1000 + 0}" r="${Math.round((6 / k) * 1000) / 1000}"/>`
    }
    el.innerHTML = out
  }

  // What floats over the sheet's top left, as far as its right and bottom edges on the stage: Fit leaves the outline clear of it.
  const clearOfPanel = (): { right: number; bottom: number } | undefined => {
    const panel = root.current?.querySelector('.tr-panel')
    const at = stage.current?.getBoundingClientRect()
    if (!panel || !at) return undefined
    const p = panel.getBoundingClientRect()
    return { right: p.right - at.left, bottom: p.bottom - at.top }
  }

  // Where the label's field stands: on its point of the plane, moved with the sheet.
  const placeLabel = (made: Sheet | null = sheet): void => {
    const input = labelEl.current
    const at = trace.current?.draft.label
    if (!input || !made || !at) return
    const [x, y] = made.toScreen(at)
    const r = stage.current?.getBoundingClientRect()
    input.style.transform = `translate(${Math.round(x - (r?.left ?? 0))}px, ${Math.round(y - (r?.top ?? 0))}px)`
  }

  // The sheet: made once for the element, and its own while the view is on. What it does is written on the elements.
  useEffect(() => {
    const stageEl = stage.current!
    const root_ = root.current!
    const made: Sheet = new Sheet(layerEl.current!, () => {
      const text = ratioText(made.zoomRatio())
      for (const el of root_.querySelectorAll('[data-zoom]')) el.textContent = text
      if (gridEl.current) paintGrid(gridEl.current, made.view)
      // The scale bar is a round length that is about as long on screen as it always is.
      const length = niceLength(SCALE_BAR_PX / made.view.k)
      if (bar.current) bar.current.style.width = `${length * made.view.k}px`
      if (barLabel.current) barLabel.current.textContent = `${number(length)} mm`
      if (tracingsStore.getState().tool === 'trace') paint.current()
      const input = labelEl.current
      const at = trace.current?.draft.label
      if (input && at) {
        const [x, y] = made.toScreen(at)
        const r = stageEl.getBoundingClientRect()
        input.style.transform = `translate(${Math.round(x - r.left)}px, ${Math.round(y - r.top)}px)`
      }
    })
    const epoch = memoryEpoch()
    setSheet(made)
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const unit = wheelPixels(e)
      if (e.ctrlKey) made.zoomAt(Math.exp((-e.deltaY * unit) / 500), e.clientX, e.clientY)
      else made.pan(-e.deltaX * unit, -e.deltaY * unit)
    }
    stageEl.addEventListener('wheel', onWheel, { passive: false })
    if (underTest) window.__tornoTracingSheet = () => ({ ...made.view, ratio: made.zoomRatio() })
    made.pan(0, 0)
    const was = key
    return () => {
      stageEl.removeEventListener('wheel', onWheel)
      // Not into a workspace that has been left meanwhile: a project of that name there is another.
      if (was !== null && epoch === memoryEpoch()) left.set(was, made.view)
      if (underTest) delete window.__tornoTracingSheet
    }
  }, [key])

  // Where the sheet stands for this tracing: as it was left, or, the first time its outline is there, fitted.
  useEffect(() => {
    if (!sheet) return
    sheet.setDown(drawing?.down ?? false)
    sheet.setBox(drawing?.box ?? null)
    // What the readouts say of the zoom is the sheet's: told again to what has just come into the page (the title block).
    sheet.refresh()
    if (key === null || placed.current === key) return
    const kept = left.get(key)
    if (kept) {
      sheet.restore(kept)
      placed.current = key
    } else if (drawing !== null && (stage.current?.getBoundingClientRect().width ?? 0) > 0) {
      sheet.fit(clearOfPanel())
      placed.current = key
    }
  }, [sheet, drawing, key])

  // What is traced follows the palette and the panel: another way of tracing, another layer, or another tool gives up what was under way.
  useEffect(() => {
    const t = trace.current!
    t.cancel()
    t.setMode(traceMode)
    hover.current = null
    if (hintEl.current) hintEl.current.textContent = ''
    paint.current()
  }, [tool, traceMode, target?.id])

  // The label's field takes the focus where it opens, and stands on its point.
  useEffect(() => {
    if (labelAt === null) return
    placeLabel()
    labelEl.current?.focus({ preventScroll: true })
  }, [labelAt])

  // Each part's tab in its own colour: the drawing names the part, and the palette is the 3D view's.
  useEffect(() => {
    const colours = colorsOfParts(scene?.parts ?? [])
    for (const group of layerEl.current?.querySelectorAll<SVGGElement>('[data-part-name]') ?? []) {
      const colour = colours.get(group.dataset.partName ?? '')
      const tab = group.querySelector<SVGRectElement>('.tr-tab')
      if (colour && tab) tab.style.fill = colour
    }
  }, [drawing, scene])

  // The keys of the sheet, and none of the view's: it hears nothing while a tracing is shown.
  useEffect(() => {
    if (!sheet) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.target instanceof Element && e.target.closest(TYPING)) return
      const stop = (): void => {
        e.preventDefault()
        e.stopPropagation()
      }
      const tracing_ = tracingsStore.getState().tool === 'trace'
      // The tool's keys are for the sheet: not for a button of the panel that has the focus.
      const onSheet = e.target === document.body || (e.target instanceof Node && stage.current?.contains(e.target) === true)
      if (pressed(e, 'tracing.fit')) {
        stop()
        sheet.fit(clearOfPanel())
      } else if (pressed(e, 'tracing.actual')) {
        stop()
        sheet.actual()
      } else if (!e.repeat && pressed(e, 'tracing.select')) {
        stop()
        tracingActions.setTool('select')
      } else if (!e.repeat && pressed(e, 'tracing.trace')) {
        stop()
        tracingActions.setTool('trace')
      } else if (tracing_ && onSheet && pressed(e, 'tracing.end')) {
        if (trace.current?.end()) stop()
      } else if (tracing_ && onSheet && pressed(e, 'tracing.back')) {
        if (trace.current?.back()) stop()
      } else if (tracing_ && pressed(e, 'tracing.leave')) {
        stop()
        // What is under way first, then the tool.
        if (!trace.current?.cancel()) tracingActions.setTool('select')
      } else if (viewKey(e)) e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [sheet])

  // The undo of a removal is offered for a while.
  useEffect(() => {
    if (removed === null) return
    const timer = setTimeout(tracingActions.forgetRemoved, 10_000)
    return () => clearTimeout(timer)
  }, [removed])
  const layerRemoved = useTracings((s) => s.layerRemoved)
  useEffect(() => {
    if (layerRemoved === null) return
    const timer = setTimeout(tracingActions.forgetLayerRemoved, 10_000)
    return () => clearTimeout(timer)
  }, [layerRemoved])

  /** What the pointer is on: a point of the cut's it snaps to, or the point of the plane under it. */
  function under(e: PointerEvent<HTMLElement>): { uv: [number, number]; snap?: Snapped } | null {
    if (!sheet) return null
    const raw = sheet.toUv(e.clientX, e.clientY)
    const snap = tool === 'trace' ? snapAt(cut?.snaps ?? [], raw, sheet.view.k, e.ctrlKey) : null
    return snap === null ? { uv: raw } : { uv: snap.uv, snap }
  }

  function point(e: PointerEvent<HTMLElement>): void {
    const at = under(e)
    if (!at || !readout.current) return
    readout.current.textContent = `${number(at.uv[0])}, ${number(at.uv[1])}`
    if (tool !== 'trace') return
    hover.current = at
    const el = hintEl.current
    if (el) {
      el.textContent = at.snap?.hint ?? ''
      const r = stage.current?.getBoundingClientRect()
      el.style.transform = `translate(${Math.round(e.clientX - (r?.left ?? 0) + 14)}px, ${Math.round(e.clientY - (r?.top ?? 0) + 18)}px)`
    }
    paint.current()
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>): void {
    if (e.button > 2 || !sheet) return
    e.currentTarget.focus({ preventScroll: true })
    e.preventDefault()
    // With Trace in hand the left button places a point; a press that moves far is a drag, which moves the sheet as it always did.
    press.current = { x: e.clientX, y: e.clientY, from: { x: e.clientX, y: e.clientY }, click: tool === 'trace' && e.button === 0, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>): void {
    point(e)
    const was = press.current
    if (!was || !sheet) return
    if (was.click && !was.moved) {
      if (Math.hypot(e.clientX - was.from.x, e.clientY - was.from.y) < CLICK_SLOP) return
      was.moved = true
    }
    e.currentTarget.setAttribute('data-panning', '')
    sheet.pan(e.clientX - was.x, e.clientY - was.y)
    was.x = e.clientX
    was.y = e.clientY
  }

  function onPointerEnd(e: PointerEvent<HTMLDivElement>): void {
    const was = press.current
    if (!was) return
    press.current = null
    e.currentTarget.removeAttribute('data-panning')
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    if (e.type === 'pointerup' && was.click && !was.moved && sheet) placePoint(e)
  }

  /** A click with Trace in hand: a point of the shape under way, or a refusal when there is no layer of the person's to put it in. */
  function placePoint(e: PointerEvent<HTMLElement>): void {
    if (traceTarget(tracingsStore.getState()) === undefined) return tracingActions.say(NO_OWN_LAYER)
    const at = under(e)
    if (at && sheet) trace.current?.click({ uv: at.uv, snapped: at.snap !== undefined }, sheet.view.k)
  }

  const axes = tracing === undefined ? null : { u: axisOfDirection(tracing.plane.x), v: axisOfDirection(tracing.plane.y) }
  const rows = drawing === null ? [] : BLOCK_ROWS.flatMap((label) => drawing.titleRows.filter(([l]) => l === label))
  const buildRow = built === null ? null : ([['Build', building ? `of ${built}; building…` : built]] as Array<[string, string]>)
  const planeAt = rows.findIndex(([l]) => l === 'Plane')
  const block = [...rows.slice(0, planeAt + 1), ...(buildRow ?? []), ...rows.slice(planeAt + 1)]

  return (
    <section ref={root} className="tracing" aria-label="Tracing" data-tracing-view="">
      <div
        ref={stage}
        className="tr-stage"
        role="region"
        aria-label="Sheet of the tracing"
        aria-description={`Drag moves around, Ctrl and the wheel zooms, ${hint('tracing.fit')} fits the outline and ${hint('tracing.actual')} shows it at true size`}
        tabIndex={0}
        data-tool={tool}
        data-axis-u={axes?.u ?? undefined}
        data-axis-v={axes?.v ?? undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onPointerLeave={() => {
          if (readout.current) readout.current.textContent = '–'
          hover.current = null
          if (hintEl.current) hintEl.current.textContent = ''
          paint.current()
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <Grid gridRef={gridEl} />
        <div ref={layerEl} className="tr-sheet-layer">
          <SheetLayer svg={drawing?.svg ?? ''} />
          <svg ref={draftEl} className={`tr-draft tr-layer-${target?.colour ?? 'slate'}`} width="1" height="1" aria-hidden="true" />
        </div>
        <span ref={hintEl} className="tr-pointer-hint" aria-hidden="true" />
        {labelAt !== null && (
          <input
            ref={labelEl}
            className="tr-label-input"
            aria-label="Text of the label"
            maxLength={MAX_LABEL_TEXT}
            placeholder="Label"
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              const keep = pressed(e, 'field.keep')
              if (keep || pressed(e, 'field.leave')) {
                if (!keep) e.currentTarget.value = ''
                e.preventDefault()
                e.stopPropagation()
                e.currentTarget.blur()
                giveKeysBack(e.currentTarget)
              }
            }}
            onBlur={(e) => void trace.current?.text(e.currentTarget.value)}
          />
        )}
      </div>

      {tracing !== undefined && drawing === null && (
        <p className="tr-empty" role="status">
          {building ? 'Building…' : 'Build to see the outline'}
        </p>
      )}

      {tracing !== undefined && <Palette />}

      <div className="tr-head">
        {tracings !== undefined && tracings.length > 0 && (
          <select
            className="tr-picker"
            aria-label="Tracing shown"
            value={open ?? ''}
            {...pointerChoice}
            onChange={(e) => {
              chosen(e.currentTarget)
              if (e.currentTarget.value === '') return
              if (e.currentTarget.value === NEW) setMaking(true)
              else {
                setMaking(false)
                tracingActions.open(e.currentTarget.value)
              }
            }}
          >
            {tracings.map((t) => (
              <option key={t.id} value={t.id}>
                {t.id}
                {t.name === '' ? '' : ` ${t.name}`}
              </option>
            ))}
            <option value={NEW}>New tracing</option>
          </select>
        )}
        <span className="viewbar-rule" aria-hidden="true" />
        <button type="button" className="bar-button" aria-keyshortcuts={hint('tracing.fit')} title={`Fit the outline (${hint('tracing.fit')})`} onClick={() => sheet?.fit(clearOfPanel())}>
          Fit
        </button>
        <button type="button" className="bar-button" aria-keyshortcuts={hint('tracing.actual')} title={`True size, a millimetre for a millimetre (${hint('tracing.actual')})`} onClick={() => sheet?.actual()}>
          1:1
        </button>
        <span className="tr-zoom num" data-zoom="" aria-label="Zoom">
          1:1
        </span>
      </div>

      {making && tracing !== undefined && (
        <div className="tr-popover">
          <NewTracing onDone={() => setMaking(false)} />
        </div>
      )}

      {tracing !== undefined ? (
        <TracingPanel />
      ) : (
        <div className="tr-none">
          <h2 className="tr-none-title">No tracings yet</h2>
          <p className="tr-note">A tracing lays one plane of the model flat at true size, on a millimetre grid, to draw on and measure.</p>
          {removed !== null && (
            <p className="tr-undo" role="status">
              {removed.name === '' ? removed.id : `${removed.id} ${removed.name}`} removed.{' '}
              <button type="button" className="link-button" onClick={() => void tracingActions.undoRemove()}>
                Undo
              </button>
            </p>
          )}
          <NewTracing onDone={() => {}} />
        </div>
      )}

      {tracing !== undefined && removed !== null && (
        <p className="tr-undo tr-undo-float" role="status">
          {removed.name === '' ? removed.id : `${removed.id} ${removed.name}`} removed.{' '}
          <button type="button" className="link-button" onClick={() => void tracingActions.undoRemove()}>
            Undo
          </button>
        </p>
      )}

      {problem !== null && (
        <p className="tr-problem selectable" role="status">
          {problem}{' '}
          <button type="button" className="link-button" onClick={tracingActions.dismissProblem}>
            Dismiss
          </button>
        </p>
      )}

      <div className="tr-scale" aria-hidden="true">
        <span ref={bar} className="tr-scale-bar" />
        <span ref={barLabel} className="tr-scale-label num">
          {number(niceLength(SCALE_BAR_PX / PX_PER_MM))} mm
        </span>
      </div>

      <div className="tr-readout" aria-live="off">
        <span className="tr-readout-label">u, v</span>
        <span ref={readout} className="num tr-readout-value">
          –
        </span>
        <span className="tr-readout-unit">mm</span>
      </div>

      {drawing !== null && (
        <dl className="tr-block" aria-label="Title block">
          {block.map(([label, text]) => (
            <div key={label} className="tr-block-row">
              <dt>{label}</dt>
              <dd className="num">{text}</dd>
            </div>
          ))}
          <div className="tr-block-row">
            <dt>Zoom</dt>
            <dd className="num" data-zoom="">
              1:1
            </dd>
          </div>
        </dl>
      )}
    </section>
  )
}
