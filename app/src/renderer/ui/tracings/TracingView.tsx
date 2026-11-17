import { memo, useEffect, useMemo, useRef, useState, type PointerEvent, type RefObject } from 'react'
import { number } from '../../../shared/format'
import { hint, pressed, viewKey } from '../../../shared/keys'
import type { DimensionMark } from '../../../shared/marks'
import { colorsOfParts } from '../../../shared/palette'
import { niceLength, tracingSvg } from '../../../shared/tracingSvg'
import { isExploded } from '../../../shared/explode'
import { memoryEpoch, onBoardForgotten } from '../../state/board'
import { useStore } from '../../state/store'
import { buildName, openTracing, tracingActions, useTracings } from '../../state/tracings'
import { useHistory } from '../useHistory'
import { chosen, pointerChoice, TYPING } from '../typing'
import { NewTracing } from './NewTracing'
import { axisOfDirection, countRender, PX_PER_MM, ratioText, Sheet, type View } from './Sheet'
import { TracingPanel } from './TracingPanel'

// A tracing at true scale, in place of the 3D view: a sheet with the kernel's outline on a millimetre grid, which the sheet's
// own transform moves and scales (`Sheet`), a panel of what the tracing is, a picker of which is shown, the scale bar and the
// title block, and a readout of where the pointer is on the plane. Panning, zooming and the readout are made on the elements
// and never go through React state, so nothing is drawn again for them (`__tornoTracingRenders` counts the layer's draws under
// test). The 3D view stays mounted under it and draws nothing meanwhile.

/** Where each tracing's sheet was left, so that it comes back as it was in this window. */
const left = new Map<string, View>()
onBoardForgotten(() => left.clear())

const underTest = typeof location !== 'undefined' && new URLSearchParams(location.search).has('test')

/** Pixels a wheel notch of each kind is worth. */
const wheelPixels = (e: WheelEvent): number => (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1)

/** The picker's last choice, which makes a tracing rather than showing one. */
const NEW = '__new'

/** The 1 mm grid is drawn from this zoom: further out its lines are a few pixels apart and only blur. */
const FINE_GRID_FROM = 0.8

/** How long the scale bar is meant to be on screen, in pixels, before it is made a round length. */
const SCALE_BAR_PX = 120

/** The rows of the title block the window shows, in its order: the build is put after the plane, and the scale is the live zoom. */
const BLOCK_ROWS = ['Project', 'Tracing', 'Plane', 'Sheet axes', 'Photo', 'Source']

/** The drawing's layer: its markup is set by the string, and nothing draws it again unless the string changes. */
const SheetLayer = memo(function SheetLayer({ svg, layerRef }: { svg: string; layerRef: RefObject<SVGSVGElement | null> }) {
  countRender()
  return <svg ref={layerRef} className="tr-sheet-layer" width="1" height="1" aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />
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
  const marks = useStore((s) => s.marks)
  const scene = useStore((s) => s.scene)
  const explode = useStore((s) => s.explode)
  const history = useHistory(cut !== null)
  const [making, setMaking] = useState(false)
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const root = useRef<HTMLElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const layerEl = useRef<SVGSVGElement>(null)
  const readout = useRef<HTMLSpanElement>(null)
  const bar = useRef<HTMLSpanElement>(null)
  const barLabel = useRef<HTMLSpanElement>(null)
  const panning = useRef<{ x: number; y: number } | null>(null)
  /** The sheet that was last fitted or restored: a tracing is fitted the first time its outline is there, and then left where the person put it. */
  const placed = useRef<string | null>(null)
  const built = cut === null ? null : buildName(history, cut.revision)
  const key = objectId !== null && open !== null ? `${objectId}/${open}` : null

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
      { forScreen: true, grid: 1, layers: tracing.layers }
    )
  }, [tracing, cut, marks, explode, objectId])

  // The sheet: made once for the element, and its own while the view is on. What it does is written on the elements.
  useEffect(() => {
    const stageEl = stage.current!
    const root_ = root.current!
    const made: Sheet = new Sheet(layerEl.current!, () => {
      const ratio = made.zoomRatio()
      if (ratio >= FINE_GRID_FROM) stageEl.setAttribute('data-fine', '')
      else stageEl.removeAttribute('data-fine')
      const text = ratioText(ratio)
      for (const el of root_.querySelectorAll('[data-zoom]')) el.textContent = text
      // The scale bar is a round length that is about as long on screen as it always is.
      const length = niceLength(SCALE_BAR_PX / made.view.k)
      if (bar.current) bar.current.style.width = `${length * made.view.k}px`
      if (barLabel.current) barLabel.current.textContent = `${number(length)} mm`
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
      sheet.fit()
      placed.current = key
    }
  }, [sheet, drawing, key])

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
      if (pressed(e, 'tracing.fit')) {
        e.preventDefault()
        e.stopPropagation()
        sheet.fit()
      } else if (pressed(e, 'tracing.actual')) {
        e.preventDefault()
        e.stopPropagation()
        sheet.actual()
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

  function point(e: PointerEvent<HTMLElement>): void {
    if (!sheet || !readout.current) return
    const [u, v] = sheet.toUv(e.clientX, e.clientY)
    readout.current.textContent = `${number(u)}, ${number(v)}`
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>): void {
    if (e.button > 2 || !sheet) return
    e.currentTarget.focus({ preventScroll: true })
    e.preventDefault()
    panning.current = { x: e.clientX, y: e.clientY }
    e.currentTarget.setPointerCapture(e.pointerId)
    e.currentTarget.setAttribute('data-panning', '')
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>): void {
    point(e)
    const was = panning.current
    if (!was || !sheet) return
    sheet.pan(e.clientX - was.x, e.clientY - was.y)
    panning.current = { x: e.clientX, y: e.clientY }
  }

  function onPointerEnd(e: PointerEvent<HTMLDivElement>): void {
    if (!panning.current) return
    panning.current = null
    e.currentTarget.removeAttribute('data-panning')
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
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
        data-axis-u={axes?.u ?? undefined}
        data-axis-v={axes?.v ?? undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onPointerLeave={() => readout.current && (readout.current.textContent = '–')}
        onContextMenu={(e) => e.preventDefault()}
      >
        <SheetLayer svg={drawing?.svg ?? ''} layerRef={layerEl} />
      </div>

      {tracing !== undefined && drawing === null && (
        <p className="tr-empty" role="status">
          {building ? 'Building…' : 'Build to see the outline'}
        </p>
      )}

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
        <button type="button" className="bar-button" aria-keyshortcuts={hint('tracing.fit')} title={`Fit the outline (${hint('tracing.fit')})`} onClick={() => sheet?.fit()}>
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
